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
        const result = await comisionesService.guardarBeneficiarioDesdeComision(req.body, req.user?.id || null);
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
    exportarExcel
};
