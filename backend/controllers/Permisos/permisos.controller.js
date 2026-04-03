const permisosService = require('../../services/Permisos/permisos.service');
const { invalidarCacheUsuario } = require('../../middlewares/permissionsMiddleware');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

/**
 * Obtener permisos del usuario actual
 */
async function obtenerMisPermisos(req, res) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return sendError(res, { status: 401, message: 'No autenticado', errorCode: 'UNAUTHENTICATED' });
    }

    const permisos = await permisosService.obtenerPermisosPorUsuario(userId);
    
    return sendSuccess(res, {
      data: {
        permisos: permisos.map(p => ({
          codigo: p.Codigo_Permiso,
          accion: p.Accion,
          modulo: p.Codigo_Modulo,
          nombreModulo: p.Nombre_Modulo,
          descripcion: p.Descripcion
        }))
      },
      message: 'Permisos obtenidos correctamente'
    });
  } catch (error) {
    console.error('Error obteniendo permisos:', error);
    return sendError(res, { status: 500, message: 'Error al obtener permisos', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Obtener menú dinámico del usuario actual
 */
async function obtenerMiMenu(req, res) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return sendError(res, { status: 401, message: 'No autenticado', errorCode: 'UNAUTHENTICATED' });
    }

    const menu = await permisosService.obtenerMenuPorUsuario(userId);
    
    return sendSuccess(res, {
      data: {
        menu: menu.map(m => ({
          id: m.Id_Modulo,
          nombre: m.Nombre_Modulo,
          codigo: m.Codigo_Modulo,
          icono: m.Icono,
          ruta: m.Ruta,
          orden: m.Orden
        }))
      },
      message: 'Menu obtenido correctamente'
    });
  } catch (error) {
    console.error('Error obteniendo menú:', error);
    return sendError(res, { status: 500, message: 'Error al obtener menu', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Obtener todos los roles (solo admin)
 */
async function obtenerRoles(req, res) {
  try {
    const roles = await permisosService.obtenerRoles();
    return sendSuccess(res, { data: { roles }, message: 'Roles obtenidos correctamente' });
  } catch (error) {
    console.error('Error obteniendo roles:', error);
    return sendError(res, { status: 500, message: 'Error al obtener roles', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Obtener todos los módulos (solo admin)
 */
async function obtenerModulos(req, res) {
  try {
    const modulos = await permisosService.obtenerModulos();
    return sendSuccess(res, { data: { modulos }, message: 'Modulos obtenidos correctamente' });
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    return sendError(res, { status: 500, message: 'Error al obtener modulos', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Obtener todos los permisos disponibles (solo admin)
 */
async function obtenerPermisos(req, res) {
  try {
    const permisos = await permisosService.obtenerTodosPermisos();
    return sendSuccess(res, { data: { permisos }, message: 'Permisos obtenidos correctamente' });
  } catch (error) {
    console.error('Error obteniendo permisos:', error);
    return sendError(res, { status: 500, message: 'Error al obtener permisos', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Obtener permisos de un rol específico (solo admin)
 */
async function obtenerPermisosPorRol(req, res) {
  try {
    const idRol = req.params.idRol;
    const permisos = await permisosService.obtenerPermisosPorRol(idRol);
    return sendSuccess(res, { data: { permisos }, message: 'Permisos del rol obtenidos correctamente' });
  } catch (error) {
    console.error('Error obteniendo permisos del rol:', error);
    return sendError(res, { status: 500, message: 'Error al obtener permisos del rol', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Asignar permiso a un rol (solo admin)
 */
async function asignarPermiso(req, res) {
  try {
    const { idRol, idPermiso } = req.body;
    
    if (!idRol || !idPermiso) {
      return sendError(res, { status: 400, message: 'Se requieren idRol e idPermiso', errorCode: 'MISSING_PARAMS' });
    }

    await permisosService.asignarPermisoARol(idRol, idPermiso);
    
    return sendSuccess(res, { data: null, message: 'Permiso asignado correctamente' });
  } catch (error) {
    console.error('Error asignando permiso:', error);
    return sendError(res, { status: 500, message: 'Error al asignar permiso', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Revocar permiso de un rol (solo admin)
 */
async function revocarPermiso(req, res) {
  try {
    const { idRol, idPermiso } = req.body;
    
    if (!idRol || !idPermiso) {
      return sendError(res, { status: 400, message: 'Se requieren idRol e idPermiso', errorCode: 'MISSING_PARAMS' });
    }

    await permisosService.revocarPermisoDeRol(idRol, idPermiso);
    
    return sendSuccess(res, { data: null, message: 'Permiso revocado correctamente' });
  } catch (error) {
    console.error('Error revocando permiso:', error);
    return sendError(res, { status: 500, message: 'Error al revocar permiso', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Crear nuevo rol (solo admin)
 */
async function crearRol(req, res) {
  try {
    const { nombreRol, descripcion } = req.body;
    
    if (!nombreRol) {
      return sendError(res, { status: 400, message: 'Se requiere nombreRol', errorCode: 'MISSING_PARAMS' });
    }

    const idRol = await permisosService.crearRol({
      Nombre_Rol: nombreRol,
      Descripcion: descripcion
    });
    
    return sendSuccess(res, { data: { idRol }, message: 'Rol creado correctamente', status: 201 });
  } catch (error) {
    console.error('Error creando rol:', error);
    return sendError(res, { status: 500, message: 'Error al crear rol', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Actualizar rol existente (solo admin)
 */
async function actualizarRol(req, res) {
  try {
    const idRol = req.params.idRol;
    const { nombreRol, descripcion, activo } = req.body;
    
    if (!nombreRol) {
      return sendError(res, { status: 400, message: 'Se requiere nombreRol', errorCode: 'MISSING_PARAMS' });
    }

    await permisosService.actualizarRol(idRol, {
      Nombre_Rol: nombreRol,
      Descripcion: descripcion,
      Activo: activo !== undefined ? activo : 1
    });
    
    return sendSuccess(res, { data: null, message: 'Rol actualizado correctamente' });
  } catch (error) {
    console.error('Error actualizando rol:', error);
    return sendError(res, { status: 500, message: 'Error al actualizar rol', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Eliminar rol (solo admin)
 */
async function eliminarRol(req, res) {
  try {
    const idRol = req.params.idRol;
    
    await permisosService.eliminarRol(idRol);
    
    return sendSuccess(res, { data: null, message: 'Rol eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando rol:', error);
    
    if (error.message.includes('usuarios asignados')) {
      return sendError(res, { status: 400, message: error.message, errorCode: 'ROLE_IN_USE' });
    }

    return sendError(res, { status: 500, message: 'Error al eliminar rol', errorCode: 'INTERNAL_ERROR' });
  }
}

/**
 * Invalidar cache de permisos de un usuario (útil después de cambiar roles/permisos)
 */
async function invalidarCache(req, res) {
  try {
    const { userId } = req.body;
    
    if (userId) {
      invalidarCacheUsuario(userId);
    }
    
    return sendSuccess(res, { data: null, message: 'Cache invalidado correctamente' });
  } catch (error) {
    console.error('Error invalidando cache:', error);
    return sendError(res, { status: 500, message: 'Error al invalidar cache', errorCode: 'INTERNAL_ERROR' });
  }
}

module.exports = {
  obtenerMisPermisos,
  obtenerMiMenu,
  obtenerRoles,
  obtenerModulos,
  obtenerPermisos,
  obtenerPermisosPorRol,
  asignarPermiso,
  revocarPermiso,
  crearRol,
  actualizarRol,
  eliminarRol,
  invalidarCache
};
