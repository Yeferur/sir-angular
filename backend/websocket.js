// websocket.js
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./database/db');
const websocketManager = require('./websocketManager');

const wss = new WebSocket.Server({ port: 6000 });

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'auth') {
        try {
          const decoded = jwt.verify(data.token, process.env.JWT_SECRET);

          // Verifica si la sesión está activa en la base de datos
          const [rows] = await db.query(
            'SELECT * FROM sesiones WHERE Token = ? LIMIT 1',
            [data.token]
          );

          if (!rows || rows.length === 0) {
            console.warn('WebSocket: Sesión no encontrada para token:', data.token?.substring(0, 20) + '...');
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Sesión inválida o expirada - por favor inicia sesión nuevamente' 
            }));
            ws.close(1008, 'Sesión inválida');
            return;
          }

          userId = decoded.id;
          await websocketManager.addClient(userId, ws);
          console.log(`WebSocket: Usuario ${userId} autenticado correctamente`);

          ws.send(JSON.stringify({ type: 'success', message: 'Autenticado' }));
        } catch (authErr) {
          console.error('WebSocket auth error:', authErr.message);
          ws.send(JSON.stringify({ type: 'error', message: 'Error en autenticación: ' + authErr.message }));
          ws.close();
          return;
        }
      }

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

    } catch (err) {
      console.error('WebSocket message error:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Error procesando mensaje: ' + err.message }));
    }
  });

  ws.on('close', () => {
    if (userId) {
      websocketManager.removeClient(userId);
      console.log(`Usuario ${userId} desconectado`);
    }
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:6000');