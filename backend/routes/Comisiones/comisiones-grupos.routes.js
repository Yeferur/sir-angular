const express = require('express');
const multer = require('multer');
const controller = require('../../controllers/Comisiones/comisiones-grupos.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

const router = express.Router();
const permission = checkPermission('COMISIONES.LEER');
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!allowedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      const error = new Error('El comprobante debe ser PDF, JPG o PNG.');
      error.status = 400;
      error.errorCode = 'INVALID_DOCUMENT_MIME';
      return callback(error);
    }
    return callback(null, true);
  },
});

function recibirComprobante(req, res, next) {
  upload.single('comprobante')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge ? 400 : (Number(error.status) || 400);
    return res.status(status).json({
      success: false,
      data: null,
      message: tooLarge ? 'El comprobante debe pesar máximo 5 MB.' : (error.message || 'No fue posible recibir el comprobante.'),
      errorCode: tooLarge ? 'DOCUMENT_TOO_LARGE' : (error.errorCode || 'DOCUMENT_UPLOAD_FAILED'),
    });
  });
}

router.get('/', authMiddleware, permission, controller.listar);
router.get('/:id/reservas', authMiddleware, permission, controller.obtenerReservas);
router.put('/:id/pago', authMiddleware, permission, recibirComprobante, controller.marcarPagado);

router.put('/lotes/:id/anulacion', authMiddleware, permission, controller.anular);
router.post('/lotes/:id/comprobante', authMiddleware, permission, recibirComprobante, controller.subirComprobante);
router.get('/lotes/:id/comprobante', authMiddleware, permission, controller.descargarComprobante);

module.exports = router;
