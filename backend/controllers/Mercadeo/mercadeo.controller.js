const {
  buscarReservasMercadeo,
  obtenerCategoriasMercadeo,
} = require('../../services/Mercadeo/mercadeo.service');

function sendSuccess(res, data, message) {
  return res.status(200).json({ success: true, data, message });
}

function sendError(res, error) {
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
  const isServerError = status >= 500;
  if (isServerError) console.error('Error en consulta de Mercadeo:', error);
  return res.status(status).json({
    success: false,
    data: null,
    message: isServerError ? 'No fue posible completar la consulta de Mercadeo.' : error.message,
    errorCode: error?.errorCode || (status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
  });
}

function asyncHandler(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((error) => sendError(res, error));
}

exports.listarReservas = asyncHandler(async (req, res) =>
  sendSuccess(res, await buscarReservasMercadeo(req.query), 'Consulta de reservas de Mercadeo completada'));

exports.listarCategorias = asyncHandler(async (_req, res) =>
  sendSuccess(res, await obtenerCategoriasMercadeo(), 'Categorías obtenidas'));
