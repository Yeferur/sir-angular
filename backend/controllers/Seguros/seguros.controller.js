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
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'Error interno al listar seguros',
            errorCode: error.errorCode || 'INTERNAL_ERROR',
            details: error.details || undefined
        });
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
            return sendError(res, {
                status: error.statusCode || 500,
                message: error.message || 'Error al generar el Excel',
                errorCode: error.errorCode || 'EXPORT_FAILED',
                details: error.details || undefined
            });
        }
    }
}

/* PATCH /seguros/buses/:id — actualiza identificación y personal del bus */
async function actualizarPersonalBus(req, res) {
    try {
        const Id_Bus_Prog = Number(req.params.id);
        if (!Id_Bus_Prog || isNaN(Id_Bus_Prog)) {
            return sendError(res, { status: 400, message: 'Id_Bus_Prog inválido', errorCode: 'INVALID_PARAM' });
        }

        const { Placa_Display, Guia, Conductor, DNI_Conductor, DNI_Guia } = req.body;
        const result = await segurosService.actualizarPersonalBus(Id_Bus_Prog, {
            Placa_Display,
            Guia,
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
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'Error interno',
            errorCode: error.errorCode || 'INTERNAL_ERROR',
            details: error.details || undefined
        });
    }
}

module.exports = {
    listar,
    exportarExcel,
    actualizarPersonalBus
};
