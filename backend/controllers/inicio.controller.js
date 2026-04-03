const { obtenerDatosInicio, guardarAforo } = require('../services/inicio.service');
const { sendSuccess, sendError } = require('../utils/responseEnvelope');

exports.getInicioData = async (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return sendError(res, { status: 400, message: 'La fecha es obligatoria', errorCode: 'MISSING_PARAMS' });
  }

  try {
    const { tours, transfers } = await obtenerDatosInicio(fecha);
    return sendSuccess(res, { data: { tours, transfers }, message: 'Datos de inicio obtenidos correctamente' });
  } catch (error) {
    console.error('Error al obtener datos de inicio:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

// POST /guardar-aforo
exports.guardarAforo = async (req, res) => {
  const { Id_Tour, Fecha, NuevoCupo } = req.body;
  // userId del usuario que actualiza el cupo (debe estar en req.user por el middleware de auth)
  const userId = req.user?.id;
  if (!Id_Tour || !Fecha || NuevoCupo == null) {
    return sendError(res, { status: 400, message: 'Faltan datos requeridos', errorCode: 'MISSING_PARAMS' });
  }
  try {
    const result = await guardarAforo({ Id_Tour, Fecha, NuevoCupo, userId });
    if (!result.success) {
      return sendError(res, { status: 400, message: result.error || 'No se pudo guardar aforo', errorCode: 'BAD_REQUEST' });
    }
    return sendSuccess(res, { data: null, message: result.message || 'Aforo guardado correctamente' });
  } catch (error) {
    console.error('Error al guardar aforo:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};
