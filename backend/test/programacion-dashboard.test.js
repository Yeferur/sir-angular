const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const permissionsService = require('../services/Permisos/permisos.service');
const {
  invalidarCacheUsuario,
} = require('../middlewares/permissionsMiddleware');
const { authMiddleware } = require('../middlewares/authMiddleware');
const programacionRouter = require('../routes/Programacion/programacion.routes');
const toursRouter = require('../routes/Tours/tours.routes');
const inicioRouter = require('../routes/inicio.routes');
const {
  obtenerDatosInicio,
  obtenerResumenToursProgramacion,
} = require('../services/inicio.service');

let nextUserId = 871000000;

function findEndpoint(router, method, path) {
  const layer = router.stack.find((entry) => (
    entry.route?.path === path && entry.route.methods?.[method]
  ));
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} to be registered`);
  return layer.route.stack.map((entry) => entry.handle);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runMiddleware(middleware, req) {
  const res = makeResponse();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { statusCode: res.statusCode, body: res.body, nextCalled };
}

async function withEffectivePermissions(codes, callback) {
  const userId = ++nextUserId;
  const original = permissionsService.obtenerPermisosPorUsuario;
  invalidarCacheUsuario(userId);
  permissionsService.obtenerPermisosPorUsuario = async () => (
    codes.map((Codigo_Permiso) => ({ Codigo_Permiso }))
  );

  try {
    await callback(userId);
  } finally {
    permissionsService.obtenerPermisosPorUsuario = original;
    invalidarCacheUsuario(userId);
  }
}

async function checkRoutePermission(handlers, userId) {
  assert.equal(handlers[0], authMiddleware);
  const req = { user: { id: userId, isClient: false } };
  return runMiddleware(handlers[1], req);
}

test('el resumen del dashboard solo devuelve datos operativos requeridos por Programación', async (t) => {
  const originalQuery = db.query;
  const capturedQueries = [];
  const fixture = [
    { Id_Tour: 1, Nombre_Tour: 'Medellín', cupos: 18, NumeroPasajeros: '12', totalReservas: '4', totalPrivados: '1' },
    { Id_Tour: 5, Nombre_Tour: 'Guatapé', cupos: 23, NumeroPasajeros: '9', totalReservas: '3', totalPrivados: '0' },
    { Id_Tour: 9, Nombre_Tour: 'Cañón', cupos: 0, NumeroPasajeros: '0', totalReservas: '0', totalPrivados: '0' },
  ];
  db.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('FROM tours t') && sql.includes('WHERE t.Activo = 1')) {
      return [[...fixture]];
    }
    return [[]];
  };
  t.after(() => { db.query = originalQuery; });

  const fecha = '2026-09-20';
  const previousImplementation = await obtenerDatosInicio(fecha);
  const dashboardSummary = await obtenerResumenToursProgramacion(fecha);
  const legacyRequest = capturedQueries.find(({ sql }) => sql.includes('AS cupos'));
  const summaryRequest = capturedQueries.find(({ sql }) => (
    sql.includes('FROM tours t') && !sql.includes('AS cupos')
  ));
  const legacyToursQuery = legacyRequest.sql;
  const summaryQuery = summaryRequest.sql;

  assert.deepEqual(
    dashboardSummary,
    previousImplementation.tours.map((tour) => ({
      Id_Tour: tour.Id_Tour,
      Nombre_Tour: tour.Nombre_Tour,
      NumeroPasajeros: tour.NumeroPasajeros,
      totalReservas: tour.totalReservas,
    }))
  );
  assert.equal(dashboardSummary[0].NumeroPasajeros, 12);
  assert.equal(dashboardSummary[0].totalReservas, 4);
  assert.deepEqual(dashboardSummary.map((tour) => [tour.Id_Tour, tour.NumeroPasajeros, tour.totalReservas]), [
    [1, 12, 4], [5, 9, 3], [9, 0, 0],
  ]);
  assert.equal(previousImplementation.tours[0].cupos, 18);
  assert.equal(previousImplementation.tours[0].totalPrivados, 1);
  assert.deepEqual(Object.keys(dashboardSummary[0]).sort(), [
    'Id_Tour', 'Nombre_Tour', 'NumeroPasajeros', 'totalReservas',
  ]);

  for (const alias of ['NumeroPasajeros', 'totalReservas']) {
    const startToken = alias === 'NumeroPasajeros'
      ? 'SELECT SUM(cnt_pasajeros)'
      : 'SELECT COUNT(r.Id_Reserva)';
    const expression = (sql) => {
      const start = sql.indexOf(startToken);
      const end = sql.indexOf(`AS ${alias}`, start) + `AS ${alias}`.length;
      assert.ok(start >= 0 && end > start, `Expected ${alias} metric in query`);
      return sql.slice(start, end);
    };
    assert.equal(expression(summaryQuery), expression(legacyToursQuery));
  }

  assert.match(summaryQuery, /WHERE t\.Activo = 1/);
  assert.match(summaryQuery, /ORDER BY t\.Nombre_Tour ASC/);
  assert.doesNotMatch(summaryQuery, /aforos|Cupo_Base|planes_tours|totalPrivados|PRIVADA|transfers/i);
  const activeReservationStates = [
    'ACTIVA', 'ACTIVO', 'PENDIENTE', 'PENDIENTEDATOS', 'CONFIRMADA', 'COMPLETADA',
  ];
  const expectedSummaryParams = [
    fecha, ...activeReservationStates,
    fecha, ...activeReservationStates,
  ];
  assert.deepEqual(summaryRequest.params, expectedSummaryParams);
  assert.deepEqual(summaryRequest.params, [
    legacyRequest.params[1],
    ...legacyRequest.params.slice(2, 8),
    legacyRequest.params[8],
    ...legacyRequest.params.slice(9, 15),
  ]);
});

test('el resumen de Programación requiere PROGRAMACION.LEER aunque falten Aforos y Tours', async () => {
  const handlers = findEndpoint(programacionRouter, 'get', '/programacion/resumen-dashboard');
  assert.equal(handlers.length, 3);
  const anonymous = await runMiddleware(authMiddleware, { headers: {} });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.nextCalled, false);

  await withEffectivePermissions(['PROGRAMACION.LEER'], async (userId) => {
    const result = await checkRoutePermission(handlers, userId);
    assert.equal(result.statusCode, 200);
    assert.equal(result.nextCalled, true);
  });

  await withEffectivePermissions([], async (userId) => {
    const result = await checkRoutePermission(handlers, userId);
    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
    assert.equal(result.body.permisoRequerido, 'PROGRAMACION.LEER');
  });

});

test('una denegación individual elimina PROGRAMACION.LEER heredado del rol', async () => {
  const handlers = findEndpoint(programacionRouter, 'get', '/programacion/resumen-dashboard');
  const userId = ++nextUserId;
  const originalGetConnection = db.getConnection;
  let effectivePermissionSql = '';
  invalidarCacheUsuario(userId);
  db.getConnection = async () => ({
    async query(sql) {
      if (sql.includes('SELECT r.Id_Rol')) {
        return [[{ Id_Rol: 17, Nombre_Rol: 'Operaciones' }]];
      }
      effectivePermissionSql = sql;
      // The role grants PROGRAMACION.LEER, but usuario_permisos contains DENY.
      return [[{ Codigo_Permiso: 'TOURS.LEER' }]];
    },
    release() {},
  });

  try {
    const result = await checkRoutePermission(handlers, userId);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.permisoRequerido, 'PROGRAMACION.LEER');
    assert.match(effectivePermissionSql, /COALESCE\(permiso_individual\.Tipo, ''\) <> 'DENY'/);
  } finally {
    db.getConnection = originalGetConnection;
    invalidarCacheUsuario(userId);
  }
});

test('las rutas originales de Tours y Aforos conservan sus permisos propios', async () => {
  const toursHandlers = findEndpoint(toursRouter, 'get', '/');
  const aforosHandlers = findEndpoint(inicioRouter, 'get', '/tours-data');

  await withEffectivePermissions(['PROGRAMACION.LEER'], async (userId) => {
    const toursResult = await checkRoutePermission(toursHandlers, userId);
    const aforosResult = await checkRoutePermission(aforosHandlers, userId);
    assert.equal(toursResult.statusCode, 403);
    assert.equal(toursResult.body.permisoRequerido, 'TOURS.LEER');
    assert.equal(aforosResult.statusCode, 403);
    assert.deepEqual(aforosResult.body.permisosRequeridos, ['AFOROS.LEER']);
  });

  await withEffectivePermissions(['TOURS.LEER'], async (userId) => {
    const result = await checkRoutePermission(toursHandlers, userId);
    assert.equal(result.statusCode, 200);
    assert.equal(result.nextCalled, true);
  });

  await withEffectivePermissions(['AFOROS.LEER'], async (userId) => {
    const result = await checkRoutePermission(aforosHandlers, userId);
    assert.equal(result.statusCode, 200);
    assert.equal(result.nextCalled, true);
  });
});
