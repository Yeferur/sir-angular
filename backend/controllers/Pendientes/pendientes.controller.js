const service = require('../../services/Pendientes/pendientes.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function handleError(res, error, fallback) {
  if (error instanceof service.PendingOperationError) {
    return sendError(res, { status: error.status, message: error.message, errorCode: error.code });
  }
  console.error(fallback, error);
  return sendError(res, { status: 500, message: fallback });
}

exports.listMine = async (req, res) => {
  try {
    const includeSuppressed = String(req.query.incluirSuprimidos ?? 'true') !== 'false';
    const data = await service.listMine(req.user.id, req.userPermissions, { includeSuppressed });
    return sendSuccess(res, { data: { pendientes: data, total: data.length } });
  } catch (error) {
    return handleError(res, error, 'No se pudieron consultar los pendientes.');
  }
};

exports.postpone = async (req, res) => {
  try {
    const data = await service.postpone(
      req.params.id,
      req.user.id,
      req.userPermissions,
      req.body?.suprimidoHasta
    );
    return sendSuccess(res, { data, message: 'Pendiente pospuesto.' });
  } catch (error) {
    return handleError(res, error, 'No se pudo posponer el pendiente.');
  }
};

exports.dismiss = async (req, res) => {
  try {
    const data = await service.dismiss(
      req.params.id,
      req.user.id,
      req.userPermissions,
      req.body?.motivo
    );
    return sendSuccess(res, { data, message: 'Pendiente descartado.' });
  } catch (error) {
    return handleError(res, error, 'No se pudo descartar el pendiente.');
  }
};

exports.audit = async (req, res) => {
  try {
    const data = await service.audit({ limit: req.query.limit, state: req.query.estado || null });
    return sendSuccess(res, { data: { pendientes: data, total: data.length } });
  } catch (error) {
    return handleError(res, error, 'No se pudo consultar la auditoría de pendientes.');
  }
};
