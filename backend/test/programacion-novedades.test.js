const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../services/Programacion/programacion-novedades.service');
const pendingService = require('../services/Pendientes/pendientes.service');
const pendingTriggerService = require('../services/Pendientes/pendientes-trigger.service');
const notifications = require('../services/Notificaciones/notificaciones.service');
const db = require('../database/db');
const permissionsService = require('../services/Permisos/permisos.service');
const websocketManager = require('../websocketManager');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { invalidarCacheUsuario } = require('../middlewares/permissionsMiddleware');
const router = require('../routes/Programacion/programacion.routes');
const controller = require('../controllers/Programacion/programacion.controller');

function snapshot(id, extra = {}) {
  return {
    Id_Reserva: id,
    Num_Pasajeros_Snap: 2,
    Id_Tour_Snap: 10,
    Fecha_Tour_Snap: '2026-09-21',
    Estado_Snap: 'Confirmada',
    Tipo_Reserva_Snap: 'Grupal',
    Nombre_Reportante_Snap: 'Titular de prueba',
    Idioma_Reserva_Snap: 'ESPAÑOL',
    Observaciones_Snap: 'Sin observaciones',
    Id_Punto_Principal_Snap: 51,
    ...extra,
  };
}

function current(id, extra = {}) {
  return {
    Id_Reserva: id,
    NumeroPasajeros: 2,
    Id_Tour: 10,
    Nombre_Tour: 'Tour de prueba',
    Fecha_Tour: '2026-09-21',
    Estado: 'Confirmada',
    Tipo_Reserva: 'Grupal',
    Nombre_Reportante: 'Titular de prueba',
    Idioma_Reserva: 'ESPAÑOL',
    Observaciones: 'Sin observaciones',
    Id_Punto_Principal: 51,
    ...extra,
  };
}

function findEndpoint(method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  assert.ok(layer, `Falta la ruta ${method.toUpperCase()} ${path}`);
  return layer.route.stack.map((entry) => entry.handle);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function runMiddleware(middleware, req) {
  const response = makeResponse();
  let nextCalled = false;
  await middleware(req, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

test('un listado grupal crea novedades por tour para reservas nuevas y combina tours relacionados', () => {
  const result = service.buildGroupChangeSets({
    program: {
      id: 44,
      fecha: '2026-09-21',
      tours: [{ Id_Tour: 10, Nombre_Tour: 'Tour diez' }, { Id_Tour: 11, Nombre_Tour: 'Tour once' }],
    },
    snapshots: [snapshot('R-1')],
    currentRows: [current('R-1'), current('R-2', { Id_Tour: 11, Nombre_Tour: 'Tour once', NumeroPasajeros: 4 })],
    historyByReservation: new Map(),
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].tourId, 11);
  assert.equal(result[0].novedades.length, 1);
  assert.equal(result[0].novedades[0].reservationId, 'R-2');
  assert.equal(result[0].novedades[0].changes[0].actual, 'Nueva reserva');
});

test('compara pasajeros, fecha, tour, estado, tipo, titular, idioma, notas y punto principal', () => {
  const result = service.changedReservation(snapshot('R-3'), current('R-3', {
    NumeroPasajeros: 5,
    Id_Tour: 20,
    Fecha_Tour: '2026-09-22',
    Estado: 'Cancelada',
    Tipo_Reserva: 'Privada',
    Nombre_Reportante: 'Nuevo titular',
    Idioma_Reserva: 'INGLÉS',
    Observaciones: 'Cambio de punto',
    Id_Punto_Principal: 92,
  }));

  assert.deepEqual(result.changes.map((change) => change.campo), [
    'Pasajeros', 'Tour', 'Fecha', 'Estado', 'Tipo de reserva', 'Titular', 'Idioma', 'Notas', 'Punto principal',
  ]);
  assert.ok(result.changes.some((change) => change.campo === 'Fecha' && change.anterior === '2026-09-21' && change.actual === '2026-09-22'));
});

test('cambios de horario y puntos se leen del historial y una reversión elimina la diferencia', () => {
  const withChanges = service.changedReservation(snapshot('R-4'), current('R-4', {
    Id_Horario: 7,
    Hora_Salida: '09:30:00',
    Puntos_Recogida: '51,52',
  }), [
    { id: 80, campo: 'Hora_Salida', anterior: '09:00:00', nuevo: '09:30:00' },
    { id: 81, campo: 'Puntos_Recogida', anterior: '["51"]', nuevo: '["51","52"]' },
  ]);
  assert.ok(withChanges.changes.some((change) => change.campo === 'Hora de salida'));
  assert.ok(withChanges.changes.some((change) => change.campo === 'Puntos de recogida'));
  assert.equal(withChanges.changes.find((change) => change.campo === 'Hora de salida').revision, 80);

  const reverted = service.changedReservation(snapshot('R-4'), current('R-4'), [
    { id: 80, campo: 'Hora_Salida', anterior: '09:00:00', nuevo: '09:30:00' },
    { id: 82, campo: 'Hora_Salida', anterior: '09:30:00', nuevo: '09:00:00' },
  ]);
  assert.equal(reverted, null);
});

test('al cancelar o eliminar una reserva incluida aparece una novedad que se resuelve al volver al snapshot', () => {
  const program = { id: 45, fecha: '2026-09-21', tours: [{ Id_Tour: 10, Nombre_Tour: 'Tour diez' }] };
  const cancelled = service.buildGroupChangeSets({
    program,
    snapshots: [snapshot('R-5')],
    currentRows: [current('R-5', { Estado: 'Cancelada' })],
    historyByReservation: new Map(),
  });
  assert.equal(cancelled[0].novedades[0].changes[0].campo, 'Estado');

  const removed = service.buildGroupChangeSets({
    program,
    snapshots: [snapshot('R-5')],
    currentRows: [],
    historyByReservation: new Map(),
  });
  assert.equal(removed[0].novedades[0].changes[0].actual, 'Ya no está disponible');

  const resolved = service.buildGroupChangeSets({
    program,
    snapshots: [snapshot('R-5')],
    currentRows: [current('R-5')],
    historyByReservation: new Map(),
  });
  assert.deepEqual(resolved, []);
});

test('la programación privada alerta altas, cambios de pasajeros y reservas que ya no están disponibles', () => {
  const result = service.buildPrivateChangeSets({
    program: { id: 46, fecha: '2026-09-21' },
    snapshots: [
      { Id_Reserva_Privada: 'P-1', NumeroPasajeros_Snap: 2 },
      { Id_Reserva_Privada: 'P-2', NumeroPasajeros_Snap: 3 },
    ],
    currentRows: [
      current('P-1', { Tipo_Reserva: 'Privada', NumeroPasajeros: 4, Estado: 'Confirmada' }),
      current('P-3', { Tipo_Reserva: 'Privada', NumeroPasajeros: 1, Estado: 'Activa' }),
    ],
    historyByReservation: new Map([
      ['P-1', [{ id: 90, campo: 'NumeroPasajeros', anterior: '2', nuevo: '4' }]],
    ]),
  });
  const byTour = result.flatMap((group) => group.novedades);
  assert.deepEqual(byTour.map((item) => item.reservationId).sort(), ['P-1', 'P-2', 'P-3']);
  assert.ok(byTour.find((item) => item.reservationId === 'P-1').changes.some((change) => change.campo === 'Pasajeros'));
  assert.ok(byTour.find((item) => item.reservationId === 'P-2').changes.some((change) => change.actual === 'Ya no está disponible'));
  assert.ok(byTour.find((item) => item.reservationId === 'P-3').changes.some((change) => change.actual === 'Nueva reserva'));
});

test('los estados activos coinciden con los usados en Programación y los cambios posteriores crean otra clave', () => {
  for (const state of ['Activa', 'Activo', 'Pendiente', 'PendienteDatos', 'Confirmada', 'Completada']) {
    assert.equal(service.isActiveReservation(state), true, state);
  }
  assert.equal(service.isActiveReservation('Cancelada'), false);

  const base = {
    fecha: '2026-09-21', programId: 48, tourId: 10, userId: 100,
    novedades: [{ reservationId: 'R-6', changes: [{ campo: 'Pasajeros', anterior: '2', actual: '3', revision: 91 }] }],
  };
  assert.equal(service.buildDeduplicationKey(base), service.buildDeduplicationKey(base));
  assert.notEqual(service.buildDeduplicationKey(base), service.buildDeduplicationKey({
    ...base,
    novedades: [{ reservationId: 'R-6', changes: [{ campo: 'Pasajeros', anterior: '2', actual: '3', revision: 95 }] }],
  }));
});

test('la sincronización localiza también una programación privada cuando la reserva cambió de fecha', async () => {
  let capturedSql = '';
  let capturedParams = [];
  const connection = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return [[]];
    },
  };

  await service.findPrograms(connection, { fecha: '2026-09-22', reservationId: 'P-9' });

  assert.match(capturedSql, /pbp\.Id_Reserva_Privada = \?/);
  assert.deepEqual(capturedParams, ['2026-09-22', 'P-9', 'P-9']);
});

test('la audiencia de una novedad requiere los dos permisos aun si tiene destinatario directo', () => {
  const audience = require('../services/Pendientes/pendientes.service').audienceClause(100, [
    'PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR', 'PENDIENTES.LEER',
  ]);
  assert.match(audience.sql, /JSON_CONTAINS/);
  assert.deepEqual(JSON.parse(audience.params[1]), ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR', 'PENDIENTES.LEER']);
  assert.ok(audience.sql.includes("REPLACE(p.Permiso_Audiencia, '&'"));
});

test('el cálculo de destinatarios hace prevalecer el DENY individual sobre el permiso del rol', async () => {
  let capturedSql = '';
  const connection = {
    async query(sql) {
      capturedSql = sql;
      return [[]];
    },
  };

  await pendingTriggerService.usersWithPermissions(connection, service.REQUIRED_PERMISSIONS);

  assert.match(capturedSql, /WHEN MAX\(up\.Tipo = 'DENY'\) = 1 THEN 0/);
});

async function processDueForRule(ruleCode, audiencePermission) {
  const originalGetConnection = db.getConnection;
  const originalCreateNotification = notifications.createNotification;
  const originalSendToUser = websocketManager.sendToUser;
  const permissionLookups = [];
  const notificationsCreated = [];
  const sent = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (sql.includes('SELECT p.Id_Pendiente, p.Id_Usuario_Destino')) {
        return [[{
          Id_Pendiente: 880,
          Id_Usuario_Destino: 901,
          Permiso_Audiencia: audiencePermission,
          Titulo: 'Aviso',
          Descripcion: 'Revisar',
          Entidad_Tipo: 'PROGRAMACION_CAMBIO',
          Entidad_Id: 'program:10',
          Datos: JSON.stringify({ fecha: '2026-09-21' }),
          Regla_Codigo: ruleCode,
          Recurrencia_Minutos: null,
          Configuracion: JSON.stringify({ canales: ['NOTIFICACION'] }),
        }]];
      }
      if (sql.includes('SELECT effective.Id_Usuario')) {
        permissionLookups.push(params[0]);
        const requiresPendingRead = params[0].includes('PENDIENTES.LEER');
        return [requiresPendingRead ? [] : [{ Id_Usuario: 901 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
  notifications.createNotification = async (_executor, payload) => {
    notificationsCreated.push(payload.userId);
    return 'N-1';
  };
  websocketManager.sendToUser = (...args) => sent.push(args);
  try {
    const result = await pendingTriggerService.processDuePendings();
    return { result, permissionLookups, notificationsCreated, sent };
  } finally {
    db.getConnection = originalGetConnection;
    notifications.createNotification = originalCreateNotification;
    websocketManager.sendToUser = originalSendToUser;
  }
}

test('el recordatorio de Programación llega sin permisos de Notificaciones ni Pendientes', async () => {
  const result = await processDueForRule(
    service.RULE_CODE,
    'PROGRAMACION.LEER&PROGRAMACION.ACTUALIZAR'
  );

  assert.deepEqual(result.permissionLookups, [['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR']]);
  assert.deepEqual(result.notificationsCreated, [901]);
  assert.equal(result.result.processed, 1);
  assert.ok(result.sent.some(([, event]) => event.type === 'programacionNovedadesActualizadas'));
});

test('los recordatorios de Pendientes siguen requiriendo PENDIENTES.LEER', async () => {
  const result = await processDueForRule('RESERVA_ESTADO_PENDIENTE', 'RESERVAS.LEER&TOURS.LEER');

  assert.deepEqual(result.permissionLookups, [['PENDIENTES.LEER', 'RESERVAS.LEER', 'TOURS.LEER']]);
  assert.deepEqual(result.notificationsCreated, []);
  assert.equal(result.result.processed, 0);
});

test('las rutas de novedades exigen autenticación y PROGRAMACION.LEER más ACTUALIZAR', async (t) => {
  const original = permissionsService.obtenerPermisosPorUsuario;
  const userId = 880001;
  const getHandlers = findEndpoint('get', '/programacion/novedades');
  const reviewHandlers = findEndpoint('patch', '/programacion/novedades/:id/revisar');
  t.after(() => {
    permissionsService.obtenerPermisosPorUsuario = original;
    invalidarCacheUsuario(userId);
  });

  const unauthenticated = await runMiddleware(authMiddleware, { headers: {} });
  assert.equal(unauthenticated.response.statusCode, 401);

  const postponeHandlers = findEndpoint('patch', '/programacion/novedades/:id/posponer');
  for (const handlers of [getHandlers, reviewHandlers, postponeHandlers]) {
    assert.equal(handlers[0], authMiddleware);
    assert.equal(handlers.length, 4);
    const req = { user: { id: userId, isClient: false } };

    permissionsService.obtenerPermisosPorUsuario = async () => [{ Codigo_Permiso: 'PROGRAMACION.LEER' }];
    invalidarCacheUsuario(userId);
    let result = await runMiddleware(handlers[1], req);
    assert.equal(result.nextCalled, true);
    result = await runMiddleware(handlers[2], req);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.nextCalled, false);

    permissionsService.obtenerPermisosPorUsuario = async () => [
      { Codigo_Permiso: 'PROGRAMACION.LEER' },
      { Codigo_Permiso: 'PROGRAMACION.ACTUALIZAR' },
    ];
    invalidarCacheUsuario(userId);
    const allowedReq = { user: { id: userId, isClient: false } };
    result = await runMiddleware(handlers[1], allowedReq);
    assert.equal(result.nextCalled, true);
    result = await runMiddleware(handlers[2], allowedReq);
    assert.equal(result.nextCalled, true);
  }
});

test('marcar revisado utiliza el descarte auditado existente y envía el refresco al mismo usuario', async (t) => {
  const originalDismiss = pendingService.dismiss;
  const originalEligibility = service.hasRequiredPermissions;
  const originalSend = websocketManager.sendToUser;
  let dismissalArgs;
  const sent = [];
  pendingService.dismiss = async (...args) => {
    dismissalArgs = args;
    return { idPendiente: String(args[0]), estado: 'DESCARTADO' };
  };
  service.hasRequiredPermissions = async () => true;
  websocketManager.sendToUser = (...args) => sent.push(args);
  t.after(() => {
    pendingService.dismiss = originalDismiss;
    service.hasRequiredPermissions = originalEligibility;
    websocketManager.sendToUser = originalSend;
  });

  const response = makeResponse();
  await controller.revisarNovedadProgramacionController({
    params: { id: '501' },
    user: { id: 77 },
    userPermissions: ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'],
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(dismissalArgs, [
    '501', 77, ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'], 'Revisada desde Programación.',
    service.RULE_CODE,
  ]);
  assert.deepEqual(sent, [[77, { type: 'programacionNovedadesActualizadas' }]]);
});

test('las novedades crean notificaciones personales para todos los usuarios efectivos de Programación', async (t) => {
  const originalUpsert = pendingService.upsertCondition;
  const originalCreateNotification = notifications.createNotification;
  const notifiedUsers = [];
  pendingService.upsertCondition = async () => ({ idPendiente: '800', eventType: 'DETECTADO' });
  notifications.createNotification = async (_connection, payload) => {
    notifiedUsers.push(payload.userId);
    return `N-${payload.userId}`;
  };
  t.after(() => {
    pendingService.upsertCondition = originalUpsert;
    notifications.createNotification = originalCreateNotification;
  });

  const connection = {
    async query(sql) {
      if (sql.includes('FROM programacion_buses pb')) return [[]];
      if (sql.includes('FROM reservas r')) return [[current('R-9', { Tipo_Reserva: 'Grupal' })]];
      if (sql.includes('FROM historial h')) return [[]];
      throw new Error(`Consulta de prueba inesperada: ${sql}`);
    },
  };
  const delivered = new Set();
  delivered.notifications = [];

  await service.syncProgram(connection, {
    id: 49,
    fecha: '2026-09-21',
    tipo: 'grupal',
    tours: [{ Id_Tour: 10, Nombre_Tour: 'Tour de prueba' }],
  }, new Set([201, 202]), delivered);

  assert.deepEqual(notifiedUsers, [201, 202]);
  assert.deepEqual(delivered.notifications.map((item) => item.userId), [201, 202]);
});

test('posponer una novedad usa la regla Programación y el usuario autenticado', async (t) => {
  const originalPostpone = pendingService.postpone;
  const originalEligibility = service.hasRequiredPermissions;
  let args;
  pendingService.postpone = async (...input) => {
    args = input;
    return { idPendiente: '502', estado: 'ACTIVO', suprimidoHasta: '2026-09-21T15:00:00.000Z' };
  };
  service.hasRequiredPermissions = async () => true;
  t.after(() => {
    pendingService.postpone = originalPostpone;
    service.hasRequiredPermissions = originalEligibility;
  });

  const response = makeResponse();
  await controller.posponerNovedadProgramacionController({
    params: { id: '502' },
    body: { suprimidoHasta: '2026-09-21T15:00:00.000Z' },
    user: { id: 78 },
    userPermissions: ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'],
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(args, [
    '502', 78, ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'],
    '2026-09-21T15:00:00.000Z', service.RULE_CODE,
  ]);
});

test('la operación de Programación no permite posponer un pendiente de otra regla o de otro usuario', async (t) => {
  const originalGetConnection = db.getConnection;
  let captured;
  const connection = {
    async beginTransaction() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      captured = { sql, params };
      return [[{ Regla_Codigo: 'OTRA_REGLA' }]];
    },
  };
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = originalGetConnection; });

  await assert.rejects(
    pendingService.postpone('503', 79, ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'],
      new Date(Date.now() + 60000).toISOString(), service.RULE_CODE),
    (error) => error.status === 404 && error.code === 'PENDING_NOT_FOUND',
  );
  assert.match(captured.sql, /p\.Id_Usuario_Destino = \?/);
  assert.ok(captured.params.includes(79));
});

test('Transfers no se alertan sin un snapshot persistido que identifique qué se preparó', () => {
  assert.match(service.describeTransferSupport(), /no guarda un snapshot ni una relación/);
});
