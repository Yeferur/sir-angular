const db = require('../../database/db');
const policy = require('./pendientes-policy.service');
const { toMysqlDateTime } = require('../../utils/dateTime');

class PendingOperationError extends Error {
  constructor(message, status = 400, code = 'PENDING_OPERATION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asMysqlDate(value) {
  return toMysqlDateTime(value);
}

function parseJson(value) {
  if (value == null || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
}

function mapPending(row) {
  const suppressedUntil = row.Suprimido_Hasta ? new Date(row.Suprimido_Hasta) : null;
  return {
    idPendiente: String(row.Id_Pendiente),
    regla: row.Regla_Codigo,
    entidadTipo: row.Entidad_Tipo,
    entidadId: String(row.Entidad_Id),
    titulo: row.Titulo,
    descripcion: row.Descripcion,
    prioridad: row.Prioridad,
    estado: row.Estado,
    fechaOperacion: row.Fecha_Operacion,
    fechaLimite: row.Fecha_Limite,
    suprimidoHasta: row.Suprimido_Hasta,
    estaSuprimido: !!(suppressedUntil && suppressedUntil.getTime() > Date.now()),
    siguienteRecordatorio: row.Siguiente_Recordatorio,
    permiteDescarte: !!row.Permite_Descarte,
    requiereJustificacion: !!row.Requiere_Justificacion,
    posposicionMaxMinutos: row.Posposicion_Max_Minutos == null ? null : Number(row.Posposicion_Max_Minutos),
    primeraDeteccion: row.Primera_Deteccion,
    ultimaDeteccion: row.Ultima_Deteccion,
    datos: parseJson(row.Datos),
  };
}

function audienceClause(userId, permissions) {
  const permissionList = [...new Set((permissions || []).map(String).filter(Boolean))];
  if (!permissionList.length) {
    return {
      sql: "p.Id_Usuario_Destino = ? AND (p.Permiso_Audiencia IS NULL OR p.Permiso_Audiencia NOT LIKE '%&%')",
      params: [userId],
    };
  }
  return {
    sql: `((p.Id_Usuario_Destino = ? AND (p.Permiso_Audiencia IS NULL OR p.Permiso_Audiencia NOT LIKE '%&%' OR
              JSON_CONTAINS(CAST(? AS JSON),
                CONCAT('["', REPLACE(p.Permiso_Audiencia, '&', '","'), '"]')) = 1))
           OR (p.Id_Usuario_Destino IS NULL AND p.Permiso_Audiencia IN (${permissionList.map(() => '?').join(',')})))`,
    params: [userId, JSON.stringify(permissionList), ...permissionList],
  };
}

const SELECT_BASE = `
  SELECT p.*, r.Codigo AS Regla_Codigo, r.Permite_Descarte,
         r.Requiere_Justificacion, r.Posposicion_Max_Minutos
    FROM pendientes_operativos p
    INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla`;

async function listMine(userId, permissions, { includeSuppressed = true } = {}) {
  const audience = audienceClause(userId, permissions);
  const suppression = includeSuppressed ? '' : ' AND (p.Suprimido_Hasta IS NULL OR p.Suprimido_Hasta <= NOW())';
  const [rows] = await db.query(
    `${SELECT_BASE}
      WHERE p.Estado = 'ACTIVO' AND ${audience.sql}${suppression}
      ORDER BY FIELD(p.Prioridad, 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'),
               COALESCE(p.Fecha_Limite, p.Fecha_Operacion, '9999-12-31'), p.Primera_Deteccion`,
    audience.params
  );
  return rows.map(mapPending);
}

async function findAccessibleForUpdate(connection, pendingId, userId, permissions, expectedRuleCode = null) {
  const audience = audienceClause(userId, permissions);
  const [rows] = await connection.query(
    `${SELECT_BASE} WHERE p.Id_Pendiente = ? AND ${audience.sql} LIMIT 1 FOR UPDATE`,
    [pendingId, ...audience.params]
  );
  if (!rows[0]) throw new PendingOperationError('Pendiente no encontrado.', 404, 'PENDING_NOT_FOUND');
  if (expectedRuleCode && rows[0].Regla_Codigo !== expectedRuleCode) {
    throw new PendingOperationError('Pendiente no encontrado.', 404, 'PENDING_NOT_FOUND');
  }
  return { row: rows[0], pending: mapPending(rows[0]) };
}

async function postpone(pendingId, userId, permissions, suppressedUntil, expectedRuleCode = null) {
  const until = new Date(suppressedUntil);
  const now = new Date();
  if (Number.isNaN(until.getTime()) || until <= now) {
    throw new PendingOperationError('Selecciona una fecha y hora futura para posponer.', 400, 'INVALID_SUPPRESSION_DATE');
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { row } = await findAccessibleForUpdate(connection, pendingId, userId, permissions, expectedRuleCode);
    if (row.Estado !== 'ACTIVO') throw new PendingOperationError('Solo se puede posponer un pendiente activo.', 409, 'PENDING_NOT_ACTIVE');
    if (row.Posposicion_Max_Minutos && until.getTime() > now.getTime() + Number(row.Posposicion_Max_Minutos) * 60000) {
      throw new PendingOperationError(
        `Este pendiente puede posponerse máximo ${row.Posposicion_Max_Minutos} minutos.`,
        422,
        'SUPPRESSION_LIMIT_EXCEEDED'
      );
    }
    await connection.query(
      `UPDATE pendientes_operativos
          SET Suprimido_Hasta = ?, Siguiente_Recordatorio = GREATEST(COALESCE(Siguiente_Recordatorio, ?), ?)
        WHERE Id_Pendiente = ?`,
      [asMysqlDate(until), asMysqlDate(until), asMysqlDate(until), pendingId]
    );
    await connection.query(
      `INSERT INTO pendientes_eventos (Id_Pendiente, Tipo, Id_Usuario, Datos)
       VALUES (?, 'POSPUESTO', ?, ?)`,
      [pendingId, userId, JSON.stringify({ suprimidoHasta: until.toISOString() })]
    );
    await connection.commit();
    return { idPendiente: String(pendingId), estado: 'ACTIVO', suprimidoHasta: until.toISOString() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function dismiss(pendingId, userId, permissions, reason, expectedRuleCode = null) {
  const normalizedReason = String(reason || '').trim();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { row } = await findAccessibleForUpdate(connection, pendingId, userId, permissions, expectedRuleCode);
    if (row.Estado !== 'ACTIVO') throw new PendingOperationError('Solo se puede descartar un pendiente activo.', 409, 'PENDING_NOT_ACTIVE');
    if (!row.Permite_Descarte) throw new PendingOperationError('Esta situación debe resolverse en su proceso de origen.', 422, 'DISMISS_NOT_ALLOWED');
    if (row.Requiere_Justificacion && !normalizedReason) {
      throw new PendingOperationError('Debes indicar el motivo del descarte.', 422, 'DISMISS_REASON_REQUIRED');
    }
    await connection.query(
      `UPDATE pendientes_operativos
          SET Estado = 'DESCARTADO', Motivo_Descarte = ?, Descartado_Por = ?,
              Fecha_Descarte = NOW(), Suprimido_Hasta = NULL, Siguiente_Recordatorio = NULL
        WHERE Id_Pendiente = ?`,
      [normalizedReason || null, userId, pendingId]
    );
    await connection.query(
      `INSERT INTO pendientes_eventos (Id_Pendiente, Tipo, Id_Usuario, Motivo)
       VALUES (?, 'DESCARTADO', ?, ?)`,
      [pendingId, userId, normalizedReason || null]
    );
    await connection.commit();
    return { idPendiente: String(pendingId), estado: 'DESCARTADO' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertCondition(input, connection = null) {
  const ownsConnection = !connection;
  const executor = connection || await db.getConnection();
  try {
    if (ownsConnection) await executor.beginTransaction();
    const rule = await policy.getRuleByCode(input.ruleCode, executor);
    if (!rule?.activa) throw new PendingOperationError(`La regla ${input.ruleCode} no existe o está inactiva.`, 422, 'RULE_INACTIVE');
    if (!input.userId && !input.audiencePermission) {
      throw new PendingOperationError('La regla debe determinar un usuario o permiso de audiencia.', 422, 'PENDING_AUDIENCE_REQUIRED');
    }
    const key = String(input.deduplicationKey || `${input.ruleCode}:${input.entityType}:${input.entityId}`).slice(0, 191);
    const [existingRows] = await executor.query(
      'SELECT Id_Pendiente, Estado FROM pendientes_operativos WHERE Clave_Deduplicacion = ? LIMIT 1 FOR UPDATE',
      [key]
    );
    const priority = policy.priorityFor(rule, input.operationDate);
    const nextReminder = policy.nextReminderFor(rule);
    let pendingId;
    let eventType = null;
    if (!existingRows[0]) {
      const [result] = await executor.query(
        `INSERT INTO pendientes_operativos
          (Id_Regla, Clave_Deduplicacion, Entidad_Tipo, Entidad_Id, Id_Usuario_Destino,
           Permiso_Audiencia, Titulo, Descripcion, Prioridad, Fecha_Operacion,
           Fecha_Limite, Siguiente_Recordatorio, Datos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rule.id, key, input.entityType, String(input.entityId), input.userId || null,
          input.audiencePermission || null, input.title || rule.nombre, input.description || rule.descripcion,
          priority, asMysqlDate(input.operationDate), asMysqlDate(input.deadline), asMysqlDate(nextReminder),
          input.data ? JSON.stringify(input.data) : null]
      );
      pendingId = result.insertId;
      eventType = 'DETECTADO';
    } else {
      pendingId = existingRows[0].Id_Pendiente;
      const shouldReactivate = existingRows[0].Estado === 'RESUELTO_AUTOMATICAMENTE';
      await executor.query(
        `UPDATE pendientes_operativos
            SET Id_Usuario_Destino = ?, Permiso_Audiencia = ?, Titulo = ?, Descripcion = ?,
                Prioridad = ?, Fecha_Operacion = ?, Fecha_Limite = ?, Ultima_Deteccion = NOW(),
                Datos = ?,
                Fecha_Resolucion = IF(Estado = 'RESUELTO_AUTOMATICAMENTE', NULL, Fecha_Resolucion),
                Siguiente_Recordatorio = IF(Estado = 'RESUELTO_AUTOMATICAMENTE', ?, Siguiente_Recordatorio),
                Estado = IF(Estado = 'RESUELTO_AUTOMATICAMENTE', 'ACTIVO', Estado)
          WHERE Id_Pendiente = ?`,
        [input.userId || null, input.audiencePermission || null, input.title || rule.nombre,
          input.description || rule.descripcion, priority, asMysqlDate(input.operationDate), asMysqlDate(input.deadline),
          input.data ? JSON.stringify(input.data) : null, asMysqlDate(nextReminder), pendingId]
      );
      if (shouldReactivate) eventType = 'REACTIVADO';
    }
    if (eventType) {
      await executor.query(
        'INSERT INTO pendientes_eventos (Id_Pendiente, Tipo, Datos) VALUES (?, ?, ?)',
        [pendingId, eventType, input.data ? JSON.stringify(input.data) : null]
      );
    }
    if (ownsConnection) await executor.commit();
    return { idPendiente: String(pendingId), eventType };
  } catch (error) {
    if (ownsConnection) await executor.rollback();
    throw error;
  } finally {
    if (ownsConnection) executor.release();
  }
}

async function resolveCondition(deduplicationKey, connection = null) {
  const executor = connection || db;
  const [result] = await executor.query(
    `UPDATE pendientes_operativos
        SET Estado = 'RESUELTO_AUTOMATICAMENTE', Fecha_Resolucion = NOW(),
            Suprimido_Hasta = NULL, Siguiente_Recordatorio = NULL
      WHERE Clave_Deduplicacion = ? AND Estado = 'ACTIVO'`,
    [deduplicationKey]
  );
  if (!result.affectedRows) return false;
  await executor.query(
    `INSERT INTO pendientes_eventos (Id_Pendiente, Tipo)
     SELECT Id_Pendiente, 'RESUELTO_AUTOMATICAMENTE'
       FROM pendientes_operativos WHERE Clave_Deduplicacion = ?`,
    [deduplicationKey]
  );
  return true;
}

async function audit({ limit = 100, state = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const params = [];
  const where = state ? 'WHERE p.Estado = ?' : '';
  if (state) params.push(state);
  params.push(safeLimit);
  const [rows] = await db.query(
    `${SELECT_BASE} ${where}
     ORDER BY p.Fecha_Actualizacion DESC LIMIT ?`,
    params
  );
  return rows.map(mapPending);
}

async function activeKeysForRule(ruleCode) {
  const [rows] = await db.query(
    `SELECT p.Clave_Deduplicacion
       FROM pendientes_operativos p
       INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla
      WHERE r.Codigo = ? AND p.Estado = 'ACTIVO'`,
    [ruleCode]
  );
  return rows.map((row) => row.Clave_Deduplicacion);
}

module.exports = {
  PendingOperationError,
  listMine,
  postpone,
  dismiss,
  upsertCondition,
  resolveCondition,
  audit,
  activeKeysForRule,
  audienceClause,
  mapPending,
};
