const db = require('../../database/db');

/**
 * Obtiene todos los usuarios
 */
async function getAllUsers() {
  const [rows] = await db.query(
    'SELECT Id_Usuario, Usuario, Nombres_Apellidos, Correo FROM usuarios WHERE Activo = 1'
  );

  // Map DB columns to frontend expected shape
  return rows.map((r) => ({
    id_user: String(r.Id_Usuario),
    username: r.Usuario || '',
    name: String(r.Nombres_Apellidos || ''),
    apellidos: '',
    email: r.Correo || '',
  }));
}

/**
 * Obtiene todas las sesiones activas
 */
async function getActiveSessions() {
  const [rows] = await db.query('SELECT Id_Usuario FROM sesiones');
  // return minimal shape expected by frontend: { id_user }
  return rows.map((r) => ({ id_user: String(r.Id_Usuario) }));
}

/**
 * Obtiene un usuario por ID (para edición)
 */
async function getUserById(id) {
  const [rows] = await db.query(
    'SELECT Id_Usuario, Usuario, Nombres_Apellidos, Correo, Telefono_Usuario, Id_Rol, Activo FROM usuarios WHERE Id_Usuario = ?',
    [id]
  );

  if (!rows.length) return null;

  const u = rows[0];

  // Obtener permisos
  const [perms] = await db.query('SELECT Id_Permiso FROM usuario_permisos WHERE Id_Usuario = ?', [id]);
  const permisos = perms.map(p => p.Id_Permiso);

  return {
    Id_Usuario: u.Id_Usuario,
    Usuario: u.Usuario,
    Nombres_Apellidos: u.Nombres_Apellidos,
    Correo: u.Correo,
    Telefono_Usuario: u.Telefono_Usuario,
    Id_Rol: u.Id_Rol,
    Activo: u.Activo,
    permisos
  };
}

/**
 * Eliminar usuario (físico o lógico)
 * En este caso intentamos físico. Si falla por FK, el controlador lo manejará.
 */
async function deleteUser(id) {
  // Primero borrar permisos
  await db.query('DELETE FROM usuario_permisos WHERE Id_Usuario = ?', [id]);

  // Luego borrar usuario
  const [result] = await db.query('DELETE FROM usuarios WHERE Id_Usuario = ?', [id]);
  return result;
}

/**
 * Obtener solo el Avatar de un usuario
 */
async function getAvatarByUserId(userId) {
  const [rows] = await db.query(
    'SELECT Avatar FROM usuarios WHERE Id_Usuario = ?',
    [userId]
  );
  return rows.length > 0 ? rows[0].Avatar : null;
}

module.exports = {
  getAllUsers,
  getActiveSessions,
  getUserById,
  deleteUser,
  getAvatarByUserId,
};

