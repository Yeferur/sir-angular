const express = require('express');
const router = express.Router();
const segurosController = require('../../controllers/Seguros/seguros.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('SEGUROS.LEER'), segurosController.listar);
router.get('/exportar', authMiddleware, checkPermission('SEGUROS.LEER'), segurosController.exportarExcel);

module.exports = router;
