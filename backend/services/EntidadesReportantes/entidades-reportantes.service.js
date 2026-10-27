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
  const [rows] = await executor.query('SELECT Nombre_Canal FROM canales_origen WHERE Id_Canal=? LIMIT 1', [channelId]);
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

async function quickCreate({ channelId, name, actorId, canValidate = false }) {
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
    const initialState = canValidate ? 'VALIDADA' : 'PENDIENTE_VALIDACION';
    const validAt = canValidate ? new Date() : null;
    const [inserted] = await conn.query(`INSERT INTO entidades_reportantes
      (Tipo,Nombre,Nombre_Normalizado,Estado_Validacion,Creado_Por,Actualizado_Por,Validado_Por,Validado_En)
      VALUES (?,?,?,?,?,?,?,?)`, [type, commercialName, key, initialState, actorId, actorId,
      canValidate ? actorId : null, validAt]);
    await recordHistorial({ conexion: conn, tabla: 'entidades_reportantes', id_registro: inserted.insertId,
      accion: 'CREAR', id_usuario: actorId,
      detalles: [{ columna: 'Tipo', anterior: null, nuevo: type },
        { columna: 'Nombre', anterior: null, nuevo: commercialName },
        { columna: 'Estado_Validacion', anterior: null, nuevo: initialState },
        ...(canValidate ? [{ columna: 'Validado_Por', anterior: null, nuevo: actorId },
          { columna: 'Validado_En', anterior: null, nuevo: validAt }] : [])] });
    if (!canValidate) await upsertEntityValidationPending(conn, inserted.insertId, commercialName);
    await conn.commit();
    return { entity: { Id_Entidad_Reportante: inserted.insertId, Tipo: type, Nombre: commercialName,
      Activo: 1, Estado_Validacion: initialState, Validado_Por: canValidate ? actorId : null,
      Validado_En: validAt }, created: true };
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
const ENTITY_CORRECTION_RULE = 'ENTIDAD_REPORTANTE_RECHAZADA_SIN_REASIGNAR';
const ENTITY_OPEN_OPERATION_STATES = ['Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Confirmada', 'Confirmado'];

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
      ruta: '/Mercadeo/Entidades?validacion=PENDIENTE_VALIDACION',
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
  id, actorId, name, reason, eventId, notify = notifications, pending = pendingService,
  recordHistory = recordHistorial,
}) {
  const [reservations] = await connection.query(`SELECT r.Id_Reserva,r.Estado,r.Creado_Por,r.Pendiente_Por_Entidad_En
    FROM reservas r WHERE r.Id_Entidad_Reportante=? FOR UPDATE`, [id]);
  const [transfers] = await connection.query(`SELECT tr.Id_Transfer,tr.Estado,tr.Creado_Por,tr.Pendiente_Por_Entidad_En
    FROM transfers tr WHERE tr.Id_Entidad_Reportante=? FOR UPDATE`, [id]);
  const byCreator = new Map();
  const addCreator = (userId, kind, operationId) => {
    if (!userId) return;
    const key = String(userId);
    if (!byCreator.has(key)) byCreator.set(key, { reservas: [], transfers: [] });
    byCreator.get(key)[kind].push(String(operationId));
  };

  for (const row of reservations) {
    await connection.query(`UPDATE reservas SET Id_Entidad_Reportante=NULL, Estado='Pendiente de datos',
      Pendiente_Por_Entidad_En=NULL WHERE Id_Reserva=?`, [row.Id_Reserva]);
    await recordHistory({ conexion: connection, tabla: 'reservas', id_registro: row.Id_Reserva,
      accion: 'ENTIDAD_REPORTANTE_RECHAZADA', id_usuario: actorId,
      detalles: [
        { columna: 'Estado', anterior: row.Estado, nuevo: 'Pendiente de datos' },
        { columna: 'Id_Entidad_Reportante', anterior: id, nuevo: null },
        { columna: 'Pendiente_Por_Entidad_En', anterior: row.Pendiente_Por_Entidad_En || null, nuevo: null },
      ] });
    addCreator(row.Creado_Por, 'reservas', row.Id_Reserva);
  }
  for (const row of transfers) {
    await connection.query(`UPDATE transfers SET Id_Entidad_Reportante=NULL, Estado='Pendiente de datos',
      Pendiente_Por_Entidad_En=NULL WHERE Id_Transfer=?`, [row.Id_Transfer]);
    await recordHistory({ conexion: connection, tabla: 'transfers', id_registro: row.Id_Transfer,
      accion: 'ENTIDAD_REPORTANTE_RECHAZADA', id_usuario: actorId,
      detalles: [
        { columna: 'Estado', anterior: row.Estado, nuevo: 'Pendiente de datos' },
        { columna: 'Id_Entidad_Reportante', anterior: id, nuevo: null },
        { columna: 'Pendiente_Por_Entidad_En', anterior: row.Pendiente_Por_Entidad_En || null, nuevo: null },
      ] });
    addCreator(row.Creado_Por, 'transfers', row.Id_Transfer);
  }

  const validators = await usersWithEntityValidationPermission(connection);
  const audiences = [
    ...[...byCreator].map(([userId, counts]) => ({ userId, role: 'CREADOR', counts })),
    { userId: null, role: 'VALIDADOR', counts: {
      reservas: reservations.map(row => String(row.Id_Reserva)),
      transfers: transfers.map(row => String(row.Id_Transfer)),
    } },
  ];
  const notificationIds = [];
  for (const { userId, role, counts } of audiences) {
    if (!counts.reservas.length && !counts.transfers.length) continue;
    const isValidator = role === 'VALIDADOR';
    const route = counts.reservas.length === 1 && !counts.transfers.length
      ? `/Reservas/EditarReserva/${encodeURIComponent(counts.reservas[0])}`
      : counts.transfers.length === 1 && !counts.reservas.length
        ? `/Transfers/EditarTransfer/${encodeURIComponent(counts.transfers[0])}`
        : '/Mercadeo/Reservas';
    const message = `${name}: ${counts.reservas.length} reservas y ${counts.transfers.length} transfers pendientes de entidad.`
      + (reason ? ` Motivo: ${reason}.` : '');
    const key = `ENTIDAD_RECHAZO:${eventId}:${role}:${userId || 'VALIDADORES'}`;
    const data = { nombreEntidad: name, ruta: route, rol: role, eventoRechazo: eventId,
      reservasAfectadas: counts.reservas.length, transfersAfectados: counts.transfers.length,
      reservasIds: counts.reservas, transfersIds: counts.transfers, motivo: reason };
    await pending.upsertCondition({ ruleCode: ENTITY_CORRECTION_RULE,
      deduplicationKey: key, entityType: 'ENTIDAD_REPORTANTE_RECHAZADA', entityId: eventId,
      userId, audiencePermission: isValidator ? 'ENTIDADES_REPORTANTES.VALIDAR' : null,
      title: `Entidad rechazada: ${String(name || '').slice(0, 110)}`,
      description: message, operationDate: new Date(), data,
    }, connection);
    for (const recipientId of isValidator ? validators : [userId]) {
      const idNotificacion = await notify.createNotification(connection, {
        userId: recipientId,
        type: 'ENTIDAD_REPORTANTE_RECHAZADA',
        title: `Entidad rechazada: ${String(name || '').slice(0, 110)}`,
        message,
        entityType: 'ENTIDAD_REPORTANTE_RECHAZADA',
        entityId: eventId,
        deduplicationKey: key,
        data,
      });
      notificationIds.push({ userId: recipientId, idNotificacion });
    }
  }
  return { reservations: reservations.length, transfers: transfers.length,
    reservationIds: reservations.map(row => String(row.Id_Reserva)),
    transferIds: transfers.map(row => String(row.Id_Transfer)), notificationIds };
}

async function resolveRejectedEntityOperation(connection, kind, operationId, pending = pendingService) {
  if (!['RESERVA', 'TRANSFER'].includes(kind)) throw new Error('Tipo de operación inválido.');
  const field = kind === 'RESERVA' ? 'reservasIds' : 'transfersIds';
  const [rows] = await connection.query(`SELECT p.Clave_Deduplicacion,p.Datos
    FROM pendientes_operativos p JOIN reglas_pendientes rp ON rp.Id_Regla=p.Id_Regla
    WHERE rp.Codigo=? AND p.Estado='ACTIVO'
      AND JSON_CONTAINS(JSON_EXTRACT(p.Datos, ?), JSON_QUOTE(?))
    FOR UPDATE`, [ENTITY_CORRECTION_RULE, `$.${field}`, String(operationId)]);
  const recipients = new Set();
  for (const row of rows) {
    const [noticeRows] = await connection.query(
      'SELECT Id_Usuario FROM notificaciones WHERE Clave_Deduplicacion=?', [row.Clave_Deduplicacion]);
    for (const notice of noticeRows) recipients.add(String(notice.Id_Usuario));
    const data = typeof row.Datos === 'string' ? JSON.parse(row.Datos) : row.Datos;
    data[field] = (data[field] || []).filter(value => String(value) !== String(operationId));
    data.reservasAfectadas = data.reservasIds.length;
    data.transfersAfectados = data.transfersIds.length;
    if (!data.reservasAfectadas && !data.transfersAfectados) {
      await pending.resolveCondition(row.Clave_Deduplicacion, connection);
      await connection.query(`UPDATE notificaciones SET Leida=1,Fecha_Lectura=COALESCE(Fecha_Lectura,NOW())
        WHERE Clave_Deduplicacion=?`, [row.Clave_Deduplicacion]);
    } else {
      const message = `${data.nombreEntidad}: ${data.reservasAfectadas} reservas y `
        + `${data.transfersAfectados} transfers pendientes de entidad.`
        + (data.motivo ? ` Motivo: ${data.motivo}.` : '');
      await connection.query(`UPDATE pendientes_operativos SET Datos=?,Descripcion=?
        WHERE Clave_Deduplicacion=?`, [JSON.stringify(data), message, row.Clave_Deduplicacion]);
      await connection.query(`UPDATE notificaciones SET Datos=?,Mensaje=?
        WHERE Clave_Deduplicacion=?`, [JSON.stringify(data), message, row.Clave_Deduplicacion]);
    }
  }
  return [...recipients];
}

async function validateEntityInTransaction(connection, id, state, actorId, reason, dependencies = {}) {
  const pending = dependencies.pendingService || pendingService;
  const notify = dependencies.notifications || notifications;
  const recordHistory = dependencies.recordHistory || recordHistorial;
  const [[before]] = await connection.query(`SELECT Id_Entidad_Reportante,Nombre,Tipo,Activo,Estado_Validacion,Creado_Por,Fecha_Creacion
    FROM entidades_reportantes WHERE Id_Entidad_Reportante=? FOR UPDATE`, [id]);
  if (!before) {
    if (state === 'RECHAZADA') throw error(409, 'ENTITY_ALREADY_RESOLVED', 'Esta entidad ya fue resuelta.');
    throw error(404, 'ENTITY_NOT_FOUND', 'Entidad reportante no encontrada.');
  }
  if (state === 'RECHAZADA' && (before.Estado_Validacion !== 'PENDIENTE_VALIDACION' || !Number(before.Activo))) {
    throw error(409, 'ENTITY_ALREADY_RESOLVED', 'Esta entidad ya fue resuelta. Solo se puede rechazar una entidad pendiente de validación y activa.');
  }
  if (before.Estado_Validacion === state) throw error(409, 'ENTITY_STATE_UNCHANGED', 'La entidad ya tiene ese estado de validación.');
  const normalizedReason = String(reason || '').trim();
  if (state === 'RECHAZADA' && normalizedReason.length > 200) {
    throw error(400, 'ENTITY_REJECTION_REASON_INVALID', 'El motivo de rechazo puede tener hasta 200 caracteres.');
  }

  let affected = { reservations: 0, transfers: 0, notificationIds: [] };
  if (state === 'RECHAZADA') {
    const eventId = (dependencies.eventIdFactory || randomUUID)();
    const rejectedAt = new Date();
    affected = await rejectRelatedOperations(connection, {
      id, actorId, name: before.Nombre, reason: normalizedReason, eventId, notify, pending, recordHistory,
    });
    await pending.resolveCondition(entityValidationPendingKey(id), connection);
    await recordHistory({ conexion: connection, tabla: 'entidades_reportantes', id_registro: id,
      accion: 'RECHAZAR', id_usuario: actorId, detalles: [
        { columna: 'Evento', anterior: null, nuevo: eventId },
        { columna: 'Nombre', anterior: null, nuevo: before.Nombre },
        { columna: 'Tipo', anterior: null, nuevo: before.Tipo },
        { columna: 'Creado_Por', anterior: null, nuevo: before.Creado_Por },
        { columna: 'Fecha_Creacion', anterior: null, nuevo: before.Fecha_Creacion },
        { columna: 'Rechazado_Por', anterior: null, nuevo: actorId },
        { columna: 'Rechazado_En', anterior: null, nuevo: rejectedAt },
        { columna: 'Motivo de rechazo', anterior: null, nuevo: normalizedReason || null },
        { columna: 'Reservas afectadas', anterior: null, nuevo: JSON.stringify(affected.reservationIds) },
        { columna: 'Transfers afectados', anterior: null, nuevo: JSON.stringify(affected.transferIds) },
      ] });
    await connection.query('DELETE FROM entidad_reportante_puntos WHERE Id_Entidad_Reportante=?', [id]);
    await connection.query('DELETE FROM perfiles_comision_entidad WHERE Id_Entidad_Reportante=?', [id]);
    await connection.query('DELETE FROM entidades_reportantes WHERE Id_Entidad_Reportante=?', [id]);
  } else if (state === 'VALIDADA') {
    await connection.query(`UPDATE entidades_reportantes SET Estado_Validacion=?,Actualizado_Por=?,Validado_Por=?,Validado_En=?
      WHERE Id_Entidad_Reportante=?`, [state, actorId, actorId, new Date(), id]);
    await recordHistory({ conexion: connection, tabla: 'entidades_reportantes', id_registro: id,
      accion: 'VALIDAR', id_usuario: actorId,
      detalles: [{ columna: 'Estado_Validacion', anterior: before.Estado_Validacion, nuevo: state }] });
    await pending.resolveCondition(entityValidationPendingKey(id), connection);
  } else {
    await connection.query(`UPDATE entidades_reportantes SET Estado_Validacion=?,Actualizado_Por=?,Validado_Por=NULL,Validado_En=NULL
      WHERE Id_Entidad_Reportante=?`, [state, actorId, id]);
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
  if (state === 'RECHAZADA' && normalizedReason.length > 200) {
    throw error(400, 'ENTITY_REJECTION_REASON_INVALID', 'El motivo de rechazo puede tener hasta 200 caracteres.');
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
  validateEntityInTransaction, runValidationTransaction, resolveRejectedEntityOperation,
  ENTITY_OPEN_OPERATION_STATES };
