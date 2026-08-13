// backend/services/Login/login.service.js
const crypto = require('crypto');
const db = require('../../database/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const permisosService = require('../Permisos/permisos.service');
const wsManager = require('../../websocketManager');

const PASSWORD_HASH_ROUNDS = 10;
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 10;

function getPasswordResetCooldownSeconds(env = process.env) {
  const parsed = Number(env.PASSWORD_RESET_COOLDOWN_SECONDS);
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 3600 ? parsed : 600;
}

/**
 * Buscar usuario por username/email/id
 */
async function findUserByUsername(username) {
  const [rows] = await db.query(
    `SELECT u.*, r.Nombre_Rol AS Rol
       FROM usuarios u
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
      WHERE u.Activo = 1
        AND (u.Id_Usuario = ? OR u.Usuario = ? OR u.Correo = ?)`,
    [username, username, username]
  );
  return rows[0];
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
}

async function withTransaction(work) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error('rollback error:', rollbackError);
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function findUserByEmail(email, executor = db) {
  const normalizedEmail = normalizeEmail(email);
  const [rows] = await executor.query(
    `SELECT Id_Usuario, Nombres_Apellidos, Usuario, Correo, Activo
     FROM usuarios
     WHERE Activo = 1 AND LOWER(Correo) = LOWER(?)
     LIMIT 1
     FOR UPDATE`,
    [normalizedEmail]
  );
  return rows[0] || null;
}

async function createPasswordResetTokenForEmail(email, options = {}) {
  return withTransaction(async (conn) => {
    const user = await findUserByEmail(email, conn);

    if (!user) {
      return { user: null, rawToken: null, expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES };
    }

    const cooldownSeconds = getPasswordResetCooldownSeconds(options.env || process.env);
    const [recentTokens] = await conn.query(
      `SELECT id FROM password_reset_tokens
       WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [user.Id_Usuario, cooldownSeconds]
    );
    if (recentTokens.length) {
      return {
        user,
        rawToken: null,
        expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
        rateLimited: true,
      };
    }

    await conn.query(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL',
      [user.Id_Usuario]
    );

    const rawToken = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken);

    await conn.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL, NOW())`,
      [user.Id_Usuario, tokenHash, PASSWORD_RESET_TOKEN_TTL_MINUTES]
    );

    const result = { user, rawToken, expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES };
    if (typeof options.onCreated === 'function') {
      // Permite persistir el correo en la misma transacción que el token. Si
      // falla la cola, no queda en producción un token que nunca podrá llegar.
      await options.onCreated(result, conn);
    }
    return result;
  });
}

async function resetPasswordWithToken(rawToken, password) {
  const tokenHash = hashPasswordResetToken(rawToken);

  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       INNER JOIN usuarios u ON u.Id_Usuario = prt.user_id AND u.Activo = 1
       WHERE prt.token_hash = ?
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()
       ORDER BY prt.created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );

    const tokenRow = rows[0];
    if (!tokenRow) {
      return null;
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    await conn.query(
      'UPDATE usuarios SET Contrasena = ?, Fecha_Actualizacion = NOW() WHERE Id_Usuario = ?',
      [passwordHash, tokenRow.user_id]
    );

    await conn.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenRow.id]
    );

    await conn.query(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND id <> ?',
      [tokenRow.user_id, tokenRow.id]
    );

    await conn.query(
      'DELETE FROM sesiones WHERE Id_Usuario = ?',
      [tokenRow.user_id]
    );

    wsManager.sendLogoutAllSessions(tokenRow.user_id, 'password_reset');

    return { userId: tokenRow.user_id };
  });
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
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no configurado');
  }
  return jwt.sign(
    {
      id: user.Id_Usuario,
      username: user.Usuario,
      name: user.Nombres_Apellidos,
      email: user.Correo,
      role: user.Rol
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * Guardar la sesión en base de datos
 */
async function saveSession(userId, token) {
  const sessionDays = Number(process.env.SESSION_EXPIRES_DAYS || 7);
  await db.query(
    `INSERT INTO sesiones (Id_Usuario, Token, Fecha_Inicio, Fecha_Expira)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [userId, token, sessionDays]
  );
}

async function logoutCurrentSession(token) {
  const sessionToken = String(token || '').trim();
  if (!sessionToken) {
    return 0;
  }

  const [result] = await db.query(
    'DELETE FROM sesiones WHERE Token = ?',
    [sessionToken]
  );

  wsManager.sendSessionLogout(sessionToken, 'self_logout_current_session');
  await wsManager.broadcastActiveUsers();
  return result?.affectedRows || 0;
}

async function logoutAllSessionsForUser(userId, options = {}) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) {
    return 0;
  }
  const {
    eventType = 'selfLogoutAllSessions',
    reason = 'self_logout_all_sessions',
  } = options;

  const [result] = await db.query(
    'DELETE FROM sesiones WHERE Id_Usuario = ?',
    [uid]
  );

  if (eventType === 'forceLogout') {
    wsManager.sendForceLogout(uid, reason);
  } else if (eventType === 'selfLogoutAllSessions') {
    wsManager.sendLogoutAllSessions(uid, reason);
  }

  await wsManager.broadcastActiveUsers();
  return result?.affectedRows || 0;
}

/**
 * Cierra todas las sesiones de un usuario. Se deja como wrapper compatible.
 */
async function logoutUserById(userId, isForced = false) {
  return logoutAllSessionsForUser(userId, {
    eventType: isForced ? 'forceLogout' : 'selfLogoutAllSessions',
    reason: isForced ? 'admin_force_logout' : 'self_logout_all_sessions'
  });
}

// Obtener usuario por ID
async function getUserById(userId) {
  const [rows] = await db.query(
    'SELECT Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Id_Rol, Activo FROM usuarios WHERE Id_Usuario = ?',
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
    permisos: (permisos || []).map(p => p.Codigo_Permiso).filter(Boolean),
    menu: (menu || []).map(m => ({
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
  findUserByEmail,
  comparePasswords,
  generateToken,
  saveSession,
  logoutCurrentSession,
  logoutAllSessionsForUser,
  logoutUserById,
  getUserById,
  getPermisosYMenu,
  createPasswordResetTokenForEmail,
  resetPasswordWithToken,
  hashPasswordResetToken,
  generatePasswordResetToken,
  getPasswordResetCooldownSeconds,
};
