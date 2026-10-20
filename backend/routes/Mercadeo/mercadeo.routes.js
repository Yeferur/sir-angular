const express = require('express');
const router = express.Router();
const controller = require('../../controllers/Mercadeo/mercadeo.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/reservas', authMiddleware, checkPermission('MERCADEO.RESERVAS.LEER'), controller.listarReservas);
router.get('/transfers', authMiddleware, checkPermission('MERCADEO.RESERVAS.LEER'), controller.listarTransfers);
router.get('/categorias', authMiddleware, checkPermission('MERCADEO.RESERVAS.LEER'), controller.listarCategorias);
router.get('/usuarios', authMiddleware, checkPermission('MERCADEO.RESERVAS.LEER'), controller.listarUsuarios);

module.exports = router;
