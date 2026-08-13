const db = require('../../database/db');

async function createNotification(connection, notification) {
  const executor = connection || db;
  const [result] = await executor.query(
    `INSERT INTO notificaciones
       (Id_Usuario, Tipo, Titulo, Mensaje, Entidad_Tipo, Entidad_Id, Datos)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [notification.userId, notification.type, notification.title, notification.message,
      notification.entityType || null, notification.entityId || null,
      notification.data ? JSON.stringify(notification.data) : null]
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
  const [[counter]] = await db.query(
    'SELECT COUNT(*) AS Total FROM notificaciones WHERE Id_Usuario = ? AND Leida = 0', [userId]
  );
  return {
    noLeidas: Number(counter?.Total || 0),
    notificaciones: rows.map((row) => ({
      idNotificacion: String(row.Id_Notificacion), tipo: row.Tipo, titulo: row.Titulo,
      mensaje: row.Mensaje, entidadTipo: row.Entidad_Tipo, entidadId: row.Entidad_Id ? String(row.Entidad_Id) : null,
      datos: typeof row.Datos === 'string' ? JSON.parse(row.Datos) : (row.Datos || null),
      leida: !!row.Leida, fechaLectura: row.Fecha_Lectura, fechaCreacion: row.Fecha_Creacion,
    })),
  };
}

async function markRead(userId, notificationId) {
  const [result] = await db.query(
    `UPDATE notificaciones SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE Id_Notificacion = ? AND Id_Usuario = ?`, [notificationId, userId]
  );
  return result.affectedRows > 0;
}

async function markAllRead(userId) {
  await db.query(
    `UPDATE notificaciones SET Leida = 1, Fecha_Lectura = COALESCE(Fecha_Lectura, NOW())
      WHERE Id_Usuario = ? AND Leida = 0`, [userId]
  );
}

module.exports = { createNotification, listMine, markRead, markAllRead };
