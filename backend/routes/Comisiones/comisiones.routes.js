const express = require('express');
const router = express.Router();
const comisionesController = require('../../controllers/Comisiones/comisiones.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('CONTROL_VIAJE.EXPORTAR_COMISIONES'), comisionesController.listar);
router.get('/exportar', authMiddleware, checkPermission('CONTROL_VIAJE.EXPORTAR_COMISIONES'), comisionesController.exportarExcel);

module.exports = router;
