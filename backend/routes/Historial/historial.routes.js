const express = require('express');
const router = express.Router();
const historialController = require('../../controllers/Historial/historial.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');

// Obtener historial con filtros
router.get('/', authMiddleware, historialController.getHistorial);

// Exportar historial a CSV
router.get('/export', authMiddleware, historialController.exportHistorial);

// Legacy endpoint
router.get('/tabla', authMiddleware, historialController.obtenerHistorial);

module.exports = router;
