const router = require('express').Router();
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permissionsMiddleware');
const controller = require('../../controllers/EntidadesReportantes/entidades-reportantes.controller');

router.get('/entidades-reportantes', authMiddleware,
  checkAnyPermission(['RESERVAS.LEER', 'RESERVAS.CREAR', 'RESERVAS.ACTUALIZAR',
    'TRANSFERS.LEER', 'TRANSFERS.CREAR', 'TRANSFERS.ACTUALIZAR',
    'MERCADEO.RESERVAS.LEER', 'ENTIDADES_REPORTANTES.LEER']), controller.list);
router.post('/entidades-reportantes/rapida', authMiddleware,
  checkAnyPermission(['RESERVAS.CREAR', 'RESERVAS.ACTUALIZAR', 'TRANSFERS.CREAR', 'TRANSFERS.ACTUALIZAR']), controller.quickCreate);
router.patch('/entidades-reportantes/:id/validacion', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.VALIDAR'), controller.validate);
router.get('/entidades-reportantes/actividad', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.LEER'), controller.activity);
router.get('/entidades-reportantes/exportar', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.LEER'), controller.exportExcel);
router.get('/entidades-reportantes/:id', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.LEER'), controller.detail);
router.post('/entidades-reportantes', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.CREAR'), controller.create);
router.patch('/entidades-reportantes/:id', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.ACTUALIZAR'), controller.update);
router.put('/entidades-reportantes/:id/puntos/:pointId', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.VALIDAR'), controller.setPoint);
router.delete('/entidades-reportantes/:id/puntos/:pointId', authMiddleware,
  checkPermission('ENTIDADES_REPORTANTES.VALIDAR'), controller.setPoint);

module.exports = router;
