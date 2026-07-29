const pool = require('../../database/db');

async function consultarPermisosEfectivos(executor, userId) {
  const [rows] = await executor.query(`
    SELECT DISTINCT
      p.Id_Permiso,
      p.Codigo_Permiso,
      p.Descripcion,
      p.Accion
    FROM usuarios u
    INNER JOIN permisos p
    LEFT JOIN roles r
      ON r.Id_Rol = u.Id_Rol
     AND r.Activo = 1
    LEFT JOIN rol_permisos rp
      ON rp.Id_Rol = r.Id_Rol
     AND rp.Id_Permiso = p.Id_Permiso
    LEFT JOIN usuario_permisos permiso_individual
      ON permiso_individual.Id_Usuario = u.Id_Usuario
     AND permiso_individual.Id_Permiso = p.Id_Permiso
    WHERE u.Id_Usuario = ?
      AND COALESCE(permiso_individual.Tipo, '') <> 'DENY'
      AND (
        rp.Id_Permiso IS NOT NULL
        OR permiso_individual.Tipo = 'ALLOW'
      )
  `, [userId]);

  return (rows || []).sort((a, b) => {
    const codigoA = String(a?.Codigo_Permiso || '');
    const codigoB = String(b?.Codigo_Permiso || '');
    return codigoA.localeCompare(codigoB);
  });
}

/**
 * Obtener todos los permisos de un usuario por su ID
 * Considera:
 * 1. Permisos del rol asignado
 * 2. Permisos individuales ALLOW (adicionales)
 * 3. Permisos individuales DENY (excepciones)
 * @param {number} userId - ID del usuario
 * @returns {Promise<Array>} Lista de permisos en formato MODULO.ACCION
 */
async function obtenerPermisosPorUsuario(userId) {
  const conexion = await pool.getConnection();
  try {
    return await consultarPermisosEfectivos(conexion, userId);
  } finally {
    conexion.release();
  }
}
/**
 * Verificar si un usuario tiene un permiso específico
 * Considera:
 * 1. Permisos del rol
 * 2. Permisos individuales adicionales (ALLOW) de usuario_permisos
 * 3. Permisos individuales revocados (DENY), con precedencia sobre el rol
 * @param {number} userId - ID del usuario
 * @param {string} codigoPermiso - Código del permiso (ej: 'TOURS.CREAR')
 * @returns {Promise<boolean>}
 */
async function verificarPermiso(userId, codigoPermiso) {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT
        CASE
          WHEN MAX(up.Tipo = 'DENY') = 1 THEN 0
          WHEN MAX(up.Tipo = 'ALLOW') = 1 THEN 1
          WHEN MAX(rp.Id_Permiso IS NOT NULL AND r.Activo = 1) = 1 THEN 1
          ELSE 0
        END AS tiene_permiso
      FROM usuarios u
      INNER JOIN permisos p
        ON p.Codigo_Permiso = ?
      LEFT JOIN roles r
        ON r.Id_Rol = u.Id_Rol
      LEFT JOIN rol_permisos rp
        ON rp.Id_Rol = r.Id_Rol
       AND rp.Id_Permiso = p.Id_Permiso
      LEFT JOIN usuario_permisos up
        ON up.Id_Usuario = u.Id_Usuario
       AND up.Id_Permiso = p.Id_Permiso
      WHERE u.Id_Usuario = ?
    `, [codigoPermiso, userId]);

    return Number(rows[0]?.tiene_permiso || 0) === 1;
  } finally {
    conexion.release();
  }
}

/**
 * Obtener menú dinámico basado en permisos del usuario
 * Considera:
 * 1. Módulos accesibles por el rol
 * 2. Módulos adicionales si el usuario tiene permisos individuales (ALLOW)
 * @param {number} userId - ID del usuario
 * @returns {Promise<Array>} Lista de módulos accesibles
 */
async function obtenerMenuPorUsuario(userId) {
  void userId;
  return [];
}

/**
 * Obtener todos los roles disponibles
 * @returns {Promise<Array>}
 */
async function obtenerRoles() {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT Id_Rol, Nombre_Rol, Descripcion, Activo
      FROM roles
      WHERE Activo = 1
      ORDER BY Nombre_Rol
    `);
    return rows;
  } finally {
    conexion.release();
  }
}

/**
 * Obtener todos los módulos
 * @returns {Promise<Array>}
 */
async function obtenerModulos() {
  return [];
}

/**
 * Obtener todos los permisos disponibles
 * @returns {Promise<Array>}
 */
async function obtenerTodosPermisos() {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT
        p.Id_Permiso,
        p.Codigo_Permiso,
        p.Accion,
        p.Descripcion,
        NULL AS Id_Modulo,
        p.Modulo_Permiso AS Nombre_Modulo,
        p.Modulo_Permiso AS Codigo_Modulo
      FROM permisos p
      ORDER BY p.Modulo_Permiso, p.Descripcion
    `);
    return rows;
  } finally {
    conexion.release();
  }
}

/**
 * Obtener permisos de un rol específico
 * @param {number} idRol - ID del rol
 * @returns {Promise<Array>}
 */
async function obtenerPermisosPorRol(idRol) {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT
        p.Id_Permiso,
        p.Codigo_Permiso,
        p.Accion,
        p.Descripcion,
        p.Modulo_Permiso AS Nombre_Modulo,
        p.Modulo_Permiso AS Codigo_Modulo
      FROM rol_permisos rp
      INNER JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
      WHERE rp.Id_Rol = ?
      ORDER BY p.Modulo_Permiso, p.Descripcion
    `, [idRol]);
    return rows;
  } finally {
    conexion.release();
  }
}

/**
 * Asignar permiso a un rol
 * @param {number} idRol - ID del rol
 * @param {number} idPermiso - ID del permiso
 * @returns {Promise<void>}
 */
async function asignarPermisoARol(idRol, idPermiso) {
  const conexion = await pool.getConnection();
  try {
    await conexion.query(`
      INSERT INTO rol_permisos (Id_Rol, Id_Permiso)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE Id_Rol = Id_Rol
    `, [idRol, idPermiso]);
  } finally {
    conexion.release();
  }
}

/**
 * Revocar permiso de un rol
 * @param {number} idRol - ID del rol
 * @param {number} idPermiso - ID del permiso
 * @returns {Promise<void>}
 */
async function revocarPermisoDeRol(idRol, idPermiso) {
  const conexion = await pool.getConnection();
  try {
    await conexion.query(`
      DELETE FROM rol_permisos
      WHERE Id_Rol = ? AND Id_Permiso = ?
    `, [idRol, idPermiso]);
  } finally {
    conexion.release();
  }
}

/**
 * Crear nuevo rol
 * @param {Object} rol - { Nombre_Rol, Descripcion }
 * @returns {Promise<number>} ID del rol creado
 */
async function crearRol(rol) {
  const conexion = await pool.getConnection();
  try {
    const [result] = await conexion.query(`
      INSERT INTO roles (Nombre_Rol, Descripcion, Activo)
      VALUES (?, ?, 1)
    `, [rol.Nombre_Rol, rol.Descripcion || null]);
    return result.insertId;
  } finally {
    conexion.release();
  }
}

/**
 * Actualizar rol existente
 * @param {number} idRol - ID del rol
 * @param {Object} rol - { Nombre_Rol, Descripcion, Activo }
 * @returns {Promise<void>}
 */
async function actualizarRol(idRol, rol) {
  const conexion = await pool.getConnection();
  try {
    await conexion.query(`
      UPDATE roles
      SET Nombre_Rol = ?,
          Descripcion = ?,
          Activo = ?
      WHERE Id_Rol = ?
    `, [rol.Nombre_Rol, rol.Descripcion, rol.Activo, idRol]);
  } finally {
    conexion.release();
  }
}

/**
 * Eliminar rol
 * @param {number} idRol - ID del rol
 * @returns {Promise<void>}
 */
async function eliminarRol(idRol) {
  const conexion = await pool.getConnection();
  try {
    // Verificar que no haya usuarios con este rol
    const [usuarios] = await conexion.query(`
      SELECT COUNT(*) as total FROM usuarios WHERE Id_Rol = ?
    `, [idRol]);

    if (usuarios[0].total > 0) {
      throw new Error('No se puede eliminar el rol porque tiene usuarios asignados');
    }

    await conexion.query(`DELETE FROM roles WHERE Id_Rol = ?`, [idRol]);
  } finally {
    conexion.release();
  }
}

module.exports = {
  obtenerPermisosPorUsuario,
  verificarPermiso,
  obtenerMenuPorUsuario,
  obtenerRoles,
  obtenerModulos,
  obtenerTodosPermisos,
  obtenerPermisosPorRol,
  asignarPermisoARol,
  revocarPermisoDeRol,
  crearRol,
  actualizarRol,
  eliminarRol
};
