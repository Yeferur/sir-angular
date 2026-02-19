const {
    obtenerPasajerosPorTour,
    actualizarConfirmacion
} = require('../../services/Confirmacion/confirmacion.service');

exports.getPasajeros = async (req, res) => {
    try {
        const { Id_Tour, Fecha } = req.query;
        if (!Id_Tour || !Fecha) {
            return res.status(400).json({ error: 'Se requieren Id_Tour y Fecha' });
        }
        const pasajeros = await obtenerPasajerosPorTour(Id_Tour, Fecha);
        res.json(pasajeros);
    } catch (error) {
        console.error('Error al obtener pasajeros para confirmación:', error);
        res.status(500).json({ error: 'Error al obtener pasajeros' });
    }
};

exports.saveConfirmacion = async (req, res) => {
    try {
        const { pasajeros } = req.body;
        if (!pasajeros || !Array.isArray(pasajeros)) {
            return res.status(400).json({ error: 'Formato de datos inválido' });
        }

        await actualizarConfirmacion(pasajeros);
        res.json({ success: true, message: 'Confirmación guardada correctamente' });
    } catch (error) {
        console.error('Error al guardar confirmación:', error);
        res.status(500).json({ error: 'Error al guardar confirmación' });
    }
};
