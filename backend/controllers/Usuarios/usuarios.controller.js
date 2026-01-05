const sesionesService = require('../../services/Usuarios/usuarios.service');

exports.obtenerUsuariosYSesiones = async (req, res) => {
  try {
    const usuarios = await sesionesService.getAllUsers();
    const sesiones = await sesionesService.getActiveSessions();

    res.json({
      usuarios,
      sesiones
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando usuarios y sesiones' });
  }
};
