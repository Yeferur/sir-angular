const db = require('../../database/db');
const ExcelJS = require('exceljs');
const { recordHistorial } = require('../Historial/logger');
const { reservasOperativasSource } = require('../schema-capabilities');
const { TYPES, normalizeName, searchKey } = require('./entidades-reportantes.service');

function fail(status, errorCode, message) { throw Object.assign(new Error(message), { status, errorCode }); }
function idValue(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail(400, 'ENTITY_ID_INVALID', 'Identificador de entidad no válido.');
  return id;
}
function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function filters(query) {
  const start = dateValue(query.desde), end = dateValue(query.hasta);
  if ((query.desde || query.hasta) && (!start || !end || start > end))
    fail(400, 'DATE_RANGE_INVALID', 'Selecciona un rango de fechas completo y válido.');
  if (start && (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 > 30)
    fail(400, 'DATE_RANGE_TOO_LONG', 'El rango máximo es de 31 días calendario.');
  const type = query.tipo || '';
  if (type && !TYPES.includes(type)) fail(400, 'ENTITY_TYPE_INVALID', 'Tipo de entidad no válido.');
  const validation = query.validacion || '';
  if (validation && !['PENDIENTE_VALIDACION', 'VALIDADA', 'RECHAZADA'].includes(validation))
    fail(400, 'ENTITY_STATE_INVALID', 'Validación no válida.');
  const activity = query.actividad || '';
  if (activity && !['CON_RESERVAS', 'SIN_RESERVAS'].includes(activity))
    fail(400, 'ACTIVITY_INVALID', 'Actividad no válida.');
  const availability = query.estado || '';
  if (availability && !['ACTIVA', 'INACTIVA'].includes(availability))
    fail(400, 'ENTITY_AVAILABILITY_INVALID', 'Estado no válido.');
  return { start, end, type, validation, activity, availability,
    search: searchKey(String(query.buscar || '').slice(0, 100)) };
}

function activitySql(f) {
  const period = f.start ? 'AND r.Fecha_Registro >= ? AND r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)' : '';
  const params = f.start ? [`${f.start} 00:00:00`, f.end] : [];
  const sql = `SELECT r.Id_Entidad_Reportante, COUNT(*) AS Reservas,
      COALESCE(SUM(pc.Pasajeros),0) AS Pasajeros,
      MIN(r.Fecha_Registro) AS Primera_Actividad, MAX(r.Fecha_Registro) AS Ultima_Actividad
    FROM ${reservasOperativasSource('r')}
    LEFT JOIN (SELECT Id_Reserva, COUNT(*) AS Pasajeros FROM pasajeros GROUP BY Id_Reserva) pc
      ON pc.Id_Reserva=r.Id_Reserva
    WHERE r.Id_Entidad_Reportante IS NOT NULL ${period}
    GROUP BY r.Id_Entidad_Reportante`;
  return { sql, params };
}
function filteredSql(f) {
  const a = activitySql(f);
  const where = ['e.Tipo IN (?, ?, ?)'];
  const params = [...a.params, ...TYPES];
  if (f.type) { where.push('e.Tipo=?'); params.push(f.type); }
  if (f.validation) { where.push('e.Estado_Validacion=?'); params.push(f.validation); }
  if (f.availability) { where.push('e.Activo=?'); params.push(f.availability === 'ACTIVA' ? 1 : 0); }
  if (f.search) { where.push('e.Nombre_Normalizado LIKE ?'); params.push(`%${f.search}%`); }
  if (f.activity) where.push(f.activity === 'CON_RESERVAS' ? 'a.Reservas IS NOT NULL' : 'a.Reservas IS NULL');
  return { sql: `FROM entidades_reportantes e LEFT JOIN (${a.sql}) a
    ON a.Id_Entidad_Reportante=e.Id_Entidad_Reportante
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params };
}
function positiveInt(value, fallback, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
const columns = `e.Id_Entidad_Reportante,e.Tipo,e.Nombre,e.Activo,e.Estado_Validacion,
  e.Creado_Por,e.Fecha_Creacion,COALESCE(a.Reservas,0) AS Reservas,
  COALESCE(a.Pasajeros,0) AS Pasajeros,a.Primera_Actividad,a.Ultima_Actividad,
  DATE_FORMAT(a.Ultima_Actividad,'%Y-%m-%d') AS Fecha_Ultima_Actividad,
  (SELECT r3.Nombre_Reportante FROM reservas r3
    WHERE r3.Id_Entidad_Reportante=e.Id_Entidad_Reportante
      AND ${require('../schema-capabilities').reservaNoEliminadaPredicate('r3')}
    ORDER BY r3.Fecha_Registro DESC,r3.Id_Reserva DESC LIMIT 1) AS Contacto_Reciente`;

async function listActivity(query = {}, unpaged = false) {
  const f = filters(query);
  const part = filteredSql(f);
  const pageSize = positiveInt(query.pageSize, 25, 100);
  const requested = positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
  const [[summary]] = await db.query(`SELECT COUNT(*) AS Total_Entidades,
    SUM(CASE WHEN a.Reservas IS NULL THEN 0 ELSE 1 END) AS Con_Reservas,
    SUM(CASE WHEN a.Reservas IS NULL THEN 1 ELSE 0 END) AS Sin_Reservas,
    SUM(CASE WHEN e.Estado_Validacion='PENDIENTE_VALIDACION' THEN 1 ELSE 0 END) AS Pendientes,
    COALESCE(SUM(a.Reservas),0) AS Total_Reservas,COALESCE(SUM(a.Pasajeros),0) AS Total_Pasajeros
    ${part.sql}`, part.params);
  const total = Number(summary.Total_Entidades || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, totalPages);
  const [items] = await db.query(`SELECT ${columns} ${part.sql}
    ORDER BY e.Nombre,e.Id_Entidad_Reportante ${unpaged ? '' : 'LIMIT ? OFFSET ?'}`,
  unpaged ? part.params : [...part.params, pageSize, (page - 1) * pageSize]);
  return { items, summary, page, pageSize, totalPages, total };
}

async function detail(rawId, query = {}) {
  const id = idValue(rawId);
  const f = filters(query);
  const [[entity]] = await db.query(`SELECT e.*,u.Nombres_Apellidos AS Creador
    FROM entidades_reportantes e LEFT JOIN usuarios u ON u.Id_Usuario=e.Creado_Por
    WHERE e.Id_Entidad_Reportante=? AND e.Tipo IN (?, ?, ?)`, [id, ...TYPES]);
  if (!entity) fail(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
  const period = f.start ? 'AND r.Fecha_Registro>=? AND r.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)' : '';
  const p = f.start ? [`${f.start} 00:00:00`, f.end] : [];
  const [[historic]] = await db.query(`SELECT COUNT(DISTINCT r.Id_Reserva) AS Reservas,
    COUNT(p.Id_Pasajero) AS Pasajeros,MIN(r.Fecha_Registro) AS Primera_Actividad,
    MAX(r.Fecha_Registro) AS Ultima_Actividad
    FROM ${reservasOperativasSource('r')} LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Id_Entidad_Reportante=?`, [id]);
  const [[periodSummary]] = await db.query(`SELECT COUNT(DISTINCT r.Id_Reserva) AS Reservas,
    COUNT(p.Id_Pasajero) AS Pasajeros FROM ${reservasOperativasSource('r')}
    LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Id_Entidad_Reportante=? ${period}`, [id, ...p]);
  const [contacts] = await db.query(`SELECT r.Nombre_Reportante AS Nombre,
    r.Telefono_Reportante AS Telefono,COUNT(*) AS Reservas,MAX(r.Fecha_Registro) AS Ultimo_Reporte
    FROM ${reservasOperativasSource('r')} WHERE r.Id_Entidad_Reportante=?
    AND r.Nombre_Reportante IS NOT NULL AND r.Nombre_Reportante<>''
    GROUP BY r.Nombre_Reportante,r.Telefono_Reportante ORDER BY Ultimo_Reporte DESC LIMIT 100`, [id]);
  const [observed] = await db.query(`SELECT p.Id_Punto,pt.Nombre_Punto,COUNT(DISTINCT r.Id_Reserva) AS Reservas
    FROM ${reservasOperativasSource('r')} JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    JOIN puntos pt ON pt.Id_Punto=p.Id_Punto WHERE r.Id_Entidad_Reportante=?
    GROUP BY p.Id_Punto,pt.Nombre_Punto ORDER BY Reservas DESC`, [id]);
  const [associated] = await db.query(`SELECT ep.Id_Punto,pt.Nombre_Punto,ep.Estado_Validacion
    FROM entidad_reportante_puntos ep JOIN puntos pt ON pt.Id_Punto=ep.Id_Punto
    WHERE ep.Id_Entidad_Reportante=? ORDER BY pt.Nombre_Punto`, [id]);
  return { entity, historic, period: periodSummary, contacts, observed, associated };
}

async function createEntity(input, actorId) {
  const type = input.Tipo;
  if (!TYPES.includes(type)) fail(400, 'ENTITY_TYPE_INVALID', 'Selecciona un tipo válido.');
  const name = normalizeName(input.Nombre), key = searchKey(name);
  if (!key) fail(400, 'ENTITY_NAME_INVALID', 'Indica un nombre comercial con letras o números.');
  const conn = await db.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`INSERT INTO entidades_reportantes
      (Tipo,Nombre,Nombre_Normalizado,Creado_Por,Actualizado_Por) VALUES (?,?,?,?,?)`,
    [type, name, key, actorId, actorId]);
    id = result.insertId;
    await recordHistorial({ conexion: conn, tabla: 'entidades_reportantes', id_registro: id,
      accion: 'CREAR', id_usuario: actorId,
      detalles: [{ columna: 'Tipo', anterior: null, nuevo: type },
        { columna: 'Nombre', anterior: null, nuevo: name }] });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'ENTITY_DUPLICATE', 'Ya existe una entidad del mismo tipo con ese nombre.');
    throw e;
  } finally { conn.release(); }
  return detail(id);
}

async function updateEntity(rawId, input, actorId) {
  const id = idValue(rawId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[old]] = await conn.query('SELECT * FROM entidades_reportantes WHERE Id_Entidad_Reportante=? FOR UPDATE', [id]);
    if (!old) fail(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
    const name = input.Nombre === undefined ? old.Nombre : normalizeName(input.Nombre);
    const type = input.Tipo === undefined ? old.Tipo : input.Tipo;
    if (!TYPES.includes(type)) fail(400, 'ENTITY_TYPE_INVALID', 'Tipo no válido.');
    if (type !== old.Tipo) {
      const [[usage]] = await conn.query('SELECT 1 AS used FROM reservas WHERE Id_Entidad_Reportante=? LIMIT 1', [id]);
      if (usage) fail(409, 'ENTITY_TYPE_IN_USE', 'No se puede cambiar el tipo de una entidad con reservas.');
    }
    const active = input.Activo === undefined ? Number(old.Activo) : Number(input.Activo);
    if (![0, 1].includes(active)) fail(400, 'ENTITY_AVAILABILITY_INVALID', 'Estado no válido.');
    await conn.query(`UPDATE entidades_reportantes SET Tipo=?,Nombre=?,Nombre_Normalizado=?,
      Activo=?,Actualizado_Por=? WHERE Id_Entidad_Reportante=?`, [type, name, searchKey(name), active, actorId, id]);
    const changes = [['Tipo', old.Tipo, type], ['Nombre', old.Nombre, name], ['Activo', Number(old.Activo), active]]
      .filter(([, before, after]) => before !== after)
      .map(([columna, anterior, nuevo]) => ({ columna, anterior, nuevo }));
    if (changes.length) await recordHistorial({ conexion: conn, tabla: 'entidades_reportantes',
      id_registro: id, accion: 'ACTUALIZAR', id_usuario: actorId, detalles: changes });
    await conn.commit();
    return { Id_Entidad_Reportante: id, Tipo: type, Nombre: name, Activo: active };
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') fail(409, 'ENTITY_DUPLICATE', 'Ya existe una entidad del mismo tipo con ese nombre.');
    throw e;
  } finally { conn.release(); }
}

async function setPoint(rawId, rawPoint, associated, actorId) {
  const id = idValue(rawId), point = idValue(rawPoint);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[entity]] = await conn.query('SELECT Id_Entidad_Reportante FROM entidades_reportantes WHERE Id_Entidad_Reportante=?', [id]);
    const [[p]] = await conn.query('SELECT Id_Punto FROM puntos WHERE Id_Punto=?', [point]);
    if (!entity || !p) fail(404, 'ENTITY_OR_POINT_NOT_FOUND', 'Entidad o punto no encontrado.');
    if (associated) await conn.query(`INSERT INTO entidad_reportante_puntos
      (Id_Entidad_Reportante,Id_Punto,Estado_Validacion,Creado_Por,Actualizado_Por,Validado_Por,Validado_En)
      VALUES (?,?,'VALIDADA',?,?,?,NOW()) ON DUPLICATE KEY UPDATE
      Estado_Validacion='VALIDADA',Actualizado_Por=VALUES(Actualizado_Por),
      Validado_Por=VALUES(Validado_Por),Validado_En=NOW()`, [id, point, actorId, actorId, actorId]);
    else await conn.query('DELETE FROM entidad_reportante_puntos WHERE Id_Entidad_Reportante=? AND Id_Punto=?', [id, point]);
    await recordHistorial({ conexion: conn, tabla: 'entidad_reportante_puntos',
      id_registro: id, accion: associated ? 'ASOCIAR' : 'DESASOCIAR', id_usuario: actorId,
      detalles: [{ columna: 'Id_Punto', anterior: associated ? null : point, nuevo: associated ? point : null }] });
    await conn.commit();
    return { Id_Entidad_Reportante: id, Id_Punto: point, asociado: associated };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function exportExcel(query = {}) {
  const { items } = await listActivity(query, true);
  const observed = new Map(), associated = new Map();
  for (let i = 0; i < items.length; i += 200) {
    const ids = items.slice(i, i + 200).map(item => item.Id_Entidad_Reportante);
    const marks = ids.map(() => '?').join(',');
    const [observedRows] = await db.query(`SELECT DISTINCT r.Id_Entidad_Reportante,pt.Nombre_Punto
      FROM ${reservasOperativasSource('r')} JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      JOIN puntos pt ON pt.Id_Punto=p.Id_Punto
      WHERE r.Id_Entidad_Reportante IN (${marks}) ORDER BY r.Id_Entidad_Reportante,pt.Nombre_Punto`, ids);
    const [associatedRows] = await db.query(`SELECT DISTINCT ep.Id_Entidad_Reportante,pt.Nombre_Punto
      FROM entidad_reportante_puntos ep JOIN puntos pt ON pt.Id_Punto=ep.Id_Punto
      WHERE ep.Estado_Validacion='VALIDADA' AND ep.Id_Entidad_Reportante IN (${marks})
      ORDER BY ep.Id_Entidad_Reportante,pt.Nombre_Punto`, ids);
    for (const row of observedRows) {
      const key = String(row.Id_Entidad_Reportante);
      observed.set(key, [...(observed.get(key) || []), row.Nombre_Punto]);
    }
    for (const row of associatedRows) {
      const key = String(row.Id_Entidad_Reportante);
      associated.set(key, [...(associated.get(key) || []), row.Nombre_Punto]);
    }
  }
  const wb = new ExcelJS.Workbook();
  const todayBogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const sheet = wb.addWorksheet('Entidades reportantes');
  sheet.columns = [
    ['Tipo', 'Tipo', 25], ['Entidad', 'Nombre', 38], ['Estado', 'Activo', 14],
    ['Validación', 'Estado_Validacion', 24], ['Reservas', 'Reservas', 13],
    ['Pasajeros', 'Pasajeros', 13], ['Primera actividad', 'Primera_Actividad', 22],
    ['Última actividad', 'Ultima_Actividad', 22], ['Días desde última actividad', 'Dias', 28],
    ['Contacto reciente', 'Contacto_Reciente', 30],
    ['Puntos observados', 'Puntos_Observados', 40],
    ['Puntos asociados', 'Puntos_Asociados', 40],
  ].map(([header, key, width]) => ({ header, key, width }));
  for (const item of items) {
    const lastDay = item.Fecha_Ultima_Actividad;
    sheet.addRow({ ...item, Activo: Number(item.Activo) ? 'Activa' : 'Inactiva',
      Dias: lastDay ? Math.max(0, Math.floor((Date.parse(todayBogota) - Date.parse(lastDay)) / 86400000)) : null,
      Puntos_Observados: (observed.get(String(item.Id_Entidad_Reportante)) || []).join('; '),
      Puntos_Asociados: (associated.get(String(item.Id_Entidad_Reportante)) || []).join('; ') });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'L1' };
  return wb.xlsx.writeBuffer();
}

module.exports = { filters, listActivity, detail, createEntity, updateEntity, setPoint, exportExcel };
