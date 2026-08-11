const express = require('express');
const controller = require('../../controllers/Turnos/turnos.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

const router = express.Router();

router.get('/mi-jornada', authMiddleware, controller.obtenerMiJornada);
router.get('/canales', authMiddleware, controller.obtenerCanales);
router.get('/semanas/historial', authMiddleware, checkPermission('TURNOS.LEER'), controller.obtenerHistorial);
router.get('/semanas', authMiddleware, checkPermission('TURNOS.LEER'), controller.obtenerSemana);
router.post('/semanas/:idSemana/publicar', authMiddleware, checkPermission('TURNOS.ACTUALIZAR'), controller.publicarSemana);

module.exports = router;
