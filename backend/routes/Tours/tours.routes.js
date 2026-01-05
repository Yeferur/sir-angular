// backend/routes/Tours/tours.routes.js
const express = require('express');
const router = express.Router();
const toursController = require('../../controllers/Tours/tours.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('TOURS.LEER'), toursController.getTours);
router.post('/', authMiddleware, checkPermission('TOURS.CREAR'), toursController.crearTour);
router.get('/:id', authMiddleware, checkPermission('TOURS.LEER'), toursController.getTourById);
router.get('/:id/disponibilidad', authMiddleware, checkPermission('TOURS.LEER'), toursController.getDisponibilidad);
router.put('/:id', authMiddleware, checkPermission('TOURS.ACTUALIZAR'), toursController.updateTour);
router.delete('/:id', authMiddleware, checkPermission('TOURS.ELIMINAR'), toursController.deleteTour);
router.get('/:id/precios', authMiddleware, checkPermission('TOURS.LEER'), toursController.getPrecios);
router.put('/:id/precios', authMiddleware, checkPermission('TOURS.ACTUALIZAR'), toursController.updatePrecios);

module.exports = router;
