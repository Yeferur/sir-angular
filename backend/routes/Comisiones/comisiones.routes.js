const express = require('express');
const router = express.Router();
const comisionesController = require('../../controllers/Comisiones/comisiones.controller');

router.get('/', comisionesController.listar);
router.get('/exportar', comisionesController.exportarExcel);

module.exports = router;
