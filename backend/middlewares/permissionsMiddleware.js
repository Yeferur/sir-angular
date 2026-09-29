const permisosService = require('../services/Permisos/permisos.service');

/**
 * Caché local con revisión compartida en MySQL: nunca reutilizar un resultado
 * positivo sin comprobar primero las revisiones de usuario y rol.
 */
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

function sameRevision(a, b) {
  return a?.idRol === b?.idRol && a?.usuario === b?.usuario && a?.rol === b?.rol;
}

function createPermissionCache(service = permisosService) {
  const cache = new Map();

  async function obtenerPermisosUsuario(userId, { forceRefresh = false } = {}) {
    const key = String(userId);
    // Si MySQL falla, el error se propaga aunque exista una entrada positiva.
    let revision = await service.obtenerRevisionPermisosUsuario(userId);
    const cached = cache.get(key);
    if (!forceRefresh && cached && sameRevision(cached.revision, revision)
      && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.permisos;
    }

    // No asociar permisos anteriores a una revisión nueva si una transacción
    // se confirma durante la lectura. Reintentos acotados y fail closed.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const permisos = await service.obtenerPermisosPorUsuario(userId);
      const confirmed = await service.obtenerRevisionPermisosUsuario(userId);
      if (sameRevision(revision, confirmed)) {
        const codes = permisos.map((p) => p.Codigo_Permiso);
        cache.set(key, { permisos: codes, revision: confirmed, timestamp: Date.now() });
        return codes;
      }
      revision = confirmed;
    }
    const error = new Error('Los permisos cambiaron repetidamente durante la autorización.');
    error.status = 503;
    throw error;
  }

  function invalidarCacheUsuario(userId) {
    cache.delete(String(userId));
  }

  function limpiarCacheExpirado() {
    const now = Date.now();
    for (const [key, data] of cache.entries()) {
      if (now - data.timestamp >= CACHE_DURATION) cache.delete(key);
    }
  }

  return { obtenerPermisosUsuario, invalidarCacheUsuario, limpiarCacheExpirado };
}

const permissionsCache = createPermissionCache();
const { obtenerPermisosUsuario, invalidarCacheUsuario } = permissionsCache;
const cacheCleanupTimer = setInterval(permissionsCache.limpiarCacheExpirado, 10 * 60 * 1000);
cacheCleanupTimer.unref?.();

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
      return res.status(error.status || 500).json({
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
      return res.status(error.status || 500).json({
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
      return res.status(error.status || 500).json({
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
  obtenerPermisosUsuario,
  createPermissionCache,
};
