const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runValidationTransaction,
  upsertEntityValidationPending,
  ENTITY_OPEN_OPERATION_STATES,
} = require('../services/EntidadesReportantes/entidades-reportantes.service');

class ValidationConnection {
  constructor({ reservations = [], transfers = [], validatorIds = ['90'] } = {}) {
    this.state = {
      entity: { Id_Entidad_Reportante: 7, Nombre: 'Hotel de prueba', Activo: 1,
        Estado_Validacion: 'PENDIENTE_VALIDACION', Validado_En: null },
      reservations: structuredClone(reservations),
      transfers: structuredClone(transfers),
      validatorIds: [...validatorIds],
      histories: [], notifications: [], pendingEvents: [],
      passengers: [{ id: 'passenger-1', Confirmacion: 'NO' }],
      payments: [{ id: 1, monto: 100 }], liquidations: [{ id: 1, monto: 20 }],
    };
    this.queries = [];
    this.commits = 0;
    this.rollbacks = 0;
    this.snapshot = null;
  }

  async beginTransaction() { this.snapshot = structuredClone(this.state); }
  async commit() { this.commits += 1; this.snapshot = null; }
  async rollback() { this.rollbacks += 1; this.state = this.snapshot; this.snapshot = null; }
  release() {}

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (/^SELECT Id_Entidad_Reportante,Nombre,Activo,Estado_Validacion/.test(sql.trim())) {
      return [[structuredClone(this.state.entity)], []];
    }
    if (/^UPDATE entidades_reportantes SET Estado_Validacion/.test(sql.trim())) {
      const [state, , , validatedAt] = params;
      this.state.entity.Estado_Validacion = state;
      this.state.entity.Validado_En = validatedAt;
      return [{ affectedRows: 1 }, []];
    }
    if (/^SELECT r\.Id_Reserva/.test(sql.trim())) {
      assert.match(sql, /r\.Eliminada_En\s+IS\s+NULL/);
      const states = params.slice(1);
      const rows = this.state.reservations.filter(row => String(row.Id_Entidad_Reportante) === String(params[0])
        && row.Eliminada_En == null && states.includes(row.Estado));
      return [structuredClone(rows), []];
    }
    if (/^SELECT tr\.Id_Transfer/.test(sql.trim())) {
      assert.doesNotMatch(sql, /Eliminada_En/);
      const states = params.slice(1);
      const rows = this.state.transfers.filter(row => String(row.Id_Entidad_Reportante) === String(params[0])
        && states.includes(row.Estado));
      return [structuredClone(rows), []];
    }
    if (/^UPDATE reservas SET Estado='Pendiente de datos'/.test(sql.trim())) {
      const [entityId, reservationId] = params;
      const row = this.state.reservations.find(item => String(item.Id_Reserva) === String(reservationId)
        && String(item.Id_Entidad_Reportante) === String(entityId) && item.Eliminada_En == null);
      if (row) {
        row.Estado = 'Pendiente de datos';
        row.Pendiente_Por_Entidad_En = this.state.entity.Validado_En;
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    if (/^UPDATE transfers SET Estado='Pendiente de datos'/.test(sql.trim())) {
      const [entityId, transferId] = params;
      const row = this.state.transfers.find(item => String(item.Id_Transfer) === String(transferId)
        && String(item.Id_Entidad_Reportante) === String(entityId));
      if (row) {
        row.Estado = 'Pendiente de datos';
        row.Pendiente_Por_Entidad_En = this.state.entity.Validado_En;
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    if (/^SELECT DISTINCT u\.Id_Usuario/.test(sql.trim())) {
      return [this.state.validatorIds.map(Id_Usuario => ({ Id_Usuario })), []];
    }
    throw new Error(`Consulta inesperada en la prueba unitaria: ${sql}`);
  }
}

function dependencies({ failNotificationAt = 0, failPending = false } = {}) {
  let notificationCalls = 0;
  const pendingService = {
    async resolveCondition(key, connection) {
      if (failPending) throw new Error('pendiente falló');
      connection.state.pendingEvents.push({ action: 'resolve', key });
    },
    async upsertCondition(data, connection) {
      connection.state.pendingEvents.push({ action: 'upsert', data });
    },
  };
  const notifications = {
    async createNotification(connection, data) {
      notificationCalls += 1;
      if (notificationCalls === failNotificationAt) throw new Error('notificación falló');
      connection.state.notifications.push(structuredClone(data));
      return String(notificationCalls);
    },
  };
  const recordHistory = async ({ conexion, ...row }) => conexion.state.histories.push(structuredClone(row));
  const websocketEvents = [];
  const websocket = { sendToUser: (...args) => websocketEvents.push(args) };
  return { pendingService, notifications, recordHistory, websocket, websocketEvents };
}

function sampleConnection() {
  return new ValidationConnection({
    reservations: [
      { Id_Reserva: 'R-1', Id_Entidad_Reportante: 7, Estado: 'Pendiente', Creado_Por: 11,
        Eliminada_En: null, Pendiente_Por_Entidad_En: null },
      { Id_Reserva: 'R-2', Id_Entidad_Reportante: 7, Estado: 'Confirmada', Creado_Por: 12,
        Eliminada_En: null, Pendiente_Por_Entidad_En: null },
      { Id_Reserva: 'R-3', Id_Entidad_Reportante: 7, Estado: 'Pendiente de pago', Creado_Por: 13,
        Eliminada_En: '2026-01-01 00:00:00', Pendiente_Por_Entidad_En: null },
      { Id_Reserva: 'R-4', Id_Entidad_Reportante: 7, Estado: 'Completada', Creado_Por: 14,
        Eliminada_En: null, Pendiente_Por_Entidad_En: null },
      { Id_Reserva: 'R-5', Id_Entidad_Reportante: 7, Estado: 'Cancelada', Creado_Por: 15,
        Eliminada_En: null, Pendiente_Por_Entidad_En: null },
    ],
    transfers: [
      { Id_Transfer: 101, Id_Entidad_Reportante: 7, Estado: 'Pendiente', Creado_Por: 11,
        Pendiente_Por_Entidad_En: null },
      { Id_Transfer: 102, Id_Entidad_Reportante: 7, Estado: 'Confirmado', Creado_Por: 13,
        Pendiente_Por_Entidad_En: null },
      { Id_Transfer: 103, Id_Entidad_Reportante: 7, Estado: 'Completado', Creado_Por: 14,
        Pendiente_Por_Entidad_En: null },
      { Id_Transfer: 104, Id_Entidad_Reportante: 7, Estado: 'Cancelado', Creado_Por: 15,
        Pendiente_Por_Entidad_En: null },
    ],
    validatorIds: ['11', '90'],
  });
}

test('rechazo marca operaciones abiertas, excluye reservas eliminadas y notifica una vez por persona', async () => {
  const connection = sampleConnection();
  const beforeProtected = structuredClone({ passengers: connection.state.passengers,
    payments: connection.state.payments, liquidations: connection.state.liquidations });
  const deps = dependencies();
  const result = await runValidationTransaction(connection,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'Datos del establecimiento no verificables.' }, deps);

  assert.equal(connection.commits, 1);
  assert.equal(connection.rollbacks, 0);
  assert.equal(result.reservasAfectadas, 2);
  assert.equal(result.transfersAfectados, 2);
  assert.equal(result.Motivo_Rechazo, 'Datos del establecimiento no verificables.');
  assert.equal(connection.state.entity.Estado_Validacion, 'RECHAZADA');
  assert.ok(connection.state.reservations.filter(row => ['R-1', 'R-2'].includes(row.Id_Reserva))
    .every(row => row.Estado === 'Pendiente de datos' && row.Pendiente_Por_Entidad_En));
  assert.equal(connection.state.reservations.find(row => row.Id_Reserva === 'R-3').Estado, 'Pendiente de pago');
  assert.equal(connection.state.reservations.find(row => row.Id_Reserva === 'R-4').Estado, 'Completada');
  assert.equal(connection.state.reservations.find(row => row.Id_Reserva === 'R-5').Estado, 'Cancelada');
  assert.ok(connection.state.transfers.filter(row => [101, 102].includes(row.Id_Transfer))
    .every(row => row.Estado === 'Pendiente de datos' && row.Pendiente_Por_Entidad_En));
  assert.equal(connection.state.transfers.find(row => row.Id_Transfer === 103).Estado, 'Completado');
  assert.equal(connection.state.transfers.find(row => row.Id_Transfer === 104).Estado, 'Cancelado');
  assert.deepEqual({ passengers: connection.state.passengers, payments: connection.state.payments,
    liquidations: connection.state.liquidations }, beforeProtected);
  assert.equal(connection.state.notifications.length, 4);
  assert.equal(new Set(connection.state.notifications.map(item => item.userId)).size, 4);
  for (const notification of connection.state.notifications) {
    assert.match(notification.deduplicationKey, /^ENTIDAD_RECHAZO:7:/);
    assert.match(notification.message, /2 reservas y 2 transfers quedaron/);
    assert.match(notification.message, /Datos del establecimiento no verificables\./);
  }
  assert.equal(deps.websocketEvents.length, 4);
  assert.ok(connection.state.pendingEvents.some(event => event.action === 'resolve'
    && event.key === 'ENTIDAD_REPORTANTE:PENDIENTE_VALIDACION:7'));
  assert.deepEqual(ENTITY_OPEN_OPERATION_STATES,
    ['Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Confirmada', 'Confirmado']);
  assert.equal(connection.queries.some(({ sql }) => /^\s*(?:UPDATE|INSERT|DELETE)\s+(?:pasajeros|pagos_|liquidaciones)/i.test(sql)), false);
});

test('la revisión inicial crea el pendiente con audiencia por permiso y enlace a Entidades pendientes', async () => {
  let received;
  const pending = { async upsertCondition(input, connection) { received = { input, connection }; } };
  const connection = { transaction: 'test-connection' };
  await upsertEntityValidationPending(connection, 42, 'Hotel de ejemplo', pending);
  assert.equal(received.connection, connection);
  assert.equal(received.input.ruleCode, 'ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION');
  assert.equal(received.input.audiencePermission, 'ENTIDADES_REPORTANTES.VALIDAR');
  assert.equal(received.input.deduplicationKey, 'ENTIDAD_REPORTANTE:PENDIENTE_VALIDACION:42');
  assert.equal(received.input.data.ruta, '/Mercadeo?vista=entidades&validacion=PENDIENTE_VALIDACION');
});

test('si falla una notificación a mitad del rechazo, se revierte la transacción completa', async () => {
  const connection = sampleConnection();
  const original = structuredClone(connection.state);
  const deps = dependencies({ failNotificationAt: 2 });

  await assert.rejects(runValidationTransaction(connection,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'No se pudo validar la identidad.' }, deps), /notificación falló/);
  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
  assert.deepEqual(connection.state, original);
  assert.deepEqual(deps.websocketEvents, []);
});

test('si falla el cierre del pendiente al final del rechazo, también se revierte entidad, operaciones e históricos', async () => {
  const connection = sampleConnection();
  const original = structuredClone(connection.state);
  const deps = dependencies({ failPending: true });

  await assert.rejects(runValidationTransaction(connection,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'Registro inconsistente.' }, deps), /pendiente falló/);
  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
  assert.deepEqual(connection.state, original);
  assert.deepEqual(deps.websocketEvents, []);
});

test('un segundo rechazo después de revalidar genera una clave de aviso nueva y conserva el estado pendiente', async () => {
  const connection = new ValidationConnection({
    reservations: [{ Id_Reserva: 'R-9', Id_Entidad_Reportante: 7, Estado: 'Pendiente de datos',
      Creado_Por: 90, Eliminada_En: null, Pendiente_Por_Entidad_En: null }],
    transfers: [], validatorIds: ['90'],
  });
  const deps = dependencies();
  await runValidationTransaction(connection,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'Primer rechazo.' }, deps);
  const firstKey = connection.state.notifications[0].deduplicationKey;
  const firstMarker = connection.state.reservations[0].Pendiente_Por_Entidad_En;

  await runValidationTransaction(connection, { id: 7, state: 'VALIDADA', actorId: 5 }, deps);
  assert.equal(connection.state.reservations[0].Estado, 'Pendiente de datos');
  assert.equal(connection.state.reservations[0].Pendiente_Por_Entidad_En, firstMarker);

  await runValidationTransaction(connection,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'Segundo rechazo.' }, deps);
  const secondKey = connection.state.notifications[1].deduplicationKey;
  assert.notEqual(secondKey, firstKey);
  assert.match(secondKey, /^ENTIDAD_RECHAZO:7:/);
  assert.equal(connection.state.reservations[0].Estado, 'Pendiente de datos');
  assert.ok(connection.state.reservations[0].Pendiente_Por_Entidad_En);
  assert.equal(connection.state.notifications.length, 2, 'creador/validador repetido recibe solo una notificación por evento');
  assert.match(connection.state.notifications[1].message, /Segundo rechazo\./);
});

test('el backend exige un motivo de rechazo de hasta 300 caracteres', async () => {
  const missing = sampleConnection();
  await assert.rejects(runValidationTransaction(missing,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: '   ' }, dependencies()),
  error => error.errorCode === 'ENTITY_REJECTION_REASON_INVALID');
  assert.equal(missing.rollbacks, 1);
  assert.equal(missing.state.entity.Estado_Validacion, 'PENDIENTE_VALIDACION');

  const tooLong = sampleConnection();
  await assert.rejects(runValidationTransaction(tooLong,
    { id: 7, state: 'RECHAZADA', actorId: 5, reason: 'x'.repeat(301) }, dependencies()),
  error => error.errorCode === 'ENTITY_REJECTION_REASON_INVALID');
  assert.equal(tooLong.rollbacks, 1);
});

test('una entidad rechazada y una inactiva tienen errores distintos; validar inactiva avisa', async () => {
  const entityService = require('../services/EntidadesReportantes/entidades-reportantes.service');
  const checkEntity = status => ({ async query(sql) {
    if (/SELECT Nombre_Canal/.test(sql)) return [[{ Nombre_Canal: 'HOTEL' }], []];
    return [[{ Id_Entidad_Reportante: 4, Tipo: 'HOTEL', Activo: status.active,
      Estado_Validacion: status.validation }], []];
  } });
  await assert.rejects(entityService.validateReservationEntity(checkEntity({ active: 1, validation: 'RECHAZADA' }), 1, 4),
    error => error.errorCode === 'ENTITY_REJECTED');
  await assert.rejects(entityService.validateReservationEntity(checkEntity({ active: 0, validation: 'VALIDADA' }), 1, 4),
    error => error.errorCode === 'ENTITY_INACTIVE');

  const connection = sampleConnection();
  connection.state.entity.Activo = 0;
  const result = await runValidationTransaction(connection, { id: 7, state: 'VALIDADA', actorId: 5 }, dependencies());
  assert.equal(result.warning, 'La entidad sigue inactiva y no podrá usarse.');
});

test('confirmar pasajeros en Control de Viaje no recalcula el estado de reservas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../services/Confirmacion/confirmacion.service.js'), 'utf8');
  const action = source.slice(source.indexOf('async function actualizarConfirmacion'), source.indexOf('\nmodule.exports'));
  assert.match(action, /UPDATE pasajeros[\s\S]*?Confirmacion/);
  assert.match(action, /INSERT INTO confirmaciones_jornada/);
  assert.doesNotMatch(action, /UPDATE\s+(?:reservas|transfers)\b/i);
});

test('las guardas de reserva bloquean la entidad y el vencimiento no pisa operaciones marcadas', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const entityService = require('../services/EntidadesReportantes/entidades-reportantes.service');
  let entityQuery = '';
  const executor = { async query(sql) {
    if (/SELECT Nombre_Canal/.test(sql)) return [[{ Nombre_Canal: 'HOTEL' }], []];
    entityQuery = sql;
    return [[{ Id_Entidad_Reportante: 4, Tipo: 'HOTEL', Activo: 1, Estado_Validacion: 'VALIDADA' }], []];
  } };
  await entityService.validateReservationEntity(executor, 1, 4);
  assert.match(entityQuery, /FOR UPDATE/i);

  for (const [relative, table] of [
    ['../services/Reservas/reservas.service.js', 'reservas'],
    ['../services/Transfers/transfers.service.js', 'transfers'],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    assert.match(source, new RegExp(`UPDATE ${table}[\\s\\S]{0,260}Pendiente_Por_Entidad_En IS NULL`));
    assert.match(source, new RegExp(`UPDATE ${table}[\\s\\S]{0,340}Estado_Validacion='RECHAZADA'`));
  }
});
