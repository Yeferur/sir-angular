const router = require('express').Router();
const controller = require('../../controllers/Pendientes/pendientes.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('PENDIENTES.LEER'), controller.listMine);
router.patch('/:id/posponer', authMiddleware, checkPermission('PENDIENTES.GESTIONAR'), controller.postpone);
router.patch('/:id/descartar', authMiddleware, checkPermission('PENDIENTES.GESTIONAR'), controller.dismiss);
router.get('/auditoria', authMiddleware, checkPermission('PENDIENTES.AUDITAR'), controller.audit);

module.exports = router;
