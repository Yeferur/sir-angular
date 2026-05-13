const jwt = require('jsonwebtoken');
const db = require('../database/db');

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
      `SELECT s.Token, s.Id_Usuario
       FROM sesiones s
       INNER JOIN usuarios u ON u.Id_Usuario = s.Id_Usuario
       WHERE s.Token = ?
         AND u.Activo = 1
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida, cerrada o usuario inactivo' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
