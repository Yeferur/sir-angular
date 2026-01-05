const express = require('express');
const { obtenerListadoBusesPorTour, obtenerListadoBusesPorTourManual } = require('../../controllers/Programacion/programacion.controller');
const router = express.Router();
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.get('/listado-buses', authMiddleware, obtenerListadoBusesPorTour);
router.get('/listado-buses/manual', authMiddleware, obtenerListadoBusesPorTourManual);

module.exports = router;
