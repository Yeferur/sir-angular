const loginService = require('../../services/Login/login.service');

exports.login = async (req, res) => {
  try {
    const { username, correo, password } = req.body || {};
    const userKey = username || correo;
    if (!userKey || !password) {
      return res.status(400).json({ error: 'Usuario/correo y contraseña son requeridos' });
    }

    const user = await loginService.findUserByUsername(userKey);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const ok = await loginService.comparePasswords(password, user.Contrasena);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = loginService.generateToken(user);
    await loginService.saveSession(user.Id_Usuario, token);

    // Obtener permisos y menú del usuario
    const { permisos, menu } = await loginService.getPermisosYMenu(user.Id_Usuario);

    return res.json({
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
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'Error interno' });
  }
};

// Logout normal: el usuario cierra su propia sesión
exports.logout = async (req, res) => {
  try {
    // El middleware authMiddleware ya validó el token
    // req.user contiene los datos del usuario autenticado
    const userId = req.user?.id;
    if (!userId) return res.status(400).json({ error: 'Usuario no autenticado' });
    
    await loginService.logoutUserById(userId, false); // false = logout normal
    return res.json({ success: true });
  } catch (e) {
    console.error('logout error:', e);
    return res.status(500).json({ error: 'Error cerrando sesión' });
  }
};

// Forzar logout: solo admin puede cerrar sesión de otro usuario
exports.forceLogout = async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    
    // Validar que el usuario autenticado sea admin
    const adminId = req.user?.id;
    const adminUser = await loginService.getUserById(adminId);
    if (!adminUser || adminUser.Rol !== 'Administrador') {
      return res.status(403).json({ error: 'No tienes permisos para forzar logout' });
    }
    
    // No se puede forzar logout de uno mismo
    if (adminId === userId) {
      return res.status(400).json({ error: 'No puedes forzar tu propio logout' });
    }
    
    await loginService.logoutUserById(userId, true); // true = forced logout
    return res.json({ success: true });
  } catch (e) {
    console.error('forceLogout error:', e);
    return res.status(500).json({ error: 'Error forzando cierre de sesión' });
  }
};
