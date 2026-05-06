const loginService = require('../../services/Login/login.service');
const emailService = require('../../services/email.service');
const { recordHistorial } = require('../../services/Historial/logger');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function buildPasswordResetUrl(token) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
  const url = new URL('/reset-password', frontendUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

exports.login = async (req, res) => {
  try {
    const { username, correo, password } = req.body || {};
    const userKey = username || correo;
    if (!userKey || !password) {
      return sendError(res, { status: 400, message: 'Usuario/correo y contrasena son requeridos', errorCode: 'MISSING_PARAMS' });
    }

    const user = await loginService.findUserByUsername(userKey);
    if (!user) return sendError(res, { status: 401, message: 'Usuario no encontrado', errorCode: 'AUTH_USER_NOT_FOUND' });

    const ok = await loginService.comparePasswords(password, user.Contrasena);
    if (!ok) return sendError(res, { status: 401, message: 'Contrasena incorrecta', errorCode: 'AUTH_INVALID_CREDENTIALS' });

    const token = loginService.generateToken(user);
    await loginService.saveSession(user.Id_Usuario, token);

    try {
      await recordHistorial({
        tabla: 'sesiones',
        id_registro: user.Id_Usuario,
        accion: 'LOGIN',
        id_usuario: user.Id_Usuario,
        detalles: [
          { columna: 'Usuario', anterior: null, nuevo: user.Usuario },
          { columna: 'Correo', anterior: null, nuevo: user.Correo }
        ]
      });
    } catch (historyError) {
      console.error('login history error:', historyError);
    }

    // Obtener permisos y menú del usuario
    const { permisos, menu } = await loginService.getPermisosYMenu(user.Id_Usuario);

    return sendSuccess(res, {
      data: {
        token,
        user: {
          id_user: user.Id_Usuario,
          name: user.Nombres_Apellidos,
          username: user.Usuario,
          email: user.Correo,
          role: user.Rol
        },
        permisos,
        menu
      },
      message: 'Login exitoso'
    });
  } catch (e) {
    console.error('login error:', e);
    return sendError(res, { status: 500, message: 'Error interno', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.forgotPassword = async (req, res) => {
  const genericMessage = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';

  try {
    const { email } = req.body || {};
    if (!email || !String(email).trim()) {
      return sendError(res, {
        status: 400,
        message: 'Correo electrónico requerido',
        errorCode: 'MISSING_PARAMS'
      });
    }

    const result = await loginService.createPasswordResetTokenForEmail(email);

    if (result?.user && result?.rawToken) {
      try {
        await emailService.sendPasswordResetEmail({
          to: result.user.Correo,
          name: result.user.Nombres_Apellidos,
          resetUrl: buildPasswordResetUrl(result.rawToken),
          expiresInMinutes: result.expiresInMinutes
        });
      } catch (mailError) {
        console.error('forgot-password email error:', mailError?.message || mailError);
      }

      try {
        await recordHistorial({
          tabla: 'usuarios',
          id_registro: result.user.Id_Usuario,
          accion: 'PASSWORD_RESET_REQUEST',
          id_usuario: result.user.Id_Usuario,
          detalles: [
            { columna: 'Correo', anterior: null, nuevo: result.user.Correo }
          ]
        });
      } catch (historyError) {
        console.error('forgot-password history error:', historyError);
      }
    }

    return sendSuccess(res, { message: genericMessage });
  } catch (e) {
    console.error('forgot-password error:', e);
    return sendSuccess(res, { message: genericMessage });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const passwordText = String(password || '');

    if (!token || !String(token).trim() || !passwordText) {
      return sendError(res, {
        status: 400,
        message: 'Token y contraseña son requeridos',
        errorCode: 'MISSING_PARAMS'
      });
    }

    if (passwordText.length < 8) {
      return sendError(res, {
        status: 400,
        message: 'La contraseña debe tener al menos 8 caracteres.',
        errorCode: 'INVALID_PASSWORD'
      });
    }

    const result = await loginService.resetPasswordWithToken(token, passwordText);
    if (!result) {
      return sendError(res, {
        status: 400,
        message: 'El enlace de recuperación no es válido o ya expiró.',
        errorCode: 'INVALID_RESET_TOKEN'
      });
    }

    try {
      await recordHistorial({
        tabla: 'usuarios',
        id_registro: result.userId,
        accion: 'PASSWORD_CHANGED_BY_RESET',
        id_usuario: result.userId,
        detalles: [
          { columna: 'Contrasena', anterior: 'NO_VISIBLE', nuevo: 'ACTUALIZADA' }
        ]
      });
    } catch (historyError) {
      console.error('reset-password history error:', historyError);
    }

    return sendSuccess(res, { message: 'Contraseña actualizada correctamente.' });
  } catch (e) {
    console.error('reset-password error:', e);
    return sendError(res, {
      status: 500,
      message: 'Error interno',
      errorCode: 'INTERNAL_ERROR'
    });
  }
};

// Logout normal: el usuario cierra su propia sesión
exports.logout = async (req, res) => {
  try {
    const token = req.authToken;
    if (!token) {
      return sendError(res, { status: 400, message: 'Token requerido', errorCode: 'UNAUTHENTICATED' });
    }

    await loginService.logoutCurrentSession(token);

    try {
      await recordHistorial({
        tabla: 'sesiones',
        id_registro: req.user?.id || null,
        accion: 'LOGOUT',
        id_usuario: req.user?.id || null,
        detalles: [
          { columna: 'Sesion', anterior: 'ACTIVA', nuevo: 'ELIMINADA' }
        ]
      });
    } catch (historyError) {
      console.error('logout history error:', historyError);
    }

    return sendSuccess(res, { data: null, message: 'Sesion cerrada correctamente' });
  } catch (e) {
    console.error('logout error:', e);
    return sendError(res, { status: 500, message: 'Error cerrando sesion', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.logoutAllSessions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, { status: 400, message: 'Usuario no autenticado', errorCode: 'UNAUTHENTICATED' });
    }

    await loginService.logoutAllSessionsForUser(userId, {
      eventType: 'selfLogoutAllSessions',
      reason: 'self_logout_all_sessions'
    });

    try {
      await recordHistorial({
        tabla: 'sesiones',
        id_registro: userId,
        accion: 'LOGOUT_ALL_SESSIONS',
        id_usuario: userId,
        detalles: [
          { columna: 'Sesiones', anterior: 'ACTIVAS', nuevo: 'CERRADAS' }
        ]
      });
    } catch (historyError) {
      console.error('logoutAllSessions history error:', historyError);
    }

    return sendSuccess(res, { data: null, message: 'Sesion cerrada en todos tus dispositivos' });
  } catch (e) {
    console.error('logoutAllSessions error:', e);
    return sendError(res, { status: 500, message: 'Error cerrando sesion', errorCode: 'INTERNAL_ERROR' });
  }
};

// Forzar logout: solo admin puede cerrar sesión de otro usuario
exports.forceLogout = async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return sendError(res, { status: 400, message: 'userId requerido', errorCode: 'MISSING_PARAMS' });

    const adminId = Number(req.user?.id);
    const targetUserId = Number(userId);

    if (!Number.isFinite(targetUserId)) {
      return sendError(res, { status: 400, message: 'userId inválido', errorCode: 'BAD_REQUEST' });
    }

    // No se puede forzar logout de uno mismo
    if (adminId && targetUserId && adminId === targetUserId) {
      return sendError(res, { status: 400, message: 'No puedes forzar tu propio logout', errorCode: 'BAD_REQUEST' });
    }
    
    await loginService.logoutAllSessionsForUser(targetUserId, {
      eventType: 'forceLogout',
      reason: 'admin_force_logout'
    });

    try {
      await recordHistorial({
        tabla: 'sesiones',
        id_registro: targetUserId,
        accion: 'FORCE_LOGOUT_USER',
        id_usuario: adminId || null,
        detalles: [
          { columna: 'Usuario_Afectado', anterior: null, nuevo: targetUserId },
          { columna: 'Ejecutado_Por', anterior: null, nuevo: adminId || null }
        ]
      });
    } catch (historyError) {
      console.error('forceLogout history error:', historyError);
    }

    return sendSuccess(res, { data: null, message: 'Sesion cerrada remotamente' });
  } catch (e) {
    console.error('forceLogout error:', e);
    return sendError(res, { status: 500, message: 'Error forzando cierre de sesion', errorCode: 'INTERNAL_ERROR' });
  }
};
