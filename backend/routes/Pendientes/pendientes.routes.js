const router = require('express').Router();
const controller = require('../../controllers/Pendientes/pendientes.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware,
  checkAnyPermission(['PENDIENTES.LEER', 'ENTIDADES_REPORTANTES.VALIDAR',
    'RESERVAS.CREAR', 'RESERVAS.ACTUALIZAR', 'TRANSFERS.CREAR', 'TRANSFERS.ACTUALIZAR']), controller.listMine);
router.patch('/:id/posponer', authMiddleware, checkPermission('PENDIENTES.GESTIONAR'), controller.postpone);
router.patch('/:id/descartar', authMiddleware, checkPermission('PENDIENTES.GESTIONAR'), controller.dismiss);
router.get('/auditoria', authMiddleware, checkPermission('PENDIENTES.AUDITAR'), controller.audit);

module.exports = router;
