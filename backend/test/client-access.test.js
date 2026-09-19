const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const fs = require('node:fs');
const path = require('node:path');
const {
  CLIENT_RESERVATION_PERMISSION_CODES,
  assertReservationOwner,
  isClientRoleName,
} = require('../utils/clientAccess');
const { filtrarReservas } = require('../services/Reservas/reservas.service');
const { searchGlobal, buildDateResult } = require('../services/Search/search.service');
const permissionsService = require('../services/Permisos/permisos.service');
const { checkAnyPermission } = require('../middlewares/permissionsMiddleware');

test('reconoce Cliente sin depender de mayúsculas y fija su alcance funcional', () => {
  assert.equal(isClientRoleName('  CLIENTE '), true);
  assert.equal(isClientRoleName('Asesor'), false);
  assert.deepEqual(CLIENT_RESERVATION_PERMISSION_CODES, [
    'RESERVAS.LEER',
    'RESERVAS.CREAR',
    'RESERVAS.ACTUALIZAR',
  ]);
  assert.equal(CLIENT_RESERVATION_PERMISSION_CODES.includes('RESERVAS.ELIMINAR'), false);
});

test('una reserva ajena se trata como inexistente', () => {
  assert.doesNotThrow(() => assertReservationOwner({ Creado_Por: 25 }, 25));
  assert.throws(
    () => assertReservationOwner({ Creado_Por: 99 }, 25),
    (error) => error.status === 404 && error.errorCode === 'RESERVA_NOT_FOUND'
  );
});

test('el listado de Cliente siempre agrega Creado_Por al conteo y a los datos', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  t.after(() => { db.query = originalQuery; });

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ total: 1 }]];
    return [[{ Id_Reserva: 'CLI00001', Estado: 'Confirmada' }]];
  };

  const result = await filtrarReservas({ page: 1, limit: 25 }, 77);
  assert.equal(result.total, 1);
  assert.match(calls[0].sql, /r\.Creado_Por = \?/);
  assert.match(calls[1].sql, /r\.Creado_Por = \?/);
  assert.deepEqual(calls[0].params, [77]);
  assert.deepEqual(calls[1].params, [77, 25, 0]);
});

test('la búsqueda Cliente consulta solo sus reservas y no catálogos empresariales', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  t.after(() => { db.query = originalQuery; });

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    return [[]];
  };

  await searchGlobal('CLI00001', CLIENT_RESERVATION_PERMISSION_CODES, {
    clientMode: true,
    ownerUserId: 77,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /r\.Creado_Por = \?/);
  assert.equal(calls[0].params.includes(77), true);
});

test('los permisos efectivos de Cliente ignoran asignaciones editables', async (t) => {
  const originalGetConnection = db.getConnection;
  const calls = [];
  t.after(() => { db.getConnection = originalGetConnection; });

  db.getConnection = async () => ({
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM usuarios u')) {
        return [[{ Id_Rol: 6, Nombre_Rol: 'Cliente' }]];
      }
      if (sql.includes('FROM permisos p')) {
        return [[
          { Id_Permiso: 5, Codigo_Permiso: 'RESERVAS.LEER' },
          { Id_Permiso: 6, Codigo_Permiso: 'RESERVAS.CREAR' },
          { Id_Permiso: 7, Codigo_Permiso: 'RESERVAS.ACTUALIZAR' },
        ]];
      }
      return [[]];
    },
    release() {},
  });

  const permissions = await permissionsService.obtenerPermisosPorUsuario(77);
  assert.deepEqual(
    permissions.map((permission) => permission.Codigo_Permiso),
    CLIENT_RESERVATION_PERMISSION_CODES
  );
  assert.equal(calls.some(({ sql }) => sql.includes('usuario_permisos permiso_individual')), false);
});

test('las acciones de fecha de Aforos requieren el permiso específico', () => {
  const legacyOnly = buildDateResult('mañana', ['INICIO.LEER']);
  const readOnly = buildDateResult('mañana', ['AFOROS.LEER']);

  assert.equal(legacyOnly.flatMap((result) => result.actions || []).some((action) => action.kind === 'aforo'), false);
  assert.deepEqual(
    readOnly.flatMap((result) => result.actions || []).filter((action) => action.kind === 'aforo').map((action) => action.permission),
    ['AFOROS.LEER']
  );
});

test('las rutas de Aforos no conservan autorizaciones alternativas de Inicio', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'inicio.routes.js'), 'utf8');
  const frontendRouteSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'app', 'app.routes.ts'), 'utf8');
  const homeSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'Home', 'home.service.js'), 'utf8');
  const searchSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'Search', 'search.service.js'), 'utf8');
  const iaSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'IA', 'tools', 'ia-inicio.tools.js'), 'utf8');

  assert.match(routeSource, /checkAnyPermission\(\['AFOROS\.LEER'\]\)/);
  assert.match(routeSource, /checkAnyPermission\(\['AFOROS\.ACTUALIZAR'\]\)/);
  assert.doesNotMatch(routeSource, /INICIO\.(?:LEER|ACTUALIZAR_AFORO)/);
  assert.match(frontendRouteSource, /permiso:\s*'AFOROS\.LEER'/);
  assert.doesNotMatch(frontendRouteSource, /permisos:\s*\['AFOROS\.LEER',\s*'INICIO\.LEER'\]/);
  assert.doesNotMatch(homeSource, /INICIO\.(?:LEER|ACTUALIZAR_AFORO)/);
  assert.doesNotMatch(searchSource, /INICIO\.(?:LEER|ACTUALIZAR_AFORO)/);
  assert.match(iaSource, /requiredPermission:\s*'AFOROS\.LEER'/);
  assert.doesNotMatch(iaSource, /requiredPermission:\s*'INICIO\.LEER'/);
});

test('el middleware de Aforos rechaza permisos antiguos y conserva lectura/escritura específicas', async (t) => {
  const originalObtenerPermisos = permissionsService.obtenerPermisosPorUsuario;
  t.after(() => { permissionsService.obtenerPermisosPorUsuario = originalObtenerPermisos; });

  let userId = 900000001;
  const run = async (permissions, required) => {
    permissionsService.obtenerPermisosPorUsuario = async () => permissions.map((Codigo_Permiso) => ({ Codigo_Permiso }));
    let nextCalled = false;
    let statusCode = 200;
    let responseBody = null;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };
    await checkAnyPermission([required])({ user: { id: userId++ } }, response, () => { nextCalled = true; });
    return { nextCalled, statusCode, responseBody };
  };

  assert.equal((await run(['INICIO.LEER'], 'AFOROS.LEER')).nextCalled, false);
  assert.equal((await run(['AFOROS.LEER'], 'AFOROS.LEER')).nextCalled, true);
  assert.equal((await run(['AFOROS.LEER'], 'AFOROS.ACTUALIZAR')).nextCalled, false);
  assert.equal((await run(['AFOROS.ACTUALIZAR'], 'AFOROS.ACTUALIZAR')).nextCalled, true);
  assert.equal((await run([], 'AFOROS.LEER')).statusCode, 403);
});
