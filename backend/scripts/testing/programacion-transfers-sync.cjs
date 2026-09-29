// Nuevo proceso del detector con la misma base de pruebas persistida.
const { assertTestDestination } = require('../migrate-programacion-transfers');
assertTestDestination(process.env, process.env.DB_NAME);
const pool = require('../../database/db');
const websocket = require('../../websocketManager');
const events = [];
websocket.sendToUser = (userId, event) => events.push({ userId, type: event.type });
(async () => {
  await require('../../services/Programacion/programacion-transfers-novedades.service').syncSavedLists();
  process.send({ events });
})().catch((error) => { process.send({ error: error.message }); process.exitCode = 1; })
  .finally(async () => { await pool.end(); process.disconnect(); });
