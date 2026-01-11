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

    // Obtener nombre del rol si se pasa Id_Rol
    let RolName = null;
    if (Id_Rol) {
      const [r] = await db.query('SELECT Nombre_Rol FROM roles WHERE Id_Rol = ?', [Id_Rol]);
      if (r && r[0]) RolName = r[0].Nombre_Rol;
    }

    // If a file was uploaded via multer, prefer that path
    let avatarPath = Avatar || null;
    if (req.file && req.file.filename) {
      // Save the relative path to the uploaded file
      avatarPath = `/uploads/usuarios/${req.file.filename}`;
    }

    // Insertar usuario usando Id_Usuario provisto (DNI)
    const insertQuery = `INSERT INTO usuarios (Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Rol, Id_Rol, Activo, Fecha_Creacion, Avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`;
    const params = [Id_Usuario, Nombres_Apellidos, Telefono_Usuario || null, Usuario, Correo, hash, RolName, Id_Rol || null, (typeof Activo !== 'undefined' ? Activo : 1), avatarPath];

    await db.query(insertQuery, params);

    // Si vienen permisos explícitos, intentar almacenarlos en permisos_usuarios si la tabla existe
    let permisosArray = permisos;
    if (typeof permisos === 'string') {
      try { permisosArray = JSON.parse(permisos); } catch (e) { permisosArray = []; }
    }

    if (Array.isArray(permisosArray) && permisosArray.length > 0) {
      try {
        const [tbl] = await db.query("SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'permisos_usuarios'");
        if (tbl[0].cnt > 0) {
          // Insertar permisos para el usuario (ignorar duplicados)
          const insertPerm = `INSERT INTO permisos_usuarios (Id_Usuario, Id_Permiso, Fecha_Asignacion) VALUES ? ON DUPLICATE KEY UPDATE Id_Usuario=Id_Usuario`;
          const rows = permisosArray.map(p => [Id_Usuario, p, new Date()]);
          await db.query(insertPerm, [rows]);
        }
      } catch (permErr) {
        console.error('Error guardando permisos de usuario (ignorado):', permErr);
      }
    }

    // Registrar en historial (usamos el Id_Usuario como id_registro)
    try {
      await recordHistorial({ tabla: 'usuarios', id_registro: Id_Usuario, accion: 'CREAR', id_usuario: req.user?.id || null, detalles: [
        { columna: 'Id_Usuario', anterior: null, nuevo: Id_Usuario },
        { columna: 'Nombres_Apellidos', anterior: null, nuevo: Nombres_Apellidos },
        { columna: 'Usuario', anterior: null, nuevo: Usuario },
        { columna: 'Correo', anterior: null, nuevo: Correo },
        { columna: 'Id_Rol', anterior: null, nuevo: Id_Rol || null }
      ] });
    } catch (histErr) {
      console.error('Error registrando historial al crear usuario:', histErr);
    }

    res.status(201).json({ message: 'Usuario creado', id: Id_Usuario });
  } catch (err) {
    console.error('crearUsuario error:', err);
    res.status(500).json({ error: 'Error creando usuario' });
  }
};
