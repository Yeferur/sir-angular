const {
  buscarReservasMercadeo,
  buscarTransfersMercadeo,
  buscarOrigenReservas,
  streamOrigenExcel,
  buildOrigenFilters,
  obtenerCategoriasMercadeo,
  obtenerUsuariosMercadeo,
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

function scopeOriginQuery(query = {}, permissions = []) {
  if (permissions.includes('MERCADEO.RESERVAS.LEER')) return { ...query };
  if (!permissions.includes('ENTIDADES_REPORTANTES.LEER')) {
    throw Object.assign(new Error('No tienes permiso para consultar el origen de reservas.'),
      { status: 403, errorCode: 'PERMISSION_DENIED' });
  }
  if (!String(query.idEntidadReportante || '').trim()
    || !String(query.fechaRegistroDesde || '').trim()
    || !String(query.fechaRegistroHasta || '').trim()) {
    throw Object.assign(new Error('La consulta por entidad requiere una entidad y un período máximo de 31 días.'),
      { status: 400, errorCode: 'ENTITY_SCOPE_REQUIRED' });
  }
  // Reuse the canonical filter validation to reject invalid/oversized ranges.
  buildOrigenFilters(query);
  const requestedSize = Number(query.pageSize);
  const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0
    ? Math.min(requestedSize, 10) : 10;
  return { ...query, pageSize };
}

exports.listarReservas = asyncHandler(async (req, res) =>
  sendSuccess(res, await buscarReservasMercadeo(req.query), 'Consulta de reservas de Mercadeo completada'));

exports.listarTransfers = asyncHandler(async (req, res) =>
  sendSuccess(res, await buscarTransfersMercadeo(req.query), 'Consulta de transfers de Mercadeo completada'));

exports.listarOrigen = asyncHandler(async (req, res) => {
  const query = scopeOriginQuery(req.query, req.userPermissions || []);
  sendSuccess(res, await buscarOrigenReservas(query), 'Consulta de origen de reservas completada');
});

exports.exportarOrigen = async (req, res) => {
  try {
    buildOrigenFilters(req.query || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mercadeo-origen-detalle.xlsx"');
    await streamOrigenExcel(req.query || {}, res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return sendError(res, error);
  }
};

exports.listarCategorias = asyncHandler(async (_req, res) =>
  sendSuccess(res, await obtenerCategoriasMercadeo(), 'Categorías obtenidas'));

exports.listarUsuarios = asyncHandler(async (_req, res) =>
  sendSuccess(res, await obtenerUsuariosMercadeo(), 'Usuarios obtenidos'));

exports.scopeOriginQuery = scopeOriginQuery;
