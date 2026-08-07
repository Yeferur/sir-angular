const db = require('../../database/db');
const { CLIENT_RESERVATION_PERMISSION_CODES, isClientRoleName } = require('../../utils/clientAccess');

/**
 * Obtiene todos los usuarios
 */
async function getAllUsers() {
  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario,
       u.Usuario,
       u.Nombres_Apellidos,
       u.Correo,
       u.Activo,
       r.Nombre_Rol
     FROM usuarios u
     LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
     ORDER BY u.Activo DESC, u.Nombres_Apellidos ASC, u.Id_Usuario ASC`
  );

  // Map DB columns to frontend expected shape
  return rows.map((r) => ({
    id_user: String(r.Id_Usuario),
    username: r.Usuario || '',
    name: String(r.Nombres_Apellidos || ''),
    apellidos: '',
    email: r.Correo || '',
    activo: Number(r.Activo) === 1,
    rol: r.Nombre_Rol || 'Sin rol',
  }));
}

/**
 * Obtiene todas las sesiones activas
 */
async function getActiveSessions() {
  const [rows] = await db.query('SELECT Id_Usuario FROM sesiones');
  // return minimal shape expected by frontend: { id_user }
  return rows.map((r) => ({ id_user: String(r.Id_Usuario) }));
}

/**
 * Obtiene un usuario por ID (para edición)
 */
async function getUserById(id) {
  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario,
       u.Usuario,
       u.Nombres_Apellidos,
       u.Correo,
       u.Telefono_Usuario,
       u.Id_Rol,
       u.Activo,
       r.Nombre_Rol
     FROM usuarios u
     LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
     WHERE u.Id_Usuario = ?`,
    [id]
  );

  if (!rows.length) return null;

  const u = rows[0];

  if (isClientRoleName(u.Nombre_Rol)) {
    const [fixedPermissions] = await db.query(
      `SELECT Id_Permiso, Descripcion, Modulo_Permiso
         FROM permisos
        WHERE Codigo_Permiso IN (?)
        ORDER BY Modulo_Permiso, Descripcion`,
      [CLIENT_RESERVATION_PERMISSION_CODES]
    );

    return {
      Id_Usuario: u.Id_Usuario,
      Usuario: u.Usuario,
      Nombres_Apellidos: u.Nombres_Apellidos,
      Correo: u.Correo,
      Telefono_Usuario: u.Telefono_Usuario,
      Id_Rol: u.Id_Rol,
      Nombre_Rol: u.Nombre_Rol,
      Activo: u.Activo,
      permisos: [],
      permisosEfectivos: fixedPermissions || [],
    };
  }

  // Permisos individuales: se conservan separados porque los formularios de
  // edición solo deben persistir las asignaciones que no provienen del rol.
  const [permisos] = await db.query(
    `SELECT p.Id_Permiso
     FROM usuario_permisos up
     INNER JOIN permisos p ON p.Id_Permiso = up.Id_Permiso
     WHERE up.Id_Usuario = ?
       AND up.Tipo = 'ALLOW'
     ORDER BY p.Descripcion`,
    [id]
  );

  // Acceso efectivo: unión de los permisos base del rol y los asignados
  // directamente al usuario. El detalle lateral usa esta vista completa.
  const [permisosEfectivos] = await db.query(
    `SELECT DISTINCT
       p.Id_Permiso,
       p.Descripcion,
       p.Modulo_Permiso
     FROM usuarios u
     INNER JOIN permisos p
     LEFT JOIN roles rol_activo
       ON rol_activo.Id_Rol = u.Id_Rol
      AND rol_activo.Activo = 1
     LEFT JOIN rol_permisos rp
       ON rp.Id_Rol = rol_activo.Id_Rol
      AND rp.Id_Permiso = p.Id_Permiso
     LEFT JOIN usuario_permisos up
       ON up.Id_Usuario = u.Id_Usuario
      AND up.Id_Permiso = p.Id_Permiso
     WHERE u.Id_Usuario = ?
       AND COALESCE(up.Tipo, '') <> 'DENY'
       AND (rp.Id_Permiso IS NOT NULL OR up.Tipo = 'ALLOW')
     ORDER BY p.Modulo_Permiso, p.Descripcion`,
    [id]
  );

  return {
    Id_Usuario: u.Id_Usuario,
    Usuario: u.Usuario,
    Nombres_Apellidos: u.Nombres_Apellidos,
    Correo: u.Correo,
    Telefono_Usuario: u.Telefono_Usuario,
    Id_Rol: u.Id_Rol,
    Nombre_Rol: u.Nombre_Rol || 'Sin rol',
    Activo: u.Activo,
    permisos,
    permisosEfectivos,
  };
}

/**
 * Obtener solo el Avatar de un usuario
 */
async function getAvatarByUserId(userId) {
  const [rows] = await db.query(
    'SELECT Avatar FROM usuarios WHERE Id_Usuario = ?',
    [userId]
  );
  return rows.length > 0 ? rows[0].Avatar : null;
}

module.exports = {
  getAllUsers,
  getActiveSessions,
  getUserById,
  getAvatarByUserId,
};

