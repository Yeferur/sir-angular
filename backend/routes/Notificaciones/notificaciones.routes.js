const router = require('express').Router();
const controller = require('../../controllers/Notificaciones/notificaciones.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('NOTIFICACIONES.LEER'), controller.listMine);
router.patch('/leer-todas', authMiddleware, checkPermission('NOTIFICACIONES.LEER'), controller.markAllRead);
router.patch('/:id/leer', authMiddleware, checkPermission('NOTIFICACIONES.LEER'), controller.markRead);
module.exports = router;
