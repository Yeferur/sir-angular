const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');
const pendingService = require('../Pendientes/pendientes.service');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');
const { randomUUID } = require('node:crypto');

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
    FROM entidades_reportantes WHERE Id_Entidad_Reportante=? LIMIT 1 FOR UPDATE`, [entityId]);
  if (!rows.length) throw error(400, 'ENTITY_INVALID', 'La entidad reportante no existe. Selecciona otra entidad para continuar.');
  if (rows[0].Estado_Validacion === 'RECHAZADA') {
    throw error(400, 'ENTITY_REJECTED', 'La entidad reportante fue rechazada. Selecciona otra entidad para continuar.');
  }
  if (!Number(rows[0].Activo)) {
    throw error(400, 'ENTITY_INACTIVE', 'La entidad reportante está inactiva. Selecciona otra entidad para continuar.');
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
    await upsertEntityValidationPending(conn, inserted.insertId, commercialName);
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

const ENTITY_VALIDATION_RULE = 'ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION';
const ENTITY_OPEN_OPERATION_STATES = ['Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Confirmada', 'Confirmado'];
const ENTITY_OPEN_STATE_MARKS = ENTITY_OPEN_OPERATION_STATES.map(() => '?').join(',');

function entityValidationPendingKey(id) {
  return `ENTIDAD_REPORTANTE:PENDIENTE_VALIDACION:${String(id)}`;
}

async function upsertEntityValidationPending(connection, id, name, pending = pendingService) {
  return pending.upsertCondition({
    ruleCode: ENTITY_VALIDATION_RULE,
    deduplicationKey: entityValidationPendingKey(id),
    entityType: 'ENTIDAD_REPORTANTE',
    entityId: id,
    audiencePermission: 'ENTIDADES_REPORTANTES.VALIDAR',
    title: 'Entidad pendiente de validación',
    description: `Revisa la entidad reportante ${String(name || '').slice(0, 255)}.`,
    operationDate: new Date(),
    data: {
      idEntidadReportante: String(id),
      ruta: '/Mercadeo?vista=entidades&validacion=PENDIENTE_VALIDACION',
    },
  }, connection);
}

async function usersWithEntityValidationPermission(connection) {
  const [rows] = await connection.query(`SELECT DISTINCT u.Id_Usuario
    FROM usuarios u
    INNER JOIN permisos p ON p.Codigo_Permiso='ENTIDADES_REPORTANTES.VALIDAR'
    LEFT JOIN roles r ON r.Id_Rol=u.Id_Rol AND r.Activo=1
    LEFT JOIN rol_permisos rp ON rp.Id_Rol=r.Id_Rol AND rp.Id_Permiso=p.Id_Permiso
    LEFT JOIN usuario_permisos up ON up.Id_Usuario=u.Id_Usuario AND up.Id_Permiso=p.Id_Permiso
    WHERE u.Activo=1 AND COALESCE(up.Tipo,'')<>'DENY'
      AND (rp.Id_Permiso IS NOT NULL OR LOWER(TRIM(r.Nombre_Rol))='administrador' OR up.Tipo='ALLOW')`);
  return rows.map(row => String(row.Id_Usuario));
}

async function rejectRelatedOperations(connection, {
  id, actorId, name, reason, eventId, notify = notifications, recordHistory = recordHistorial,
}) {
  const [reservations] = await connection.query(`SELECT r.Id_Reserva,r.Estado,r.Creado_Por,r.Pendiente_Por_Entidad_En
    FROM reservas r WHERE r.Id_Entidad_Reportante=? AND r.Eliminada_En IS NULL
      AND r.Estado IN (${ENTITY_OPEN_STATE_MARKS}) FOR UPDATE`, [id, ...ENTITY_OPEN_OPERATION_STATES]);
  const [transfers] = await connection.query(`SELECT tr.Id_Transfer,tr.Estado,tr.Creado_Por,tr.Pendiente_Por_Entidad_En
    FROM transfers tr WHERE tr.Id_Entidad_Reportante=?
      AND tr.Estado IN (${ENTITY_OPEN_STATE_MARKS}) FOR UPDATE`, [id, ...ENTITY_OPEN_OPERATION_STATES]);
  const affected = [];

  for (const row of reservations) {
    await connection.query(`UPDATE reservas SET Estado='Pendiente de datos',
      Pendiente_Por_Entidad_En=(SELECT Validado_En FROM entidades_reportantes WHERE Id_Entidad_Reportante=?)
      WHERE Id_Reserva=? AND Eliminada_En IS NULL`, [id, row.Id_Reserva]);
    await recordHistory({ conexion: connection, tabla: 'reservas', id_registro: row.Id_Reserva,
      accion: 'ENTIDAD_REPORTANTE_RECHAZADA', id_usuario: actorId,
      detalles: [
        { columna: 'Estado', anterior: row.Estado, nuevo: 'Pendiente de datos' },
        { columna: 'Pendiente_Por_Entidad_En', anterior: row.Pendiente_Por_Entidad_En || null, nuevo: 'Fecha del rechazo de la entidad' },
      ] });
    if (row.Creado_Por) affected.push(String(row.Creado_Por));
  }
  for (const row of transfers) {
    await connection.query(`UPDATE transfers SET Estado='Pendiente de datos',
      Pendiente_Por_Entidad_En=(SELECT Validado_En FROM entidades_reportantes WHERE Id_Entidad_Reportante=?)
      WHERE Id_Transfer=?`, [id, row.Id_Transfer]);
    await recordHistory({ conexion: connection, tabla: 'transfers', id_registro: row.Id_Transfer,
      accion: 'ENTIDAD_REPORTANTE_RECHAZADA', id_usuario: actorId,
      detalles: [
        { columna: 'Estado', anterior: row.Estado, nuevo: 'Pendiente de datos' },
        { columna: 'Pendiente_Por_Entidad_En', anterior: row.Pendiente_Por_Entidad_En || null, nuevo: 'Fecha del rechazo de la entidad' },
      ] });
    if (row.Creado_Por) affected.push(String(row.Creado_Por));
  }

  const validators = await usersWithEntityValidationPermission(connection);
  const recipients = [...new Set([...affected, ...validators])];
  const message = `${reservations.length} ${reservations.length === 1 ? 'reserva' : 'reservas'} y `
    + `${transfers.length} ${transfers.length === 1 ? 'transfer' : 'transfers'} quedaron en “Pendiente de datos”. `
    + `Motivo: ${reason}`;
  const notificationIds = [];
  for (const userId of recipients) {
    const idNotificacion = await notify.createNotification(connection, {
      userId,
      type: 'ENTIDAD_REPORTANTE_RECHAZADA',
      title: `Entidad rechazada: ${String(name || '').slice(0, 110)}`,
      message,
      entityType: 'ENTIDAD_REPORTANTE',
      entityId: String(id),
      deduplicationKey: `ENTIDAD_RECHAZO:${id}:${eventId}`,
      data: {
        idEntidadReportante: String(id),
        eventoRechazo: eventId,
        reservasAfectadas: reservations.length,
        transfersAfectados: transfers.length,
        motivo: reason,
      },
    });
    notificationIds.push({ userId, idNotificacion });
  }
  return { reservations: reservations.length, transfers: transfers.length, notificationIds };
}

async function validateEntityInTransaction(connection, id, state, actorId, reason, dependencies = {}) {
  const pending = dependencies.pendingService || pendingService;
  const notify = dependencies.notifications || notifications;
  const recordHistory = dependencies.recordHistory || recordHistorial;
  const [[before]] = await connection.query(`SELECT Id_Entidad_Reportante,Nombre,Activo,Estado_Validacion
    FROM entidades_reportantes WHERE Id_Entidad_Reportante=? FOR UPDATE`, [id]);
  if (!before) throw error(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
  if (before.Estado_Validacion === state) throw error(409, 'ENTITY_STATE_UNCHANGED', 'La entidad ya tiene ese estado de validación.');
  const normalizedReason = String(reason || '').trim();
  if (state === 'RECHAZADA' && (!normalizedReason || normalizedReason.length > 300)) {
    throw error(400, 'ENTITY_REJECTION_REASON_INVALID', 'Escribe un motivo de rechazo de hasta 300 caracteres.');
  }

  await connection.query(`UPDATE entidades_reportantes SET Estado_Validacion=?,Actualizado_Por=?,
    Validado_Por=?,Validado_En=? WHERE Id_Entidad_Reportante=?`,
  [state, actorId, state === 'PENDIENTE_VALIDACION' ? null : actorId,
    state === 'PENDIENTE_VALIDACION' ? null : new Date(), id]);
  const historyDetails = [{ columna: 'Estado_Validacion', anterior: before.Estado_Validacion, nuevo: state }];
  if (state === 'RECHAZADA') historyDetails.push({ columna: 'Motivo de rechazo', anterior: null, nuevo: normalizedReason });
  await recordHistory({ conexion: connection, tabla: 'entidades_reportantes', id_registro: id,
    accion: state === 'RECHAZADA' ? 'RECHAZAR' : 'VALIDAR', id_usuario: actorId, detalles: historyDetails });

  let affected = { reservations: 0, transfers: 0, notificationIds: [] };
  if (state === 'RECHAZADA') {
    affected = await rejectRelatedOperations(connection, {
      id, actorId, name: before.Nombre, reason: normalizedReason, eventId: randomUUID(), notify, recordHistory,
    });
    await pending.resolveCondition(entityValidationPendingKey(id), connection);
  } else if (state === 'VALIDADA') {
    await pending.resolveCondition(entityValidationPendingKey(id), connection);
  } else {
    await upsertEntityValidationPending(connection, id, before.Nombre, pending);
  }
  return {
    Id_Entidad_Reportante: id,
    Estado_Validacion: state,
    Activo: Number(before.Activo),
    Motivo_Rechazo: state === 'RECHAZADA' ? normalizedReason : null,
    warning: state === 'VALIDADA' && !Number(before.Activo)
      ? 'La entidad sigue inactiva y no podrá usarse.' : null,
    reservasAfectadas: affected.reservations,
    transfersAfectados: affected.transfers,
    notificationIds: affected.notificationIds,
  };
}

async function runValidationTransaction(connection, { id, state, actorId, reason = '' }, dependencies = {}) {
  const websocket = dependencies.websocket || websocketManager;
  await connection.beginTransaction();
  try {
    const result = await validateEntityInTransaction(connection, id, state, actorId, reason, dependencies);
    await connection.commit();
    for (const notification of result.notificationIds) {
      try {
        websocket.sendToUser(notification.userId, {
          type: 'notificacionNueva', idNotificacion: notification.idNotificacion, categoria: 'entidades-reportantes',
        });
      } catch (emitError) {
        console.error('[entidades-reportantes] No se pudo emitir aviso en tiempo real:', emitError?.message || emitError);
      }
    }
    const { notificationIds, ...response } = result;
    return response;
  } catch (e) {
    await connection.rollback();
    throw e;
  }
}

async function validateEntity(id, state, actorId, reason = '') {
  if (!['PENDIENTE_VALIDACION', 'VALIDADA', 'RECHAZADA'].includes(state)) {
    throw error(400, 'ENTITY_STATE_INVALID', 'Estado de validación no válido.');
  }
  const normalizedReason = String(reason || '').trim();
  if (state === 'RECHAZADA' && (!normalizedReason || normalizedReason.length > 300)) {
    throw error(400, 'ENTITY_REJECTION_REASON_INVALID', 'Escribe un motivo de rechazo de hasta 300 caracteres.');
  }
  const conn = await db.getConnection();
  try {
    return await runValidationTransaction(conn, { id, state, actorId, reason: normalizedReason });
  }
  finally { conn.release(); }
}

module.exports = { TYPES, CHANNEL_TYPES, normalizeName, typeForChannel,
  searchKey, validateReservationEntity, listEntities, quickCreate, validateEntity,
  entityValidationPendingKey, upsertEntityValidationPending, rejectRelatedOperations,
  validateEntityInTransaction, runValidationTransaction,
  ENTITY_OPEN_OPERATION_STATES };
