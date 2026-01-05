const express = require('express');
const router = express.Router();
const sesionesController = require('../../controllers/Usuarios/usuarios.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

router.get('/usuarios-sesiones', authMiddleware, checkPermission('USUARIOS.LEER'), sesionesController.obtenerUsuariosYSesiones);

module.exports = router;
