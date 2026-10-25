const gruposService = require('../../services/Comisiones/comisiones-grupos.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function handleError(res, error, fallbackMessage, fallbackCode) {
  const status = Number(error?.status) || 500;
  return sendError(res, {
    status,
    message: status >= 500 ? fallbackMessage : error.message,
    errorCode: error?.errorCode || fallbackCode,
    details: error?.details || null,
  });
}

async function listar(req, res) {
  try {
    const result = await gruposService.listarGrupos(req.query);
    return sendSuccess(res, { data: result, message: 'Grupos de comisión obtenidos correctamente' });
  } catch (error) {
    console.error('Error al listar grupos de comisión:', error);
    return handleError(res, error, 'Error al consultar los grupos de comisión', 'GROUP_LIST_FAILED');
  }
}

async function obtenerReservas(req, res) {
  try {
    const result = await gruposService.obtenerDetalleGrupo(req.params.id, req.query);
    return sendSuccess(res, { data: result, message: 'Detalle del grupo obtenido correctamente' });
  } catch (error) {
    return handleError(res, error, 'Error al consultar el detalle del grupo', 'GROUP_DETAIL_FAILED');
  }
}

async function marcarPagado(req, res) {
  try {
    const result = await gruposService.marcarGrupoPagado(req.params.id, req.body, req.user?.id || null, req.file || null);
    return sendSuccess(res, { data: result, message: 'Lote marcado como pagado', status: 201 });
  } catch (error) {
    console.error('Error al marcar el grupo de comisión como pagado:', error);
    return handleError(res, error, 'Error al marcar el grupo como pagado', 'GROUP_PAYMENT_FAILED');
  }
}

async function anular(req, res) {
  try {
    const result = await gruposService.anularPago(req.params.id, req.body, req.user?.id || null);
    return sendSuccess(res, { data: result, message: 'Pago anulado y liquidaciones liberadas correctamente' });
  } catch (error) {
    console.error('Error al anular lote de comisión:', error);
    return handleError(res, error, 'Error al anular el pago', 'GROUP_ANNULMENT_FAILED');
  }
}

async function subirComprobante(req, res) {
  try {
    const result = await gruposService.subirComprobante(req.params.id, req.file, req.user?.id || null);
    return sendSuccess(res, { data: result, message: 'Comprobante asociado al lote correctamente' });
  } catch (error) {
    console.error('Error al subir comprobante de grupo de comisión:', error);
    return handleError(res, error, 'Error al guardar el comprobante', 'PROOF_UPLOAD_FAILED');
  }
}

async function descargarComprobante(req, res) {
  try {
    const document = await gruposService.obtenerComprobante(req.params.id);
    const name = String(document.Comprobante_Nombre_Original || 'comprobante')
      .replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Type', document.Comprobante_Mime_Type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(document.absolutePath, (error) => {
      if (error && !res.headersSent) handleError(res, error, 'Error al descargar el comprobante', 'PROOF_DOWNLOAD_FAILED');
    });
  } catch (error) {
    return handleError(res, error, 'Error al descargar el comprobante', 'PROOF_DOWNLOAD_FAILED');
  }
}

module.exports = { listar, obtenerReservas, marcarPagado, anular, subirComprobante, descargarComprobante };
