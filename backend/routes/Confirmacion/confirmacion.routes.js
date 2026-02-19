const express = require('express');
const router = express.Router();
const controller = require('../../controllers/Confirmacion/confirmacion.controller');

router.get('/pasajeros', controller.getPasajeros);
router.put('/update', controller.saveConfirmacion);

module.exports = router;
