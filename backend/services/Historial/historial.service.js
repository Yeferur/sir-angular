const db = require('../../database/db');
const { MODULOS_HISTORIAL, ACCIONES_CONOCIDAS, etiquetaAccion, moduloDeTabla } = require('./catalogos');

const SECRET_FIELD = /pass(word|wd)?|contrasena|clave|token|credencial|secret|cookie|authorization|autorizacion|session|sesion|correo|email|telefono|phone|api.?key|usuario|user(name)?|login|documento|identificacion|cedula/i;
const SECRET_VALUE = /\bBearer\s+[^\s,;]+|\b(token|api[_-]?key|password|passwd|secret|credential)\s*[:=]\s*[^\s,;]+/i;
const TOKEN_VALUE = /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b|\b[A-Za-z0-9_-]{64,}\b/;
const TABLES_MAPPED = [...new Set(MODULOS_HISTORIAL.flatMap((module) => module.tablas))];

function list(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(',');
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function parseDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? date : null;
}

function sanitizeValue(value) {
  if (value == null) return null;
  const text = String(value);
  if (SECRET_VALUE.test(text) || TOKEN_VALUE.test(text)) return '[Oculto]';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const scrub = (item) => {
        if (Array.isArray(item)) return item.map(scrub);
        if (!item || typeof item !== 'object') return item;
        return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, SECRET_FIELD.test(key) ? '[Oculto]' : scrub(nested)]));
      };
      return JSON.stringify(scrub(parsed)).slice(0, 3000);
    }
  } catch { /* Plain text details continue below. */ }
  if (text.length > 3000) return `${text.slice(0, 3000)}…`;
  return text;
}

function visibleDetails(rows) {
  return (rows || []).filter((row) => !SECRET_FIELD.test(String(row.Columna || '')))
    .map((row) => ({ columna: row.Columna, anterior: sanitizeValue(row.Valor_Anterior), nuevo: sanitizeValue(row.Valor_Nuevo) }));
}

function normalizarReferencia(value) {
  const referencia = String(value || '').trim().toUpperCase();
  if (!referencia) return '';
  if (/^[A-Z]{2,4}\d{5}$/.test(referencia) || /^TRS\d{5}$/.test(referencia)) return referencia;
  throw new Error('referencia debe ser un código válido de reserva o transfer');
}

function buildWhere(filters = {}) {
  const params = [];
  const conditions = [];
  const userIds = list(filters.usuarios ?? filters.usuario);
  const actions = list(filters.acciones ?? filters.tipoAccion);
  const modules = list(filters.modulos ?? filters.modulo);
  const referencia = normalizarReferencia(filters.referencia);
  const from = filters.fechaInicio ? parseDate(filters.fechaInicio) : null;
  const to = filters.fechaFin ? parseDate(filters.fechaFin) : null;
  if (filters.fechaInicio && !from) throw new Error('fechaInicio debe ser una fecha calendario válida (YYYY-MM-DD)');
  if (filters.fechaFin && !to) throw new Error('fechaFin debe ser una fecha calendario válida (YYYY-MM-DD)');
  if ((!from || !to) && !referencia) throw new Error('El período debe incluir fecha de inicio y fin');
  if (Boolean(from) !== Boolean(to)) throw new Error('El período debe incluir fecha de inicio y fin');
  if (from && to && from > to) throw new Error('fechaInicio no puede ser posterior a fechaFin');

  if (userIds.length) {
    const ids = userIds.map((value) => Number(value));
    if (ids.some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('usuarios debe contener identificadores válidos');
    conditions.push(`h.Id_Usuario IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (actions.length) {
    conditions.push(`h.Accion IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions);
  }
  if (modules.length) {
    const selected = new Set(modules);
    const known = new Set(MODULOS_HISTORIAL.map((module) => module.value));
    if ([...selected].some((value) => !known.has(value))) throw new Error('módulo no reconocido');
    const tables = [...new Set(MODULOS_HISTORIAL.filter((module) => selected.has(module.value)).flatMap((module) => module.tablas))];
    const wantsOther = selected.has('otros');
    const otherCondition = wantsOther
      ? `h.Tabla NOT IN (${TABLES_MAPPED.map(() => '?').join(',')})`
      : '';
    const tableCondition = tables.length ? `h.Tabla IN (${tables.map(() => '?').join(',')})` : '';
    conditions.push([tableCondition, otherCondition].filter(Boolean).map((value) => `(${value})`).join(' OR '));
    params.push(...tables, ...(wantsOther ? TABLES_MAPPED : []));
  }
  if (referencia) {
    const transferId = /^(?:TRC|TRS)\d{5}$/.test(referencia) ? referencia.replace(/^(?:TRC|TRS)/, '') : null;
    conditions.push(`(
      (h.Tabla = 'reservas' AND h.Id_Registro = ?)
      OR (h.Tabla = 'transfers' AND h.Id_Registro = ?)
      OR (h.Tabla = 'pasajeros' AND EXISTS (
        SELECT 1 FROM pasajeros p WHERE p.Id_Pasajero = h.Id_Registro AND p.Id_Reserva = ?
      ))
      OR (h.Tabla = 'pagos_reservas' AND EXISTS (
        SELECT 1 FROM pagos_reservas pr WHERE pr.Id_Pago = h.Id_Registro AND pr.Id_Reserva = ?
      ))
      OR (h.Tabla = 'pagos_transfers' AND EXISTS (
        SELECT 1 FROM pagos_transfers pt WHERE pt.Id_Pago = h.Id_Registro AND pt.Id_Transfer = ?
      ))
      OR (h.Tabla = 'programacion' AND h.Id_Registro LIKE CONCAT('%|', ?))
    )`);
    params.push(referencia, transferId, referencia, referencia, transferId === null ? null : Number(transferId), referencia);
  }
  if (from) { conditions.push('h.Fecha_Hora_Registro >= ?'); params.push(`${from} 00:00:00`); }
  if (to) { conditions.push('h.Fecha_Hora_Registro < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

async function getFilterOptions() {
  const [[users], [tables], [actions]] = await Promise.all([
    db.query(`SELECT catalog.id, catalog.label FROM (
      SELECT u.Id_Usuario AS id,
        CONCAT(COALESCE(NULLIF(u.Nombres_Apellidos, ''), NULLIF(u.Usuario, ''), CONCAT('Usuario #', u.Id_Usuario)),
          IF(u.Activo = 0, ' (inactivo)', '')) AS label
      FROM usuarios u
      UNION ALL
      SELECT h.Id_Usuario AS id,
        COALESCE(MAX(NULLIF(h.Actor_Nombre, '')), CONCAT('Usuario #', h.Id_Usuario)) AS label
      FROM historial h LEFT JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
      WHERE h.Id_Usuario IS NOT NULL AND u.Id_Usuario IS NULL
      GROUP BY h.Id_Usuario
    ) catalog ORDER BY catalog.label`),
    db.query('SELECT DISTINCT Tabla AS tabla FROM historial WHERE Tabla IS NOT NULL AND Tabla <> \'\' ORDER BY Tabla'),
    db.query('SELECT DISTINCT Accion AS accion FROM historial WHERE Accion IS NOT NULL AND Accion <> \'\' ORDER BY Accion'),
  ]);
  const usedTables = new Set((tables || []).map((row) => row.tabla));
  const modules = MODULOS_HISTORIAL.map((module) => ({
    value: module.value,
    label: module.label,
    tables: module.value === 'otros' ? [...usedTables].filter((table) => !TABLES_MAPPED.includes(table)) : module.tablas.filter((table) => usedTables.has(table)),
  })).filter((module) => module.value !== 'otros' || module.tables.length > 0);
  const actionValues = [...new Set([...ACCIONES_CONOCIDAS, ...(actions || []).map((row) => row.accion)])].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    usuarios: (users || []).map((user) => ({ id: Number(user.id), label: user.label || `Usuario #${user.id}` })),
    acciones: actionValues.map((value) => ({ value, label: etiquetaAccion(value) })),
    modulos: modules.map(({ value, label }) => ({ value, label })),
  };
}

async function getHistorial(filters = {}) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(filters.limit, 10) || 10));
  const where = buildWhere(filters);
  const base = `FROM historial h LEFT JOIN usuarios u ON h.Id_Usuario = u.Id_Usuario ${where.sql}`;
  const [countRows] = await db.query(`SELECT COUNT(*) AS total ${base}`, where.params);
  const total = Number(countRows?.[0]?.total || 0);
  const offset = (page - 1) * limit;
  const [rows] = await db.query(`SELECT h.Id_Historial, h.Id_Usuario,
    COALESCE(NULLIF(h.Actor_Nombre, ''), NULLIF(u.Nombres_Apellidos, ''), NULLIF(u.Usuario, ''),
      IF(h.Id_Usuario IS NULL, 'Sistema', CONCAT('Usuario #', h.Id_Usuario))) AS Usuario_Nombre,
    h.Actor_Nombre, h.Actor_Rol, h.Accion AS Tipo_Accion, h.Tabla AS Tabla_Afectada,
    h.Id_Registro, DATE_FORMAT(h.Fecha_Hora_Registro, '%Y-%m-%d %H:%i:%s') AS Fecha_Accion
    ${base} ORDER BY h.Fecha_Hora_Registro DESC, h.Id_Historial DESC LIMIT ? OFFSET ?`, [...where.params, limit, offset]);
  const ids = (rows || []).map((row) => row.Id_Historial);
  let details = [];
  if (ids.length) {
    [details] = await db.query(`SELECT Id_Historial, Columna, Valor_Anterior, Valor_Nuevo
      FROM detalle_historial WHERE Id_Historial IN (${ids.map(() => '?').join(',')})
      ORDER BY Id_Historial ASC, Id_Detalle ASC`, ids);
  }
  const grouped = new Map();
  for (const detail of details || []) {
    if (SECRET_FIELD.test(String(detail.Columna || ''))) continue;
    const key = Number(detail.Id_Historial);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ columna: detail.Columna, anterior: sanitizeValue(detail.Valor_Anterior), nuevo: sanitizeValue(detail.Valor_Nuevo) });
  }
  const data = (rows || []).map((row) => {
    const detail = grouped.get(Number(row.Id_Historial)) || [];
    const module = moduloDeTabla(row.Tabla_Afectada);
    const summary = detail.length
      ? detail.map((item) => `${item.columna}: ${item.anterior || 'vacío'} → ${item.nuevo || 'vacío'}`).join('; ')
      : `${etiquetaAccion(row.Tipo_Accion)} en ${module.label}`;
    // In this schema user IDs can be government identifiers; the actor name is
    // enough context for user/session events, so keep those IDs out of API/Excel.
    return { ...row, Id_Registro: module.value === 'usuarios' ? null : row.Id_Registro,
      Modulo: module.label, Descripcion: summary, Detalles: detail };
  });
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function exportarHistorial(filters = {}) {
  const pageSize = 100;
  const first = await getHistorial({ ...filters, page: 1, limit: pageSize });
  const data = [...first.data];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await getHistorial({ ...filters, page, limit: pageSize });
    data.push(...next.data);
  }
  return data;
}

async function registrarAccion({ userId, tipoAccion, descripcion, tablaAfectada, idRegistro = null }) {
  let finalAccion = tipoAccion;
  if (tipoAccion === 'CREAR_O_ACTUALIZAR') {
    finalAccion = !idRegistro || idRegistro === 0 ? 'CREAR' : 'ACTUALIZAR';
  }
  const { recordHistorial } = require('./logger');
  await recordHistorial({ tabla: tablaAfectada, id_registro: idRegistro, accion: finalAccion, id_usuario: userId,
    detalles: descripcion ? [{ columna: 'Descripcion', anterior: null, nuevo: descripcion }] : [] });
}

async function getHistorialByTableAndId(tabla, idRegistro) {
  const params = [tabla];
  let sql = `SELECT h.Id_Historial, h.Tabla, h.Id_Registro, h.Accion, h.Id_Usuario,
    COALESCE(NULLIF(h.Actor_Nombre, ''), u.Nombres_Apellidos, u.Usuario) AS Usuario_Nombre,
    h.Actor_Nombre, h.Actor_Rol, h.Fecha_Hora_Registro FROM historial h
    LEFT JOIN usuarios u ON h.Id_Usuario = u.Id_Usuario WHERE h.Tabla = ?`;
  if (idRegistro !== undefined && idRegistro !== null) { sql += ' AND h.Id_Registro = ?'; params.push(idRegistro); }
  sql += ' ORDER BY h.Fecha_Hora_Registro DESC';
  const [rows] = await db.query(sql, params);
  if (!rows?.length) return [];
  const ids = rows.map((row) => row.Id_Historial);
  const [details] = await db.query(`SELECT Id_Historial, Columna, Valor_Anterior, Valor_Nuevo FROM detalle_historial WHERE Id_Historial IN (${ids.map(() => '?').join(',')})`, ids);
  const grouped = new Map();
  for (const item of details || []) {
    if (SECRET_FIELD.test(String(item.Columna || ''))) continue;
    const key = Number(item.Id_Historial);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ columna: item.Columna, anterior: sanitizeValue(item.Valor_Anterior), nuevo: sanitizeValue(item.Valor_Nuevo) });
  }
  return rows.map((row) => ({ id: row.Id_Historial, tabla: row.Tabla, id_registro: row.Id_Registro,
    accion: row.Accion, usuario: row.Usuario_Nombre || row.Actor_Nombre || null, actor_nombre: row.Actor_Nombre || null,
    actor_rol: row.Actor_Rol || null, fecha: row.Fecha_Hora_Registro, detalles: grouped.get(Number(row.Id_Historial)) || [] }));
}

module.exports = { getHistorial, getFilterOptions, registrarAccion, exportarHistorial, getHistorialByTableAndId,
  buildWhere, visibleDetails, sanitizeValue };
