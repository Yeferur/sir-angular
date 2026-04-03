const {
  getServiciosTransferSvc,
  crearTransferSvc
} = require('../../services/Transfers/transfers.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

const { getRangosSvc, getPreciosPorRangoSvc } = require('../../services/Transfers/transfers.service');
const { filtrarTransfersSvc } = require('../../services/Transfers/transfers.service');

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
    return sendError(res, { status: 500, message: 'Error al crear transfer', errorCode: 'INTERNAL_ERROR' });
  }
};
