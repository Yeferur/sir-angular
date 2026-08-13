const db = require('./database/db');
const { isClientRoleName } = require('./utils/clientAccess');

// userId -> Map(token -> Set<WebSocket>)
const clientsByUser = new Map();
// token -> { userId, sockets: Set<WebSocket> }
const clientsByToken = new Map();
const wsMeta = new WeakMap();

function isOpen(ws) {
  return ws && ws.readyState === 1; // WebSocket.OPEN
}

function getOrCreateUserMap(userId) {
  const uid = Number(userId);
  let userMap = clientsByUser.get(uid);
  if (!userMap) {
    userMap = new Map();
    clientsByUser.set(uid, userMap);
  }
  return userMap;
}

function getOrCreateTokenEntry(token, userId) {
  const safeToken = String(token || '');
  let entry = clientsByToken.get(safeToken);
  if (!entry) {
    entry = { userId: Number(userId), sockets: new Set() };
    clientsByToken.set(safeToken, entry);
  } else if (userId != null) {
    entry.userId = Number(userId);
  }
  return entry;
}

function cleanupUserMap(userId) {
  const uid = Number(userId);
  const userMap = clientsByUser.get(uid);
  if (!userMap || userMap.size === 0) {
    clientsByUser.delete(uid);
  }
}

function cleanupTokenEntry(token) {
  const safeToken = String(token || '');
  const entry = clientsByToken.get(safeToken);
  if (!entry || entry.sockets.size === 0) {
    clientsByToken.delete(safeToken);
  }
}

function detachSocket(ws) {
  const meta = wsMeta.get(ws);
  if (!meta) return null;

  const { userId, token } = meta;
  const uid = Number(userId);
  const safeToken = String(token || '');

  const userMap = clientsByUser.get(uid);
  if (userMap) {
    const tokenSet = userMap.get(safeToken);
    if (tokenSet) {
      tokenSet.delete(ws);
      if (tokenSet.size === 0) {
        userMap.delete(safeToken);
      }
    }
  }

  const tokenEntry = clientsByToken.get(safeToken);
  if (tokenEntry) {
    tokenEntry.sockets.delete(ws);
    if (tokenEntry.sockets.size === 0) {
      clientsByToken.delete(safeToken);
    }
  }

  wsMeta.delete(ws);
  cleanupUserMap(uid);
  cleanupTokenEntry(safeToken);

  return { userId: uid, token: safeToken };
}

function trackSocket(userId, token, ws, metadata = {}) {
  const uid = Number(userId);
  const safeToken = String(token || '');
  const userMap = getOrCreateUserMap(uid);
  const tokenSet = userMap.get(safeToken) || new Set();
  tokenSet.add(ws);
  userMap.set(safeToken, tokenSet);

  const tokenEntry = getOrCreateTokenEntry(safeToken, uid);
  tokenEntry.sockets.add(ws);
  wsMeta.set(ws, {
    userId: uid,
    token: safeToken,
    role: metadata.role || null,
    isClient: isClientRoleName(metadata.role),
  });
}

async function addClient(userId, token, ws, metadata = {}) {
  const uid = Number(userId);
  const safeToken = String(token || '');

  if (!uid || !safeToken) {
    return 0;
  }

  trackSocket(uid, safeToken, ws, metadata);

  const userMap = clientsByUser.get(uid);
  const tokenSet = userMap?.get(safeToken);
  console.log(`✅ addClient uid=${uid} tokenSockets=${tokenSet?.size || 0} tokens=${userMap?.size || 0} usuarios=${clientsByUser.size}`);
  await broadcastActiveUsers();
  return tokenSet?.size || 0;
}

async function removeClient(userId, tokenOrWs, maybeWs) {
  let ws = maybeWs;
  let token = tokenOrWs;

  if (tokenOrWs && typeof tokenOrWs === 'object' && !maybeWs) {
    ws = tokenOrWs;
    token = null;
  }

  if (ws) {
    const meta = wsMeta.get(ws);
    if (meta) {
      token = meta.token;
      userId = meta.userId;
    }
  }

  if (userId == null || token == null || !ws) return;

  const uid = Number(userId);
  const safeToken = String(token || '');

  const userMap = clientsByUser.get(uid);
  if (userMap) {
    const tokenSet = userMap.get(safeToken);
    if (tokenSet) {
      tokenSet.delete(ws);
      if (tokenSet.size === 0) {
        userMap.delete(safeToken);
      }
    }
  }

  const tokenEntry = clientsByToken.get(safeToken);
  if (tokenEntry) {
    tokenEntry.sockets.delete(ws);
    if (tokenEntry.sockets.size === 0) {
      clientsByToken.delete(safeToken);
    }
  }

  wsMeta.delete(ws);
  cleanupUserMap(uid);
  cleanupTokenEntry(safeToken);

  const remaining = userMap?.get(safeToken)?.size || 0;
  console.log(`❌ removeClient uid=${uid} tokenSockets=${remaining} tokens=${userMap?.size || 0} usuarios=${clientsByUser.size}`);
  await broadcastActiveUsers();
}

function getClients(userId) {
  const uid = Number(userId);
  const userMap = clientsByUser.get(uid);
  if (!userMap) return [];

  const sockets = [];
  for (const set of userMap.values()) {
    sockets.push(...Array.from(set));
  }
  return sockets;
}

function getAllActiveUsers() {
  return Array.from(clientsByUser.keys());
}

function sendToUser(userId, event) {
  const sockets = getClients(userId);
  const payload = JSON.stringify(event || {});
  let sent = 0;
  for (const ws of sockets) {
    if (!isOpen(ws)) continue;
    try { ws.send(payload); sent++; } catch {}
  }
  return sent;
}

async function broadcastActiveUsers() {
  try {
    const usuarios = getAllActiveUsers();
    const [rows] = await db.query('SELECT Id_Usuario FROM sesiones');
    const sesionesDB = Array.from(new Set(rows.map((r) => Number(r.Id_Usuario))));

    const payload = JSON.stringify({
      type: 'usuarios_conectados_actualizados',
      usuarios,
      sesiones: sesionesDB
    });

    console.log(`📡 BroadcastActiveUsers: ${usuarios.length} conectados, ${sesionesDB.length} en DB`);

    for (const userMap of clientsByUser.values()) {
      for (const set of userMap.values()) {
        for (const ws of set) {
          if (isOpen(ws) && !wsMeta.get(ws)?.isClient) ws.send(payload);
        }
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

    for (const [uid, userMap] of clientsByUser.entries()) {
      if (userId != null && uid === Number(userId)) continue;

      for (const set of userMap.values()) {
        for (const ws of set) {
          if (isOpen(ws)) {
            if (wsMeta.get(ws)?.isClient) continue;
            ws.send(payload);
            enviados++;
          }
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
    const { ownerUserId = null, ...publicEvent } = evento || {};
    const payload = JSON.stringify(publicEvent);

    let enviados = 0;
    for (const [uid, userMap] of clientsByUser.entries()) {
      for (const set of userMap.values()) {
        for (const ws of set) {
          if (isOpen(ws)) {
            const metadata = wsMeta.get(ws);
            if (metadata?.isClient && Number(ownerUserId) !== Number(uid)) continue;
            ws.send(payload);
            enviados++;
          }
        }
      }
    }

    console.log(`📡 Broadcast Reserva: Enviado a ${enviados} sockets (Tipo: ${publicEvent.type})`);
  } catch (err) {
    console.error('Error en broadcastReservaEvento:', err.message);
  }
}

function sendSessionLogout(token, reason = 'self_logout_current_session') {
  const safeToken = String(token || '');
  const entry = clientsByToken.get(safeToken);
  if (!entry || entry.sockets.size === 0) return 0;

  let enviados = 0;
  const payload = JSON.stringify({ type: 'logout', reason });

  for (const ws of Array.from(entry.sockets)) {
    if (!isOpen(ws)) {
      detachSocket(ws);
      continue;
    }

    try {
      ws.send(payload);
      enviados++;
    } catch {}

    try {
      ws.close(1000, 'session_logout');
    } catch {}
    detachSocket(ws);
  }

  cleanupTokenEntry(safeToken);
  return enviados;
}

function sendLogoutToUser(userId, { type, reason, closeCode = 'force_logout' }) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return 0;
  const userMap = clientsByUser.get(uid);
  if (!userMap || userMap.size === 0) return 0;

  let enviados = 0;
  const payload = JSON.stringify({
    type,
    reason
  });

  for (const [token, wsSet] of Array.from(userMap.entries())) {
    for (const ws of Array.from(wsSet)) {
      if (!isOpen(ws)) {
        detachSocket(ws);
        continue;
      }

      try {
        ws.send(payload);
        enviados++;
      } catch {}

      try {
        ws.close(1000, closeCode);
      } catch {}
      detachSocket(ws);
    }

    cleanupTokenEntry(token);
  }

  clientsByUser.delete(uid);
  return enviados;
}

// ✅ Logout forzado a todas las pestañas/navegadores del usuario
function sendForceLogout(userId, reason = 'admin_force_logout') {
  return sendLogoutToUser(userId, {
    type: 'forceLogout',
    reason,
    closeCode: 'force_logout'
  });
}

function sendLogoutAllSessions(userId, reason = 'self_logout_all_sessions') {
  return sendLogoutToUser(userId, {
    type: 'selfLogoutAllSessions',
    reason,
    closeCode: 'session_logout'
  });
}

module.exports = {
  addClient,
  removeClient,
  getClients,
  getAllActiveUsers,
  sendToUser,
  broadcastActiveUsers,
  broadcastAforoActualizado,
  broadcastReservaEvento,
  sendSessionLogout,
  sendForceLogout,
  sendLogoutAllSessions
};
