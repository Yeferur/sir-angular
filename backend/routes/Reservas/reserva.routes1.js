// routes/Reservas/reserva.routes.js
const express = require('express');
const router = express.Router();

// Asegúrate de que este path apunte bien:
const reservasCtrl = require('../../controllers/Reservas/reservas.controller');

// Pequeño wrapper para evitar try/catch repetidos
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Rutas
router.get('/reservas', asyncHandler(reservasCtrl.listar));                // GET /api/reservas?Fecha_Tour=...
router.get('/reservas/:id', asyncHandler(reservasCtrl.obtener));           // GET /api/reservas/:id
router.post('/reservas', asyncHandler(reservasCtrl.crear));                // POST /api/reservas  (payload de reserva)

// (Opcional) disponibilidad y confirmación de punto por REST clásico
router.get('/reservas/disponibilidad', asyncHandler(reservasCtrl.disponibilidad)); // ?Fecha_Tour=YYYY-MM-DD&Id_Tour=1&Cantidad=3
router.post('/reservas/confirmar-crear-punto', asyncHandler(reservasCtrl.confirmarCrearPunto)); // { token }

module.exports = router;
