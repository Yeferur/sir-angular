// backend/websocketManager.js
const db = require('./database/db');

const clients = new Map(); // userId -> Set<WebSocket>

function isOpen(ws) {
  return ws && ws.readyState === 1; // WebSocket.OPEN
}

function getSet(uid) {
  let set = clients.get(uid);
  if (!set) {
    set = new Set();
    clients.set(uid, set);
  }
  return set;
}

async function addClient(userId, ws) {
  const uid = Number(userId);
  const set = getSet(uid);

  set.add(ws);

  console.log(`✅ addClient uid=${uid} sockets=${set.size} usuarios=${clients.size}`);
  await broadcastActiveUsers();
}

async function removeClient(userId, ws) {
  const uid = Number(userId);
  const set = clients.get(uid);
  if (!set) return;

  if (ws) set.delete(ws);

  if (set.size === 0) clients.delete(uid);

  console.log(`❌ removeClient uid=${uid} sockets=${set.size || 0} usuarios=${clients.size}`);
  await broadcastActiveUsers();
}

function getClients(userId) {
  const uid = Number(userId);
  const set = clients.get(uid);
  return set ? Array.from(set) : [];
}

function getAllActiveUsers() {
  return Array.from(clients.keys());
}

async function broadcastActiveUsers() {
  try {
    const usuarios = getAllActiveUsers();
    const [rows] = await db.query('SELECT Id_Usuario FROM sesiones');
    const sesionesDB = rows.map(r => Number(r.Id_Usuario));

    const payload = JSON.stringify({
      type: 'usuarios_conectados_actualizados',
      usuarios,
      sesiones: sesionesDB
    });

    console.log(`📡 BroadcastActiveUsers: ${usuarios.length} conectados, ${sesionesDB.length} en DB`);

    for (const set of clients.values()) {
      for (const ws of set) {
        if (isOpen(ws)) ws.send(payload);
      }
    }
  } catch (err) {
    console.error('Error en broadcastActiveUsers:', err.message);
  }
}

// ✅ Aforo a todos menos quien actualiza (si userId viene)
function broadcastAforoActualizado({ Id_Tour, Nombre_Tour, NuevoCupo, userId = null }) {
  try {
    const payload = JSON.stringify({
      type: 'aforoActualizado',
      Id_Tour,
      Nombre_Tour,
      NuevoCupo
    });

    let enviados = 0;

    for (const [uid, set] of clients.entries()) {
      if (userId != null && uid === Number(userId)) continue;

      for (const ws of set) {
        if (isOpen(ws)) {
          ws.send(payload);
          enviados++;
        }
      }
    }

    console.log(`📡 Broadcast Aforo: Enviado a ${enviados} sockets (Tour ${Id_Tour}, Cupo: ${NuevoCupo})`);
  } catch (err) {
    console.error('Error en broadcastAforoActualizado:', err.message);
  }
}

function broadcastReservaEvento(evento) {
  try {
    const payload = JSON.stringify(evento);

    let enviados = 0;
    for (const set of clients.values()) {
      for (const ws of set) {
        if (isOpen(ws)) {
          ws.send(payload);
          enviados++;
        }
      }
    }

    console.log(`📡 Broadcast Reserva: Enviado a ${enviados} sockets (Tipo: ${evento.type})`);
  } catch (err) {
    console.error('Error en broadcastReservaEvento:', err.message);
  }
}

// ✅ Logout forzado a todas las pestañas/navegadores del usuario
function sendForceLogout(userId, reason = 'logout_remoto') {
  const uid = Number(userId);
  const set = clients.get(uid);
  if (!set || set.size === 0) return 0;

  let enviados = 0;

  for (const ws of set) {
    if (!isOpen(ws)) continue;

    try {
      ws.send(JSON.stringify({ type: 'forceLogout', reason }));
      enviados++;
    } catch {}

    try {
      ws.close(1000, 'force_logout');
    } catch {}
  }

  set.clear();
  clients.delete(uid);

  return enviados;
}

module.exports = {
  addClient,
  removeClient,
  getClients,
  getAllActiveUsers,
  broadcastActiveUsers,
  broadcastAforoActualizado,
  broadcastReservaEvento,
  sendForceLogout
};
