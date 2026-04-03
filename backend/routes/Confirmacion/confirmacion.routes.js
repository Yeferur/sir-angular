const express = require('express');
const router = express.Router();
const controller = require('../../controllers/Confirmacion/confirmacion.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/pasajeros', authMiddleware, checkPermission('RESERVAS.LEER'), controller.getPasajeros);
router.put('/update', authMiddleware, checkPermission('RESERVAS.ACTUALIZAR'), controller.saveConfirmacion);

module.exports = router;
