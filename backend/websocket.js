// backend/websocket.js
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./database/db');
const websocketManager = require('./websocketManager');

process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production') return true;

  const allowedOrigins = parseOrigins(
    process.env.WS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || process.env.FRONTEND_URL
  );

  return allowedOrigins.includes(origin);
}

function initWebSocket(httpServer) {
  // ✅ Comparte el MISMO proceso/servidor
  const wss = new WebSocket.Server({
    server: httpServer,
    path: '/ws',
    verifyClient: ({ origin }, done) => {
      if (isAllowedOrigin(origin)) return done(true);
      console.warn(`WS origin rechazado: ${origin}`);
      return done(false, 403, 'Origen WebSocket no permitido');
    }
  });

  wss.on('connection', (ws) => {
    let userId = null;
    let sessionToken = null;

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'auth') {
          try {
            if (!process.env.JWT_SECRET) {
              console.error('WS auth error: JWT_SECRET no definido');
              ws.send(JSON.stringify({ type: 'error', message: 'No se pudo validar la sesión en tiempo real.' }));
              ws.close(1011, 'server_config_error');
              return;
            }

            const decoded = jwt.verify(data.token, process.env.JWT_SECRET);

            const [rows] = await db.query(
              `SELECT s.Id_Usuario, r.Nombre_Rol
                 FROM sesiones s
                 INNER JOIN usuarios u ON u.Id_Usuario = s.Id_Usuario AND u.Activo = 1
                 LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
                WHERE s.Token = ?
                LIMIT 1`,
              [data.token]
            );

            if (!rows || rows.length === 0) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Sesión inválida o expirada - por favor inicia sesión nuevamente'
              }));
              ws.close(1008, 'Sesion invalida');
              return;
            }

            userId = Number(rows[0].Id_Usuario || decoded.id);
            sessionToken = String(data.token || '');
            await websocketManager.addClient(userId, sessionToken, ws, {
              role: rows[0].Nombre_Rol || null,
            });

            ws.send(JSON.stringify({ type: 'success', message: 'Autenticado' }));
            return;
          } catch (err) {
            console.error('WS auth error:', err?.message || err);
            ws.send(JSON.stringify({ type: 'error', message: 'No se pudo validar la sesión en tiempo real.' }));
            ws.close(1008, 'auth_error');
            return;
          }
        }

        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (!userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'No autenticado' }));
          return;
        }

      } catch (err) {
        console.error('WS message processing error:', err?.message || err);
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'No se pudo procesar el mensaje WebSocket.' }));
        } catch {}
      }
    });

    ws.on('close', () => {
      if (userId || sessionToken) websocketManager.removeClient(userId, sessionToken, ws);
    });

    ws.on('error', (e) => {
      console.error('WS socket error:', e?.message || e);
    });
  });

  console.log('✅ WebSocket inicializado en path /ws');
  return wss;
}

module.exports = { initWebSocket };
