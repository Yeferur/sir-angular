const db = require('../../database/db');
const websocketManager = require('../../websocketManager');

const EVENT_TYPE = 'permissions:updated';

function notifyUser(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;
  return websocketManager.sendToUser(id, { type: EVENT_TYPE });
}

async function notifyRole(roleId, { reconnectSockets = false } = {}) {
  const id = Number(roleId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;
  const [users] = await db.query(
    'SELECT Id_Usuario FROM usuarios WHERE Id_Rol = ? AND Activo = 1',
    [id]
  );
  let sent = 0;
  for (const user of users) {
    sent += notifyUser(user.Id_Usuario);
    if (reconnectSockets) websocketManager.reconnectUserSockets(user.Id_Usuario);
  }
  return sent;
}

async function safelyNotifyUser(userId) {
  try { await notifyUser(userId); }
  catch (error) { console.error('No se pudo notificar cambio de permisos:', error); }
}

async function safelyNotifyRole(roleId, options) {
  try { await notifyRole(roleId, options); }
  catch (error) { console.error('No se pudo notificar cambio de permisos de rol:', error); }
}

module.exports = { notifyUser, notifyRole, safelyNotifyUser, safelyNotifyRole };
