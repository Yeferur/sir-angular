const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const ws = require('../websocketManager');
const events = require('../services/Permisos/permissions-events');
const permissionsService = require('../services/Permisos/permisos.service');
const controller = require('../controllers/Permisos/permisos.controller');
const { checkPermission } = require('../middlewares/permissionsMiddleware');

function response() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
}

test('el evento se dirige a todas las conexiones de cada usuario afectado por un rol', async (t) => {
  const originalQuery = db.query;
  const originalSend = ws.sendToUser;
  const originalReconnect = ws.reconnectUserSockets;
  const sent = [];
  const reconnected = [];
  db.query = async (sql, params) => {
    assert.match(sql, /WHERE Id_Rol = \? AND Activo = 1/);
    assert.deepEqual(params, [7]);
    return [[{ Id_Usuario: 3 }, { Id_Usuario: 8 }], []];
  };
  ws.sendToUser = (id, event) => { sent.push([id, event]); return id === 3 ? 2 : 1; };
  ws.reconnectUserSockets = (id) => { reconnected.push(id); return 1; };
  t.after(() => { db.query = originalQuery; ws.sendToUser = originalSend; ws.reconnectUserSockets = originalReconnect; });

  assert.equal(await events.notifyRole(7), 3);
  assert.deepEqual(sent, [
    [3, { type: 'permissions:updated' }],
    [8, { type: 'permissions:updated' }],
  ]);
  assert.equal(events.notifyUser(3), 2); // También funciona si el editor es el usuario afectado.
  assert.deepEqual(sent.at(-1), [3, { type: 'permissions:updated' }]);
  assert.equal(await events.notifyRole(7, { reconnectSockets: true }), 3);
  assert.deepEqual(reconnected, [3, 8]);
  assert.equal(events.notifyUser('invalid'), 0);
});

test('WebSocket entrega el cambio a todas las pestañas y sesiones del mismo usuario', async (t) => {
  const originalQuery = db.query;
  db.query = async () => [[], []];
  t.after(() => { db.query = originalQuery; });
  const sockets = Array.from({ length: 3 }, () => ({
    readyState: 1,
    messages: [],
    send(payload) { this.messages.push(JSON.parse(payload)); },
    close() { this.readyState = 3; },
  }));
  try {
    await ws.addClient(15, 'session-a', sockets[0], { role: 'Operador' });
    await ws.addClient(15, 'session-a', sockets[1], { role: 'Operador' });
    await ws.addClient(15, 'session-b', sockets[2], { role: 'Operador' });
    assert.equal(ws.sendToUser(15, { type: 'permissions:updated' }), 3);
    sockets.forEach(socket => assert.equal(socket.messages.at(-1).type, 'permissions:updated'));
    assert.equal(ws.reconnectUserSockets(15), 3);
    sockets.forEach(socket => assert.equal(socket.readyState, 3));
  } finally {
    await ws.removeClient(15, 'session-a', sockets[0]);
    await ws.removeClient(15, 'session-a', sockets[1]);
    await ws.removeClient(15, 'session-b', sockets[2]);
  }
});

test('asignación, revocación y cambio de rol notifican después de guardar', async (t) => {
  const originals = {
    assign: permissionsService.asignarPermisoARol,
    revoke: permissionsService.revocarPermisoDeRol,
    update: permissionsService.actualizarRol,
    notify: events.safelyNotifyRole,
  };
  const order = [];
  permissionsService.asignarPermisoARol = async () => { order.push('saved'); };
  permissionsService.revocarPermisoDeRol = async () => { order.push('saved'); };
  permissionsService.actualizarRol = async () => { order.push('saved'); };
  events.safelyNotifyRole = async (id) => { order.push(`notified:${id}`); };
  t.after(() => {
    permissionsService.asignarPermisoARol = originals.assign;
    permissionsService.revocarPermisoDeRol = originals.revoke;
    permissionsService.actualizarRol = originals.update;
    events.safelyNotifyRole = originals.notify;
  });

  for (const [handler, request] of [
    [controller.asignarPermiso, { body: { idRol: 7, idPermiso: 4 } }],
    [controller.revocarPermiso, { body: { idRol: 7, idPermiso: 4 } }],
    [controller.actualizarRol, { params: { idRol: 7 }, body: { nombreRol: 'Comercial' } }],
  ]) {
    const res = response();
    await handler(request, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  }
  assert.deepEqual(order, ['saved', 'notified:7', 'saved', 'notified:7', 'saved', 'notified:7']);
});

test('el backend rechaza Mercadeo aunque el frontend conserve una opción visible', async (t) => {
  const originalRevision = permissionsService.obtenerRevisionPermisosUsuario;
  const originalPermissions = permissionsService.obtenerPermisosPorUsuario;
  permissionsService.obtenerRevisionPermisosUsuario = async () => ({ idRol: 7, usuario: 2, rol: 3 });
  permissionsService.obtenerPermisosPorUsuario = async () => [];
  t.after(() => {
    permissionsService.obtenerRevisionPermisosUsuario = originalRevision;
    permissionsService.obtenerPermisosPorUsuario = originalPermissions;
  });
  const res = response();
  let nextCalled = false;
  await checkPermission('MERCADEO.RESERVAS.LEER')({ user: { id: 991 } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.permisoRequerido, 'MERCADEO.RESERVAS.LEER');
  assert.equal(nextCalled, false);
});
