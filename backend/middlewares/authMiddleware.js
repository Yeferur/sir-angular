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

    // Validar que el token exista en la base de datos
    const [rows] = await db.query(
      'SELECT * FROM sesiones WHERE Token = ?',
      [token]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida o cerrada' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
