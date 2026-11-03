const test = require('node:test');
const assert = require('node:assert/strict');
const { runValidationTransaction, resolveRejectedEntityOperation } = require('../services/EntidadesReportantes/entidades-reportantes.service');
const { checkPermission } = require('../middlewares/permissionsMiddleware');

class Connection {
  constructor({ reservations = [], transfers = [], entityState = 'PENDIENTE_VALIDACION', active = 1,
    activeUsers = [11, 12, 90], validationUsers = [90] } = {}) {
    this.state = { entity: { Id_Entidad_Reportante: 7, Nombre: 'Hotel Sol', Tipo: 'HOTEL',
      Activo: active, Estado_Validacion: entityState, Creado_Por: 4, Fecha_Creacion: '2026-10-01 10:00:00' },
    reservations: structuredClone(reservations), transfers: structuredClone(transfers),
    histories: [], notices: [], pendings: [] };
    this.activeUsers = activeUsers.map(String);
    this.validationUsers = validationUsers.map(String);
    this.commits = 0; this.rollbacks = 0; this.sql = [];
  }
  async beginTransaction() { this.before = structuredClone(this.state); }
  async commit() { this.commits++; this.before = null; }
  async rollback() { this.rollbacks++; this.state = this.before; this.before = null; }
  async query(sql, params = []) {
    this.sql.push({ sql, params });
    const q = sql.trim().replace(/\s+/g, ' ');
    if (q.startsWith('SELECT Id_Entidad_Reportante,Nombre,Tipo,Activo')) return [[this.state.entity ? structuredClone(this.state.entity) : undefined]];
    if (q.startsWith('SELECT r.Id_Reserva')) return [structuredClone(this.state.reservations.filter(r =>
      String(r.Id_Entidad_Reportante) === String(params[0]) && (r.Eliminada_En == null)
      && params.slice(1).includes(r.Estado)))];
    if (q.startsWith('SELECT tr.Id_Transfer')) return [structuredClone(this.state.transfers.filter(r =>
      String(r.Id_Entidad_Reportante) === String(params[0]) && params.slice(1).includes(r.Estado)))];
    if (q.startsWith('SELECT Id_Usuario FROM usuarios WHERE Activo=1'))
      return [params.filter(id => this.activeUsers.includes(String(id))).map(Id_Usuario => ({ Id_Usuario }))];
    if (q.startsWith('UPDATE reservas SET Id_Entidad_Reportante=NULL')) {
      const row = this.state.reservations.find(r => String(r.Id_Reserva) === String(params[0]));
      row.Id_Entidad_Reportante = null; row.Estado = 'Pendiente de datos';
      row.Pendiente_Por_Entidad_En ||= new Date('2026-11-02T12:00:00.000Z');
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE transfers SET Id_Entidad_Reportante=NULL')) {
      const row = this.state.transfers.find(r => String(r.Id_Transfer) === String(params[0]));
      row.Id_Entidad_Reportante = null; row.Estado = 'Pendiente de datos';
      row.Pendiente_Por_Entidad_En ||= new Date('2026-11-02T12:00:00.000Z');
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT DISTINCT u.Id_Usuario'))
      return [this.validationUsers.map(Id_Usuario => ({ Id_Usuario }))];
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
    if (q.startsWith("SELECT Id_Usuario FROM notificaciones WHERE Tipo='ENTIDAD_REPORTANTE_RECHAZADA'"))
      return [this.state.notices.filter(item => item.data.operacionTipo === params[0]
        && item.data.operacionId === params[1]).map(item => ({ Id_Usuario: item.userId }))];
    if (q.startsWith("UPDATE notificaciones SET Leida=1,Fecha_Lectura=COALESCE(Fecha_Lectura,NOW()) WHERE Tipo='ENTIDAD_REPORTANTE_RECHAZADA'")) {
      for (const notice of this.state.notices.filter(item => item.data.operacionTipo === params[0]
        && item.data.operacionId === params[1])) notice.leida = true;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE notificaciones SET Leida=')) {
      for (const notice of this.state.notices.filter(item => item.deduplicationKey === params[0])) notice.leida = true;
      return [{ affectedRows: 1 }];
    }
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
const reject = (c, dependencies = deps(), reason = '') => {
  const notify = dependencies.notifications;
  return runValidationTransaction(c, { id: 7, state: 'RECHAZADA', actorId: 90, reason }, {
    ...dependencies,
    notifications: notify && { ...notify, createNotification: (executor, input) => notify.createNotification(executor || c, input) },
  });
};

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

test('rechazo con dos reservas y un transfer crea un aviso por operación a sus asesores', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11), reserve('R2', 12)], transfers: [transfer(31, 11)] });
  const firstReservationMarker = c.state.reservations[0].Pendiente_Por_Entidad_En;
  const result = await reject(c, deps(), 'Nombre incorrecto');
  assert.equal(result.reservasAfectadas, 2); assert.equal(result.transfersAfectados, 1);
  assert.deepEqual(new Set(result.reservasIds), new Set(['R1', 'R2']));
  assert.deepEqual(result.transfersIds, ['31']);
  for (const row of [...c.state.reservations, ...c.state.transfers]) {
    assert.equal(row.Id_Entidad_Reportante, null); assert.equal(row.Estado, 'Pendiente de datos');
    assert.ok(row.Pendiente_Por_Entidad_En);
  }
  assert.equal(c.state.reservations[0].Pendiente_Por_Entidad_En, firstReservationMarker);
  assert.equal(c.state.histories.filter(h => h.tabla === 'reservas' || h.tabla === 'transfers').length, 0);
  assert.equal(c.state.pendings.filter(p => p.estado === 'ACTIVO').length, 3);
  assert.equal(c.state.notices.length, 3);
  assert.deepEqual(c.state.notices.map(n => `${n.data.operacionTipo}:${n.data.operacionId}`).sort(),
    ['RESERVA:R1', 'RESERVA:R2', 'TRANSFER:31']);
  assert.deepEqual(new Set(c.state.notices.map(n => n.userId)), new Set(['11', '12']));
  assert.equal(c.state.notices.find(n => n.data.operacionId === 'R1').message,
    'Tu reserva R1 quedó pendiente: la entidad "Hotel Sol" no fue aprobada. Cambia la entidad para continuar.');
  assert.equal(c.state.notices.find(n => n.data.operacionId === '31').message,
    'Tu transfer TRS00031 quedó pendiente: la entidad "Hotel Sol" no fue aprobada. Cambia la entidad para continuar.');
  assert.equal(c.state.notices.find(n => n.data.operacionId === 'R1').data.route, '/Reservas/EditarReserva/R1');
  assert.equal(c.state.notices.find(n => n.data.operacionId === '31').data.route, '/Transfers/EditarTransfer/31');
});

test('rechazo avisa por operación a validadores y administradores, sin avisar actor ni creador', async () => {
  const c = new Connection({
    reservations: [reserve('R1', 11), reserve('R2', 12)],
    transfers: [transfer(31, 11)],
    activeUsers: [11, 12, 90, 91, 92, 93],
    validationUsers: [90, 91, 92, 93, 11], // 90 rechaza; 91/92 validan; 93 es administrador; 11 creó R1 y T31.
  });
  const result = await reject(c);
  const validatorNotices = c.state.notices.filter(n => ['91', '92', '93'].includes(n.userId));
  const creatorNotices = c.state.notices.filter(n => ['11', '12'].includes(n.userId)
    && n.message.startsWith('Tu '));
  assert.equal(result.reservasAfectadas, 2);
  assert.equal(result.transfersAfectados, 1);
  assert.equal(result.avisosValidacionCreados, 10);
  assert.equal(result.alertasCreadas, 13);
  assert.equal(validatorNotices.length, 9);
  assert.equal(creatorNotices.length, 3);
  assert.equal(c.state.notices.some(n => n.userId === '90'), false);

  for (const operation of [
    { kind: 'RESERVA', id: 'R1', creator: '11', message: 'Se rechazó la entidad "Hotel Sol": la reserva R1 quedó pendiente por entidad.' },
    { kind: 'RESERVA', id: 'R2', creator: '12', message: 'Se rechazó la entidad "Hotel Sol": la reserva R2 quedó pendiente por entidad.' },
    { kind: 'TRANSFER', id: '31', creator: '11', message: 'Se rechazó la entidad "Hotel Sol": el transfer TRS00031 quedó pendiente por entidad.' },
  ]) {
    const rows = validatorNotices.filter(n => n.data.operacionTipo === operation.kind
      && n.data.operacionId === operation.id);
    assert.deepEqual(new Set(rows.map(n => n.userId)), new Set(['91', '92', '93']));
    assert.ok(rows.every(n => n.message === operation.message));
    assert.ok(rows.every(n => n.userId !== operation.creator && n.userId !== '90'));
    assert.ok(rows.every(n => n.data.route === (operation.kind === 'RESERVA'
      ? `/Reservas/EditarReserva/${operation.id}` : `/Transfers/EditarTransfer/${operation.id}`)));
  }
  assert.deepEqual(new Set(creatorNotices.map(n => `${n.data.operacionTipo}:${n.data.operacionId}`)),
    new Set(['RESERVA:R1', 'RESERVA:R2', 'TRANSFER:31']));
  assert.equal(c.state.notices.filter(n => n.userId === '11' && n.data.operacionId === 'R1').length, 1);
  assert.equal(c.state.notices.find(n => n.userId === '11' && n.data.operacionId === 'R1').message,
    'Tu reserva R1 quedó pendiente: la entidad "Hotel Sol" no fue aprobada. Cambia la entidad para continuar.');
  assert.equal(c.state.notices.filter(n => n.userId === '11' && n.data.operacionId === 'R2').length, 1);
  assert.match(c.state.notices.find(n => n.userId === '11' && n.data.operacionId === 'R2').message,
    /^Se rechazó la entidad/);
  assert.equal(new Set(c.state.notices.map(n => `${n.userId}:${n.deduplicationKey}`)).size, c.state.notices.length);
  const permissionQuery = c.sql.find(row => row.sql.startsWith('SELECT DISTINCT u.Id_Usuario'))?.sql || '';
  assert.match(permissionQuery, /ENTIDADES_REPORTANTES\.VALIDAR/);
  assert.match(permissionQuery, /LOWER\(TRIM\(r\.Nombre_Rol\)\)='administrador'/i);
});

test('rechazo con una reserva activa sin marca establece Pendiente_Por_Entidad_En', async () => {
  const reservation = { ...reserve('R-ACTIVA', 11), Pendiente_Por_Entidad_En: null };
  const c = new Connection({ reservations: [reservation] });
  const result = await reject(c);
  assert.deepEqual(result.reservasIds, ['R-ACTIVA']);
  assert.equal(c.state.reservations[0].Id_Entidad_Reportante, null);
  assert.equal(c.state.reservations[0].Estado, 'Pendiente de datos');
  assert.ok(c.state.reservations[0].Pendiente_Por_Entidad_En);
});

test('rechazo con un transfer activo lo deja pendiente por entidad y devuelve su ID', async () => {
  const c = new Connection({ transfers: [transfer(41, 11)] });
  const result = await reject(c);
  assert.deepEqual(result.transfersIds, ['41']);
  assert.equal(c.state.transfers[0].Id_Entidad_Reportante, null);
  assert.equal(c.state.transfers[0].Estado, 'Pendiente de datos');
  assert.ok(c.state.transfers[0].Pendiente_Por_Entidad_En);
});

test('rechazo no toca una reserva ya realizada', async () => {
  const completed = { ...reserve('R-REALIZADA', 11), Estado: 'Completada',
    Pendiente_Por_Entidad_En: null, Eliminada_En: null };
  const c = new Connection({ reservations: [completed] });
  const original = structuredClone(completed);
  const result = await reject(c);
  assert.deepEqual(result.reservasIds, []);
  assert.deepEqual(c.state.reservations[0], original);
  assert.equal(c.state.histories.some(h => h.tabla === 'reservas'), false);
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

test('un fallo al crear un aviso de validación se registra y no bloquea el rechazo', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11)], activeUsers: [11, 90, 91, 92],
    validationUsers: [90, 91, 92] });
  const result = await reject(c, deps({ failAt: 2 }));
  assert.equal(c.state.entity, null);
  assert.equal(c.state.reservations.every(row => row.Id_Entidad_Reportante === null), true);
  assert.equal(c.commits, 1); assert.equal(c.rollbacks, 0);
  assert.equal(result.alertasCreadas, 2); assert.equal(result.alertasFallidas, 1);
  assert.equal(result.avisosValidacionCreados, 1); assert.equal(result.avisosValidacionFallidos, 1);
  assert.equal(c.state.notices.some(n => n.userId === '11'), true);
  assert.equal(c.state.notices.some(n => n.userId === '92'), true);
  assert.equal(c.state.notices.some(n => n.userId === '91'), false);
});

test('asesor inactivo omite su aviso y el rechazo se completa', async () => {
  const c = new Connection({ reservations: [reserve('R-INACTIVA', 11)], activeUsers: [] });
  const result = await reject(c);
  assert.equal(c.state.entity, null);
  assert.equal(c.state.reservations[0].Id_Entidad_Reportante, null);
  assert.equal(c.commits, 1); assert.equal(c.rollbacks, 0);
  assert.equal(result.alertasOmitidasAsesorNoDisponible, 1);
  assert.equal(c.state.notices.length, 0);
});

test('un creador que también valida recibe solo el aviso de asesor para su operación', async () => {
  const c = new Connection({ reservations: [reserve('R-VALIDADOR', 91)],
    activeUsers: [11, 90, 91], validationUsers: [90, 91] });
  const result = await reject(c);
  assert.equal(c.state.entity, null);
  assert.equal(result.alertasCreadas, 1);
  assert.equal(c.state.notices.length, 1);
  assert.equal(c.state.notices[0].userId, '91');
  assert.match(c.state.notices[0].message, /^Tu reserva R-VALIDADOR/);
  assert.equal(c.state.pendings.filter(p => p.estado === 'ACTIVO').length, 1);
});

test('motivo opcional y límite de 200 caracteres', async () => {
  const c = new Connection(); await reject(c, deps(), ''); assert.equal(c.commits, 1);
  const long = new Connection();
  await assert.rejects(reject(long, deps(), 'x'.repeat(201)), e => e.errorCode === 'ENTITY_REJECTION_REASON_INVALID');
  assert.equal(long.state.entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
});

test('al asignar entidad desaparece el aviso de esa operación y se conserva el de las demás', async () => {
  const c = new Connection({ reservations: [reserve('R1', 11), reserve('R2', 12)], transfers: [transfer(31, 11)],
    activeUsers: [11, 12, 90, 91], validationUsers: [90, 91] });
  await reject(c);
  c.state.reservations[0].Id_Entidad_Reportante = 8;
  // La ruta de edición llama este cierre dentro de su transacción, después de recalcular estado.
  await resolveRejectedEntityOperation(c, 'RESERVA', 'R1', {
    async resolveCondition(key, connection) { connection.state.pendings.find(p => p.key === key).estado = 'RESUELTO'; },
  });
  const firstPending = c.state.pendings.find(p => p.data.reservasIds.includes('R1'));
  const secondPending = c.state.pendings.find(p => p.data.reservasIds.includes('R2'));
  assert.equal(firstPending.estado, 'RESUELTO');
  assert.equal(secondPending.estado, 'ACTIVO');
  assert.ok(c.state.notices.filter(n => n.data.operacionId === 'R1').every(n => n.leida === true));
  assert.ok(c.state.notices.filter(n => n.data.operacionId === 'R2').every(n => n.leida === undefined));
  assert.ok(c.state.notices.filter(n => n.data.operacionId === '31').every(n => n.leida === undefined));
  c.state.transfers[0].Id_Entidad_Reportante = 8;
  await resolveRejectedEntityOperation(c, 'TRANSFER', '31', {
    async resolveCondition(key, connection) { connection.state.pendings.find(p => p.key === key).estado = 'RESUELTO'; },
  });
  assert.ok(c.state.notices.filter(n => n.data.operacionId === '31').every(n => n.leida === true));
  c.state.reservations[1].Id_Entidad_Reportante = 8;
  await resolveRejectedEntityOperation(c, 'RESERVA', 'R2', {
    async resolveCondition(key, connection) { connection.state.pendings.find(p => p.key === key).estado = 'RESUELTO'; },
  });
  assert.equal(secondPending.estado, 'RESUELTO');
  assert.ok(c.state.notices.filter(n => n.data.operacionId === 'R2').every(n => n.leida === true));
});

test('el aviso directo al validador se cierra aunque el creador no tenga pendiente activo', async () => {
  const c = new Connection({ reservations: [reserve('R-SIN-PENDIENTE', 11)],
    activeUsers: [90, 91], validationUsers: [90, 91] });
  await reject(c);
  assert.equal(c.state.pendings.some(p => p.estado === 'ACTIVO'), false);
  assert.equal(c.state.notices.length, 1);
  assert.equal(c.state.notices[0].userId, '91');

  c.state.reservations[0].Id_Entidad_Reportante = 8;
  const recipients = await resolveRejectedEntityOperation(c, 'RESERVA', 'R-SIN-PENDIENTE', {
    async resolveCondition() {},
  });
  assert.deepEqual(recipients, ['91']);
  assert.equal(c.state.notices[0].leida, true);
});
