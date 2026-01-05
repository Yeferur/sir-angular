const express = require('express');
const router = express.Router();
const transfersController = require('../../controllers/Transfers/transfers.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/Transfer/ServicioTransfer', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getServicios);
router.post('/Transfer/NuevoTransfer', authMiddleware, checkPermission('TRANSFERS.CREAR'), transfersController.createTransfer);
router.get('/Transfer/Rangos', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getRangos);
router.get('/Transfer/Precios', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getPrecios);
router.get('/Transfer/Buscar', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getTransfers);

module.exports = router;
