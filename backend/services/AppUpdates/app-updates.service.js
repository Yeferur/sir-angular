const db = require('../../database/db');

const CURRENT_RELEASE = Object.freeze({
  version: 'v1.2.0-beta',
  title: 'SIR tiene una nueva actualización',
  message: 'Consulta los cambios y mejoras disponibles en esta versión.',
  publishedAt: '2026-09-22',
});

async function publishCurrentRelease(release = CURRENT_RELEASE) {
  const version = String(release?.version || '').trim();
  if (!version) throw new Error('La actualización debe tener una versión.');
  const deduplicationKey = `APP_UPDATE:${version}`;
  const [result] = await db.query(
    `INSERT INTO notificaciones
       (Id_Usuario, Tipo, Titulo, Mensaje, Entidad_Tipo, Entidad_Id, Datos, Clave_Deduplicacion)
     SELECT u.Id_Usuario, 'APP_UPDATE', ?, ?, 'APP_UPDATE', ?, ?, ?
       FROM usuarios u
       INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
      WHERE u.Activo = 1 AND r.Activo = 1 AND LOWER(TRIM(r.Nombre_Rol)) <> 'cliente'
     ON DUPLICATE KEY UPDATE Id_Notificacion = Id_Notificacion`,
    [release.title, release.message, version, JSON.stringify({
      version,
      publishedAt: release.publishedAt || null,
      drawer: 'app-updates',
    }), deduplicationKey]
  );
  return { version, delivered: Number(result.affectedRows || 0) };
}

module.exports = { CURRENT_RELEASE, publishCurrentRelease };
