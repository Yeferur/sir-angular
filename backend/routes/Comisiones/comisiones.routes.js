const express = require('express');
const router  = express.Router();
const comisionesController = require('../../controllers/Comisiones/comisiones.controller');
const { authMiddleware }   = require('../../middlewares/authMiddleware');
const { checkPermission }  = require('../../middlewares/permissionsMiddleware');

const PERM = 'COMISIONES.LEER';

// Listar comisiones con filtros
router.get(
    '/',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.listar
);

// Actualizar Estado_Liquidacion (+ datos de pago opcionales si se pagan por primera vez)
router.put(
    '/liquidacion/estado',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.actualizarLiquidacion
);

// Actualización atómica de varias liquidaciones con destinos de pago distintos.
router.put(
    '/liquidacion/lote',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.actualizarLiquidacionesLote
);

// Actualizar solo Forma_Pago / Cuenta_Bancaria, sin tocar Estado ni Fecha_Pago
router.put(
    '/liquidacion/pago',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.actualizarDatosPago
);

// Perfil reutilizable de pago, ligado uno a uno a Hotel o Agencia Nacional.
router.get(
    '/perfiles-entidad/:idEntidad',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.obtenerPerfilComisionEntidad
);

router.post(
    '/perfiles-entidad',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.guardarPerfilComisionEntidad
);

router.put(
    '/perfiles-entidad',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.guardarPerfilComisionEntidad
);

// Exportar Excel
router.get(
    '/exportar',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.exportarExcel
);

module.exports = router;
