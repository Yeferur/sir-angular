const express = require('express');
const controller = require('../../controllers/Turnos/turnos.controller');
const exchangeController = require('../../controllers/Turnos/turnos-intercambios.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

const router = express.Router();

function advisorOnly(req, res, next) {
  if (String(req.user?.role || '').trim().toLocaleLowerCase('es-CO') !== 'asesor') {
    return res.status(403).json({ message: 'Esta acción está disponible únicamente para asesores.', errorCode: 'ADVISOR_ONLY' });
  }
  return next();
}

router.get('/mi-jornada', authMiddleware, controller.obtenerMiJornada);
router.get('/intercambios', authMiddleware, advisorOnly, exchangeController.listMine);
router.get('/intercambios/opciones', authMiddleware, advisorOnly, exchangeController.candidates);
router.post('/intercambios', authMiddleware, advisorOnly, exchangeController.create);
router.patch('/intercambios/:id/responder', authMiddleware, advisorOnly, exchangeController.respond);
router.patch('/intercambios/:id/cancelar', authMiddleware, advisorOnly, exchangeController.cancel);
router.get('/canales', authMiddleware, controller.obtenerCanales);
router.get('/semanas/historial', authMiddleware, checkPermission('TURNOS.LEER'), controller.obtenerHistorial);
router.get('/semanas', authMiddleware, checkPermission('TURNOS.LEER'), controller.obtenerSemana);
router.post('/semanas/:idSemana/publicar', authMiddleware, checkPermission('TURNOS.ACTUALIZAR'), controller.publicarSemana);

module.exports = router;
