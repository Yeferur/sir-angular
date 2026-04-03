const sesionesService = require('../../services/Usuarios/usuarios.service');
const bcrypt = require('bcrypt');
const db = require('../../database/db');
const { recordHistorial } = require('../../services/Historial/logger');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

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

exports.actualizarUsuario = async (req, res) => {
  let conn;
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
    } = req.body;

    if (!Nombres_Apellidos || !Usuario || !Correo) {
      return sendError(res, {
        status: 400,
        message: 'Datos incompletos',
        errorCode: 'MISSING_PARAMS',
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [currentRows] = await conn.query(
      'SELECT Id_Usuario, Nombres_Apellidos, Usuario, Correo, Activo FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
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

    let permisosArray = permisos;
    if (typeof permisos === 'string') {
      try {
        permisosArray = JSON.parse(permisos);
      } catch (_err) {
        permisosArray = [];
      }
    }

    if (Array.isArray(permisosArray)) {
      await conn.query('DELETE FROM usuario_permisos WHERE Id_Usuario = ?', [id]);

      if (permisosArray.length > 0) {
        const rows = permisosArray.map((p) => [id, p, 'ALLOW', new Date()]);
        await conn.query(
          'INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Tipo, Fecha_Asignacion) VALUES ?',
          [rows]
        );
      }
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: id,
      accion: 'ACTUALIZAR',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Nombres_Apellidos', anterior: current.Nombres_Apellidos, nuevo: Nombres_Apellidos },
        { columna: 'Usuario', anterior: current.Usuario, nuevo: Usuario },
        { columna: 'Correo', anterior: current.Correo, nuevo: Correo },
      ],
    });

    await conn.commit();

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
      'SELECT Id_Usuario, Nombres_Apellidos, Activo FROM usuarios WHERE Id_Usuario = ? LIMIT 1',
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

    if (Number(current.Activo) === 0) {
      await conn.rollback();
      return sendError(res, {
        status: 409,
        message: 'El usuario ya se encuentra desactivado',
        errorCode: 'USER_ALREADY_INACTIVE',
      });
    }

    await conn.query('UPDATE usuarios SET Activo = 0 WHERE Id_Usuario = ?', [id]);
    await conn.query('DELETE FROM sesiones WHERE Id_Usuario = ?', [id]);

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: id,
      accion: 'SOFT_DELETE',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Activo', anterior: current.Activo, nuevo: 0 },
      ],
    });

    await conn.commit();

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
    } = req.body;

    if (!Id_Usuario || !Nombres_Apellidos || !Usuario || !Correo || !Contrasena) {
      return sendError(res, {
        status: 400,
        message: 'Datos incompletos',
        errorCode: 'MISSING_PARAMS',
      });
    }

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

    let permisosArray = permisos;
    if (typeof permisos === 'string') {
      try {
        permisosArray = JSON.parse(permisos);
      } catch (_err) {
        permisosArray = [];
      }
    }

    if (Array.isArray(permisosArray) && permisosArray.length > 0) {
      const rows = permisosArray.map((p) => [Id_Usuario, p, 'ALLOW', new Date()]);
      await conn.query(
        'INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Tipo, Fecha_Asignacion) VALUES ? ON DUPLICATE KEY UPDATE Tipo = VALUES(Tipo), Fecha_Asignacion = VALUES(Fecha_Asignacion)',
        [rows]
      );
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'usuarios',
      id_registro: Id_Usuario,
      accion: 'CREAR',
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
