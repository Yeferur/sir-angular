const permisosService = require('../services/Permisos/permisos.service');

/**
 * Cache de permisos por usuario (en memoria, se limpia cada cierto tiempo)
 * Formato: { userId: { permisos: [...], timestamp: Date } }
 */
const permisosCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Limpiar cache expirado
 */
function limpiarCacheExpirado() {
  const ahora = Date.now();
  for (const [userId, data] of permisosCache.entries()) {
    if (ahora - data.timestamp > CACHE_DURATION) {
      permisosCache.delete(userId);
    }
  }
}

// Limpiar cache cada 10 minutos sin mantener vivo el proceso por este timer.
const cacheCleanupTimer = setInterval(limpiarCacheExpirado, 10 * 60 * 1000);
cacheCleanupTimer.unref?.();

/**
 * Obtener permisos de usuario (con cache)
 * @param {number} userId
 * @returns {Promise<Array>} Lista de códigos de permisos
 */
async function obtenerPermisosUsuario(userId, { forceRefresh = false } = {}) {
  // Verificar cache
  const cached = permisosCache.get(userId);
  if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return cached.permisos;
  }

  // Obtener de BD
  const permisos = await permisosService.obtenerPermisosPorUsuario(userId);
  const codigosPermisos = permisos.map(p => p.Codigo_Permiso);

  // Guardar en cache
  permisosCache.set(userId, {
    permisos: codigosPermisos,
    timestamp: Date.now()
  });

  return codigosPermisos;
}

/**
 * Invalidar cache de permisos de un usuario
 * @param {number} userId
 */
function invalidarCacheUsuario(userId) {
  permisosCache.delete(userId);
}

/**
 * Middleware para verificar permisos específicos
 * @param {string} codigoPermiso - Código del permiso (ej: 'TOURS.CREAR')
 * @returns {Function} Middleware de Express
 */
function checkPermission(codigoPermiso) {
  return async (req, res, next) => {
    try {
      // Verificar que el usuario esté autenticado
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'No autenticado',
          mensaje: 'Debe iniciar sesión para acceder a este recurso'
        });
      }

      const userId = req.user.id;

      // Obtener permisos del usuario
      let permisos = req.user?.isClient && Array.isArray(req.userPermissions)
        ? req.userPermissions
        : await obtenerPermisosUsuario(userId);

      // Si el permiso fue concedido recientemente, el caché puede contener
      // todavía la versión anterior. Refrescar una vez antes de responder 403.
      if (!req.user?.isClient && !permisos.includes(codigoPermiso)) {
        permisos = await obtenerPermisosUsuario(userId, { forceRefresh: true });
      }

      // Verificar si tiene el permiso
      if (!permisos.includes(codigoPermiso)) {
        return res.status(403).json({
          error: 'Acceso denegado',
          mensaje: `No tiene permiso para realizar esta acción (${codigoPermiso})`,
          permisoRequerido: codigoPermiso
        });
      }

      // Agregar permisos a req para que estén disponibles en controladores
      req.userPermissions = permisos;

      next();
    } catch (error) {
      console.error('Error verificando permisos:', error);
      return res.status(500).json({
        error: 'Error al verificar permisos',
        mensaje: error.message
      });
    }
  };
}

/**
 * Middleware para verificar múltiples permisos (requiere al menos uno)
 * @param {Array<string>} codigosPermisos - Array de códigos de permisos
 * @returns {Function} Middleware de Express
 */
function checkAnyPermission(codigosPermisos) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'No autenticado',
          mensaje: 'Debe iniciar sesión para acceder a este recurso'
        });
      }

      const userId = req.user.id;
      let permisos = req.user?.isClient && Array.isArray(req.userPermissions)
        ? req.userPermissions
        : await obtenerPermisosUsuario(userId);

      // Verificar si tiene al menos uno de los permisos
      let tienePermiso = codigosPermisos.some(codigo => permisos.includes(codigo));
      if (!req.user?.isClient && !tienePermiso) {
        permisos = await obtenerPermisosUsuario(userId, { forceRefresh: true });
        tienePermiso = codigosPermisos.some(codigo => permisos.includes(codigo));
      }

      if (!tienePermiso) {
        return res.status(403).json({
          error: 'Acceso denegado',
          mensaje: 'No tiene permiso para realizar esta acción',
          permisosRequeridos: codigosPermisos
        });
      }

      req.userPermissions = permisos;
      next();
    } catch (error) {
      console.error('Error verificando permisos:', error);
      return res.status(500).json({
        error: 'Error al verificar permisos',
        mensaje: error.message
      });
    }
  };
}

/**
 * Middleware para verificar que sea administrador
 * @returns {Function} Middleware de Express
 */
function requireAdmin() {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'No autenticado'
        });
      }

      // Los administradores tienen permisos sobre USUARIOS.LEER
      let permisos = req.user?.isClient && Array.isArray(req.userPermissions)
        ? req.userPermissions
        : await obtenerPermisosUsuario(req.user.id);

      if (!req.user?.isClient && !permisos.includes('USUARIOS.LEER')) {
        permisos = await obtenerPermisosUsuario(req.user.id, { forceRefresh: true });
      }

      if (!permisos.includes('USUARIOS.LEER')) {
        return res.status(403).json({
          error: 'Acceso denegado',
          mensaje: 'Solo administradores pueden acceder a este recurso'
        });
      }

      req.userPermissions = permisos;
      next();
    } catch (error) {
      console.error('Error verificando admin:', error);
      return res.status(500).json({
        error: 'Error al verificar permisos',
        mensaje: error.message
      });
    }
  };
}

module.exports = {
  checkPermission,
  checkAnyPermission,
  requireAdmin,
  invalidarCacheUsuario,
  obtenerPermisosUsuario
};
