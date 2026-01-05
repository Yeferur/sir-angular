const db = require('../../database/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
    { expiresIn: '7d' }   // ahora dura 7 días
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
 * Eliminar sesión en base de datos
 */
/**
 * Cierra todas las sesiones de un usuario, desconecta WebSocket y notifica.
 */
async function logoutUserById(userId, isForced = false) {
  // 1) Borrar todas las sesiones
  await db.query(
    'DELETE FROM sesiones WHERE Id_Usuario = ?',
    [userId]
  );

  // 2) Cerrar WebSocket si está conectado
  const wsManager = require('../../websocketManager');
  const clientSocket = wsManager.getClient(userId);
  if (clientSocket && clientSocket.readyState === 1) { // 1 = OPEN
    // Enviar tipo diferente según si es logout normal o forzado
    const messageType = isForced ? 'force-logout' : 'logout';
    clientSocket.send(JSON.stringify({ type: messageType }));
    
    // Pequeño delay para asegurar que el mensaje se envíe antes de cerrar
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Cerrar socket - esto dispara ws.on('close') que llamará removeClient
    clientSocket.close();
  } else if (clientSocket) {
    // Si el socket existe pero no está abierto, remover manualmente
    wsManager.removeClient(userId);
  }

  // 3) Pequeño delay para asegurar que la DB se actualizó antes de broadcast
  await new Promise(resolve => setTimeout(resolve, 100));

  // 4) Notificar a todos los clientes
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


module.exports = {
  findUserByUsername,
  comparePasswords,
  generateToken,
  saveSession,
  logoutUserById,
  getUserById
};
