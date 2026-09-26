const db = require('../../database/db');
const notifications = require('../Notificaciones/notificaciones.service');
const emailOutbox = require('../email-outbox.service');
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

async function processDueReminders({ limit = 50 } = {}, dependencies = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const database = dependencies.db || db;
  const notificationService = dependencies.notifications || notifications;
  const mailOutbox = dependencies.emailOutbox || emailOutbox;
  const wsManager = dependencies.websocketManager || websocketManager;
  const connection = await database.getConnection();
  const emitted = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT r.Id_Recordatorio, r.Id_Usuario, r.Titulo, r.Descripcion,
              r.Recurrencia, r.Intervalo, r.Siguiente_Trigger, r.Enviar_Correo,
              u.Nombres_Apellidos, u.Correo
         FROM recordatorios r
         LEFT JOIN usuarios u ON u.Id_Usuario = r.Id_Usuario
        WHERE r.Estado = 'ACTIVO' AND r.Activo = 1
          AND r.Siguiente_Trigger IS NOT NULL AND r.Siguiente_Trigger <= NOW()
          AND (r.Suprimido_Hasta IS NULL OR r.Suprimido_Hasta <= NOW())
        ORDER BY r.Siguiente_Trigger ASC
        LIMIT ? FOR UPDATE SKIP LOCKED`,
      [safeLimit]
    );

    for (const row of rows) {
      const occurrence = toMysqlDateTime(row.Siguiente_Trigger);
      const notificationId = await notificationService.createNotification(connection, {
        userId: row.Id_Usuario,
        type: 'RECORDATORIO',
        title: row.Titulo,
        message: row.Descripcion || 'Tienes un recordatorio pendiente.',
        entityType: 'RECORDATORIO',
        entityId: String(row.Id_Recordatorio),
        data: {
          ruta: '/Pendientes', tab: 'recordatorios',
          origenTipo: 'RECORDATORIO', recordatorioId: String(row.Id_Recordatorio),
          ocurrencia: occurrence,
        },
        deduplicationKey: `RECORDATORIO:${row.Id_Recordatorio}:${occurrence}`,
      });
      if (row.Enviar_Correo && mailOutbox.isSingleMailbox(row.Correo)) {
        try {
          await mailOutbox.enqueueReminderEmail({
            to: row.Correo,
            name: row.Nombres_Apellidos,
            title: row.Titulo,
            description: row.Descripcion,
          }, row.Id_Recordatorio, occurrence, { executor: connection });
        } catch (error) {
          console.error(`[Recordatorios] No se pudo encolar el correo del recordatorio ${row.Id_Recordatorio}:`, error?.message || error);
        }
      }
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
    wsManager.sendToUser(item.userId, {
      type: 'notificacionNueva',
      idNotificacion: item.notificationId,
      categoria: 'recordatorios',
    });
  }
  return { processed: emitted.length };
}

module.exports = { nextTrigger, processDueReminders };
