const db = require('../../database/db');
const ExcelJS = require('exceljs');
const { recordHistorial } = require('../Historial/logger');
const { reservasOperativasSource, reservaNoEliminadaPredicate } = require('../schema-capabilities');
const { TYPES, normalizeName, searchKey } = require('./entidades-reportantes.service');
const { DIAS_SIN_REPORTAR_ALERTA } = require('../../config/entidades-reportantes');

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
function bogotaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(new Date());
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
  const daysValue = query.diasSinReportarMin ?? query.sinReportarHaceMasDe ?? '';
  const days = daysValue === '' || daysValue === null || daysValue === undefined
    ? null
    : Number(daysValue);
  if (days !== null && (!Number.isSafeInteger(days) || days < 0 || days > 36500))
    fail(400, 'INACTIVITY_DAYS_INVALID', 'Indica un número de días entre 0 y 36500.');
  const sortOptions = {
    nombre: 'nombre', entidad: 'nombre', tipo: 'tipo', estado: 'estado', validacion: 'validacion',
    operaciones: 'operaciones', pasajeros: 'pasajeros', reservas: 'reservas', transfers: 'transfers',
    primera_reserva: 'primera_reserva', ultima_reserva: 'ultima_reserva',
    dias_sin_reportar: 'dias_sin_reportar',
  };
  const requestedSort = String(query.ordenarPor || query.sortBy || 'nombre').trim().toLowerCase();
  const sortBy = sortOptions[requestedSort] || 'nombre';
  const direction = String(query.orden || query.sortDirection || 'ASC').trim().toUpperCase();
  const sortDirection = direction === 'DESC' ? 'DESC' : 'ASC';
  return { start, end, type, validation, activity, availability,
    daysSinceReportMin: days, sortBy, sortDirection,
    search: searchKey(String(query.buscar || '').slice(0, 100)) };
}

function activitySql(f) {
  const reservationPeriod = f.start
    ? 'AND r.Fecha_Registro >= ? AND r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)'
    : '';
  const transferPeriod = f.start
    ? 'AND tr.Fecha_Registro >= ? AND tr.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)'
    : '';
  const params = f.start
    ? [`${f.start} 00:00:00`, f.end, `${f.start} 00:00:00`, f.end]
    : [];
  const joins = `LEFT JOIN (
      SELECT e_res.Id_Entidad_Reportante,
        COUNT(DISTINCT r.Id_Reserva) AS Reservas,
        COUNT(DISTINCT p.Id_Pasajero) AS Pasajeros
      FROM entidades_reportantes e_res
      LEFT JOIN reservas r
        ON r.Id_Entidad_Reportante=e_res.Id_Entidad_Reportante
        AND ${reservaNoEliminadaPredicate('r')} ${reservationPeriod}
      LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      GROUP BY e_res.Id_Entidad_Reportante
    ) ar ON ar.Id_Entidad_Reportante=e.Id_Entidad_Reportante
    LEFT JOIN (
      SELECT e_transfer.Id_Entidad_Reportante,
        COUNT(tr.Id_Transfer) AS Transfers,
        COALESCE(SUM(tr.Cantidad_Personas),0) AS Pasajeros
      FROM entidades_reportantes e_transfer
      LEFT JOIN transfers tr
        ON tr.Id_Entidad_Reportante=e_transfer.Id_Entidad_Reportante ${transferPeriod}
      GROUP BY e_transfer.Id_Entidad_Reportante
    ) at ON at.Id_Entidad_Reportante=e.Id_Entidad_Reportante
    LEFT JOIN (
      SELECT r.Id_Entidad_Reportante,
        MIN(r.Fecha_Registro) AS Primera_Actividad,
        MAX(r.Fecha_Registro) AS Ultima_Actividad
      FROM reservas r JOIN entidades_reportantes historyEntity
        ON historyEntity.Id_Entidad_Reportante=r.Id_Entidad_Reportante
        AND historyEntity.Estado_Validacion='VALIDADA' AND historyEntity.Activo=1
      WHERE r.Id_Entidad_Reportante IS NOT NULL AND ${reservaNoEliminadaPredicate('r')}
      GROUP BY r.Id_Entidad_Reportante
    ) rh ON rh.Id_Entidad_Reportante=e.Id_Entidad_Reportante
    LEFT JOIN (
      SELECT tr.Id_Entidad_Reportante,
        MIN(tr.Fecha_Registro) AS Primera_Actividad,
        MAX(tr.Fecha_Registro) AS Ultima_Actividad
      FROM transfers tr JOIN entidades_reportantes historyEntity
        ON historyEntity.Id_Entidad_Reportante=tr.Id_Entidad_Reportante
        AND historyEntity.Estado_Validacion='VALIDADA' AND historyEntity.Activo=1
      WHERE tr.Id_Entidad_Reportante IS NOT NULL
      GROUP BY tr.Id_Entidad_Reportante
    ) th ON th.Id_Entidad_Reportante=e.Id_Entidad_Reportante`;
  return { joins, params };
}

function firstActivitySql() {
  return `CASE
    WHEN rh.Primera_Actividad IS NULL THEN th.Primera_Actividad
    WHEN th.Primera_Actividad IS NULL THEN rh.Primera_Actividad
    ELSE LEAST(rh.Primera_Actividad,th.Primera_Actividad) END`;
}
function lastActivitySql() {
  return `CASE
    WHEN rh.Ultima_Actividad IS NULL THEN th.Ultima_Actividad
    WHEN th.Ultima_Actividad IS NULL THEN rh.Ultima_Actividad
    ELSE GREATEST(rh.Ultima_Actividad,th.Ultima_Actividad) END`;
}
function daysSinceReportSql(todayPlaceholder = '?') {
  const lastActivity = lastActivitySql();
  return `CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1
    AND (${lastActivity}) IS NOT NULL
    THEN GREATEST(DATEDIFF(${todayPlaceholder},DATE(${lastActivity})),0)
    ELSE NULL END`;
}
function reportAgeFilterSql(todayPlaceholder = '?') {
  const lastActivity = lastActivitySql();
  return `DATEDIFF(${todayPlaceholder},DATE(COALESCE((${lastActivity}),e.Validado_En)))`;
}
function operationsSql() {
  return '(COALESCE(ar.Reservas,0)+COALESCE(at.Transfers,0))';
}
function orderBySql(f) {
  const columns = {
    nombre: 'e.Nombre', tipo: 'e.Tipo', estado: 'e.Activo', validacion: 'e.Estado_Validacion',
    operaciones: 'Operaciones', pasajeros: 'Pasajeros', reservas: 'Reservas', transfers: 'Transfers',
    primera_reserva: 'Primera_Reserva', ultima_reserva: 'Ultima_Reserva',
    dias_sin_reportar: 'Dias_Sin_Reportar',
  };
  return `${columns[f.sortBy] || columns.nombre} ${f.sortDirection}, e.Id_Entidad_Reportante ${f.sortDirection}`;
}

function filteredSql(f) {
  const a = activitySql(f);
  const where = ['e.Tipo IN (?, ?, ?)'];
  const params = [...a.params, ...TYPES];
  if (f.type) { where.push('e.Tipo=?'); params.push(f.type); }
  if (f.validation) { where.push('e.Estado_Validacion=?'); params.push(f.validation); }
  if (f.availability) { where.push('e.Activo=?'); params.push(f.availability === 'ACTIVA' ? 1 : 0); }
  if (f.search) { where.push('e.Nombre_Normalizado LIKE ?'); params.push(`%${f.search}%`); }
  if (f.activity) where.push(f.activity === 'CON_RESERVAS' ? `${operationsSql()}>0` : `${operationsSql()}=0`);
  if (f.daysSinceReportMin !== null) {
    where.push(`e.Estado_Validacion='VALIDADA' AND e.Activo=1
      AND ${reportAgeFilterSql()} > ?`);
    params.push(bogotaToday(), f.daysSinceReportMin);
  }
  return { sql: `FROM entidades_reportantes e ${a.joins}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params };
}
function positiveInt(value, fallback, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
function columnsSql() {
  return `e.Id_Entidad_Reportante,e.Tipo,e.Nombre,e.Activo,e.Estado_Validacion,
  e.Creado_Por,e.Fecha_Creacion,COALESCE(ar.Reservas,0) AS Reservas,
  COALESCE(at.Transfers,0) AS Transfers,
  ${operationsSql()} AS Operaciones,
  (COALESCE(ar.Pasajeros,0)+COALESCE(at.Pasajeros,0)) AS Pasajeros,
  CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1 THEN ${firstActivitySql()} ELSE NULL END AS Primera_Reserva,
  CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1 THEN ${lastActivitySql()} ELSE NULL END AS Ultima_Reserva,
  CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1 THEN ${firstActivitySql()} ELSE NULL END AS Primera_Actividad,
  CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1 THEN ${lastActivitySql()} ELSE NULL END AS Ultima_Actividad,
  DATE_FORMAT(CASE WHEN e.Estado_Validacion='VALIDADA' AND e.Activo=1 THEN ${lastActivitySql()} ELSE NULL END,'%Y-%m-%d') AS Fecha_Ultima_Actividad,
  ${daysSinceReportSql()} AS Dias_Sin_Reportar,
  (SELECT r3.Nombre_Reportante FROM reservas r3
    WHERE r3.Id_Entidad_Reportante=e.Id_Entidad_Reportante
      AND ${reservaNoEliminadaPredicate('r3')}
    ORDER BY r3.Fecha_Registro DESC,r3.Id_Reserva DESC LIMIT 1) AS Contacto_Reciente`;
}

async function listActivity(query = {}, unpaged = false) {
  const f = filters(query);
  const part = filteredSql(f);
  const pageSize = positiveInt(query.pageSize, 25, 100);
  const requested = positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
  const [[summary]] = await db.query(`SELECT COUNT(*) AS Total_Entidades,
    SUM(CASE WHEN ${operationsSql()}>0 THEN 1 ELSE 0 END) AS Con_Actividad,
    SUM(CASE WHEN ${operationsSql()}=0 THEN 1 ELSE 0 END) AS Sin_Actividad,
    SUM(CASE WHEN COALESCE(ar.Reservas,0)>0 THEN 1 ELSE 0 END) AS Con_Reservas,
    SUM(CASE WHEN COALESCE(ar.Reservas,0)=0 THEN 1 ELSE 0 END) AS Sin_Reservas,
    SUM(CASE WHEN e.Estado_Validacion='PENDIENTE_VALIDACION' THEN 1 ELSE 0 END) AS Pendientes,
    COALESCE(SUM(COALESCE(ar.Reservas,0)),0) AS Total_Reservas,
    COALESCE(SUM(COALESCE(at.Transfers,0)),0) AS Total_Transfers,
    COALESCE(SUM(${operationsSql()}),0) AS Total_Operaciones,
    COALESCE(SUM(COALESCE(ar.Pasajeros,0)+COALESCE(at.Pasajeros,0)),0) AS Total_Pasajeros
    ${part.sql}`, part.params);
  const total = Number(summary.Total_Entidades || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, totalPages);
  const [items] = await db.query(`SELECT ${columnsSql()} ${part.sql}
    ORDER BY ${orderBySql(f)} ${unpaged ? '' : 'LIMIT ? OFFSET ?'}`,
  unpaged
    ? [bogotaToday(), ...part.params]
    : [bogotaToday(), ...part.params, pageSize, (page - 1) * pageSize]);
  return { items, summary, page, pageSize, totalPages, total,
    umbralDiasSinReportar: DIAS_SIN_REPORTAR_ALERTA,
    ordenarPor: f.sortBy, orden: f.sortDirection };
}

function combinedDateSql(reservationAlias, transferAlias, field) {
  const reservationDate = `${reservationAlias}.${field}`;
  const transferDate = `${transferAlias}.${field}`;
  return `CASE
    WHEN ${reservationDate} IS NULL THEN ${transferDate}
    WHEN ${transferDate} IS NULL THEN ${reservationDate}
    ELSE ${field === 'Primera_Actividad' ? 'LEAST' : 'GREATEST'}(${reservationDate},${transferDate}) END`;
}

async function entityActivity(rawId, f = {}, includeDays = false, includeActivityDates = true) {
  const reservationPeriod = f.start
    ? 'AND r.Fecha_Registro>=? AND r.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)'
    : '';
  const transferPeriod = f.start
    ? 'AND tr.Fecha_Registro>=? AND tr.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)'
    : '';
  const periodParams = f.start ? [`${f.start} 00:00:00`, f.end] : [];
  const firstDate = combinedDateSql('ra', 'ta', 'Primera_Actividad');
  const lastDate = combinedDateSql('ra', 'ta', 'Ultima_Actividad');
  const daysExpression = `CASE WHEN (${lastDate}) IS NOT NULL
    THEN GREATEST(DATEDIFF(?,DATE(${lastDate})),0) ELSE NULL END`;
  const sql = `SELECT COALESCE(ra.Reservas,0) AS Reservas,
      COALESCE(ta.Transfers,0) AS Transfers,
      COALESCE(ra.Reservas,0)+COALESCE(ta.Transfers,0) AS Operaciones,
      COALESCE(ra.Pasajeros,0)+COALESCE(ta.Pasajeros,0) AS Pasajeros
      ${includeActivityDates ? `,${firstDate} AS Primera_Reserva,${lastDate} AS Ultima_Reserva,
        ${firstDate} AS Primera_Actividad,${lastDate} AS Ultima_Actividad` : ''}
      ${includeDays ? `,${daysExpression} AS Dias_Sin_Reportar` : ''}
    FROM (SELECT 1 AS singleton) seed
    LEFT JOIN (
      SELECT COUNT(DISTINCT r.Id_Reserva) AS Reservas,
        COUNT(DISTINCT p.Id_Pasajero) AS Pasajeros,
        MIN(r.Fecha_Registro) AS Primera_Actividad,
        MAX(r.Fecha_Registro) AS Ultima_Actividad
      FROM ${reservasOperativasSource('r')}
      LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      WHERE r.Id_Entidad_Reportante=? ${reservationPeriod}
    ) ra ON 1=1
    LEFT JOIN (
      SELECT COUNT(tr.Id_Transfer) AS Transfers,
        COALESCE(SUM(tr.Cantidad_Personas),0) AS Pasajeros,
        MIN(tr.Fecha_Registro) AS Primera_Actividad,
        MAX(tr.Fecha_Registro) AS Ultima_Actividad
      FROM transfers tr
      WHERE tr.Id_Entidad_Reportante=? ${transferPeriod}
    ) ta ON 1=1`;
  const params = [
    ...(includeDays ? [bogotaToday()] : []),
    rawId, ...periodParams, rawId, ...periodParams,
  ];
  const [[result]] = await db.query(sql, params);
  return result;
}

async function detail(rawId, query = {}) {
  const id = idValue(rawId);
  const f = filters(query);
  const [[entity]] = await db.query(`SELECT e.*,u.Nombres_Apellidos AS Creador,
      (SELECT dh.Valor_Nuevo FROM historial h
        INNER JOIN detalle_historial dh ON dh.Id_Historial=h.Id_Historial
       WHERE h.Tabla='entidades_reportantes'
         AND h.Id_Registro=CAST(e.Id_Entidad_Reportante AS CHAR)
         AND h.Accion='RECHAZAR' AND dh.Columna='Motivo de rechazo'
       ORDER BY h.Id_Historial DESC LIMIT 1) AS Motivo_Rechazo
    FROM entidades_reportantes e LEFT JOIN usuarios u ON u.Id_Usuario=e.Creado_Por
    WHERE e.Id_Entidad_Reportante=? AND e.Tipo IN (?, ?, ?)`, [id, ...TYPES]);
  if (!entity) fail(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
  const eligibleForActivityDates = entity.Estado_Validacion === 'VALIDADA' && Number(entity.Activo) === 1;
  const historic = await entityActivity(id, {}, eligibleForActivityDates, eligibleForActivityDates);
  const periodSummary = await entityActivity(id, f, false, false);
  if (!eligibleForActivityDates) {
    historic.Primera_Reserva = null;
    historic.Ultima_Reserva = null;
    historic.Primera_Actividad = null;
    historic.Ultima_Actividad = null;
    historic.Dias_Sin_Reportar = null;
  }
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
    const { upsertEntityValidationPending } = require('./entidades-reportantes.service');
    await upsertEntityValidationPending(conn, id, name);
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

async function streamExcel(query = {}, output) {
  const pageSize = 100;
  let page = 1;
  let result = await listActivity({ ...query, page, pageSize });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: true });
  const sheet = wb.addWorksheet('Entidades reportantes');
  sheet.columns = [
    ['Tipo', 'Tipo', 25], ['Entidad', 'Nombre', 38], ['Estado', 'Activo', 14],
    ['Validación', 'Estado_Validacion', 24], ['Reservas', 'Reservas', 13],
    ['Pasajeros', 'Pasajeros', 13], ['Primera actividad', 'Primera_Actividad', 22],
    ['Última actividad', 'Ultima_Actividad', 22], ['Días desde última actividad', 'Dias', 28],
    ['Contacto reciente', 'Contacto_Reciente', 30],
    ['Puntos observados', 'Puntos_Observados', 40],
    ['Puntos asociados', 'Puntos_Asociados', 40],
    ['Transfers', 'Transfers', 13], ['Operaciones', 'Operaciones', 13],
  ].map(([header, key, width]) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'N1' };
  while (true) {
    const ids = result.items.map(item => item.Id_Entidad_Reportante);
    const observed = new Map(), associated = new Map();
    if (ids.length) {
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
    for (const item of result.items) {
      sheet.addRow({ ...item, Activo: Number(item.Activo) ? 'Activa' : 'Inactiva',
        Dias: item.Dias_Sin_Reportar,
        Puntos_Observados: (observed.get(String(item.Id_Entidad_Reportante)) || []).join('; '),
        Puntos_Asociados: (associated.get(String(item.Id_Entidad_Reportante)) || []).join('; ') }).commit();
    }
    if (page >= result.totalPages) break;
    page += 1;
    result = await listActivity({ ...query, page, pageSize });
  }
  sheet.commit();
  await wb.commit();
}

module.exports = { filters, listActivity, detail, createEntity, updateEntity, setPoint, streamExcel };
