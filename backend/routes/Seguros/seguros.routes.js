const express = require('express');
const router = express.Router();
const segurosController = require('../../controllers/Seguros/seguros.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission } = require('../../middlewares/permissionsMiddleware');

const AUTH = authMiddleware;
const PERM = checkPermission('SEGUROS.LEER');

// Rutas existentes — sin cambios de path ni permisos
router.get('/',         AUTH, PERM, segurosController.listar);
router.get('/exportar', AUTH, PERM, segurosController.exportarExcel);

// Nueva ruta — actualizar conductor/DNI de un bus
router.patch('/buses/:id', AUTH, PERM, segurosController.actualizarPersonalBus);

module.exports = router;