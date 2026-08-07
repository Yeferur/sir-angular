const jwt = require('jsonwebtoken');
const db = require('../database/db');
const {
  CLIENT_RESERVATION_PERMISSION_CODES,
  isClientRoleName,
} = require('../utils/clientAccess');

exports.authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.authToken = token;

    // Validar que el token exista en la base de datos
    const [rows] = await db.query(
      `SELECT s.Token, s.Id_Usuario, u.Id_Rol, r.Nombre_Rol
       FROM sesiones s
       INNER JOIN usuarios u ON u.Id_Usuario = s.Id_Usuario
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
       WHERE s.Token = ?
         AND u.Activo = 1
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida, cerrada o usuario inactivo' });
    }

    const authenticatedUser = rows[0];
    req.user = {
      ...decoded,
      id: authenticatedUser.Id_Usuario,
      roleId: authenticatedUser.Id_Rol || null,
      role: authenticatedUser.Nombre_Rol || null,
      isClient: isClientRoleName(authenticatedUser.Nombre_Rol),
    };
    if (req.user.isClient) {
      // Evita que una entrada antigua del caché conserve accesos de un rol
      // anterior después de convertir la cuenta en Cliente.
      req.userPermissions = [...CLIENT_RESERVATION_PERMISSION_CODES];
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
