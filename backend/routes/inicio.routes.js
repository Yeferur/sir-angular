const express = require('express');
const router = express.Router();
const inicioCtrl = require('../controllers/inicio.controller');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { checkAnyPermission } = require('../middlewares/permissionsMiddleware');


router.get(
  '/tours-data',
  authMiddleware,
  checkAnyPermission(['AFOROS.LEER', 'INICIO.LEER']),
  inicioCtrl.getInicioData,
);
router.post(
  '/guardar-aforo',
  authMiddleware,
  checkAnyPermission(['AFOROS.ACTUALIZAR', 'INICIO.ACTUALIZAR_AFORO']),
  inicioCtrl.guardarAforo,
);

module.exports = router;
