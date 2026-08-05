const {
    obtenerPasajerosPorTour,
    obtenerEstadoConfirmacion,
    actualizarConfirmacion
} = require('../../services/Confirmacion/confirmacion.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function handleError(res, error, fallbackMessage) {
    const status = Number(error?.status) || 500;
    return sendError(res, {
        status,
        message: status >= 500 ? fallbackMessage : error.message,
        errorCode: error?.errorCode || 'INTERNAL_ERROR',
        details: error?.details || null,
    });
}

exports.getPasajeros = async (req, res) => {
    try {
        const { Id_Tour, Fecha } = req.query;
        if (!Id_Tour || !Fecha) {
            return sendError(res, { status: 400, message: 'Se requieren Id_Tour y Fecha', errorCode: 'MISSING_PARAMS' });
        }
        const pasajeros = await obtenerPasajerosPorTour(Id_Tour, Fecha);
        return sendSuccess(res, { data: pasajeros, message: 'Pasajeros obtenidos correctamente' });
    } catch (error) {
        console.error('Error al obtener pasajeros para confirmación:', error);
        return handleError(res, error, 'Error al obtener pasajeros');
    }
};

exports.getEstado = async (req, res) => {
    try {
        const estado = await obtenerEstadoConfirmacion(req.query.Fecha, req.query.Id_Tour);
        return sendSuccess(res, { data: estado, message: 'Estado de confirmación obtenido correctamente' });
    } catch (error) {
        console.error('Error al obtener el estado de confirmación:', error);
        return handleError(res, error, 'Error al comprobar la confirmación de la jornada');
    }
};

exports.saveConfirmacion = async (req, res) => {
    try {
        const result = await actualizarConfirmacion(req.body, req.user?.id || null);
        return sendSuccess(res, { data: result, message: 'Confirmación guardada correctamente' });
    } catch (error) {
        console.error('Error al guardar confirmación:', error);
        return handleError(res, error, 'Error al guardar la confirmación');
    }
};
