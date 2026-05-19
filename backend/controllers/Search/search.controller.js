const { sendSuccess, sendError } = require('../../utils/responseEnvelope');
const { obtenerPermisosUsuario } = require('../../middlewares/permissionsMiddleware');
const { searchGlobal, sanitizeQuery, canSearchQuery } = require('../../services/Search/search.service');

async function globalSearch(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, { status: 401, message: 'No autenticado', errorCode: 'UNAUTHENTICATED' });
    }

    const query = sanitizeQuery(req.query?.q);
    const permisos = Array.isArray(req.userPermissions) ? req.userPermissions : await obtenerPermisosUsuario(userId);

    if (!canSearchQuery(query)) {
      return sendSuccess(res, {
        data: { query, results: [] },
        message: 'La búsqueda requiere al menos 2 caracteres o un identificador exacto.',
      });
    }

    const data = await searchGlobal(query, permisos);
    return sendSuccess(res, { data, message: 'Búsqueda global completada correctamente' });
  } catch (error) {
    console.error('globalSearch error:', error);
    return sendError(res, {
      status: error.status || 500,
      message: error.message || 'Error al ejecutar la búsqueda global',
      errorCode: error.errorCode || 'INTERNAL_ERROR',
    });
  }
}

module.exports = {
  globalSearch,
};
