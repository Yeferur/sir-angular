const db = require('../../database/db');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');
const { toMysqlDateTime } = require('../../utils/dateTime');

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function nextReminder(recurrenceMinutes, now = new Date()) {
  const minutes = Number(recurrenceMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return toMysqlDateTime(new Date(now.getTime() + minutes * 60000));
}

async function usersWithPermissions(connection, permissionCodes) {
  const codes = [...new Set(permissionCodes.filter(Boolean))];
  if (!codes.length) return [];
  const [rows] = await connection.query(
    `SELECT effective.Id_Usuario
       FROM (
         SELECT u.Id_Usuario, p.Codigo_Permiso,
                CASE
                  WHEN MAX(up.Tipo = 'DENY') = 1 THEN 0
                  WHEN MAX(up.Tipo = 'ALLOW') = 1 THEN 1
                  WHEN MAX(rp.Id_Permiso IS NOT NULL AND r.Activo = 1) = 1 THEN 1
                  ELSE 0
                END AS Permitido
           FROM usuarios u
           INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
           INNER JOIN permisos p ON p.Codigo_Permiso IN (?)
           LEFT JOIN rol_permisos rp ON rp.Id_Rol = r.Id_Rol AND rp.Id_Permiso = p.Id_Permiso
           LEFT JOIN usuario_permisos up ON up.Id_Usuario = u.Id_Usuario AND up.Id_Permiso = p.Id_Permiso
          WHERE u.Activo = 1 AND r.Activo = 1 AND LOWER(TRIM(r.Nombre_Rol)) <> 'cliente'
          GROUP BY u.Id_Usuario, p.Codigo_Permiso
       ) effective
      WHERE effective.Permitido = 1
      GROUP BY effective.Id_Usuario
     HAVING COUNT(DISTINCT effective.Codigo_Permiso) = ?`,
    [codes, codes.length]
  );
  return rows.map((row) => Number(row.Id_Usuario));
}

async function processDuePendings({ limit = 30 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const connection = await db.getConnection();
  const emitted = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT p.Id_Pendiente, p.Id_Usuario_Destino, p.Permiso_Audiencia,
              p.Titulo, p.Descripcion, p.Entidad_Tipo, p.Entidad_Id, p.Datos,
              r.Recurrencia_Minutos, r.Configuracion
         FROM pendientes_operativos p
         INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla AND r.Activa = 1
        WHERE p.Estado = 'ACTIVO'
          AND p.Siguiente_Recordatorio IS NOT NULL AND p.Siguiente_Recordatorio <= NOW()
          AND (p.Suprimido_Hasta IS NULL OR p.Suprimido_Hasta <= NOW())
        ORDER BY p.Siguiente_Recordatorio ASC
        LIMIT ? FOR UPDATE SKIP LOCKED`,
      [safeLimit]
    );

    for (const row of rows) {
      const config = parseJson(row.Configuracion);
      const channels = Array.isArray(config.canales) ? config.canales : [];
      let recipients = [];
      if (channels.includes('NOTIFICACION')) {
        if (row.Id_Usuario_Destino) {
          const authorized = await usersWithPermissions(connection, ['PENDIENTES.LEER']);
          recipients = authorized.filter((userId) => userId === Number(row.Id_Usuario_Destino));
        } else {
          recipients = await usersWithPermissions(connection, ['PENDIENTES.LEER', row.Permiso_Audiencia]);
        }
      }
      const data = parseJson(row.Datos, null);
      for (const userId of recipients) {
        const notificationId = await notifications.createNotification(connection, {
          userId,
          type: 'PENDIENTE',
          title: row.Titulo,
          message: row.Descripcion || 'Hay una situación operativa que requiere atención.',
          entityType: row.Entidad_Tipo,
          entityId: String(row.Entidad_Id),
          data: { ...(data || {}), pendienteId: String(row.Id_Pendiente), ruta: data?.ruta || '/Pendientes' },
        });
        emitted.push({ userId, notificationId });
      }
      await connection.query(
        `UPDATE pendientes_operativos
            SET Siguiente_Recordatorio = ?
          WHERE Id_Pendiente = ?`,
        [nextReminder(row.Recurrencia_Minutos), row.Id_Pendiente]
      );
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
      categoria: 'pendientes',
    });
  }
  return { processed: emitted.length };
}

module.exports = { nextReminder, usersWithPermissions, processDuePendings };
