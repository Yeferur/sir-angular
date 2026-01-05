const express = require('express');
const router = express.Router();
const inicioCtrl = require('../controllers/inicio.controller');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { checkPermission } = require('../middlewares/permissionsMiddleware');


router.get('/tours-data', authMiddleware, checkPermission('INICIO.LEER'), inicioCtrl.getInicioData);
router.post('/guardar-aforo', authMiddleware, checkPermission('INICIO.ACTUALIZAR_AFORO'), inicioCtrl.guardarAforo);

module.exports = router;
