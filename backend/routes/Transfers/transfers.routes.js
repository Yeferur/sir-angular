const express = require('express');
const router = express.Router();
const transfersController = require('../../controllers/Transfers/transfers.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/Transfer/ServicioTransfer', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getServicios);
router.post('/Transfer/NuevoTransfer', authMiddleware, checkPermission('TRANSFERS.CREAR'), transfersController.createTransfer);
router.put('/Transfer/:Id_Transfer', authMiddleware, checkPermission('TRANSFERS.CREAR'), transfersController.updateTransfer);
router.patch('/Transfer/:Id_Transfer/Cancelar', authMiddleware, checkPermission('TRANSFERS.CREAR'), transfersController.cancelTransfer);
router.get('/Transfer/Rangos', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getRangos);
router.get('/Transfer/Precios', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getPrecios);
router.get('/Transfer/Buscar', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getTransfers);
router.get('/Transfer/:Id_Transfer', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getDetalleTransfer);

// Comprobantes
router.post('/Transfer/:Id_Transfer/Pagos/:Id_Pago/Comprobante', authMiddleware, checkPermission('TRANSFERS.CREAR'), transfersController.uploadComprobanteTransfer);
router.get('/Transfer/Comprobante/:nombreArchivo', authMiddleware, checkPermission('TRANSFERS.LEER'), transfersController.getComprobanteTransfer);

module.exports = router;
