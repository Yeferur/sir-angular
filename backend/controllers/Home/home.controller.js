const { getHomeSummary } = require('../../services/Home/home.service');
const { obtenerPermisosUsuario } = require('../../middlewares/permissionsMiddleware');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

async function getSummary(req, res) {
  try {
    const userId = req.user?.id;
    const permissions = Array.isArray(req.userPermissions)
      ? req.userPermissions
      : await obtenerPermisosUsuario(userId);
    const data = await getHomeSummary(userId, permissions);
    return sendSuccess(res, { data, message: 'Inicio obtenido correctamente' });
  } catch (error) {
    console.error('Error obteniendo Inicio:', error);
    return sendError(res, {
      status: error?.status || 500,
      message: error?.message || 'No se pudo cargar el Inicio',
      errorCode: error?.errorCode || 'HOME_SUMMARY_ERROR',
    });
  }
}

module.exports = { getSummary };
