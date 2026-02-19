const express = require('express');
const router = express.Router();
const segurosController = require('../../controllers/Seguros/seguros.controller');

router.get('/', segurosController.listar);
router.get('/exportar', segurosController.exportarExcel);

module.exports = router;
