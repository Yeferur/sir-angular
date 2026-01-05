const db = require('../../database/db');

async function getHistorial(filters = {}) {
  const {
    usuario = '',
    tipoAccion = '',
    tablaAfectada = '',
    fechaInicio = '',
    fechaFin = '',
    search = '',
    page = 1,
    limit = 10
  } = filters;

  let query = `
    SELECT 
      h.Id_Historial,
      h.Id_Usuario,
      u.Nombres_Apellidos AS Usuario_Nombre,
      h.Accion AS Tipo_Accion,
      '' AS Descripcion,
      h.Tabla AS Tabla_Afectada,
      h.Id_Registro,
      h.Fecha_Hora_Registro AS Fecha_Accion,
      '' AS IP_Address,
      '' AS User_Agent
    FROM historial h
    LEFT JOIN usuarios u ON h.Id_Usuario = u.Id_Usuario
    WHERE 1=1
  `;

  const params = [];

  if (usuario) {
    query += ` AND u.Nombres_Apellidos LIKE ?`;
    params.push(`%${usuario}%`);
  }

  if (tipoAccion) {
    query += ` AND h.Accion = ?`;
    params.push(tipoAccion);
  }

  if (tablaAfectada) {
    query += ` AND h.Tabla = ?`;
    params.push(tablaAfectada);
  }

  if (fechaInicio) {
    query += ` AND DATE(h.Fecha_Hora_Registro) >= ?`;
    params.push(fechaInicio);
  }

  if (fechaFin) {
    query += ` AND DATE(h.Fecha_Hora_Registro) <= ?`;
    params.push(fechaFin);
  }

  if (search) {
    query += ` AND (
      u.Nombres_Apellidos LIKE ? OR
      h.Tabla LIKE ?
    )`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  // Contar total
  const countQuery = `SELECT COUNT(*) as total FROM (${query}) as filtered`;
  const [countResult] = await db.query(countQuery, params);
  const total = countResult[0]?.total || 0;

  // Paginar
  const offset = (page - 1) * limit;
  query += ` ORDER BY h.Fecha_Hora_Registro DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const [rows] = await db.query(query, params);

  return {
    data: rows,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / limit)
  };
}

// Registrar acción en historial
async function registrarAccion({
  userId,
  tipoAccion,
  descripcion,
  tablaAfectada,
  idRegistro = null,
  ipAddress = null,
  userAgent = null
}) {
  const query = `
    INSERT INTO historial (
      Id_Usuario,
      Accion,
      Tabla,
      Id_Registro,
      Fecha_Hora_Registro
    ) VALUES (?, ?, ?, ?, NOW())
  `;

  const params = [
    userId,
    tipoAccion,
    tablaAfectada,
    idRegistro
  ];

  await db.query(query, params);
}

// Exportar historial a CSV
async function exportarHistorial(filters = {}) {
  const result = await getHistorial({
    ...filters,
    limit: 10000
  });

  return result.data;
}

// Legacy function - Obtener historial por tabla e ID de registro
async function getHistorialByTableAndId(tabla, idRegistro) {
  const params = [tabla];
  let sql = `SELECT h.Id_Historial, h.Tabla, h.Id_Registro, h.Accion, h.Id_Usuario, h.Fecha_Hora_Registro, u.Usuario as Usuario_Nombre
    FROM historial h
    LEFT JOIN usuarios u ON h.Id_Usuario = u.Id_Usuario
    WHERE h.Tabla = ?`;

  if (idRegistro !== undefined && idRegistro !== null) {
    sql += ' AND h.Id_Registro = ?';
    params.push(idRegistro);
  }

  sql += ' ORDER BY h.Fecha_Hora_Registro DESC';

  const [rows] = await db.query(sql, params);

  if (!rows || rows.length === 0) return [];

  // fetch detalle_historial for the found ids
  const ids = rows.map((r) => r.Id_Historial);
  const [detalles] = await db.query(
    `SELECT Id_Historial, Columna, Valor_Anterior, Valor_Nuevo FROM detalle_historial WHERE Id_Historial IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  const detalleMap = {};
  for (const d of detalles || []) {
    detalleMap[d.Id_Historial] = detalleMap[d.Id_Historial] || [];
    detalleMap[d.Id_Historial].push({ columna: d.Columna, anterior: d.Valor_Anterior, nuevo: d.Valor_Nuevo });
  }

  return rows.map((r) => ({
    id: r.Id_Historial,
    tabla: r.Tabla,
    id_registro: r.Id_Registro,
    accion: r.Accion,
    usuario: r.Usuario_Nombre || null,
    fecha: r.Fecha_Hora_Registro,
    detalles: detalleMap[r.Id_Historial] || [],
  }));
}

module.exports = { 
  getHistorial,
  registrarAccion,
  exportarHistorial,
  getHistorialByTableAndId 
};
