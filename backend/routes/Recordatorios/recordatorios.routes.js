const router = require('express').Router();
const controller = require('../../controllers/Recordatorios/recordatorios.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/', authMiddleware, checkPermission('RECORDATORIOS.LEER'), controller.listMine);
router.post('/', authMiddleware, checkPermission('RECORDATORIOS.CREAR'), controller.create);
router.patch('/:id', authMiddleware, checkPermission('RECORDATORIOS.ACTUALIZAR'), controller.update);
router.patch('/:id/posponer', authMiddleware, checkPermission('RECORDATORIOS.ACTUALIZAR'), controller.postpone);
router.patch('/:id/completar', authMiddleware, checkPermission('RECORDATORIOS.ACTUALIZAR'), controller.complete);
router.delete('/:id', authMiddleware, checkPermission('RECORDATORIOS.ELIMINAR'), controller.remove);

module.exports = router;
