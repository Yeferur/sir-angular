// backend/controllers/Programacion/programacion.controller.inteligente.js
const cerebro = require('../../services/Programacion/programacion.service');

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
    const { fecha, idTour } = req.body;

    if (!fecha || !idTour) {
        return res.status(400).json({
            error: 'Petición inválida. Se requiere "fecha" y "idTour" en el cuerpo de la solicitud.'
        });
    }

    try {
        console.log(`[INFO] Iniciando generación de plan para Tour: ${idTour}, Fecha: ${fecha}`);
        const resultado = await cerebro.generarPlanLogistico(fecha, idTour);
        console.log(`[SUCCESS] Plan generado para Tour: ${idTour}. Se encontraron ${resultado.sugerencias.length} sugerencias.`);

        res.status(200).json(resultado);

    } catch (error) {
        console.error(`[ERROR] Falló la generación del plan para Tour: ${idTour}, Fecha: ${fecha}`, error);
        res.status(500).json({
            error: 'Error interno del servidor al generar el plan logístico.'
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
        return res.status(400).json({
            error: 'Petición inválida. Se requiere "fecha", "idTour" y "flotaManual" en el cuerpo de la solicitud.'
        });
    }

    if (!Array.isArray(flotaManual) || flotaManual.length === 0) {
        return res.status(400).json({
            error: 'El campo "flotaManual" debe ser un arreglo de capacidades de buses y no puede estar vacío.'
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

        res.status(200).json(resultado);

    } catch (error) {
        console.error(`[ERROR] Falló la generación del plan asistido para Tour: ${idTour}`, error);
        res.status(500).json({
            error: 'Error interno del servidor al generar el plan con flota definida.'
        });
    }
};

