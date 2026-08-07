const express = require('express');
const router = express.Router();
const historialController = require('../../controllers/Historial/historial.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

// Obtener historial con filtros
router.get('/', authMiddleware, checkPermission('HISTORIAL.LEER'), historialController.getHistorial);

// Exportar historial a CSV
router.get('/export', authMiddleware, checkPermission('HISTORIAL.LEER'), historialController.exportHistorial);

// Legacy endpoint
router.get('/tabla', authMiddleware, checkPermission('HISTORIAL.LEER'), historialController.obtenerHistorial);

module.exports = router;
