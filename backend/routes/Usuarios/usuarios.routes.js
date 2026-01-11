const express = require('express');
const router = express.Router();
const sesionesController = require('../../controllers/Usuarios/usuarios.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

// Try to load multer if available; if not, continue without upload middleware (install multer to enable avatar uploads)
let uploadMiddleware = (req, res, next) => next();
try {
	const multer = require('multer');
	const path = require('path');
	const fs = require('fs');
	const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'usuarios');
	if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
	const storage = multer.diskStorage({
		destination: (req, file, cb) => cb(null, uploadDir),
		filename: (req, file, cb) => {
			const ext = path.extname(file.originalname);
			const name = `${Date.now()}-${Math.round(Math.random()*1e6)}${ext}`;
			cb(null, name);
		}
	});
	const upload = multer({ storage });
	uploadMiddleware = upload.single('avatar');
} catch (e) {
	console.warn('multer not installed — avatar upload disabled. Install multer to enable file uploads.');
}

router.get('/usuarios-sesiones', authMiddleware, checkPermission('USUARIOS.LEER'), sesionesController.obtenerUsuariosYSesiones);

// Crear nuevo usuario (solo para administradores con permiso USUARIOS.CREAR)
router.post('/usuarios', authMiddleware, checkPermission('USUARIOS.CREAR'), uploadMiddleware, sesionesController.crearUsuario);

module.exports = router;
