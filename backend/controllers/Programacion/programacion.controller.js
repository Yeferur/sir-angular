// backend/controllers/Programacion/programacion.controller.inteligente.js
const cerebro = require('../../services/Programacion/programacion.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

/**
 * ===================================================================================
 * CONTROLADOR PARA EL ASISTENTE DE LOGÍSTICA INTELIGENTE
 * ===================================================================================
 * Maneja las peticiones HTTP, las valida y llama a las funciones del "cerebro".
 * ===================================================================================
 */

/**
 * Controlador para generar el plan logístico automático.
 * Recibe fecha y idTour desde el cuerpo de la petición.
 */
exports.generarPlanLogisticoController = async (req, res) => {
    // Extraemos los datos del cuerpo de la petición (body) en lugar de la query.
    // Soporte para idsTours (array) o idTour (legacy/single)
    const { fecha, idTour, idsTours } = req.body;

    // Normalizar a una variable 'tours' que sea lo que pasemos al servicio
    const tours = idsTours || idTour;

    if (!fecha || !tours) {
        return sendError(res, {
            status: 400,
            message: 'Peticion invalida. Se requiere fecha e idsTours (o idTour).',
            errorCode: 'MISSING_PARAMS'
        });
    }

    try {
        console.log(`[INFO] Iniciando generación de plan para Tours: ${JSON.stringify(tours)}, Fecha: ${fecha}`);
        const resultado = await cerebro.generarPlanLogistico(fecha, tours);
        console.log(`[SUCCESS] Plan generado para Tours: ${JSON.stringify(tours)}.`);

        return sendSuccess(res, { data: resultado, message: 'Plan logistico generado correctamente' });

    } catch (error) {
        console.error(`[ERROR] Falló la generación del plan para Tours: ${JSON.stringify(tours)}, Fecha: ${fecha}`, error);
        return sendError(res, {
            status: 500,
            message: 'Error interno del servidor al generar el plan logistico.',
            errorCode: 'INTERNAL_ERROR'
        });
    }
};

/**
 * Exporta el listado de un bus en formato Excel (XLSX).
 * Body: { fecha: 'YYYY-MM-DD', idTour: number, bus: {...}, nombreTour?: string }
 */
exports.exportarListadoBusController = async (req, res) => {
    const { fecha, idTour, bus, nombreTour } = req.body || {};

    if (!fecha || !idTour || !bus) {
        return sendError(res, { status: 400, message: 'Se requiere fecha, idTour y bus en el cuerpo.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const buffer = await cerebro.generarExcelListadoBus({ fecha, idTour, bus, nombreTour });

        const placa = bus.id ? String(bus.id).replace(/\s+/g, '_') : 'Bus';
        const tourName = nombreTour ? String(nombreTour).replace(/\s+/g, '_') : 'Tour';
        const fileName = `${fecha}_${tourName}_${placa}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error al exportar listado de bus:', error);
        return sendError(res, { status: 500, message: 'Error al generar el archivo.', errorCode: 'EXPORT_FAILED' });
    }
};

/**
 * Consulta listado guardado y reservas sin asignar.
 * Body: { fecha: 'YYYY-MM-DD', idTour: number }
 */
exports.obtenerListadoFinalController = async (req, res) => {
    const { fecha, idTour, idsTours } = req.body || {};
    const tours = idsTours || idTour;

    if (!fecha || !tours) {
        return sendError(res, { status: 400, message: 'Se requiere fecha e idsTours (o idTour) en el cuerpo.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const resultado = await cerebro.obtenerListadoFinal({ fecha, idsTours: tours });
        return sendSuccess(res, { data: resultado, message: 'Listado final obtenido correctamente' });
    } catch (error) {
        console.error('Error al consultar listado final:', error);
        return sendError(res, { status: 500, message: 'Error interno al consultar el listado.', errorCode: 'INTERNAL_ERROR' });
    }
};

/**
 * Guarda el listado final confirmado.
 * Body: { fecha: 'YYYY-MM-DD', idTour: number, buses: [...] }
 */
exports.guardarListadoFinalController = async (req, res) => {
    const { fecha, idTour, idsTours, buses } = req.body || {};
    const tours = idsTours || idTour;

    if (!fecha || !tours || !Array.isArray(buses)) {
        return sendError(res, { status: 400, message: 'Se requiere fecha, idsTours (o idTour) y buses en el cuerpo.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const resultado = await cerebro.guardarListadoFinal({ fecha, idsTours: tours, buses });
        return sendSuccess(res, { data: resultado, message: 'Listado final guardado correctamente' });
    } catch (error) {
        console.error('Error al guardar listado final:', error);
        return sendError(res, { status: 500, message: 'Error interno al guardar el listado.', errorCode: 'INTERNAL_ERROR' });
    }
};

/**
 * Controlador para generar un plan en "Modo Asistido" con una flota manual.
 * Recibe fecha, idTour y flotaManual desde el cuerpo de la petición.
 */
exports.generarPlanAsistidoController = async (req, res) => {
    const { fecha, idTour, flotaManual, reservasAncladas } = req.body;

    if (!fecha || !idTour || !flotaManual) {
        return sendError(res, {
            status: 400,
            message: 'Peticion invalida. Se requiere fecha, idTour y flotaManual.',
            errorCode: 'MISSING_PARAMS'
        });
    }

    if (!Array.isArray(flotaManual) || flotaManual.length === 0) {
        return sendError(res, {
            status: 400,
            message: 'El campo flotaManual debe ser un arreglo y no puede estar vacio.',
            errorCode: 'BAD_REQUEST'
        });
    }

    try {
        console.log(`[INFO] Iniciando plan asistido para Tour: ${idTour}, Flota: [${flotaManual.join(', ')}]`);
        const resultado = await cerebro.generarPlanConFlotaDefinida(
            fecha,
            idTour,
            flotaManual,
            reservasAncladas || [] // Opcional, por si no se envían ancladas
        );
        console.log(`[SUCCESS] Plan asistido generado para Tour: ${idTour}.`);

        return sendSuccess(res, { data: resultado, message: 'Plan asistido generado correctamente' });

    } catch (error) {
        console.error(`[ERROR] Falló la generación del plan asistido para Tour: ${idTour}`, error);
        return sendError(res, {
            status: 500,
            message: 'Error interno del servidor al generar el plan con flota definida.',
            errorCode: 'INTERNAL_ERROR'
        });
    }
};

