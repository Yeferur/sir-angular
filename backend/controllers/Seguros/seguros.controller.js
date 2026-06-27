const segurosService = require('../../services/Seguros/seguros.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

/* GET /seguros?Fecha=&Id_Tour= */
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

/* GET /seguros/exportar?Fecha=&Id_Tour= */
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

/* PATCH /seguros/buses/:id — actualiza Conductor, DNI_Conductor, DNI_Guia */
async function actualizarPersonalBus(req, res) {
    try {
        const Id_Bus_Prog = Number(req.params.id);
        if (!Id_Bus_Prog || isNaN(Id_Bus_Prog)) {
            return sendError(res, { status: 400, message: 'Id_Bus_Prog inválido', errorCode: 'INVALID_PARAM' });
        }

        const { Conductor, DNI_Conductor, DNI_Guia } = req.body;
        const result = await segurosService.actualizarPersonalBus(Id_Bus_Prog, {
            Conductor,
            DNI_Conductor,
            DNI_Guia
        });

        if (result.affected === 0) {
            return sendError(res, { status: 404, message: 'Bus no encontrado', errorCode: 'NOT_FOUND' });
        }

        return sendSuccess(res, { message: 'Personal del bus actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar personal del bus:', error);
        return sendError(res, { status: 500, message: 'Error interno', errorCode: 'INTERNAL_ERROR' });
    }
}

module.exports = {
    listar,
    exportarExcel,
    actualizarPersonalBus
};