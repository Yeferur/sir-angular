const router = require('express').Router();
const controller = require('../../controllers/Notificaciones/notificaciones.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.get('/', authMiddleware, controller.listMine);
router.patch('/leer-todas', authMiddleware, controller.markAllRead);
router.patch('/:id/leer', authMiddleware, controller.markRead);
module.exports = router;
