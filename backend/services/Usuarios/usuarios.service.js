const db = require('../../database/db');

/**
 * Obtiene todos los usuarios
 */
async function getAllUsers() {
  const [rows] = await db.query(
    'SELECT Id_Usuario, Usuario, Nombres_Apellidos, Correo FROM usuarios'
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

module.exports = {
  getAllUsers,
  getActiveSessions
};
