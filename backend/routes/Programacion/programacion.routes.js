// backend/routes/Programacion/programacion.routes.inteligente.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddleware'); // Asumo que tienes un middleware de autenticación
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

// Importamos el nuevo controlador inteligente
const {
    generarPlanLogisticoController,
    generarPlanAsistidoController,
    exportarListadoBusController
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


// --- Rutas Legacy (las que ya tenías) ---
// // Puedes mantenerlas por compatibilidad o eliminarlas eventualmente.
// const {
//     obtenerListadoBusesPorTour,
//     obtenerListadoBusesPorTourManual
// } = require('../../controllers/Programacion/programacion.controller');

// router.get('/listado-buses', authMiddleware, obtenerListadoBusesPorTour);
// router.get('/listado-buses/manual', authMiddleware, obtenerListadoBusesPorTourManual);


module.exports = router;
