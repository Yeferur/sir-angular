const sesionesService = require('../../services/Usuarios/usuarios.service');
const bcrypt = require('bcrypt');
const db = require('../../database/db');
const { recordHistorial } = require('../../services/Historial/logger');

exports.obtenerUsuariosYSesiones = async (req, res) => {
  try {
    const usuarios = await sesionesService.getAllUsers();
    const sesiones = await sesionesService.getActiveSessions();

    res.json({
      usuarios,
      sesiones
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando usuarios y sesiones' });
  }
};

// Obtener usuario por ID
exports.obtenerUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await sesionesService.getUserById(id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo usuario' });
  }
};

// Actualizar usuario
exports.actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params; // ID de la URL
    const { Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Id_Rol, Activo, permisos } = req.body;

    if (!Nombres_Apellidos || !Usuario || !Correo) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Verificar si el usuario existe
    const current = await sesionesService.getUserById(id);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Verificar unicidad de Usuario y Correo (excluyendo el actual)
    const [exists] = await db.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE (Usuario = ? OR Correo = ?) AND Id_Usuario != ?',
      [Usuario, Correo, id]
    );

    if (exists[0].total > 0) {
      return res.status(409).json({ error: 'Usuario o correo ya existen en otro registro' });
    }

    // Preparar update
    let hash = null;
    if (Contrasena && Contrasena.trim().length > 0) {
      const saltRounds = 8;
      hash = await bcrypt.hash(Contrasena, saltRounds);
    }

    // Obtener nombre del rol (Opcional, ya no se guarda en tabla usuarios pero sirve para lógica si se necesita)
    // let RolName = null;
    // if (Id_Rol) {
    //   const [r] = await db.query('SELECT Nombre_Rol FROM roles WHERE Id_Rol = ?', [Id_Rol]);
    //   if (r && r[0]) RolName = r[0].Nombre_Rol;
    // }

    // Query dinámica
    let updateQuery = 'UPDATE usuarios SET Nombres_Apellidos=?, Telefono_Usuario=?, Usuario=?, Correo=?, Id_Rol=?, Activo=?';
    const params = [Nombres_Apellidos, Telefono_Usuario || null, Usuario, Correo, Id_Rol || null, (typeof Activo !== 'undefined' ? Activo : 1)];

    if (hash) {
      updateQuery += ', Contrasena=?';
      params.push(hash);
    }

    updateQuery += ' WHERE Id_Usuario=?';
    params.push(id);

    await db.query(updateQuery, params);

    // Actualizar permisos (borrar y reinsertar)
    let permisosArray = permisos;
    if (typeof permisos === 'string') {
      try { permisosArray = JSON.parse(permisos); } catch (e) { permisosArray = []; }
    }

    if (Array.isArray(permisosArray)) {
      // Primero borrar los existentes
      await db.query('DELETE FROM usuario_permisos WHERE Id_Usuario = ?', [id]);

      // Insertar nuevos si hay
      if (permisosArray.length > 0) {
        const insertPerm = `INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Fecha_Asignacion) VALUES ?`;
        const rows = permisosArray.map(p => [id, p, new Date()]);
        await db.query(insertPerm, [rows]);
      }
    }

    // Historial
    await recordHistorial({
      tabla: 'usuarios',
      id_registro: id,
      accion: 'ACTUALIZAR',
      id_usuario: req.user?.id || null,
      detalles: [
        { columna: 'Nombres_Apellidos', anterior: current.Nombres_Apellidos, nuevo: Nombres_Apellidos },
        // Podríamos loguear más campos si se desea
      ]
    });

    res.json({ message: 'Usuario actualizado correctamente' });

  } catch (err) {
    console.error('actualizarUsuario error:', err);
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
};

// Eliminar usuario
exports.eliminarUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar auto-eliminación
    if (req.user && req.user.id === id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
    }

    const current = await sesionesService.getUserById(id);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    try {
      await sesionesService.deleteUser(id);

      // Historial
      await recordHistorial({
        tabla: 'usuarios',
        id_registro: id,
        accion: 'ELIMINAR',
        id_usuario: req.user?.id || null,
        detalles: [
          { columna: 'Id_Usuario', anterior: id, nuevo: null }
        ]
      });

      res.json({ message: 'Usuario eliminado correctamente' });
    } catch (dbErr) {
      if (dbErr.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ error: 'No se puede eliminar: El usuario tiene registros asociados (Reservas, Historial, etc.). Considere desactivarlo.' });
      }
      throw dbErr;
    }

  } catch (err) {
    console.error('eliminarUsuario error:', err);
    res.status(500).json({ error: 'Error eliminando usuario' });
  }
};

// Crear nuevo usuario
exports.crearUsuario = async (req, res) => {
  try {
    const { Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Id_Rol, Activo, Avatar, permisos } = req.body;

    if (!Id_Usuario || !Nombres_Apellidos || !Usuario || !Correo || !Contrasena) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Verificar unicidad de Id_Usuario (DNI), Usuario y Correo
    const [exists] = await db.query('SELECT COUNT(*) as total FROM usuarios WHERE Id_Usuario = ? OR Usuario = ? OR Correo = ?', [Id_Usuario, Usuario, Correo]);
    if (exists[0].total > 0) {
      return res.status(409).json({ error: 'Id_Usuario, usuario o correo ya existen' });
    }

    // Hash password
    const saltRounds = 8;
    const hash = await bcrypt.hash(Contrasena, saltRounds);

    // Obtener nombre del rol (Opcional, ya no se guarda en tabla usuarios pero sirve para lógica si se necesita)
    // let RolName = null;
    // if (Id_Rol) {
    //   const [r] = await db.query('SELECT Nombre_Rol FROM roles WHERE Id_Rol = ?', [Id_Rol]);
    //   if (r && r[0]) RolName = r[0].Nombre_Rol;
    // }

    // If a file was uploaded via multer, prefer that path
    let avatarPath = Avatar || null;
    if (req.file && req.file.filename) {
      // Save the relative path to the uploaded file
      avatarPath = `/uploads/usuarios/${req.file.filename}`;
    }

    // Insertar usuario usando Id_Usuario provisto (DNI)
    const insertQuery = `INSERT INTO usuarios (Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Id_Rol, Activo, Fecha_Creacion, Avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`;
    const params = [Id_Usuario, Nombres_Apellidos, Telefono_Usuario || null, Usuario, Correo, hash, Id_Rol || null, (typeof Activo !== 'undefined' ? Activo : 1), avatarPath];

    await db.query(insertQuery, params);

    // Si vienen permisos explícitos, intentar almacenarlos en usuario_permisos si la tabla existe
    let permisosArray = permisos;
    if (typeof permisos === 'string') {
      try { permisosArray = JSON.parse(permisos); } catch (e) { permisosArray = []; }
    }

    if (Array.isArray(permisosArray) && permisosArray.length > 0) {
      try {
        const [tbl] = await db.query("SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'usuario_permisos'");
        if (tbl[0].cnt > 0) {
          // Insertar permisos para el usuario (ignorar duplicados)
          const insertPerm = `INSERT INTO usuario_permisos (Id_Usuario, Id_Permiso, Fecha_Asignacion) VALUES ? ON DUPLICATE KEY UPDATE Id_Usuario=Id_Usuario`;
          const rows = permisosArray.map(p => [Id_Usuario, p, new Date()]);
          await db.query(insertPerm, [rows]);
        }
      } catch (permErr) {
        console.error('Error guardando permisos de usuario (ignorado):', permErr);
      }
    }

    // Registrar en historial (usamos el Id_Usuario como id_registro)
    try {
      await recordHistorial({
        tabla: 'usuarios', id_registro: Id_Usuario, accion: 'CREAR', id_usuario: req.user?.id || null, detalles: [
          { columna: 'Id_Usuario', anterior: null, nuevo: Id_Usuario },
          { columna: 'Nombres_Apellidos', anterior: null, nuevo: Nombres_Apellidos },
          { columna: 'Usuario', anterior: null, nuevo: Usuario },
          { columna: 'Correo', anterior: null, nuevo: Correo },
          { columna: 'Id_Rol', anterior: null, nuevo: Id_Rol || null }
        ]
      });
    } catch (histErr) {
      console.error('Error registrando historial al crear usuario:', histErr);
    }

    res.status(201).json({ message: 'Usuario creado', id: Id_Usuario });
  } catch (err) {
    console.error('crearUsuario error:', err);
    res.status(500).json({ error: 'Error creando usuario' });
  }
};
