const loginService = require('../../services/Login/login.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

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

// Logout normal: el usuario cierra su propia sesión
exports.logout = async (req, res) => {
  try {
    // El middleware authMiddleware ya validó el token
    // req.user contiene los datos del usuario autenticado
    const userId = req.user?.id;
    if (!userId) return sendError(res, { status: 400, message: 'Usuario no autenticado', errorCode: 'UNAUTHENTICATED' });
    
    await loginService.logoutUserById(userId, false); // false = logout normal
    return sendSuccess(res, { data: null, message: 'Sesion cerrada correctamente' });
  } catch (e) {
    console.error('logout error:', e);
    return sendError(res, { status: 500, message: 'Error cerrando sesion', errorCode: 'INTERNAL_ERROR' });
  }
};

// Forzar logout: solo admin puede cerrar sesión de otro usuario
exports.forceLogout = async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return sendError(res, { status: 400, message: 'userId requerido', errorCode: 'MISSING_PARAMS' });

    const adminId = req.user?.id;

    // No se puede forzar logout de uno mismo
    if (adminId === userId) {
      return sendError(res, { status: 400, message: 'No puedes forzar tu propio logout', errorCode: 'BAD_REQUEST' });
    }
    
    await loginService.logoutUserById(userId, true); // true = forced logout
    return sendSuccess(res, { data: null, message: 'Sesion cerrada remotamente' });
  } catch (e) {
    console.error('forceLogout error:', e);
    return sendError(res, { status: 500, message: 'Error forzando cierre de sesion', errorCode: 'INTERNAL_ERROR' });
  }
};
