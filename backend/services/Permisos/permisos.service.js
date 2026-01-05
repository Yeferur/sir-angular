const pool = require('../../database/db');

/**
 * Obtener todos los permisos de un usuario por su ID
 * @param {number} userId - ID del usuario
 * @returns {Promise<Array>} Lista de permisos en formato MODULO.ACCION
 */
async function obtenerPermisosPorUsuario(userId) {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT DISTINCT 
        p.Codigo_Permiso,
        p.Accion,
        m.Codigo_Modulo,
        m.Nombre_Modulo,
        p.Descripcion
      FROM usuarios u
      INNER JOIN roles r ON u.Id_Rol = r.Id_Rol
      INNER JOIN rol_permisos rp ON r.Id_Rol = rp.Id_Rol
      INNER JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
      INNER JOIN modulos m ON p.Id_Modulo = m.Id_Modulo
      WHERE u.Id_Usuario = ?
        AND r.Activo = 1
        AND m.Activo = 1
      ORDER BY m.Orden, p.Accion
    `, [userId]);

    return rows;
  } finally {
    conexion.release();
  }
}

/**
 * Verificar si un usuario tiene un permiso específico
 * @param {number} userId - ID del usuario
 * @param {string} codigoPermiso - Código del permiso (ej: 'TOURS.CREAR')
 * @returns {Promise<boolean>}
 */
async function verificarPermiso(userId, codigoPermiso) {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT COUNT(*) as tiene_permiso
      FROM usuarios u
      INNER JOIN roles r ON u.Id_Rol = r.Id_Rol
      INNER JOIN rol_permisos rp ON r.Id_Rol = rp.Id_Rol
      INNER JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
      WHERE u.Id_Usuario = ?
        AND p.Codigo_Permiso = ?
        AND r.Activo = 1
    `, [userId, codigoPermiso]);

    return rows[0].tiene_permiso > 0;
  } finally {
    conexion.release();
  }
}

/**
 * Obtener menú dinámico basado en permisos del usuario
 * @param {number} userId - ID del usuario
 * @returns {Promise<Array>} Lista de módulos accesibles
 */
async function obtenerMenuPorUsuario(userId) {
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT DISTINCT 
        m.Id_Modulo,
        m.Nombre_Modulo,
        m.Codigo_Modulo,
        m.Icono,
        m.Ruta,
        m.Orden
      FROM usuarios u
      INNER JOIN roles r ON u.Id_Rol = r.Id_Rol
      INNER JOIN rol_permisos rp ON r.Id_Rol = rp.Id_Rol
      INNER JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
      INNER JOIN modulos m ON p.Id_Modulo = m.Id_Modulo
      WHERE u.Id_Usuario = ?
        AND r.Activo = 1
        AND m.Activo = 1
      ORDER BY m.Orden
    `, [userId]);

    return rows;
  } finally {
    conexion.release();
  }
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
  const conexion = await pool.getConnection();
  try {
    const [rows] = await conexion.query(`
      SELECT Id_Modulo, Nombre_Modulo, Codigo_Modulo, Descripcion, Icono, Ruta, Orden, Activo
      FROM modulos
      ORDER BY Orden
    `);
    return rows;
  } finally {
    conexion.release();
  }
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
        m.Id_Modulo,
        m.Nombre_Modulo,
        m.Codigo_Modulo
      FROM permisos p
      INNER JOIN modulos m ON p.Id_Modulo = m.Id_Modulo
      ORDER BY m.Orden, p.Accion
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
        m.Nombre_Modulo,
        m.Codigo_Modulo
      FROM rol_permisos rp
      INNER JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
      INNER JOIN modulos m ON p.Id_Modulo = m.Id_Modulo
      WHERE rp.Id_Rol = ?
      ORDER BY m.Orden, p.Accion
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
