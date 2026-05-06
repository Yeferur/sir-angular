const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');

const {
  getServiciosTransferSvc,
  crearTransferSvc,
  actualizarTransferSvc,
  cancelarTransferSvc,
  getDetalleTransferSvc,
  subirComprobanteTransferSvc,
  resolverComprobanteSeguroTransferPorNombre
} = require('../../services/Transfers/transfers.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

const { getRangosSvc, getPreciosPorRangoSvc } = require('../../services/Transfers/transfers.service');
const { filtrarTransfersSvc } = require('../../services/Transfers/transfers.service');

// Configuración multer para comprobantes
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function extensionForMime(file) {
  if (file.mimetype === 'image/jpeg') return '.jpg';
  if (file.mimetype === 'image/png') return '.png';
  if (file.mimetype === 'application/pdf') return '.pdf';
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ext || '.bin';
}

const uploadComprobante = multer({
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

const asyncHandler = fn => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(e => {
    console.error(`Error en ${req.path}:`, e);
    const statusCode = e.status || 500;
    const errorMessage = e.status ? e.message : 'Error interno del servidor';
    const errorCode = e.errorCode || (statusCode === 409 ? 'CONFLICT' : statusCode === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
    return sendError(res, { status: statusCode, message: errorMessage, errorCode });
  });
};

exports.getServicios = async (_req, res) => {
  try {
    const rows = await getServiciosTransferSvc();
    return sendSuccess(res, { data: rows, message: 'Servicios obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener servicios de transfer', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getRangos = async (_req, res) => {
  try {
    const rows = await getRangosSvc();
    return sendSuccess(res, { data: rows, message: 'Rangos obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener rangos', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getPrecios = async (req, res) => {
  try {
    const { Id_Rango } = req.query;
    if (!Id_Rango) return sendError(res, { status: 400, message: 'Falta Id_Rango', errorCode: 'MISSING_PARAMS' });
    const rows = await getPreciosPorRangoSvc(Id_Rango);
    return sendSuccess(res, { data: rows, message: 'Precios obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener precios', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getTransfers = async (req, res) => {
  try {
    const data = await filtrarTransfersSvc(req.query || {});
    return sendSuccess(res, { data, message: 'Transfers obtenidos correctamente' });
  } catch (e) {
    console.error(e);
    return sendError(res, { status: 500, message: 'Error al obtener transfers', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.createTransfer = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) return sendError(res, { status: 400, message: 'Falta body', errorCode: 'BAD_REQUEST' });

    const result = await crearTransferSvc(payload);
    return sendSuccess(res, { data: result, message: 'Transfer creado correctamente' });
  } catch (e) {
    console.error(e);
    const status = e?.status || 500;
    return sendError(res, {
      status,
      message: e?.message || 'Error al crear transfer',
      errorCode: e?.errorCode || (status === 409 ? 'CONFLICT' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR')
    });
  }
};

exports.updateTransfer = async (req, res) => {
  try {
    const { Id_Transfer } = req.params;
    const payload = req.body;

    if (!Id_Transfer) return sendError(res, { status: 400, message: 'Falta Id_Transfer', errorCode: 'MISSING_PARAMS' });
    if (!payload) return sendError(res, { status: 400, message: 'Falta body', errorCode: 'BAD_REQUEST' });

    const result = await actualizarTransferSvc(Id_Transfer, payload);
    return sendSuccess(res, { data: result, message: 'Transfer actualizado correctamente' });
  } catch (e) {
    console.error(e);
    const status = e?.status || 500;
    return sendError(res, {
      status,
      message: e?.message || 'Error al actualizar transfer',
      errorCode: e?.errorCode || (status === 409 ? 'CONFLICT' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR')
    });
  }
};

exports.cancelTransfer = async (req, res) => {
  try {
    const { Id_Transfer } = req.params;
    if (!Id_Transfer) return sendError(res, { status: 400, message: 'Falta Id_Transfer', errorCode: 'MISSING_PARAMS' });

    const result = await cancelarTransferSvc(Id_Transfer);
    return sendSuccess(res, { data: result, message: 'Transfer cancelado correctamente' });
  } catch (e) {
    const status = e?.status || 500;
    return sendError(res, {
      status,
      message: status === 404 ? 'Transfer no encontrado' : 'Error al cancelar transfer',
      errorCode: status === 404 ? 'TRANSFER_NOT_FOUND' : 'INTERNAL_ERROR'
    });
  }
};

exports.getDetalleTransfer = async (req, res) => {
  try {
    const { Id_Transfer } = req.params;
    if (!Id_Transfer) return sendError(res, { status: 400, message: 'Falta Id_Transfer', errorCode: 'MISSING_PARAMS' });

    const data = await getDetalleTransferSvc(Id_Transfer);
    if (!data) {
      return sendError(res, { status: 404, message: 'Transfer no encontrado', errorCode: 'NOT_FOUND' });
    }

    return sendSuccess(res, { data, message: 'Detalle de transfer obtenido correctamente' });
  } catch (e) {
    console.error(e);
    const status = e?.status || 500;
    return sendError(res, {
      status,
      message: e?.message || 'Error al obtener detalle del transfer',
      errorCode: e?.errorCode || (status === 409 ? 'CONFLICT' : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR')
    });
  }
};

// UPLOAD COMPROBANTE PAGO TRANSFER
exports.uploadComprobanteTransfer = [
  uploadComprobante.single('file'),
  asyncHandler(async (req, res) => {
    const { Id_Transfer, Id_Pago } = req.params;
    if (!Id_Transfer || !Id_Pago) {
      return sendError(res, { status: 400, message: 'Falta Id_Transfer o Id_Pago', errorCode: 'MISSING_PARAMS' });
    }

    if (!req.file) {
      return sendError(res, { status: 400, message: 'Falta archivo', errorCode: 'BAD_REQUEST' });
    }

    const userId = req.user?.id || null;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

    const result = await subirComprobanteTransferSvc(
      Id_Transfer,
      Id_Pago,
      req.file,
      userId,
      clientIp
    );

    return sendSuccess(res, { data: result, message: 'Comprobante guardado correctamente' });
  })
];

// GET COMPROBANTE TRANSFER (servir archivo)
exports.getComprobanteTransfer = asyncHandler(async (req, res) => {
  const { nombreArchivo } = req.params;
  const resolved = await resolverComprobanteSeguroTransferPorNombre(nombreArchivo);
  if (!resolved) {
    return sendError(res, { status: 404, message: 'Comprobante no encontrado', errorCode: 'FILE_NOT_FOUND' });
  }
  return res.sendFile(resolved.absolutePath);
});
