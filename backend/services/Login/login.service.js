// backend/services/Login/login.service.js
const db = require('../../database/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const permisosService = require('../Permisos/permisos.service');
const wsManager = require('../../websocketManager');

/**
 * Buscar usuario por username/email/id
 */
async function findUserByUsername(username) {
  const [rows] = await db.query(
    'SELECT * FROM usuarios WHERE Id_Usuario = ? OR Usuario = ? OR Correo = ?',
    [username, username, username]
  );
  return rows[0];
}

/**
 * Comparar contraseñas
 */
async function comparePasswords(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generar token JWT
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.Id_Usuario,
      username: user.Usuario,
      name: user.Nombres_Apellidos,
      email: user.Correo,
      role: user.Rol
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Guardar la sesión en base de datos
 */
async function saveSession(userId, token) {
  await db.query(
    `INSERT INTO sesiones (Id_Usuario, Token, Fecha_Inicio, Fecha_Expira)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))`,
    [userId, token]
  );
}

/**
 * Cierra todas las sesiones de un usuario, notifica y desconecta WS.
 * - isForced=true: cierre remoto/forzado
 * - isForced=false: logout normal del mismo usuario
 */
async function logoutUserById(userId, isForced = false) {
  const uid = Number(userId);

  // 1) eliminar sesiones
  await db.query('DELETE FROM sesiones WHERE Id_Usuario = ?', [uid]);

  // 2) avisar y desconectar websockets del usuario (todas sus pestañas)
  if (isForced) {
    wsManager.sendForceLogout(uid, 'sesion_cerrada_remotamente');
  } else {
    // logout normal: también puedes cerrar todas sus pestañas si quieres
    wsManager.sendForceLogout(uid, 'logout');
  }

  // 3) refrescar conectados
  await wsManager.broadcastActiveUsers();
}

// Obtener usuario por ID
async function getUserById(userId) {
  const [rows] = await db.query(
    'SELECT Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Rol, Activo FROM usuarios WHERE Id_Usuario = ?',
    [userId]
  );
  return rows[0] || null;
}

/**
 * Obtener permisos y menú del usuario al hacer login
 */
async function getPermisosYMenu(userId) {
  const [permisos, menu] = await Promise.all([
    permisosService.obtenerPermisosPorUsuario(userId),
    permisosService.obtenerMenuPorUsuario(userId)
  ]);

  return {
    permisos: permisos.map(p => p.Codigo_Permiso),
    menu: menu.map(m => ({
      id: m.Id_Modulo,
      nombre: m.Nombre_Modulo,
      codigo: m.Codigo_Modulo,
      icono: m.Icono,
      ruta: m.Ruta,
      orden: m.Orden
    }))
  };
}

module.exports = {
  findUserByUsername,
  comparePasswords,
  generateToken,
  saveSession,
  logoutUserById,
  getUserById,
  getPermisosYMenu
};
