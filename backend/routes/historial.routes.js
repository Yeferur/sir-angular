const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware') || require('../../middlewares/authMiddleware');
const historialController = require('../controllers/Historial/historial.controller') || require('../../controllers/Historial/historial.controller');

// GET /api/historial-tabla?tabla=NombreTabla&id=123 (legacy)
router.get('/historial-tabla', authMiddleware, historialController.obtenerHistorial);

module.exports = router;
