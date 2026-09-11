const db = require('../../database/db');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');
const { toMysqlDateTime } = require('../../utils/dateTime');

function nextTrigger(row, now = new Date()) {
  const recurrence = String(row.Recurrencia || '').trim().toUpperCase();
  const interval = Math.min(Math.max(Number.parseInt(row.Intervalo, 10) || 1, 1), 365);
  if (!recurrence || recurrence === 'NINGUNA') return null;
  const next = new Date(now);
  if (recurrence === 'DIARIA') next.setUTCDate(next.getUTCDate() + interval);
  else if (recurrence === 'SEMANAL') next.setUTCDate(next.getUTCDate() + interval * 7);
  else return null;
  return toMysqlDateTime(next);
}

async function processDueReminders({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const connection = await db.getConnection();
  const emitted = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT Id_Recordatorio, Id_Usuario, Titulo, Descripcion, Recurrencia, Intervalo
         FROM recordatorios
        WHERE Estado = 'ACTIVO' AND Activo = 1
          AND Siguiente_Trigger IS NOT NULL AND Siguiente_Trigger <= NOW()
          AND (Suprimido_Hasta IS NULL OR Suprimido_Hasta <= NOW())
        ORDER BY Siguiente_Trigger ASC
        LIMIT ? FOR UPDATE SKIP LOCKED`,
      [safeLimit]
    );

    for (const row of rows) {
      const notificationId = await notifications.createNotification(connection, {
        userId: row.Id_Usuario,
        type: 'RECORDATORIO',
        title: row.Titulo,
        message: row.Descripcion || 'Tienes un recordatorio pendiente.',
        entityType: 'RECORDATORIO',
        entityId: String(row.Id_Recordatorio),
        data: { ruta: '/Pendientes', tab: 'recordatorios' },
      });
      await connection.query(
        `UPDATE recordatorios
            SET Siguiente_Trigger = ?, Suprimido_Hasta = NULL
          WHERE Id_Recordatorio = ?`,
        [nextTrigger(row), row.Id_Recordatorio]
      );
      emitted.push({ userId: row.Id_Usuario, notificationId });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  for (const item of emitted) {
    websocketManager.sendToUser(item.userId, {
      type: 'notificacionNueva',
      idNotificacion: item.notificationId,
      categoria: 'recordatorios',
    });
  }
  return { processed: emitted.length };
}

module.exports = { nextTrigger, processDueReminders };
