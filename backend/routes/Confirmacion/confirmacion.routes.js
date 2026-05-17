const express = require('express');
const router = express.Router();
const controller = require('../../controllers/Confirmacion/confirmacion.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/pasajeros', authMiddleware, checkPermission('CONTROL_VIAJE.LEER'), controller.getPasajeros);
router.put('/update', authMiddleware, checkPermission('CONTROL_VIAJE.ACTUALIZAR_ASISTENCIA'), controller.saveConfirmacion);

module.exports = router;
