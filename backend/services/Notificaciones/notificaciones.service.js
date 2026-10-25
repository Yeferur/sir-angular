const db = require('../../database/db');

async function createNotification(connection, notification) {
  const executor = connection || db;
  const [result] = await executor.query(
    `INSERT INTO notificaciones
       (Id_Usuario, Tipo, Titulo, Mensaje, Entidad_Tipo, Entidad_Id, Datos, Clave_Deduplicacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE Id_Notificacion = LAST_INSERT_ID(Id_Notificacion)`,
    [notification.userId, notification.type, notification.title, notification.message,
      notification.entityType || null, notification.entityId || null,
      notification.data ? JSON.stringify(notification.data) : null,
      notification.deduplicationKey || null]
  );
  return String(result.insertId);
}

async function listMine(userId, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const [rows] = await db.query(
    `SELECT Id_Notificacion, Tipo, Titulo, Mensaje, Entidad_Tipo, Entidad_Id,
            Datos, Leida, Fecha_Lectura, Fecha_Creacion
       FROM notificaciones WHERE Id_Usuario = ?
      ORDER BY Fecha_Creacion DESC LIMIT ?`,
    [userId, safeLimit]
  );
  const [activeRejections] = await db.query(
    `SELECT n.Id_Notificacion, n.Tipo, n.Titulo, n.Mensaje, n.Entidad_Tipo, n.Entidad_Id,
            n.Datos, n.Leida, n.Fecha_Lectura, n.Fecha_Creacion
       FROM notificaciones n
      WHERE n.Id_Usuario=? AND n.Tipo='ENTIDAD_REPORTANTE_RECHAZADA'
        AND EXISTS (SELECT 1 FROM pendientes_operativos p
          WHERE p.Clave_Deduplicacion=n.Clave_Deduplicacion AND p.Estado='ACTIVO')
      ORDER BY n.Fecha_Creacion DESC`, [userId]
  );
  const visible = [...new Map([...activeRejections, ...rows]
    .map(row => [String(row.Id_Notificacion), row])).values()]
    .sort((a, b) => new Date(b.Fecha_Creacion).getTime() - new Date(a.Fecha_Creacion).getTime());
  const [[counter]] = await db.query(
    'SELECT COUNT(*) AS Total FROM notificaciones WHERE Id_Usuario = ? AND Leida = 0', [userId]
  );
  return {
    noLeidas: Number(counter?.Total || 0),
    notificaciones: visible.map((row) => ({
      idNotificacion: String(row.Id_Notificacion), tipo: row.Tipo, titulo: row.Titulo,
      mensaje: row.Mensaje, entidadTipo: row.Entidad_Tipo, entidadId: row.Entidad_Id ? String(row.Entidad_Id) : null,
      datos: typeof row.Datos === 'string' ? JSON.parse(row.Datos) : (row.Datos || null),
      leida: !!row.Leida, fechaLectura: row.Fecha_Lectura, fechaCreacion: row.Fecha_Creacion,
    })),
  };
}

async function markRead(userId, notificationId) {
  const [result] = await db.query(
    `UPDATE notificaciones n SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE n.Id_Notificacion = ? AND n.Id_Usuario = ?
        AND (n.Tipo <> 'ENTIDAD_REPORTANTE_RECHAZADA' OR NOT EXISTS
          (SELECT 1 FROM pendientes_operativos p
            WHERE p.Clave_Deduplicacion=n.Clave_Deduplicacion AND p.Estado='ACTIVO'))`, [notificationId, userId]
  );
  return result.affectedRows > 0;
}

async function markAllRead(userId) {
  await db.query(
    `UPDATE notificaciones n SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE n.Id_Usuario = ? AND n.Leida = 0
        AND (n.Tipo <> 'ENTIDAD_REPORTANTE_RECHAZADA' OR NOT EXISTS
          (SELECT 1 FROM pendientes_operativos p
            WHERE p.Clave_Deduplicacion=n.Clave_Deduplicacion AND p.Estado='ACTIVO'))`, [userId]
  );
}

async function markReminderHandled(executor, userId, reminderId) {
  const database = executor || db;
  const [result] = await database.query(
    `UPDATE notificaciones
        SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE Id_Usuario = ? AND Tipo = 'RECORDATORIO' AND Entidad_Id = ? AND Leida = 0`,
    [userId, String(reminderId)]
  );
  return Number(result.affectedRows || 0);
}

async function markPendingHandled(executor, pendingId) {
  const database = executor || db;
  const [result] = await database.query(
    `UPDATE notificaciones
        SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE Tipo = 'PENDIENTE' AND Leida = 0
        AND JSON_UNQUOTE(JSON_EXTRACT(Datos, '$.pendienteId')) = ?`,
    [String(pendingId)]
  );
  return Number(result.affectedRows || 0);
}

module.exports = {
  createNotification,
  listMine,
  markRead,
  markAllRead,
  markReminderHandled,
  markPendingHandled,
};
