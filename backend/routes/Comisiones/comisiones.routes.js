const express = require('express');
const router  = express.Router();
const comisionesController = require('../../controllers/Comisiones/comisiones.controller');
const { authMiddleware }   = require('../../middlewares/authMiddleware');
const { checkPermission }  = require('../../middlewares/permissionsMiddleware');
const multer = require('multer');

const PERM = 'COMISIONES.LEER';
const uploadDocuments = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    fileFilter: (_req, file, cb) => {
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
            const error = new Error('Solo se permiten imágenes JPG, PNG o documentos PDF.');
            error.status = 400;
            return cb(error);
        }
        cb(null, true);
    }
});

function receiveDocuments(req, res, next) {
    uploadDocuments.array('documentos', 5)(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
            success: false,
            data: null,
            message: tooLarge ? 'Cada documento debe pesar máximo 5 MB.' : (error.message || 'No fue posible recibir los documentos.'),
            errorCode: tooLarge ? 'DOCUMENT_TOO_LARGE' : 'DOCUMENT_UPLOAD_FAILED'
        });
    });
}

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

// Centralización opcional desde el flujo de comisiones.
router.post(
    '/beneficiarios',
    authMiddleware,
    checkPermission(PERM),
    receiveDocuments,
    comisionesController.guardarBeneficiario
);

router.get(
    '/beneficiarios/documentos/:idDocumento',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.descargarDocumento
);

router.delete(
    '/beneficiarios/:idBeneficiario/documentos/:idDocumento',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.eliminarDocumento
);

// Exportar Excel
router.get(
    '/exportar',
    authMiddleware,
    checkPermission(PERM),
    comisionesController.exportarExcel
);

module.exports = router;
