// src/controllers/Reservas/reservas.controller.js
const multer = require('multer');

const {
  filtrarReservas,
  obtenerReserva,
  verificarCupos,
  obtenerCanales,
  obtenerMonedas,
  obtenerTours,
  obtenerPlanesByTour,
  obtenerPreciosPorFiltro,
  obtenerHorarios,
  crearReservaConPasajerosYPagos,
  obtenerComisiones,
  obtenerReservaDetalle,
  actualizarReservaConPasajerosYPagos,
  cancelarReservaSvc,
  eliminarReservaSvc,
  getPuntoByIdSvc,
  verificarDniDuplicado,
  obtenerHistorialCambiosReserva,
  resolverComprobanteSeguroPorNombre,
  eliminarComprobantePagoReserva,
} = require('../../services/Reservas/reservas.service');
const { clientOwnerIdFromRequest } = require('../../utils/clientAccess');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const err = new Error('Tipo de archivo no permitido. Solo JPG, PNG o PDF.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

function sendSuccess(res, { data = null, message = 'OK', status = 200 } = {}) {
  return res.status(status).json({ success: true, data, message });
}

function sendError(res, { status = 500, message = 'Error interno del servidor', errorCode = 'INTERNAL_ERROR' } = {}) {
  return res.status(status).json({ success: false, data: null, message, error: message, errorCode });
}

function buildFilesMap(files = []) {
  const filesMap = {};
  for (const f of files) {
    filesMap[f.fieldname] = f;
  }
  return filesMap;
}

// Wrapper simplificado para centralizar el manejo de errores asíncronos
const asyncHandler = fn => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(e => {
    console.error(`Error en ${req.path}:`, e);
    const statusCode = e.status || 500;
    const errorMessage = e.message || 'Error interno del servidor';
    const errorCode = e.errorCode || (statusCode === 409 ? 'CONFLICT' : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
    return sendError(res, { status: statusCode, message: errorMessage, errorCode });
  });
};

// --------- LISTADOS / CATÁLOGOS ----------
exports.getReservas = asyncHandler(async (req, res) => {
  return sendSuccess(res, {
    data: await filtrarReservas(req.query, clientOwnerIdFromRequest(req)),
    message: 'Reservas obtenidas correctamente'
  });
});

exports.getReserva = asyncHandler(async (req, res) => {
  const data = await obtenerReserva(req.query.Id_Reserva, clientOwnerIdFromRequest(req));
  if (!data) return sendError(res, { status: 404, message: 'Reserva no encontrada', errorCode: 'RESERVA_NOT_FOUND' });
  return sendSuccess(res, { data, message: 'Reserva obtenida correctamente' });
});

exports.getCupos = asyncHandler(async (req, res) => {
  const { Fecha, Id_Tour, cantidad } = req.query;
  return sendSuccess(res, { data: await verificarCupos(Fecha, Id_Tour, cantidad), message: 'Cupos verificados correctamente' });
});

exports.getCanales = asyncHandler(async (_req, res) => {
  return sendSuccess(res, { data: await obtenerCanales(), message: 'Canales obtenidos correctamente' });
});

exports.getMonedas = asyncHandler(async (_req, res) => {
  return sendSuccess(res, { data: await obtenerMonedas(), message: 'Monedas obtenidas correctamente' });
});

exports.getTours = asyncHandler(async (req, res) => {
  return sendSuccess(res, {
    data: await obtenerTours(req.query?.includeTourId),
    message: 'Tours obtenidos correctamente'
  });
});

exports.getPlanesByTour = asyncHandler(async (req, res) => {
  return sendSuccess(res, { data: await obtenerPlanesByTour(req.params.id, req.query?.fecha), message: 'Planes obtenidos correctamente' });
});

exports.getPrecios = asyncHandler(async (req, res) => {
  const { Id_Tour, Id_Plan, Id_Moneda, fecha } = req.query;
  return sendSuccess(res, { data: await obtenerPreciosPorFiltro(Id_Tour, Id_Plan, Id_Moneda, fecha), message: 'Precios obtenidos correctamente' });
});

exports.getHorarios = asyncHandler(async (req, res) => {
  const { Id_Tour, Id_Punto } = req.query;
  return sendSuccess(res, { data: await obtenerHorarios(Id_Tour, Id_Punto), message: 'Horarios obtenidos correctamente' });
});

exports.getComisiones = asyncHandler(async (req, res) => {
  const { Id_Tour, Id_Canal } = req.query;
  return sendSuccess(res, { data: await obtenerComisiones(Id_Tour, Id_Canal), message: 'Comisiones obtenidas correctamente' });
});

exports.getReservaDetalle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = await obtenerReservaDetalle(id, clientOwnerIdFromRequest(req));
  if (!data) return sendError(res, { status: 404, message: 'Reserva no encontrada', errorCode: 'RESERVA_NOT_FOUND' });
  return sendSuccess(res, { data, message: 'Detalle de reserva obtenido correctamente' });
});

exports.getPuntoById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pto = await getPuntoByIdSvc(id);
  if (!pto) return sendError(res, { status: 404, message: 'Punto no encontrado', errorCode: 'PUNTO_NOT_FOUND' });
  return sendSuccess(res, { data: pto, message: 'Punto obtenido correctamente' });
});

exports.checkDniDuplicado = asyncHandler(async (req, res) => {
  const { dni, fecha, excludeReservaId } = req.query;
  if (!dni || !fecha) {
    return sendError(res, { status: 400, message: 'Se requieren DNI y fecha', errorCode: 'MISSING_PARAMS' });
  }
  const resultado = await verificarDniDuplicado(
    dni,
    fecha,
    excludeReservaId,
    clientOwnerIdFromRequest(req)
  );
  return sendSuccess(res, { data: resultado, message: 'Validación de DNI completada' });
});

exports.getReservaHistorialCambios = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit } = req.query;
  return sendSuccess(res, {
    data: await obtenerHistorialCambiosReserva(id, limit, clientOwnerIdFromRequest(req)),
    message: 'Historial forense obtenido correctamente'
  });
});

exports.getComprobanteSeguro = asyncHandler(async (req, res) => {
  const { nombreArchivo } = req.params;
  const resolved = await resolverComprobanteSeguroPorNombre(
    nombreArchivo,
    clientOwnerIdFromRequest(req)
  );
  if (!resolved) {
    return sendError(res, { status: 404, message: 'Comprobante no encontrado', errorCode: 'FILE_NOT_FOUND' });
  }
  return res.sendFile(resolved.absolutePath);
});

exports.deleteComprobantePagoReserva = asyncHandler(async (req, res) => {
  const { id, idPago } = req.params;
  const userId = req.user?.id || null;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

  const data = await eliminarComprobantePagoReserva(
    id,
    idPago,
    userId,
    clientIp,
    clientOwnerIdFromRequest(req)
  );
  return sendSuccess(res, { data, message: 'Comprobante eliminado correctamente' });
});


// --------- CREACIÓN CON ARCHIVOS ----------
exports.saveReserva = [
  upload.any(),
  asyncHandler(async (req, res) => {
    const payloadStr = req.body?.payload;
    if (!payloadStr) {
      const err = new Error('Falta payload'); err.status = 400; throw err;
    }

    let payload;
    try { 
      payload = JSON.parse(payloadStr); 
    } catch { 
      const err = new Error('Payload JSON inválido'); err.status = 400; throw err;
    }

    const ownerUserId = clientOwnerIdFromRequest(req);
    const sourceReservationId = payload?.Id_Reserva_Origen
      || payload?.reservaOrigen
      || payload?.reservaOrigenId
      || null;
    if (ownerUserId != null && payload?.esDuplicado && sourceReservationId) {
      const source = await obtenerReservaDetalle(sourceReservationId, ownerUserId);
      if (!source) {
        const err = new Error('Reserva no encontrada');
        err.status = 404;
        err.errorCode = 'RESERVA_NOT_FOUND';
        throw err;
      }
    }

    const filesMap = buildFilesMap(Array.isArray(req.files) ? req.files : []);

    const userId = req.user?.id || null;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || null;
    const result = await crearReservaConPasajerosYPagos(
      payload,
      filesMap,
      userId,
      clientIp,
      ownerUserId
    );

    return sendSuccess(res, { data: result, message: 'Reserva creada correctamente', status: 201 });
  })
];

// --------- ACTUALIZACIÓN CON ARCHIVOS ----------
exports.updateReserva = [
  upload.any(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const payloadStr = req.body?.payload;
    if (!payloadStr) {
      const err = new Error('Falta payload'); err.status = 400; throw err;
    }

    let payload;
    try { 
      payload = JSON.parse(payloadStr); 
    } catch { 
      const err = new Error('Payload JSON inválido'); err.status = 400; throw err;
    }

    const filesMap = buildFilesMap(Array.isArray(req.files) ? req.files : []);

    const userId = req.user?.id || null;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || null;
    const result = await actualizarReservaConPasajerosYPagos(
      id,
      payload,
      filesMap,
      userId,
      clientIp,
      clientOwnerIdFromRequest(req)
    );

    return sendSuccess(res, { data: result, message: 'Reserva actualizada correctamente' });
  })
];

exports.cancelReserva = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || null;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;
  const data = await cancelarReservaSvc(id, userId, clientIp, clientOwnerIdFromRequest(req));
  return sendSuccess(res, { data, message: 'Reserva cancelada correctamente' });
});

exports.deleteReserva = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || null;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;
  const data = await eliminarReservaSvc(id, userId, clientIp, clientOwnerIdFromRequest(req));
  return sendSuccess(res, { data, message: 'Reserva eliminada correctamente' });
});
