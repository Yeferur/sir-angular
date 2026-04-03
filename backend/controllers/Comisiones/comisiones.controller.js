const comisionesService = require('../../services/Comisiones/comisiones.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

async function listar(req, res) {
    try {
        const filtros = req.query; // { Id_Tour, Fecha, ... }
        const data = await comisionesService.listarComisiones(filtros);
        return sendSuccess(res, { data, message: 'Comisiones obtenidas correctamente' });
    } catch (error) {
        console.error('Error al listar comisiones:', error);
        return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
    }
}

async function exportarExcel(req, res) {
    try {
        const filtros = req.query;
        await comisionesService.generarExcelComisiones(filtros, res);
    } catch (error) {
        console.error('Error al exportar comisiones:', error);
        if (!res.headersSent) {
            return sendError(res, { status: 500, message: 'Error al generar el archivo Excel', errorCode: 'EXPORT_FAILED' });
        }
    }
}

module.exports = {
    listar,
    exportarExcel
};
