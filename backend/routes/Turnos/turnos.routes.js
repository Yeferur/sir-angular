const express = require('express');
const controller = require('../../controllers/Turnos/turnos.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');
const { sendError } = require('../../utils/responseEnvelope');
const { isAdministratorRole } = require('../../services/Turnos/turnos.service');

const router = express.Router();

function requireAdministrator(req, res, next) {
  if (!isAdministratorRole(req.user?.role)) {
    return sendError(res, {
      status: 403,
      message: 'Solo los administradores autorizados pueden gestionar turnos de asesores.',
      errorCode: 'ADMIN_ONLY',
    });
  }
  return next();
}

router.get('/mi-jornada', authMiddleware, controller.obtenerMiJornada);
router.get('/asesores', authMiddleware, requireAdministrator, checkPermission('TURNOS.LEER'), controller.listarAsesores);
router.put('/asesores/:id', authMiddleware, requireAdministrator, checkPermission('TURNOS.ACTUALIZAR'), controller.actualizarJornada);

module.exports = router;
