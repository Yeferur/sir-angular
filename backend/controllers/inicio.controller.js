const { obtenerDatosInicio, guardarAforo } = require('../services/inicio.service');

exports.getInicioData = async (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.status(400).json({ error: 'La fecha es obligatoria' });
  }

  try {
    const { tours, transfers } = await obtenerDatosInicio(fecha);
    res.json({ tours, transfers });
  } catch (error) {
    console.error('Error al obtener datos de inicio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /guardar-aforo
exports.guardarAforo = async (req, res) => {
  const { Id_Tour, Fecha, NuevoCupo } = req.body;
  // userId del usuario que actualiza el cupo (debe estar en req.user por el middleware de auth)
  const userId = req.user?.id;
  if (!Id_Tour || !Fecha || NuevoCupo == null) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  try {
    const result = await guardarAforo({ Id_Tour, Fecha, NuevoCupo, userId });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ message: result.message });
  } catch (error) {
    console.error('Error al guardar aforo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
