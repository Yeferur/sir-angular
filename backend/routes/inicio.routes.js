const express = require('express');
const router = express.Router();
const inicioCtrl = require('../controllers/inicio.controller');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { checkAnyPermission } = require('../middlewares/permissionsMiddleware');


router.get(
  '/tours-data',
  authMiddleware,
  checkAnyPermission(['AFOROS.LEER']),
  inicioCtrl.getInicioData,
);
router.post(
  '/guardar-aforo',
  authMiddleware,
  checkAnyPermission(['AFOROS.ACTUALIZAR']),
  inicioCtrl.guardarAforo,
);

module.exports = router;
