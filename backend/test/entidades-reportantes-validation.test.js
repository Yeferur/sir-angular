const test = require('node:test');
const assert = require('node:assert/strict');
const { runValidationTransaction, resolveRejectedEntityOperation } = require('../services/EntidadesReportantes/entidades-reportantes.service');
const { checkPermission } = require('../middlewares/permissionsMiddleware');

class Connection {
  constructor({ reservations = [], transfers = [], entityState = 'PENDIENTE_VALIDACION', active = 1 } = {}) {
    this.state = { entity: { Id_Entidad_Reportante: 7, Nombre: 'Hotel Sol', Tipo: 'HOTEL',
      Activo: active, Estado_Validacion: entityState, Creado_Por: 4, Fecha_Creacion: '2026-10-01 10:00:00' },
    reservations: structuredClone(reservations), transfers: structuredClone(transfers),
    histories: [], notices: [], pendings: [] };
    this.commits = 0; this.rollbacks = 0; this.sql = [];
  }
  async beginTransaction() { this.before = structuredClone(this.state); }
  async commit() { this.commits++; this.before = null; }
  async rollback() { this.rollbacks++; this.state = this.before; this.before = null; }
  async query(sql, params = []) {
    this.sql.push({ sql, params });
    const q = sql.trim();
    if (q.startsWith('SELECT Id_Entidad_Reportante,Nombre,Tipo,Activo')) return [[this.state.entity ? structuredClone(this.state.entity) : undefined]];
    if (q.startsWith('SELECT r.Id_Reserva')) return [structuredClone(this.state.reservations.filter(r => String(r.Id_Entidad_Reportante) === String(params[0])))];
    if (q.startsWith('SELECT tr.Id_Transfer')) return [structuredClone(this.state.transfers.filter(r => String(r.Id_Entidad_Reportante) === String(params[0])))];
    if (q.startsWith('UPDATE reservas SET Id_Entidad_Reportante=NULL')) {
      const row = this.state.reservations.find(r => String(r.Id_Reserva) === String(params[0]));
      row.Id_Entidad_Reportante = null; row.Estado = 'Pendiente de datos'; row.Pendiente_Por_Entidad_En = null;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE transfers SET Id_Entidad_Reportante=NULL')) {
      const row = this.state.transfers.find(r => String(r.Id_Transfer) === String(params[0]));
      row.Id_Entidad_Reportante = null; row.Estado = 'Pendiente de datos'; row.Pendiente_Por_Entidad_En = null;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT DISTINCT u.Id_Usuario')) return [[{ Id_Usuario: 90 }]];
    if (q.startsWith('DELETE FROM entidad_reportante_puntos') || q.startsWith('DELETE FROM perfiles_comision_entidad')) return [{ affectedRows: 0 }];
    if (q.startsWith('DELETE FROM entidades_reportantes')) { this.state.entity = null; return [{ affectedRows: 1 }]; }
    if (q.startsWith('SELECT p.Clave_Deduplicacion,p.Datos')) {
      const field = params[1].slice(2);
      return [this.state.pendings.filter(p => p.estado === 'ACTIVO' && p.data[field].includes(String(params[2])))
        .map(p => ({ Clave_Deduplicacion: p.key, Datos: JSON.stringify(p.data) }))];
    }
    if (q.startsWith('UPDATE pendientes_operativos SET Datos=')) {
      const p = this.state.pendings.find(p => p.key === params[2]); p.data = JSON.parse(params[0]); return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE notificaciones SET Datos=')) return [{ affectedRows: 1 }];
    if (q.startsWith('UPDATE notificaciones SET Leida=')) return [{ affectedRows: 1 }];
    if (q.startsWith('SELECT Id_Usuario FROM notificaciones WHERE Clave_Deduplicacion='))
      return [this.state.notices.filter(n => n.deduplicationKey === params[0])
        .map(n => ({ Id_Usuario: n.userId }))];
    throw new Error(`SQL inesperado: ${q}`);
  }
}

function deps({ failAt = null } = {}) {
  let noticeCalls = 0;
  return {
    pendingService: {
      async resolveCondition(key, c) { c.state.pendings.push({ key, estado: 'RESUELTO' }); },
      async upsertCondition(input, c) { c.state.pendings.push({ key: input.deduplicationKey, estado: 'ACTIVO', data: structuredClone(input.data), audience: input.audiencePermission, userId: input.userId }); },
    },
    notifications: { async createNotification(c, input) {
      noticeCalls++;
      if (noticeCalls === failAt) throw new Error('fallo de aviso');
      c.state.notices.push(structuredClone(input)); return String(noticeCalls);
    } },
    recordHistory: async ({ conexion, ...event }) => conexion.state.histories.push(structuredClone(event)),
    websocket: { sendToUser() {} },
  };
}
const reserve = (id, user) => ({ Id_Reserva: id, Id_Entidad_Reportante: 7, Estado: 'Confirmada', Creado_Por: user, Pendiente_Por_Entidad_En: new Date() });
const transfer = (id, user) => ({ Id_Transfer: id, Id_Entidad_Reportante: 7, Estado: 'Confirmado', Creado_Por: user, Pendiente_Por_Entidad_En: new Date() });
const reject = (c, dependencies = deps(), reason = '') => runValidationTransaction(c,
  { id: 7, state: 'RECHAZADA', actorId: 90, reason }, dependencies);

test('rechazo sin operaciones elimina entidad, cierra validación y confirma una transacción', async () => {
  const c = new Connection();
  const result = await reject(c);
  assert.equal(result.reservasAfectadas, 0); assert.equal(result.transfersAfectados, 0);
  assert.equal(c.state.entity, null); assert.equal(c.commits, 1); assert.equal(c.rollbacks, 0);
  assert.match(c.sql[0].sql, /FOR UPDATE/);
  assert.ok(c.state.pendings.some(p => p.key === 'ENTIDAD_REPORTANTE:PENDIENTE_VALIDACION:7'));
  const history = c.state.histories.find(h => h.accion === 'RECHAZAR');
  assert.ok(history.detalles.some(d => d.columna === 'Nombre' && d.nuevo === 'Hotel Sol'));
  assert.ok(history.detalles.some(d => d.columna === 'Creado_Por' && d.nuevo === 4));
});

test('dos creadores y transfers quedan sin entidad, con pendientes y avisos por audiencia', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11), reserve('R2', 12)], transfers: [transfer(31, 11)] });
  const result = await reject(c, deps(), 'Nombre incorrecto');
  assert.equal(result.reservasAfectadas, 2); assert.equal(result.transfersAfectados, 1);
  for (const row of [...c.state.reservations, ...c.state.transfers]) {
    assert.equal(row.Id_Entidad_Reportante, null); assert.equal(row.Estado, 'Pendiente de datos');
    assert.equal(row.Pendiente_Por_Entidad_En, null);
  }
  assert.equal(c.state.pendings.filter(p => p.estado === 'ACTIVO').length, 3);
  assert.equal(c.state.notices.length, 3);
  assert.equal(c.state.notices.find(n => n.userId === '11').data.reservasAfectadas, 1);
  assert.equal(c.state.notices.find(n => n.userId === '11').data.transfersAfectados, 1);
  assert.equal(c.state.notices.find(n => n.userId === '90').data.reservasAfectadas, 2);
  assert.match(c.state.notices[0].message, /Nombre incorrecto/);
});

test('entidad validada o inactiva no se rechaza ni cambia', async () => {
  for (const opts of [{ entityState: 'VALIDADA' }, { active: 0 }]) {
    const c = new Connection(opts), original = structuredClone(c.state);
    await assert.rejects(reject(c), e => e.status === 409 && e.errorCode === 'ENTITY_ALREADY_RESOLVED');
    assert.deepEqual(c.state, original); assert.equal(c.rollbacks, 1);
  }
});

test('rechazo doble da el mensaje de entidad resuelta', async () => {
  const c = new Connection(); await reject(c);
  await assert.rejects(reject(c), e => e.status === 409 && /Esta entidad ya fue resuelta/.test(e.message));
  assert.equal(c.commits, 1); assert.equal(c.rollbacks, 1);
});

test('dos validadores concurrentes serializan el rechazo por FOR UPDATE', async () => {
  const shared = { entity: new Connection().state.entity, locked: false, waiting: [] };
  const connection = () => ({
    async beginTransaction() {},
    async commit() { shared.locked = false; shared.waiting.shift()?.(); },
    async rollback() { if (shared.locked) { shared.locked = false; shared.waiting.shift()?.(); } },
    async query(sql) {
      const q = sql.trim();
      if (q.startsWith('SELECT Id_Entidad_Reportante,Nombre,Tipo,Activo')) {
        assert.match(q, /FOR UPDATE/);
        if (shared.locked) await new Promise(resolve => shared.waiting.push(resolve));
        shared.locked = true;
        return [[shared.entity ? structuredClone(shared.entity) : undefined]];
      }
      if (q.startsWith('SELECT r.Id_Reserva') || q.startsWith('SELECT tr.Id_Transfer') ||
          q.startsWith('SELECT DISTINCT u.Id_Usuario')) return [[]];
      if (q.startsWith('DELETE FROM entidades_reportantes')) { shared.entity = null; return [{ affectedRows: 1 }]; }
      if (q.startsWith('DELETE FROM entidad_reportante_puntos') || q.startsWith('DELETE FROM perfiles_comision_entidad')) return [{ affectedRows: 0 }];
      throw new Error(`SQL inesperado: ${q}`);
    },
  });
  const dependencies = { pendingService: { async resolveCondition() {} },
    recordHistory: async () => {}, websocket: { sendToUser() {} } };
  const first = runValidationTransaction(connection(), { id: 7, state: 'RECHAZADA', actorId: 90 }, dependencies);
  const second = runValidationTransaction(connection(), { id: 7, state: 'RECHAZADA', actorId: 91 }, dependencies);
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /Esta entidad ya fue resuelta/);
});

test('sin ENTIDADES_REPORTANTES.VALIDAR el middleware devuelve 403', async () => {
  const middleware = checkPermission('ENTIDADES_REPORTANTES.VALIDAR');
  const req = { user: { id: 11, isClient: true }, userPermissions: [] };
  let status; const res = { status(code) { status = code; return this; }, json() { return this; } };
  await middleware(req, res, () => assert.fail('No debe permitir la solicitud'));
  assert.equal(status, 403);
});

test('fallo a mitad de los avisos revierte entidad, operaciones e historial', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11), reserve('R2', 12)] });
  const original = structuredClone(c.state);
  await assert.rejects(reject(c, deps({ failAt: 2 })), /fallo de aviso/);
  assert.deepEqual(c.state, original); assert.equal(c.commits, 0); assert.equal(c.rollbacks, 1);
});

test('motivo opcional y límite de 200 caracteres', async () => {
  const c = new Connection(); await reject(c, deps(), ''); assert.equal(c.commits, 1);
  const long = new Connection();
  await assert.rejects(reject(long, deps(), 'x'.repeat(201)), e => e.errorCode === 'ENTITY_REJECTION_REASON_INVALID');
  assert.equal(long.state.entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
});

test('al corregir una operación se descuenta del pendiente del creador y del agregado', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11), reserve('R2', 12)] });
  await reject(c);
  c.state.reservations[0].Id_Entidad_Reportante = 8;
  // La ruta de edición llama este cierre dentro de su transacción, después de recalcular estado.
  await resolveRejectedEntityOperation(c, 'RESERVA', 'R1', {
    async resolveCondition(key, connection) { connection.state.pendings.find(p => p.key === key).estado = 'RESUELTO'; },
  });
  const creator = c.state.pendings.find(p => p.userId === '11');
  const aggregate = c.state.pendings.find(p => p.audience === 'ENTIDADES_REPORTANTES.VALIDAR');
  assert.equal(creator.estado, 'RESUELTO');
  assert.deepEqual(aggregate.data.reservasIds, ['R2']);
  c.state.reservations[1].Id_Entidad_Reportante = 8;
  await resolveRejectedEntityOperation(c, 'RESERVA', 'R2', {
    async resolveCondition(key, connection) { connection.state.pendings.find(p => p.key === key).estado = 'RESUELTO'; },
  });
  assert.equal(aggregate.estado, 'RESUELTO');
});
