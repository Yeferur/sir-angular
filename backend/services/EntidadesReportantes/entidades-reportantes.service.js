const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');

const TYPES = Object.freeze(['HOTEL', 'AGENCIA_NACIONAL', 'AGENCIA_INTERNACIONAL']);
const CHANNEL_TYPES = Object.freeze({
  HOTEL: 'HOTEL',
  'AGENCIA NACIONAL': 'AGENCIA_NACIONAL',
  'AGENCIA INTERNACIONAL': 'AGENCIA_INTERNACIONAL',
});

function error(status, errorCode, message) {
  return Object.assign(new Error(message), { status, errorCode });
}

function normalizeName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 255) {
    throw error(400, 'ENTITY_NAME_INVALID', 'El nombre comercial debe tener entre 2 y 255 caracteres.');
  }
  if (Object.hasOwn(CHANNEL_TYPES, name.toLocaleUpperCase('es'))) {
    throw error(400, 'ENTITY_NAME_GENERIC', 'Indica el nombre comercial concreto del hotel o agencia.');
  }
  return name;
}

function searchKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

async function typeForChannel(executor, channelId) {
  const [rows] = await executor.query('SELECT Nombre_Canal FROM canales_reservas WHERE Id_Canal=? LIMIT 1', [channelId]);
  if (!rows.length) throw error(400, 'CHANNEL_INVALID', 'Selecciona un canal válido para este servicio.');
  return CHANNEL_TYPES[String(rows[0].Nombre_Canal).trim().toLocaleUpperCase('es')] || null;
}

async function validateReservationEntity(executor, channelId, entityId) {
  const requiredType = await typeForChannel(executor, channelId);
  const supplied = entityId !== undefined && entityId !== null && entityId !== '';
  if (!requiredType) {
    // A channel without entity-reporting semantics always persists NULL, even
    // when an older or stale client still sends a previously selected entity.
    return null;
  }
  if (!supplied) throw error(400, 'ENTITY_REQUIRED', 'Selecciona o registra el hotel o agencia que reportó el servicio.');
  if (!/^\d+$/.test(String(entityId)) || Number(entityId) <= 0) {
    throw error(400, 'ENTITY_INVALID', 'Selecciona una entidad reportante válida.');
  }
  const [rows] = await executor.query(`SELECT Id_Entidad_Reportante,Tipo,Activo,Estado_Validacion
    FROM entidades_reportantes WHERE Id_Entidad_Reportante=? LIMIT 1`, [entityId]);
  if (!rows.length || !Number(rows[0].Activo) || rows[0].Estado_Validacion === 'RECHAZADA') {
    throw error(400, 'ENTITY_INVALID', 'La entidad reportante no existe, está inactiva o fue rechazada.');
  }
  if (rows[0].Tipo !== requiredType) throw error(400, 'ENTITY_CHANNEL_MISMATCH', 'La entidad no corresponde al canal seleccionado.');
  return rows[0].Id_Entidad_Reportante;
}

async function listEntities({ type, search = '', limit = 100, includeInactive = false } = {}) {
  if (type && !TYPES.includes(type)) throw error(400, 'ENTITY_TYPE_INVALID', 'Tipo de entidad no válido.');
  const max = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const term = String(search).trim().slice(0, 100);
  const where = [includeInactive ? '1=1' : "Activo=1 AND Estado_Validacion<>'RECHAZADA'"];
  const params = [];
  if (type) { where.push('Tipo=?'); params.push(type); }
  if (term) { where.push('Nombre_Normalizado LIKE ?'); params.push(`%${searchKey(term)}%`); }
  const [rows] = await db.query(`SELECT Id_Entidad_Reportante,Tipo,Nombre,Activo,Estado_Validacion,
    Creado_Por,Fecha_Creacion,Actualizado_Por,Fecha_Actualizacion,Validado_Por,Validado_En
    FROM entidades_reportantes WHERE ${where.join(' AND ')} ORDER BY Nombre,Id_Entidad_Reportante LIMIT ?`, [...params, max]);
  return rows;
}

async function quickCreate({ channelId, name, actorId }) {
  const commercialName = normalizeName(name);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const type = await typeForChannel(conn, channelId);
    if (!type) throw error(400, 'ENTITY_CHANNEL_MISMATCH', 'El registro rápido solo aplica a hoteles y agencias.');
    const key = searchKey(commercialName);
    if (!key) throw error(400, 'ENTITY_NAME_INVALID', 'Indica un nombre comercial con letras o números.');
    const [existing] = await conn.query(`SELECT Id_Entidad_Reportante,Tipo,Nombre,Activo,Estado_Validacion
      FROM entidades_reportantes WHERE Tipo=? AND Nombre_Normalizado=? LIMIT 1 FOR UPDATE`, [type, key]);
    if (existing.length) {
      if (!Number(existing[0].Activo) || existing[0].Estado_Validacion === 'RECHAZADA') {
        throw error(409, 'ENTITY_INACTIVE_DUPLICATE', 'Ya existe una entidad inactiva o rechazada con ese nombre; solicita su revisión.');
      }
      await conn.commit();
      return { entity: existing[0], created: false };
    }
    const [inserted] = await conn.query(`INSERT INTO entidades_reportantes
      (Tipo,Nombre,Nombre_Normalizado,Estado_Validacion,Creado_Por,Actualizado_Por)
      VALUES (?,?,?,'PENDIENTE_VALIDACION',?,?)`, [type, commercialName, key, actorId, actorId]);
    await recordHistorial({ conexion: conn, tabla: 'entidades_reportantes', id_registro: inserted.insertId,
      accion: 'CREAR', id_usuario: actorId,
      detalles: [{ columna: 'Tipo', anterior: null, nuevo: type },
        { columna: 'Nombre', anterior: null, nuevo: commercialName }] });
    await conn.commit();
    return { entity: { Id_Entidad_Reportante: inserted.insertId, Tipo: type, Nombre: commercialName,
      Activo: 1, Estado_Validacion: 'PENDIENTE_VALIDACION' }, created: true };
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') {
      const type = await typeForChannel(db, channelId);
      const [rows] = await db.query(`SELECT Id_Entidad_Reportante,Tipo,Nombre,Activo,Estado_Validacion
        FROM entidades_reportantes WHERE Tipo=? AND Nombre_Normalizado=? LIMIT 1`, [type, searchKey(commercialName)]);
      if (rows.length && Number(rows[0].Activo) && rows[0].Estado_Validacion !== 'RECHAZADA') {
        return { entity: rows[0], created: false };
      }
    }
    throw e;
  } finally { conn.release(); }
}

async function validateEntity(id, state, actorId) {
  if (!['PENDIENTE_VALIDACION', 'VALIDADA', 'RECHAZADA'].includes(state)) {
    throw error(400, 'ENTITY_STATE_INVALID', 'Estado de validación no válido.');
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[before]] = await conn.query('SELECT Estado_Validacion FROM entidades_reportantes WHERE Id_Entidad_Reportante=? FOR UPDATE', [id]);
    if (!before) throw error(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
    await conn.query(`UPDATE entidades_reportantes SET Estado_Validacion=?,Actualizado_Por=?,
      Validado_Por=?,Validado_En=? WHERE Id_Entidad_Reportante=?`,
    [state, actorId, state === 'PENDIENTE_VALIDACION' ? null : actorId,
      state === 'PENDIENTE_VALIDACION' ? null : new Date(), id]);
    await recordHistorial({ conexion: conn, tabla: 'entidades_reportantes', id_registro: id,
      accion: 'VALIDAR', id_usuario: actorId,
      detalles: [{ columna: 'Estado_Validacion', anterior: before.Estado_Validacion, nuevo: state }] });
    await conn.commit();
    return { Id_Entidad_Reportante: id, Estado_Validacion: state };
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

module.exports = { TYPES, CHANNEL_TYPES, normalizeName, typeForChannel,
  searchKey, validateReservationEntity, listEntities, quickCreate, validateEntity };
