const permisosService = require('../../services/Permisos/permisos.service');
const { invalidarCacheUsuario } = require('../../middlewares/permissionsMiddleware');

/**
 * Obtener permisos del usuario actual
 */
async function obtenerMisPermisos(req, res) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const permisos = await permisosService.obtenerPermisosPorUsuario(userId);
    
    res.json({
      permisos: permisos.map(p => ({
        codigo: p.Codigo_Permiso,
        accion: p.Accion,
        modulo: p.Codigo_Modulo,
        nombreModulo: p.Nombre_Modulo,
        descripcion: p.Descripcion
      }))
    });
  } catch (error) {
    console.error('Error obteniendo permisos:', error);
    res.status(500).json({
      error: 'Error al obtener permisos',
      mensaje: error.message
    });
  }
}

/**
 * Obtener menú dinámico del usuario actual
 */
async function obtenerMiMenu(req, res) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const menu = await permisosService.obtenerMenuPorUsuario(userId);
    
    res.json({
      menu: menu.map(m => ({
        id: m.Id_Modulo,
        nombre: m.Nombre_Modulo,
        codigo: m.Codigo_Modulo,
        icono: m.Icono,
        ruta: m.Ruta,
        orden: m.Orden
      }))
    });
  } catch (error) {
    console.error('Error obteniendo menú:', error);
    res.status(500).json({
      error: 'Error al obtener menú',
      mensaje: error.message
    });
  }
}

/**
 * Obtener todos los roles (solo admin)
 */
async function obtenerRoles(req, res) {
  try {
    const roles = await permisosService.obtenerRoles();
    res.json({ roles });
  } catch (error) {
    console.error('Error obteniendo roles:', error);
    res.status(500).json({
      error: 'Error al obtener roles',
      mensaje: error.message
    });
  }
}

/**
 * Obtener todos los módulos (solo admin)
 */
async function obtenerModulos(req, res) {
  try {
    const modulos = await permisosService.obtenerModulos();
    res.json({ modulos });
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    res.status(500).json({
      error: 'Error al obtener módulos',
      mensaje: error.message
    });
  }
}

/**
 * Obtener todos los permisos disponibles (solo admin)
 */
async function obtenerPermisos(req, res) {
  try {
    const permisos = await permisosService.obtenerTodosPermisos();
    res.json({ permisos });
  } catch (error) {
    console.error('Error obteniendo permisos:', error);
    res.status(500).json({
      error: 'Error al obtener permisos',
      mensaje: error.message
    });
  }
}

/**
 * Obtener permisos de un rol específico (solo admin)
 */
async function obtenerPermisosPorRol(req, res) {
  try {
    const idRol = req.params.idRol;
    const permisos = await permisosService.obtenerPermisosPorRol(idRol);
    res.json({ permisos });
  } catch (error) {
    console.error('Error obteniendo permisos del rol:', error);
    res.status(500).json({
      error: 'Error al obtener permisos del rol',
      mensaje: error.message
    });
  }
}

/**
 * Asignar permiso a un rol (solo admin)
 */
async function asignarPermiso(req, res) {
  try {
    const { idRol, idPermiso } = req.body;
    
    if (!idRol || !idPermiso) {
      return res.status(400).json({
        error: 'Datos incompletos',
        mensaje: 'Se requieren idRol e idPermiso'
      });
    }

    await permisosService.asignarPermisoARol(idRol, idPermiso);
    
    res.json({
      mensaje: 'Permiso asignado correctamente'
    });
  } catch (error) {
    console.error('Error asignando permiso:', error);
    res.status(500).json({
      error: 'Error al asignar permiso',
      mensaje: error.message
    });
  }
}

/**
 * Revocar permiso de un rol (solo admin)
 */
async function revocarPermiso(req, res) {
  try {
    const { idRol, idPermiso } = req.body;
    
    if (!idRol || !idPermiso) {
      return res.status(400).json({
        error: 'Datos incompletos',
        mensaje: 'Se requieren idRol e idPermiso'
      });
    }

    await permisosService.revocarPermisoDeRol(idRol, idPermiso);
    
    res.json({
      mensaje: 'Permiso revocado correctamente'
    });
  } catch (error) {
    console.error('Error revocando permiso:', error);
    res.status(500).json({
      error: 'Error al revocar permiso',
      mensaje: error.message
    });
  }
}

/**
 * Crear nuevo rol (solo admin)
 */
async function crearRol(req, res) {
  try {
    const { nombreRol, descripcion } = req.body;
    
    if (!nombreRol) {
      return res.status(400).json({
        error: 'Datos incompletos',
        mensaje: 'Se requiere nombreRol'
      });
    }

    const idRol = await permisosService.crearRol({
      Nombre_Rol: nombreRol,
      Descripcion: descripcion
    });
    
    res.status(201).json({
      mensaje: 'Rol creado correctamente',
      idRol
    });
  } catch (error) {
    console.error('Error creando rol:', error);
    res.status(500).json({
      error: 'Error al crear rol',
      mensaje: error.message
    });
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
      return res.status(400).json({
        error: 'Datos incompletos',
        mensaje: 'Se requiere nombreRol'
      });
    }

    await permisosService.actualizarRol(idRol, {
      Nombre_Rol: nombreRol,
      Descripcion: descripcion,
      Activo: activo !== undefined ? activo : 1
    });
    
    res.json({
      mensaje: 'Rol actualizado correctamente'
    });
  } catch (error) {
    console.error('Error actualizando rol:', error);
    res.status(500).json({
      error: 'Error al actualizar rol',
      mensaje: error.message
    });
  }
}

/**
 * Eliminar rol (solo admin)
 */
async function eliminarRol(req, res) {
  try {
    const idRol = req.params.idRol;
    
    await permisosService.eliminarRol(idRol);
    
    res.json({
      mensaje: 'Rol eliminado correctamente'
    });
  } catch (error) {
    console.error('Error eliminando rol:', error);
    
    if (error.message.includes('usuarios asignados')) {
      return res.status(400).json({
        error: 'No se puede eliminar',
        mensaje: error.message
      });
    }
    
    res.status(500).json({
      error: 'Error al eliminar rol',
      mensaje: error.message
    });
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
    
    res.json({
      mensaje: 'Cache invalidado correctamente'
    });
  } catch (error) {
    console.error('Error invalidando cache:', error);
    res.status(500).json({
      error: 'Error al invalidar cache',
      mensaje: error.message
    });
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
