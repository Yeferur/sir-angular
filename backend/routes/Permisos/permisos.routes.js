const express = require('express');
const router = express.Router();
const permisosController = require('../../controllers/Permisos/permisos.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { requireAdmin } = require('../../middlewares/permissionsMiddleware');

// =====================================================
// Rutas públicas para el usuario autenticado
// =====================================================

// Obtener permisos del usuario actual
router.get('/me/permisos', authMiddleware, permisosController.obtenerMisPermisos);

// Obtener menú dinámico del usuario actual
router.get('/me/menu', authMiddleware, permisosController.obtenerMiMenu);

// =====================================================
// Rutas de administración (solo admin)
// =====================================================

// Obtener todos los roles
router.get('/roles', authMiddleware, requireAdmin(), permisosController.obtenerRoles);

// Crear nuevo rol
router.post('/roles', authMiddleware, requireAdmin(), permisosController.crearRol);

// Actualizar rol existente
router.put('/roles/:idRol', authMiddleware, requireAdmin(), permisosController.actualizarRol);

// Eliminar rol
router.delete('/roles/:idRol', authMiddleware, requireAdmin(), permisosController.eliminarRol);

// Obtener permisos de un rol específico
router.get('/roles/:idRol/permisos', authMiddleware, requireAdmin(), permisosController.obtenerPermisosPorRol);

// Obtener todos los módulos
router.get('/modulos', authMiddleware, requireAdmin(), permisosController.obtenerModulos);

// Obtener todos los permisos disponibles
router.get('/permisos', authMiddleware, requireAdmin(), permisosController.obtenerPermisos);

// Asignar permiso a rol
router.post('/rol-permisos', authMiddleware, requireAdmin(), permisosController.asignarPermiso);

// Revocar permiso de rol
router.delete('/rol-permisos', authMiddleware, requireAdmin(), permisosController.revocarPermiso);

// Invalidar cache de permisos
router.post('/cache/invalidar', authMiddleware, requireAdmin(), permisosController.invalidarCache);

module.exports = router;
