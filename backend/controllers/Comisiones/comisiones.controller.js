const comisionesService = require('../../services/Comisiones/comisiones.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

async function listar(req, res) {
    try {
        const data = await comisionesService.listarComisiones(req.query);
        return sendSuccess(res, { data, message: 'Comisiones obtenidas correctamente' });
    } catch (error) {
        console.error('Error al listar comisiones:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

async function actualizarLiquidacion(req, res) {
    try {
        const result = await comisionesService.actualizarLiquidacion(req.body);
        return sendSuccess(res, { data: result, message: 'Estado de liquidación actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar liquidación:', error);
        return sendError(res, { status: 500, message: 'Error al actualizar la liquidación', errorCode: 'UPDATE_FAILED' });
    }
}

async function actualizarDatosPago(req, res) {
    try {
        const result = await comisionesService.actualizarDatosPago(req.body);
        return sendSuccess(res, { data: result, message: 'Datos de pago actualizados correctamente' });
    } catch (error) {
        console.error('Error al actualizar datos de pago:', error);
        return sendError(res, { status: 500, message: 'Error al actualizar los datos de pago', errorCode: 'UPDATE_FAILED' });
    }
}

async function exportarExcel(req, res) {
    try {
        await comisionesService.generarExcelComisiones(req.query, res);
    } catch (error) {
        console.error('Error al exportar comisiones:', error);
        if (!res.headersSent) {
            return sendError(res, { status: 500, message: 'Error al generar el archivo Excel', errorCode: 'EXPORT_FAILED' });
        }
    }
}

module.exports = {
    listar,
    actualizarLiquidacion,
    actualizarDatosPago,
    exportarExcel
};