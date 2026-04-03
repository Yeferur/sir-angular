const {
    obtenerPasajerosPorTour,
    actualizarConfirmacion
} = require('../../services/Confirmacion/confirmacion.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

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
        return sendError(res, { status: 500, message: 'Error al obtener pasajeros', errorCode: 'INTERNAL_ERROR' });
    }
};

exports.saveConfirmacion = async (req, res) => {
    try {
        const { pasajeros } = req.body;
        if (!pasajeros || !Array.isArray(pasajeros)) {
            return sendError(res, { status: 400, message: 'Formato de datos invalido', errorCode: 'BAD_REQUEST' });
        }

        await actualizarConfirmacion(pasajeros);
        return sendSuccess(res, { data: null, message: 'Confirmacion guardada correctamente' });
    } catch (error) {
        console.error('Error al guardar confirmación:', error);
        return sendError(res, { status: 500, message: 'Error al guardar confirmacion', errorCode: 'INTERNAL_ERROR' });
    }
};
