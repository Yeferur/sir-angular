const segurosService = require('../../services/Seguros/seguros.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

async function listar(req, res) {
    try {
        const filtros = req.query;
        const data = await segurosService.listarSeguros(filtros);
        return sendSuccess(res, { data, message: 'Seguros obtenidos correctamente' });
    } catch (error) {
        console.error('Error al listar seguros:', error);
        return sendError(res, { status: 500, message: 'Error interno al listar seguros', errorCode: 'INTERNAL_ERROR' });
    }
}

async function exportarExcel(req, res) {
    try {
        const filtros = req.query;
        await segurosService.generarExcelSeguros(filtros, res);
    } catch (error) {
        console.error('Error al exportar Excel de seguros:', error);
        if (!res.headersSent) {
            return sendError(res, { status: 500, message: 'Error al generar el Excel', errorCode: 'EXPORT_FAILED' });
        }
    }
}

module.exports = {
    listar,
    exportarExcel
};
