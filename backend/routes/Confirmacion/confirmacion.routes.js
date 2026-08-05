const express = require('express');
const router = express.Router();
const controller = require('../../controllers/Confirmacion/confirmacion.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/pasajeros', authMiddleware, checkPermission('CONTROL_VIAJE.LEER'), controller.getPasajeros);
router.get(
  '/estado',
  authMiddleware,
  checkAnyPermission(['CONTROL_VIAJE.LEER', 'COMISIONES.LEER', 'SEGUROS.LEER']),
  controller.getEstado,
);
router.put('/update', authMiddleware, checkPermission('CONTROL_VIAJE.ACTUALIZAR_ASISTENCIA'), controller.saveConfirmacion);

module.exports = router;
