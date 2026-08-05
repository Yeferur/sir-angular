// backend/controllers/Programacion/programacion.controller.inteligente.js
const cerebro = require('../../services/Programacion/programacion.service');
const { recordHistorial } = require('../../services/Historial/logger');
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

        try {
            await recordHistorial({
                tabla: 'programacion',
                id_registro: `${fecha}|${idTour}|${placa}`,
                accion: 'EXPORTAR_EXCEL_LISTADO',
                id_usuario: req.user?.id || null,
                detalles: [
                    { columna: 'Fecha', anterior: null, nuevo: fecha },
                    { columna: 'Id_Tour', anterior: null, nuevo: String(idTour) },
                    { columna: 'Bus', anterior: null, nuevo: String(bus.id || placa) }
                ]
            });
        } catch (historialError) {
            console.error('No se pudo registrar historial de exportación de listado:', historialError);
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error al exportar listado de bus:', error);
        return sendError(res, { status: 500, message: 'Error al generar el archivo.', errorCode: 'EXPORT_FAILED' });
    }
};

/**
 * Ejecuta el generador actual y el nuevo optimizador en modo sombra.
 * No guarda ni reemplaza listados.
 */
exports.generarComparacionLogisticaShadowController = async (req, res) => {
    const { fecha, idTour, idsTours, maxGuiasBilingues } = req.body || {};
    const tours = idsTours || idTour;

    if (!fecha || !tours) {
        return sendError(res, {
            status: 400,
            message: 'Se requiere fecha e idsTours (o idTour).',
            errorCode: 'MISSING_PARAMS'
        });
    }

    try {
        const resultado = await cerebro.generarComparacionLogisticaShadow(
            fecha,
            tours,
            { maxGuiasBilingues }
        );
        return sendSuccess(res, {
            data: resultado,
            message: 'Comparación logística en modo sombra generada correctamente'
        });
    } catch (error) {
        console.error('Error al generar comparación logística en modo sombra:', error);
        return sendError(res, {
            status: 500,
            message: error?.message || 'No fue posible ejecutar el banco de pruebas logístico.',
            errorCode: 'SHADOW_PLAN_FAILED'
        });
    }
};

exports.generarPlanLogisticoOptimizadoController = async (req, res) => {
    const { fecha, idTour, idsTours, maxGuiasBilingues } = req.body || {};
    const tours = idsTours || idTour;

    if (!fecha || !tours) {
        return sendError(res, {
            status: 400,
            message: 'Se requiere fecha e idsTours (o idTour).',
            errorCode: 'MISSING_PARAMS'
        });
    }

    try {
        const resultado = await cerebro.generarPlanLogisticoOptimizado(
            fecha,
            tours,
            { maxGuiasBilingues }
        );
        return sendSuccess(res, {
            data: resultado,
            message: 'Plan logístico optimizado generado correctamente'
        });
    } catch (error) {
        console.error('Error al generar el plan logístico optimizado:', error);
        return sendError(res, {
            status: 500,
            message: error?.message || 'No fue posible generar el plan logístico.',
            errorCode: 'OPTIMIZED_PLAN_FAILED'
        });
    }
};

/**
 * Exporta una reserva privada en formato Excel.
 * Body: { fecha: 'YYYY-MM-DD', idReserva: string, buses: [...], nombreTour?: string, nombreReportante?: string }
 */
exports.exportarReservaPrivadaController = async (req, res) => {
    const { fecha, idReserva, buses, nombreTour, nombreReportante, idTour } = req.body || {};

    if (!fecha || !idReserva || !Array.isArray(buses) || buses.length === 0) {
        return sendError(res, { status: 400, message: 'Se requiere fecha, idReserva y buses en el cuerpo.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const buffer = await cerebro.generarExcelReservaPrivada({ fecha, idReserva, buses, nombreTour, nombreReportante, idTour });
        const reservaId = String(idReserva).replace(/\s+/g, '_');
        const tourName = nombreTour ? String(nombreTour).replace(/\s+/g, '_') : 'Privado';
        const fileName = `${fecha}_${tourName}_${reservaId}.xlsx`;

        try {
            await recordHistorial({
                tabla: 'programacion',
                id_registro: `${fecha}|${idReserva}`,
                accion: 'EXPORTAR_EXCEL_PRIVADO',
                id_usuario: req.user?.id || null,
                detalles: [
                    { columna: 'Fecha', anterior: null, nuevo: fecha },
                    { columna: 'Id_Reserva', anterior: null, nuevo: String(idReserva) },
                    { columna: 'Buses', anterior: null, nuevo: String(buses.length) }
                ]
            });
        } catch (historialError) {
            console.error('No se pudo registrar historial de exportación privada:', historialError);
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error al exportar reserva privada:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'Error al generar el archivo de la reserva privada.',
            errorCode: error.errorCode || 'EXPORT_PRIVATE_FAILED',
            details: error.details || undefined
        });
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
    const { fecha, idTour, idsTours, buses, busesPrivados } = req.body || {};
    const tours = idsTours || idTour;

    if (!fecha || !tours || !Array.isArray(buses)) {
        return sendError(res, { status: 400, message: 'Se requiere fecha, idsTours (o idTour) y buses en el cuerpo.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const resultado = await cerebro.guardarListadoFinal({
            fecha,
            idsTours: tours,
            buses,
            busesPrivados: Array.isArray(busesPrivados) ? busesPrivados : [],
            userId: req.user?.id || null
        });
        return sendSuccess(res, { data: resultado, message: 'Listado final guardado correctamente' });
    } catch (error) {
        console.error('Error al guardar listado final:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'Error interno al guardar el listado.',
            errorCode: error.errorCode || 'INTERNAL_ERROR',
            details: error.details || undefined
        });
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

/**
 * Devuelve el resumen de reservas privadas del día (para la card del dashboard).
 * Body: { fecha: 'YYYY-MM-DD', idsTours?: number[] }
 */
exports.resumenPrivadosDiaController = async (req, res) => {
    const { fecha, idsTours, idTour } = req.body || {};
    const tours = idsTours || (idTour ? [idTour] : null);

    if (!fecha) {
        return sendError(res, { status: 400, message: 'Se requiere fecha.', errorCode: 'MISSING_PARAMS' });
    }

    try {
        const resultado = await cerebro.resumenPrivadosDia(fecha, tours);
        return sendSuccess(res, { data: resultado, message: 'Resumen de privados obtenido correctamente' });
    } catch (error) {
        console.error('Error en resumenPrivadosDiaController:', error);
        return sendError(res, { status: 500, message: 'Error interno al consultar privados.', errorCode: 'INTERNAL_ERROR' });
    }
};

exports.guardarProgramacionPrivadaController = async (req, res) => {
    const { fecha, buses } = req.body || {};
    if (!fecha || !Array.isArray(buses)) {
        return sendError(res, {
            status: 400,
            message: 'Se requiere fecha y la lista de vehículos privados.',
            errorCode: 'MISSING_PARAMS'
        });
    }

    try {
        const resultado = await cerebro.guardarProgramacionPrivada({
            fecha,
            buses,
            userId: req.user?.id || null
        });
        return sendSuccess(res, {
            data: resultado,
            message: 'Programación privada guardada correctamente'
        });
    } catch (error) {
        console.error('Error al guardar programación privada:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'No fue posible guardar la programación privada.',
            errorCode: error.errorCode || 'PRIVATE_PROGRAM_SAVE_FAILED',
            details: error.details || undefined
        });
    }
};

exports.calcularRutaVisualController = async (req, res) => {
    try {
        const resultado = await cerebro.calcularRutaVisualOSRM(req.body?.coordenadas);
        return sendSuccess(res, { data: resultado, message: 'Ruta visual calculada con OSRM' });
    } catch (error) {
        console.error('Error al calcular ruta visual con OSRM:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'No fue posible calcular la ruta visual.',
            errorCode: error.errorCode || 'ROUTE_FAILED'
        });
    }
};

exports.exportarListadosZipController = async (req, res) => {
    const { fecha, idTour, buses, nombreTour } = req.body || {};
    try {
        const resultado = await cerebro.generarZipListados({ fecha, idTour, buses, nombreTour });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${resultado.fileName}"`);
        res.send(resultado.buffer);
    } catch (error) {
        console.error('Error al exportar ZIP de listados:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'No fue posible generar el archivo comprimido.',
            errorCode: error.errorCode || 'ZIP_EXPORT_FAILED'
        });
    }
};

exports.exportarPrivadosZipController = async (req, res) => {
    const { fecha, buses } = req.body || {};
    try {
        const resultado = await cerebro.generarZipPrivados({ fecha, buses });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${resultado.fileName}"`);
        res.send(resultado.buffer);
    } catch (error) {
        console.error('Error al exportar ZIP de programación privada:', error);
        return sendError(res, {
            status: error.statusCode || 500,
            message: error.message || 'No fue posible exportar la programación privada.',
            errorCode: error.errorCode || 'PRIVATE_ZIP_EXPORT_FAILED',
            details: error.details || undefined
        });
    }
};
