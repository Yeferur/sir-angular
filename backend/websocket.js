// backend/websocket.js
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./database/db');
const websocketManager = require('./websocketManager');

process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

function initWebSocket(httpServer) {
  // ✅ Comparte el MISMO proceso/servidor
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'auth') {
          try {
            if (!process.env.JWT_SECRET) {
              ws.send(JSON.stringify({ type: 'error', message: 'JWT_SECRET no definido' }));
              ws.close(1011, 'server_config_error');
              return;
            }

            const decoded = jwt.verify(data.token, process.env.JWT_SECRET);

            const [rows] = await db.query(
              'SELECT 1 FROM sesiones WHERE Token = ? LIMIT 1',
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

            userId = Number(decoded.id);
            await websocketManager.addClient(userId, ws);

            ws.send(JSON.stringify({ type: 'success', message: 'Autenticado' }));
            return;
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Auth error: ' + err.message }));
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
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'Error procesando mensaje: ' + err.message }));
        } catch {}
      }
    });

    ws.on('close', () => {
      if (userId) websocketManager.removeClient(userId, ws);
    });

    ws.on('error', (e) => {
      console.error('WS socket error:', e?.message || e);
    });
  });

  console.log('✅ WebSocket inicializado en path /ws (mismo server HTTP)');
  return wss;
}

module.exports = { initWebSocket };
