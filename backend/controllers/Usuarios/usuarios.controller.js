const sesionesService = require('../../services/Usuarios/usuarios.service');
const bcrypt = require('bcrypt');
const db = require('../../database/db');
const { recordHistorial } = require('../../services/Historial/logger');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');
const wsManager = require('../../websocketManager');
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', '..');

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function parsePermissionIds(value) {
  let parsed = value;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_err) {
      return null;
    }
  }

  if (!Array.isArray(parsed)) return null;

  const ids = [];
  for (const permission of parsed) {
    const rawId = permission && typeof permission === 'object'
      ? permission.Id_Permiso ?? permission.idPermiso ?? permission.id
      : permission;
    const id = Number(rawId);

    if (!Number.isSafeInteger(id) || id <= 0) return null;
    ids.push(id);
  }

  return [...new Set(ids)];
}

function resolveAvatarAbsolutePath(avatarValue) {
  if (!avatarValue || typeof avatarValue !== 'string') return null;

  let raw = avatarValue.trim();
  if (!raw) return null;

  // Soporta URLs absolutas: http://host/uploads/...
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname || raw;
    } catch (_err) {
      // mantener valor original si URL falla
    }
  }

  // Normaliza separadores y elimina query/hash
  raw = raw.split('?')[0].split('#')[0].replace(/\\/g, '/');

  // Extraer ruta desde uploads si viene prefijada
  const uploadsMarker = '/uploads/';
  const uploadsIdx = raw.indexOf(uploadsMarker);
  if (uploadsIdx >= 0) {
    raw = `uploads/${raw.slice(uploadsIdx + uploadsMarker.length)}`;
  }

  // Quitar slash inicial
  raw = raw.replace(/^\/+/, '');

  // Candidato 1: ruta exacta relativa al backend
  const exactCandidate = path.join(backendRoot, raw);
  if (fs.existsSync(exactCandidate)) return exactCandidate;

  // Candidato 2+: búsqueda por nombre de archivo en carpetas conocidas
  const filename = path.basename(raw);
  if (!filename) return null;

  const candidates = [
    path.join(backendRoot, 'uploads', 'fotos_perfil', filename),
    path.join(backendRoot, 'uploads', 'usuarios', filename),
    path.join(backendRoot, 'uploads', filename),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

exports.obtenerUsuariosYSesiones = async (req, res) => {
  try {
    const usuarios = await sesionesService.getAllUsers();
    const sesiones = await sesionesService.getActiveSessions();

    return sendSuccess(res, {
      data: { usuarios, sesiones },
      message: 'Usuarios y sesiones obtenidos correctamente',
    });
  } catch (err) {
    console.error(err);
    return sendError(res, {
      status: 500,
      message: 'Error consultando usuarios y sesiones',
      errorCode: 'INTERNAL_ERROR',
    });
  }
};

exports.obtenerUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await sesionesService.getUserById(id);
    if (!usuario) {
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    return sendSuccess(res, {
      data: usuario,
      message: 'Usuario obtenido correctamente',
    });
  } catch (err) {
    console.error(err);
    return sendError(res, {
      status: 500,
      message: 'Error obteniendo usuario',
      errorCode: 'INTERNAL_ERROR',
    });
  }
};

exports.obtenerMiPerfil = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, {
        status: 401,
        message: 'Usuario no autenticado',
        errorCode: 'UNAUTHENTICATED',
      });
    }

    const [rows] = await db.query(
      'SELECT Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Avatar FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    return sendSuccess(res, {
      data: rows[0],
      message: 'Perfil obtenido correctamente',
    });
  } catch (err) {
    console.error('obtenerMiPerfil error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error obteniendo perfil',
      errorCode: 'INTERNAL_ERROR',
    });
  }
};

exports.actualizarMiPerfil = async (req, res) => {
  let conn;
  let closedSessionTokens = [];
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, {
        status: 401,
        message: 'Usuario no autenticado',
        errorCode: 'UNAUTHENTICATED',
      });
    }

    const forbiddenKeys = ['Id_Usuario', 'Id_Rol', 'permisos', 'Activo', 'Usuario'];
    const attemptedForbidden = forbiddenKeys.filter((k) => Object.prototype.hasOwnProperty.call(req.body || {}, k));
    if (attemptedForbidden.length > 0) {
      return sendError(res, {
        status: 403,
        message: 'No tienes permisos para modificar campos privilegiados',
        errorCode: 'FORBIDDEN',
        details: { fields: attemptedForbidden },
      });
    }

    const {
      Nombres_Apellidos,
      Telefono_Usuario,
      Correo,
      Contrasena,
      Contrasena_Actual,
    } = req.body || {};

    if (!Nombres_Apellidos || !Correo) {
      return sendError(res, {
        status: 400,
        message: 'Nombre y correo son obligatorios',
        errorCode: 'MISSING_PARAMS',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [currentRows] = await conn.query(
      'SELECT Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Correo, Contrasena FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
      [userId]
    );

    if (!currentRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const current = currentRows[0];

    const [exists] = await conn.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE Correo = ? AND Id_Usuario != ?',
      [Correo, userId]
    );

    if (exists[0].total > 0) {
      await conn.rollback();
      return sendError(res, {
        status: 409,
        message: 'El correo ya esta en uso',
        errorCode: 'DUPLICATE_USER',
      });
    }

    let hash = null;
    if (Contrasena && String(Contrasena).trim().length > 0) {
      if (!Contrasena_Actual || !await bcrypt.compare(String(Contrasena_Actual), current.Contrasena)) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'La contraseña actual no es correcta',
          errorCode: 'INVALID_CURRENT_PASSWORD',
        });
      }

      if (!isStrongPassword(Contrasena)) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'La nueva contraseña debe incluir mayúscula, minúscula, número, símbolo y mínimo 8 caracteres',
          errorCode: 'WEAK_PASSWORD',
        });
      }

      hash = await bcrypt.hash(String(Contrasena), 8);
    }

    let updateQuery = 'UPDATE usuarios SET Nombres_Apellidos = ?, Telefono_Usuario = ?, Correo = ?';
    const params = [
      String(Nombres_Apellidos).trim(),
      Telefono_Usuario ? String(Telefono_Usuario).trim() : null,
      String(Correo).trim(),
    ];

    if (hash) {
      updateQuery += ', Contrasena = ?';
      params.push(hash);
    }

    updateQuery += ' WHERE Id_Usuario = ?';
    params.push(userId);

    await conn.query(updateQuery, params);

    const detalles = [
      { columna: 'Nombres_Apellidos', anterior: current.Nombres_Apellidos, nuevo: String(Nombres_Apellidos).trim() },
      { columna: 'Telefono_Usuario', anterior: current.Telefono_Usuario, nuevo: Telefono_Usuario ? String(Telefono_Usuario).trim() : null },
      { columna: 'Correo', anterior: current.Correo, nuevo: String(Correo).trim() },
    ];

    if (hash) {
      detalles.push({ columna: 'Contrasena', anterior: '***', nuevo: 'ACTUALIZADA' });

      const [sessionRows] = await conn.query(
        'SELECT Token FROM sesiones WHERE Id_Usuario = ? AND Token <> ?',
        [userId, req.authToken]
      );
      closedSessionTokens = sessionRows.map((row) => row.Token).filter(Boolean);
      await conn.query(
        'DELETE FROM sesiones WHERE Id_Usuario = ? AND Token <> ?',
        [userId, req.authToken]
      );
      detalles.push({
        columna: 'Otras_Sesiones_Cerradas',
        anterior: closedSessionTokens.length,
        nuevo: 0,
      });
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: userId,
      accion: 'ACTUALIZAR_PERFIL',
      id_usuario: userId,
      detalles,
    });

    await conn.commit();

    if (closedSessionTokens.length > 0) {
      try {
        for (const token of closedSessionTokens) {
          wsManager.sendSessionLogout(token, 'password_changed');
        }
        await wsManager.broadcastActiveUsers();
      } catch (socketError) {
        console.error('actualizarMiPerfil websocket warning:', socketError);
      }
    }

    const [updatedRows] = await db.query(
      'SELECT Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Avatar FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
      [userId]
    );

    return sendSuccess(res, {
      data: updatedRows[0] || null,
      message: 'Perfil actualizado correctamente',
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('actualizarMiPerfil error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error actualizando perfil',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};

exports.actualizarUsuario = async (req, res) => {
  let conn;
  let shouldForceLogout = false;
  try {
    const { id } = req.params;
    const {
      Nombres_Apellidos,
      Telefono_Usuario,
      Usuario,
      Correo,
      Contrasena,
      Id_Rol,
      Activo,
      permisos,
      permisosEfectivos,
    } = req.body;

    if (!Nombres_Apellidos || !Usuario || !Correo) {
      return sendError(res, {
        status: 400,
        message: 'Datos incompletos',
        errorCode: 'MISSING_PARAMS',
      });
    }

    const usaPermisosEfectivos = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'permisosEfectivos'
    );
    const usaPermisosAdicionales = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'permisos'
    );
    const permisosEfectivosArray = usaPermisosEfectivos
      ? parsePermissionIds(permisosEfectivos)
      : null;
    const permisosAdicionalesArray = !usaPermisosEfectivos && usaPermisosAdicionales
      ? (parsePermissionIds(permisos) || [])
      : null;

    if (usaPermisosEfectivos && permisosEfectivosArray === null) {
      return sendError(res, {
        status: 400,
        message: 'La lista de permisos efectivos no es válida',
        errorCode: 'INVALID_PERMISSIONS',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [currentRows] = await conn.query(
      `SELECT u.Id_Usuario, u.Nombres_Apellidos, u.Usuario, u.Correo, u.Activo, u.Id_Rol, r.Nombre_Rol
       FROM usuarios u
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
       WHERE u.Id_Usuario = ?
       LIMIT 1`,
      [id]
    );

    if (!currentRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const current = currentRows[0];

    if (String(req.user?.id) === String(id) && Number(Activo) === 0) {
      await conn.rollback();
      return sendError(res, {
        status: 400,
        message: 'No puedes desactivar tu propio usuario',
        errorCode: 'SELF_DEACTIVATION_FORBIDDEN',
      });
    }

    const [targetRoleRows] = await conn.query(
      'SELECT Nombre_Rol FROM roles WHERE Id_Rol = ? AND Activo = 1 LIMIT 1',
      [Id_Rol]
    );
    if (!targetRoleRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 400,
        message: 'El rol seleccionado no está disponible',
        errorCode: 'INVALID_ROLE',
      });
    }

    let permisosBaseIds = [];
    if (usaPermisosEfectivos) {
      const [baseRows] = await conn.query(
        'SELECT Id_Permiso FROM rol_permisos WHERE Id_Rol = ?',
        [Id_Rol]
      );
      permisosBaseIds = baseRows.map((row) => Number(row.Id_Permiso));
    }

    const permisosSolicitados = usaPermisosEfectivos
      ? permisosEfectivosArray
      : permisosAdicionalesArray;

    if (Array.isArray(permisosSolicitados) && permisosSolicitados.length > 0) {
      const placeholders = permisosSolicitados.map(() => '?').join(', ');
      const [validPermissionRows] = await conn.query(
        `SELECT Id_Permiso FROM permisos WHERE Id_Permiso IN (${placeholders})`,
        permisosSolicitados
      );
      const validPermissionIds = new Set(
        validPermissionRows.map((row) => Number(row.Id_Permiso))
      );

      if (validPermissionIds.size !== permisosSolicitados.length) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'La lista contiene permisos que no existen',
          errorCode: 'INVALID_PERMISSIONS',
        });
      }
    }

    const currentIsAdmin = String(current.Nombre_Rol || '').trim().toLowerCase() === 'administrador';
    const targetIsAdmin = String(targetRoleRows[0].Nombre_Rol || '').trim().toLowerCase() === 'administrador';
    if (currentIsAdmin && (Number(Activo) === 0 || !targetIsAdmin)) {
      const [adminRows] = await conn.query(
        `SELECT COUNT(*) AS total
         FROM usuarios u
         INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
         WHERE u.Activo = 1
           AND u.Id_Usuario <> ?
           AND LOWER(TRIM(r.Nombre_Rol)) = 'administrador'`,
        [id]
      );
      if (Number(adminRows[0]?.total || 0) === 0) {
        await conn.rollback();
        return sendError(res, {
          status: 409,
          message: 'Debe permanecer al menos un usuario activo con rol Administrador',
          errorCode: 'LAST_ADMIN_FORBIDDEN',
        });
      }
    }

    const [exists] = await conn.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE (Usuario = ? OR Correo = ?) AND Id_Usuario != ?',
      [Usuario, Correo, id]
    );

    if (exists[0].total > 0) {
      await conn.rollback();
      return sendError(res, {
        status: 409,
        message: 'Usuario o correo ya existen en otro registro',
        errorCode: 'DUPLICATE_USER',
      });
    }

    let hash = null;
    if (Contrasena && Contrasena.trim().length > 0) {
      if (!isStrongPassword(Contrasena)) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'La contraseña debe incluir mayúscula, minúscula, número, símbolo y mínimo 8 caracteres',
          errorCode: 'WEAK_PASSWORD',
        });
      }
      hash = await bcrypt.hash(Contrasena, 8);
    }

    let updateQuery = 'UPDATE usuarios SET Nombres_Apellidos=?, Telefono_Usuario=?, Usuario=?, Correo=?, Id_Rol=?, Activo=?';
    const params = [
      Nombres_Apellidos,
      Telefono_Usuario || null,
      Usuario,
      Correo,
      Id_Rol || null,
      typeof Activo !== 'undefined' ? Activo : current.Activo,
    ];

    if (hash) {
      updateQuery += ', Contrasena=?';
      params.push(hash);
    }

    updateQuery += ' WHERE Id_Usuario=?';
    params.push(id);

    await conn.query(updateQuery, params);

    if (usaPermisosEfectivos) {
      const permisosBase = new Set(permisosBaseIds);
      const permisosSeleccionados = new Set(permisosEfectivosArray);
      const permissionOverrides = [
        ...permisosEfectivosArray
          .filter((permissionId) => !permisosBase.has(permissionId))
          .map((permissionId) => ({ id: permissionId, type: 'ALLOW' })),
        ...permisosBaseIds
          .filter((permissionId) => !permisosSeleccionados.has(permissionId))
          .map((permissionId) => ({ id: permissionId, type: 'DENY' })),
      ];

      await conn.query('DELETE FROM usuario_permisos WHERE Id_Usuario = ?', [id]);

      if (permissionOverrides.length > 0) {
        const now = new Date();
        const rows = permissionOverrides.map(({ id: permissionId, type }) => [
          id,
          permissionId,
          type,
          now,
        ]);
        await conn.query(
          'INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Tipo, Fecha_Asignacion) VALUES ?',
          [rows]
        );
      }
    } else if (Array.isArray(permisosAdicionalesArray)) {
      // El payload histórico representa únicamente permisos adicionales.
      // No debe borrar DENY creados a partir de una selección efectiva, pues
      // hacerlo devolvería silenciosamente permisos revocados del rol.
      await conn.query(
        "DELETE FROM usuario_permisos WHERE Id_Usuario = ? AND Tipo = 'ALLOW'",
        [id]
      );

      if (permisosAdicionalesArray.length > 0) {
        const rows = permisosAdicionalesArray.map((permissionId) => [
          id,
          permissionId,
          'ALLOW',
          new Date(),
        ]);
        await conn.query(
          'INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Tipo, Fecha_Asignacion) VALUES ?',
          [rows]
        );
      }
    }

    shouldForceLogout = !!hash || Number(Activo) === 0;
    if (shouldForceLogout) {
      await conn.query('DELETE FROM sesiones WHERE Id_Usuario = ?', [id]);
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: id,
      accion: 'ACTUALIZAR_USUARIO',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Nombres_Apellidos', anterior: current.Nombres_Apellidos, nuevo: Nombres_Apellidos },
        { columna: 'Usuario', anterior: current.Usuario, nuevo: Usuario },
        { columna: 'Correo', anterior: current.Correo, nuevo: Correo },
      ],
    });

    await conn.commit();

    if (shouldForceLogout) {
      try {
        wsManager.sendForceLogout(Number(id), hash ? 'password_changed_by_admin' : 'user_deactivated');
        await wsManager.broadcastActiveUsers();
      } catch (socketError) {
        console.error('actualizarUsuario websocket warning:', socketError);
      }
    }

    return sendSuccess(res, {
      data: null,
      message: 'Usuario actualizado correctamente',
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('actualizarUsuario error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error actualizando usuario',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};

exports.eliminarUsuario = async (req, res) => {
  let conn;
  let deactivatedUserId = null;
  try {
    const { id } = req.params;

    if (req.user && String(req.user.id) === String(id)) {
      return sendError(res, {
        status: 400,
        message: 'No puedes desactivar tu propio usuario.',
        errorCode: 'BAD_REQUEST',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [currentRows] = await conn.query(
      `SELECT u.Id_Usuario, u.Nombres_Apellidos, u.Activo, u.Id_Rol, r.Nombre_Rol
       FROM usuarios u
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
       WHERE u.Id_Usuario = ?
       LIMIT 1`,
      [id]
    );

    if (!currentRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const current = currentRows[0];

    const roleName = String(current.Nombre_Rol || '').trim().toLowerCase();

    if (Number(current.Activo) === 0) {
      await conn.rollback();
      return sendError(res, {
        status: 409,
        message: 'El usuario ya se encuentra desactivado',
        errorCode: 'USER_ALREADY_INACTIVE',
      });
    }

    if (roleName === 'administrador') {
      const [adminRows] = await conn.query(
        `SELECT COUNT(*) AS total
         FROM usuarios u
         INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
         WHERE u.Activo = 1
           AND u.Id_Usuario <> ?
           AND LOWER(TRIM(r.Nombre_Rol)) = 'administrador'`,
        [id]
      );

      if (Number(adminRows[0]?.total || 0) === 0) {
        await conn.rollback();
        return sendError(res, {
          status: 409,
          message: 'No puedes desactivar el ultimo usuario con rol Administrador.',
          errorCode: 'LAST_ADMIN_FORBIDDEN',
        });
      }
    }

    const [sessionRows] = await conn.query(
      'SELECT COUNT(*) AS total FROM sesiones WHERE Id_Usuario = ?',
      [id]
    );
    const totalSesionesCerradas = Number(sessionRows[0]?.total || 0);

    await conn.query('UPDATE usuarios SET Activo = 0 WHERE Id_Usuario = ?', [id]);
    await conn.query('DELETE FROM sesiones WHERE Id_Usuario = ?', [id]);

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: id,
      accion: 'ELIMINAR_USUARIO',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Activo', anterior: current.Activo, nuevo: 0 },
        { columna: 'Rol', anterior: current.Nombre_Rol || null, nuevo: current.Nombre_Rol || null },
        { columna: 'Sesiones_Cerradas', anterior: totalSesionesCerradas, nuevo: 0 },
      ],
    });

    await conn.commit();
    deactivatedUserId = Number(id);

    try {
      wsManager.sendForceLogout(deactivatedUserId, 'user_deactivated');
      await wsManager.broadcastActiveUsers();
    } catch (socketError) {
      console.error('eliminarUsuario websocket warning:', socketError);
    }

    return sendSuccess(res, {
      data: null,
      message: 'Usuario desactivado correctamente',
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('eliminarUsuario error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error desactivando usuario',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};

exports.crearUsuario = async (req, res) => {
  let conn;
  try {
    const {
      Id_Usuario,
      Nombres_Apellidos,
      Telefono_Usuario,
      Usuario,
      Correo,
      Contrasena,
      Id_Rol,
      Activo,
      Avatar,
      permisos,
      permisosEfectivos,
    } = req.body;

    if (!Id_Usuario || !Nombres_Apellidos || !Usuario || !Correo || !Contrasena) {
      return sendError(res, {
        status: 400,
        message: 'Datos incompletos',
        errorCode: 'MISSING_PARAMS',
      });
    }

    if (!isStrongPassword(Contrasena)) {
      return sendError(res, {
        status: 400,
        message: 'La contraseña debe incluir mayúscula, minúscula, número, símbolo y mínimo 8 caracteres',
        errorCode: 'WEAK_PASSWORD',
      });
    }

    const usaPermisosEfectivos = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'permisosEfectivos'
    );
    const permisosEfectivosArray = usaPermisosEfectivos
      ? parsePermissionIds(permisosEfectivos)
      : null;

    if (usaPermisosEfectivos && permisosEfectivosArray === null) {
      return sendError(res, {
        status: 400,
        message: 'La lista de permisos efectivos no es válida',
        errorCode: 'INVALID_PERMISSIONS',
      });
    }

    // Compatibilidad: el payload anterior envía solo permisos adicionales.
    // Conserva su comportamiento ALLOW y tolera una lista ausente o inválida
    // como lo hacía la implementación previa.
    const permisosAdicionalesArray = usaPermisosEfectivos
      ? null
      : (parsePermissionIds(permisos) || []);

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [exists] = await conn.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE Id_Usuario = ? OR Usuario = ? OR Correo = ?',
      [Id_Usuario, Usuario, Correo]
    );

    if (exists[0].total > 0) {
      await conn.rollback();
      return sendError(res, {
        status: 409,
        message: 'Id_Usuario, usuario o correo ya existen',
        errorCode: 'DUPLICATE_USER',
      });
    }

    let permisosBaseIds = [];
    if (Id_Rol) {
      const [roleRows] = await conn.query(
        'SELECT Id_Rol FROM roles WHERE Id_Rol = ? AND Activo = 1 LIMIT 1',
        [Id_Rol]
      );

      if (!roleRows.length) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'El rol seleccionado no está disponible',
          errorCode: 'INVALID_ROLE',
        });
      }

      const [baseRows] = await conn.query(
        'SELECT Id_Permiso FROM rol_permisos WHERE Id_Rol = ?',
        [Id_Rol]
      );
      permisosBaseIds = baseRows.map((row) => Number(row.Id_Permiso));
    }

    const permisosSolicitados = usaPermisosEfectivos
      ? permisosEfectivosArray
      : permisosAdicionalesArray;

    if (permisosSolicitados.length > 0) {
      const placeholders = permisosSolicitados.map(() => '?').join(', ');
      const [validPermissionRows] = await conn.query(
        `SELECT Id_Permiso FROM permisos WHERE Id_Permiso IN (${placeholders})`,
        permisosSolicitados
      );
      const validPermissionIds = new Set(
        validPermissionRows.map((row) => Number(row.Id_Permiso))
      );

      if (validPermissionIds.size !== permisosSolicitados.length) {
        await conn.rollback();
        return sendError(res, {
          status: 400,
          message: 'La lista contiene permisos que no existen',
          errorCode: 'INVALID_PERMISSIONS',
        });
      }
    }

    const hash = await bcrypt.hash(Contrasena, 8);

    let avatarPath = Avatar || null;
    if (req.file && req.file.filename) {
      avatarPath = `/uploads/usuarios/${req.file.filename}`;
    }

    await conn.query(
      'INSERT INTO usuarios (Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Id_Rol, Activo, Fecha_Creacion, Avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
      [
        Id_Usuario,
        Nombres_Apellidos,
        Telefono_Usuario || null,
        Usuario,
        Correo,
        hash,
        Id_Rol || null,
        typeof Activo !== 'undefined' ? Activo : 1,
        avatarPath,
      ]
    );

    let permissionOverrides;
    if (usaPermisosEfectivos) {
      const permisosBase = new Set(permisosBaseIds);
      const permisosSeleccionados = new Set(permisosEfectivosArray);

      permissionOverrides = [
        ...permisosEfectivosArray
          .filter((id) => !permisosBase.has(id))
          .map((id) => ({ id, type: 'ALLOW' })),
        ...permisosBaseIds
          .filter((id) => !permisosSeleccionados.has(id))
          .map((id) => ({ id, type: 'DENY' })),
      ];
    } else {
      permissionOverrides = permisosAdicionalesArray.map((id) => ({
        id,
        type: 'ALLOW',
      }));
    }

    if (permissionOverrides.length > 0) {
      const now = new Date();
      const rows = permissionOverrides.map(({ id, type }) => [
        Id_Usuario,
        id,
        type,
        now,
      ]);
      await conn.query(
        'INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Tipo, Fecha_Asignacion) VALUES ? ON DUPLICATE KEY UPDATE Tipo = VALUES(Tipo), Fecha_Asignacion = VALUES(Fecha_Asignacion)',
        [rows]
      );
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: Id_Usuario,
      accion: 'CREAR_USUARIO',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Id_Usuario', anterior: null, nuevo: Id_Usuario },
        { columna: 'Nombres_Apellidos', anterior: null, nuevo: Nombres_Apellidos },
        { columna: 'Usuario', anterior: null, nuevo: Usuario },
        { columna: 'Correo', anterior: null, nuevo: Correo },
        { columna: 'Id_Rol', anterior: null, nuevo: Id_Rol || null },
      ],
    });

    await conn.commit();

    return sendSuccess(res, {
      data: { id: Id_Usuario },
      message: 'Usuario creado correctamente',
      status: 201,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('crearUsuario error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error creando usuario',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};

/**
 * POST /api/perfil/foto
 * Subir foto de perfil del usuario autenticado
 * Body: FormData con file (en campo 'avatar')
 * IDOR Prevention: Id_Usuario extraído del token SOLAMENTE
 */
exports.subirFotoPerfil = async (req, res) => {
  let conn;
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, {
        status: 401,
        message: 'Usuario no autenticado',
        errorCode: 'UNAUTHENTICATED',
      });
    }

    if (!req.file) {
      return sendError(res, {
        status: 400,
        message: 'No se envió archivo',
        errorCode: 'MISSING_FILE',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Obtener foto actual
    const [currentRows] = await conn.query(
      'SELECT Avatar FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
      [userId]
    );

    if (!currentRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const currentAvatar = currentRows[0].Avatar;

    // URL de la foto nueva basada en la ruta REAL donde multer la guardó
    const relativeFilePath = path.relative(backendRoot, req.file.path).replace(/\\/g, '/');
    const newAvatarUrl = `/${relativeFilePath}`;

    // Actualizar BD
    await conn.query(
      'UPDATE usuarios SET Avatar = ? WHERE Id_Usuario = ?',
      [newAvatarUrl, userId]
    );

    // Log en historial
    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: userId,
      accion: 'ACTUALIZAR_AVATAR',
      id_usuario: userId,
      detalles: [
        { columna: 'Avatar', anterior: currentAvatar || 'NINGUNA', nuevo: newAvatarUrl },
      ],
    });

    await conn.commit();

    // Eliminar archivo anterior DESPUÉS de commitear (para no bloquear transacción)
    if (currentAvatar) {
      try {
        const oldFilePath = resolveAvatarAbsolutePath(currentAvatar);
        if (oldFilePath && fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      } catch (err) {
        console.warn('No se pudo eliminar archivo anterior:', err.message);
      }
    }

    return sendSuccess(res, {
      data: { Avatar: newAvatarUrl },
      message: 'Foto de perfil subida correctamente',
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('subirFotoPerfil error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error subiendo foto de perfil',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};

/**
 * DELETE /api/perfil/foto
 * Eliminar foto de perfil del usuario autenticado
 * IDOR Prevention: Id_Usuario extraído del token SOLAMENTE
 */
exports.eliminarFotoPerfil = async (req, res) => {
  let conn;
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, {
        status: 401,
        message: 'Usuario no autenticado',
        errorCode: 'UNAUTHENTICATED',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Obtener foto actual
    const [currentRows] = await conn.query(
      'SELECT Avatar FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
      [userId]
    );

    if (!currentRows.length) {
      await conn.rollback();
      return sendError(res, {
        status: 404,
        message: 'Usuario no encontrado',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    const currentAvatar = currentRows[0].Avatar;

    if (!currentAvatar) {
      await conn.rollback();
      return sendError(res, {
        status: 400,
        message: 'El usuario no tiene foto de perfil asignada',
        errorCode: 'NO_AVATAR',
      });
    }

    // Actualizar BD
    await conn.query(
      'UPDATE usuarios SET Avatar = NULL WHERE Id_Usuario = ?',
      [userId]
    );

    // Log en historial
    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: userId,
      accion: 'ELIMINAR_AVATAR',
      id_usuario: userId,
      detalles: [
        { columna: 'Avatar', anterior: currentAvatar, nuevo: 'ELIMINADA' },
      ],
    });

    await conn.commit();

    // Eliminar archivo físico DESPUÉS de commitear
    try {
      const filePath = resolveAvatarAbsolutePath(currentAvatar);
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('No se pudo eliminar archivo:', err.message);
    }

    return sendSuccess(res, {
      data: { Avatar: null },
      message: 'Foto de perfil eliminada',
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('eliminarFotoPerfil error:', err);
    return sendError(res, {
      status: 500,
      message: 'Error eliminando foto de perfil',
      errorCode: 'INTERNAL_ERROR',
    });
  } finally {
    if (conn) conn.release();
  }
};
