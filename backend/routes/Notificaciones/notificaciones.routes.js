const router = require('express').Router();
const controller = require('../../controllers/Notificaciones/notificaciones.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');

function internalOnly(req, res, next) {
  if (req.user?.isClient) return res.status(403).json({ message: 'Las notificaciones internas no están disponibles para clientes.', errorCode: 'INTERNAL_ONLY' });
  return next();
}

router.get('/', authMiddleware, internalOnly, controller.listMine);
router.patch('/leer-todas', authMiddleware, internalOnly, controller.markAllRead);
router.patch('/:id/leer', authMiddleware, internalOnly, controller.markRead);
module.exports = router;
