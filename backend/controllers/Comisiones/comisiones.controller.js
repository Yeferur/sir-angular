const comisionesService = require('../../services/Comisiones/comisiones.service');
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
        const data = await comisionesService.listarComisiones(req.query);
        return sendSuccess(res, { data, message: 'Comisiones obtenidas correctamente' });
    } catch (error) {
        console.error('Error al listar comisiones:', error);
        return handleError(res, error, 'Error interno del servidor', 'INTERNAL_ERROR');
    }
}

async function actualizarLiquidacion(req, res) {
    try {
        const result = await comisionesService.actualizarLiquidacion(req.body, req.user?.id || null);
        return sendSuccess(res, { data: result, message: 'Estado de liquidación actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar liquidación:', error);
        return handleError(res, error, 'Error al actualizar la liquidación', 'UPDATE_FAILED');
    }
}

async function actualizarLiquidacionesLote(req, res) {
    try {
        const result = await comisionesService.actualizarLiquidacionesLote(req.body, req.user?.id || null);
        return sendSuccess(res, { data: result, message: 'Comisiones actualizadas correctamente' });
    } catch (error) {
        console.error('Error al actualizar lote de comisiones:', error);
        return handleError(res, error, 'Error al actualizar las comisiones', 'BATCH_UPDATE_FAILED');
    }
}

async function actualizarDatosPago(req, res) {
    try {
        const result = await comisionesService.actualizarDatosPago(req.body, req.user?.id || null);
        return sendSuccess(res, { data: result, message: 'Datos de pago actualizados correctamente' });
    } catch (error) {
        console.error('Error al actualizar datos de pago:', error);
        return handleError(res, error, 'Error al actualizar los datos de pago', 'UPDATE_FAILED');
    }
}

async function guardarBeneficiario(req, res) {
    try {
        const payload = { ...req.body };
        if (typeof payload.reservas === 'string') {
            try { payload.reservas = JSON.parse(payload.reservas); }
            catch { payload.reservas = []; }
        }
        const result = await comisionesService.guardarBeneficiarioDesdeComision(payload, req.user?.id || null, req.files || []);
        return sendSuccess(res, {
            data: result,
            message: result.created
                ? 'Beneficiario centralizado correctamente'
                : 'Beneficiario actualizado correctamente',
            status: result.created ? 201 : 200,
        });
    } catch (error) {
        console.error('Error al guardar beneficiario de comisión:', error);
        return handleError(res, error, 'Error al guardar el beneficiario', 'BENEFICIARY_SAVE_FAILED');
    }
}

async function descargarDocumento(req, res) {
    try {
        const document = await comisionesService.obtenerDocumentoBeneficiario(Number(req.params.idDocumento));
        res.setHeader('Content-Type', document.Mime_Type);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.Nombre_Original)}`);
        return res.sendFile(document.absolutePath);
    } catch (error) {
        return handleError(res, error, 'Error al descargar el documento', 'DOCUMENT_DOWNLOAD_FAILED');
    }
}

async function eliminarDocumento(req, res) {
    try {
        const result = await comisionesService.eliminarDocumentoBeneficiario(
            Number(req.params.idBeneficiario),
            Number(req.params.idDocumento),
        );
        return sendSuccess(res, { data: result, message: 'Documento eliminado correctamente' });
    } catch (error) {
        return handleError(res, error, 'Error al eliminar el documento', 'DOCUMENT_DELETE_FAILED');
    }
}

async function exportarExcel(req, res) {
    try {
        await comisionesService.generarExcelComisiones(req.query, res);
    } catch (error) {
        console.error('Error al exportar comisiones:', error);
        if (!res.headersSent) {
            return handleError(res, error, 'Error al generar el archivo Excel', 'EXPORT_FAILED');
        }
    }
}

module.exports = {
    listar,
    actualizarLiquidacion,
    actualizarLiquidacionesLote,
    actualizarDatosPago,
    guardarBeneficiario,
    descargarDocumento,
    eliminarDocumento,
    exportarExcel
};
