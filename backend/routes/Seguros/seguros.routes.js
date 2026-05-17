const express = require('express');
const router = express.Router();
const segurosController = require('../../controllers/Seguros/seguros.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('CONTROL_VIAJE.EXPORTAR_SEGUROS'), segurosController.listar);
router.get('/exportar', authMiddleware, checkPermission('CONTROL_VIAJE.EXPORTAR_SEGUROS'), segurosController.exportarExcel);

module.exports = router;
