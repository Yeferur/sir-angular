// backend/routes/Programacion/programacion.routes.inteligente.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddleware'); // Asumo que tienes un middleware de autenticación
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

// Importamos el nuevo controlador inteligente
const {
    generarPlanLogisticoController,
    generarComparacionLogisticaShadowController,
    generarPlanAsistidoController,
    exportarListadoBusController,
    exportarReservaPrivadaController,
    guardarListadoFinalController,
    obtenerListadoFinalController,
    resumenPrivadosDiaController
} = require('../../controllers/Programacion/programacion.controller');

/**
 * ===================================================================================
 * RUTAS PARA EL ASISTENTE DE LOGÍSTICA INTELIGENTE
 * ===================================================================================
 */

/**
 * @route   POST /api/programacion/plan-logistico
 * @desc    Genera las mejores 3 opciones de plan logístico para un tour y fecha.
 * @access  Private
 * @body    { "fecha": "YYYY-MM-DD", "idTour": 123 }
 */
router.post(
    '/plan-logistico',
    authMiddleware,
    checkPermission('PROGRAMACION.CREAR'),
    generarPlanLogisticoController
);

/**
 * @route   POST /api/programacion/plan-asistido
 * @desc    Genera un plan logístico para una flota definida manualmente (Modo Asistido).
 * @access  Private
 * @body    { "fecha": "YYYY-MM-DD", "idTour": 123, "flotaManual": [43, 40, 40], "reservasAncladas": [] }
 */
router.post(
    '/plan-asistido',
    authMiddleware,
    checkPermission('PROGRAMACION.CREAR'),
    generarPlanAsistidoController
);

/**
 * @route   POST /api/programacion/exportar-listado-bus
 * @desc    Exporta a Excel el listado de un bus (archivo individual)
 * @access  Private
 */
router.post(
    '/exportar-listado-bus',
    authMiddleware,
    checkPermission('PROGRAMACION.LEER'),
    exportarListadoBusController
);

router.post(
    '/plan-logistico-shadow',
    authMiddleware,
    checkPermission('PROGRAMACION.CREAR'),
    generarComparacionLogisticaShadowController
);

router.post(
    '/exportar-reserva-privada',
    authMiddleware,
    checkPermission('PROGRAMACION.LEER'),
    exportarReservaPrivadaController
);

/**
 * @route   POST /api/programacion/guardar-listado
 * @desc    Guarda el listado final confirmado
 * @access  Private
 */
router.post(
    '/guardar-listado',
    authMiddleware,
    checkPermission('PROGRAMACION.ACTUALIZAR'),
    guardarListadoFinalController
);

/**
 * @route   POST /api/programacion/listado-existente
 * @desc    Consulta listado guardado y reservas sin asignar
 * @access  Private
 */
router.post(
    '/listado-existente',
    authMiddleware,
    checkPermission('PROGRAMACION.LEER'),
    obtenerListadoFinalController
);


// --- Rutas Legacy (las que ya tenías) ---
// // Puedes mantenerlas por compatibilidad o eliminarlas eventualmente.
// const {
//     obtenerListadoBusesPorTour,
//     obtenerListadoBusesPorTourManual
// } = require('../../controllers/Programacion/programacion.controller');

// router.get('/listado-buses', authMiddleware, obtenerListadoBusesPorTour);
// router.get('/listado-buses/manual', authMiddleware, obtenerListadoBusesPorTourManual);


/**
 * @route   POST /api/programacion/privados-del-dia
 * @desc    Resumen de reservas privadas del día para el dashboard
 * @access  Private
 * @body    { "fecha": "YYYY-MM-DD", "idsTours": [1, 2, ...] }
 */
router.post(
    '/privados-del-dia',
    authMiddleware,
    checkPermission('PROGRAMACION.LEER'),
    resumenPrivadosDiaController
);

module.exports = router;
