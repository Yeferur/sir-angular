// src/routes/Reservas/reservas.routes.js
const express = require('express');
const router = express.Router();
const reservasController = require('../../controllers/Reservas/reservas.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

// Query y utilidades
router.get('/reservas', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getReservas);
router.get('/reserva', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getReserva);
router.get('/reservas/verificar-cupos', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getCupos);

// Catálogos
router.get('/canales', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getCanales);
router.get('/monedas', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getMonedas);
router.get('/tours', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getTours);
router.get('/tours/:id/planes', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getPlanesByTour);
router.get('/precios', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getPrecios);
router.get('/horarios', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getHorarios);
router.get('/tours/comisiones', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getComisiones);

// Creación
router.post('/reservas', authMiddleware, checkPermission('RESERVAS.CREAR'), reservasController.saveReserva);

// 🔽 Edición
router.get('/reservas/:id/detalle', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getReservaDetalle);
router.put('/reservas/:id', authMiddleware, checkPermission('RESERVAS.ACTUALIZAR'), reservasController.updateReserva);

// (opcional) Punto por Id para hidratar tokens de puntos
router.get('/reservas/puntos/:id', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.getPuntoById);

// Verificar DNI duplicado
router.get('/reservas/verificar-dni', authMiddleware, checkPermission('RESERVAS.LEER'), reservasController.checkDniDuplicado);

module.exports = router;
