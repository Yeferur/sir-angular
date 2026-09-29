const crypto = require('node:crypto');
const db = require('../../database/db');
const pendingService = require('../Pendientes/pendientes.service');
const { usersWithPermissions, pendingNotificationKey } = require('../Pendientes/pendientes-trigger.service');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');
const { RULE_CODE, REQUIRED_PERMISSIONS, AUDIENCE_PERMISSION } = require('./programacion-novedades.service');

// Campos operativos usados por el listado/Excel actual. DNI, reportante, dinero,
// moneda, pagos, comprobantes y metadatos no forman parte de esta referencia.
const FIELDS = [
  ['Fecha_Transfer', 'Fecha'], ['Hora_Recogida', 'Hora de recogida'], ['Estado', 'Estado'],
  ['Punto_Salida', 'Origen'], ['Punto_Destino', 'Destino'], ['Cantidad_Personas', 'Pasajeros'],
  ['Nombre_Servicio', 'Servicio'], ['Rango_Descripcion', 'Rango'],
  ['Nombre_Titular', 'Titular'], ['Telefono_Titular', 'Teléfono de contacto'],
  ['Vuelo', 'Vuelo'], ['TipoVuelo', 'Tipo de vuelo'], ['Observaciones', 'Notas'],
];

function dateLabel(value) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value || '').slice(0, 10);
}

function parseJson(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function changeSignature(changes = []) {
  return JSON.stringify(changes.map(({ campo, anterior, actual }) => [campo, anterior, actual]));
}

function operationalSnapshot(row) {
  // Usar la misma normalización que la exportación, incluyendo horas 12/24h.
  const { normalizarHoraProgramacionTransfer } = require('./programacion.service');
  const data = {};
  for (const [field] of FIELDS) {
    let value = row[field];
    if (field === 'Fecha_Transfer') value = dateLabel(value);
    else if (field === 'Hora_Recogida') value = normalizarHoraProgramacionTransfer(value).display || '';
    else if (field === 'Cantidad_Personas') value = Math.max(0, Number(value || 0));
    else value = String(value ?? '').trim();
    data[field] = value;
  }
  return data;
}

function changedTransfer(snapshot, current) {
  const before = parseJson(snapshot.Datos_Snapshot);
  if (!current) return [{ campo: 'Transfer', anterior: 'Incluido en el listado preparado', actual: 'Ya no está disponible', revision: null }];
  const now = operationalSnapshot(current);
  return FIELDS.filter(([field]) => before[field] !== now[field]).map(([field, campo]) => ({
    campo, anterior: String(before[field] ?? '') || 'Sin dato', actual: String(now[field] ?? '') || 'Sin dato', revision: null,
  }));
}

async function loadRows(executor, { fecha, ids } = {}) {
  if (ids && !ids.length) return [];
  const scope = ids ? 'tr.Id_Transfer IN (?)'
    : "tr.Fecha_Transfer = ? AND LOWER(TRIM(COALESCE(tr.Estado, ''))) NOT IN ('cancelado', 'cancelada')";
  const [rows] = await executor.query(`SELECT tr.Id_Transfer,
      CONCAT('TRS', LPAD(tr.Id_Transfer, 5, '0')) AS Codigo_Transfer,
      tr.Fecha_Transfer, tr.Hora_Recogida, tr.Estado, tr.Punto_Salida, tr.Punto_Destino,
      tr.Nombre_Titular, tr.Telefono_Titular, tr.DNI, tr.Cantidad_Personas,
      tr.Vuelo, tr.TipoVuelo, tr.Observaciones,
      COALESCE(NULLIF(s.Nombre_Servicio, ''), 'Sin servicio') AS Nombre_Servicio,
      COALESCE(NULLIF(rg.Descripcion, ''), 'Sin rango') AS Rango_Descripcion
    FROM transfers tr
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
    LEFT JOIN transfers_rangos rg ON rg.Id_Rango = tr.Id_Rango
    WHERE ${scope} ORDER BY Nombre_Servicio ASC, tr.Id_Transfer ASC`, [ids || fecha]);
  return rows || [];
}

async function saveExportedList(data, userId = null) {
  const snapshots = data.transfers.map((row) => ({ id: String(row.Id_Transfer), data: operationalSnapshot(row) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const signature = crypto.createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Esta fila serializa exportaciones y detecciones de la misma fecha.
    await connection.query(`INSERT INTO programacion_transfers_listados (Fecha_Operacion)
      VALUES (?) ON DUPLICATE KEY UPDATE Fecha_Operacion = Fecha_Operacion`, [data.fecha]);
    const [[list]] = await connection.query(`SELECT CAST(Revision AS CHAR) AS Revision, Firma
      FROM programacion_transfers_listados WHERE Fecha_Operacion = ? FOR UPDATE`, [data.fecha]);
    const changed = list.Firma !== signature;
    const revision = changed ? String(BigInt(list.Revision) + 1n) : list.Revision;
    if (changed) {
      await connection.query(`UPDATE programacion_transfers_listados SET Revision = ?, Firma = ?,
        Confirmado_En = NOW(3), Confirmado_Por = ? WHERE Fecha_Operacion = ?`, [revision, signature, userId, data.fecha]);
      if (snapshots.length) await connection.query(`INSERT INTO programacion_transfers_snapshot
        (Fecha_Operacion, Revision_Listado, Id_Transfer, Datos_Snapshot) VALUES ?`, [
        snapshots.map((snapshot) => [data.fecha, revision, snapshot.id, JSON.stringify(snapshot.data)]),
      ]);
    }
    await connection.commit();
    return { fecha: data.fecha, revision, changed };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

function emitUpdates(fecha, delivered, notices, resolvedUsers) {
  for (const userId of delivered) websocketManager.sendToUser(userId, { type: 'programacionNovedadesActualizadas', fecha });
  for (const { userId, notificationId } of notices) websocketManager.sendToUser(userId, {
    type: 'notificacionNueva', idNotificacion: notificationId, categoria: 'pendientes',
  });
  // Avisos usa este evento existente para recargar también noLeidas después de
  // markPendingHandled. Un envío por destinatario aunque se resuelvan varios.
  for (const userId of resolvedUsers) websocketManager.sendToUser(userId, { type: 'actividadActualizada', categoria: 'pendientes' });
}

async function syncForDate(fecha) {
  const date = dateLabel(fecha);
  const connection = await db.getConnection();
  const delivered = new Set();
  const notices = [];
  const resolvedUsers = new Set();
  try {
    await connection.beginTransaction();
    const [[list]] = await connection.query(`SELECT CAST(Revision AS CHAR) AS Revision
      FROM programacion_transfers_listados WHERE Fecha_Operacion = ? FOR UPDATE`, [date]);
    if (!list || list.Revision === '0') { await connection.commit(); return { changed: 0 }; }
    const [snapshots] = await connection.query(`SELECT Id_Transfer, Datos_Snapshot FROM programacion_transfers_snapshot
      WHERE Fecha_Operacion = ? AND Revision_Listado = ? ORDER BY Id_Transfer`, [date, list.Revision]);
    const current = new Map((await loadRows(connection, { ids: snapshots.map((row) => String(row.Id_Transfer)) }))
      .map((row) => [String(row.Id_Transfer), row]));
    const eligible = new Set(await usersWithPermissions(connection, REQUIRED_PERMISSIONS));
    const expected = new Set();
    for (const snapshot of snapshots) {
      const id = String(snapshot.Id_Transfer);
      const changes = changedTransfer(snapshot, current.get(id));
      if (!changes.length) continue;
      const code = `TRS${id.padStart(5, '0')}`;
      for (const userId of eligible) {
        const key = `PROGRAMACION_TRANSFER:${date}:${list.Revision}:${id}:${userId}`;
        expected.add(key);
        const data = { tipo: 'TRANSFER', fecha: date, revisionListado: list.Revision, transferId: id,
          cambios: changes, ruta: `/Programacion/Transfers/${date}` };
        const [[previous]] = await connection.query(`SELECT Estado, Datos FROM pendientes_operativos
          WHERE Clave_Deduplicacion = ? LIMIT 1 FOR UPDATE`, [key]);
        const result = await pendingService.upsertCondition({
          ruleCode: RULE_CODE, deduplicationKey: key, entityType: 'PROGRAMACION_CAMBIO',
          entityId: `${date}:TRANSFER:${id}`, userId, audiencePermission: AUDIENCE_PERMISSION,
          title: `Novedades de Programación: Transfer ${code}`,
          description: `${code} cambió respecto al listado de Transfers preparado para ${date}: ${changes.map((c) => c.campo).join(', ')}.`.slice(0, 500),
          operationDate: date, data,
        }, connection);
        if (result.eventType || (previous?.Estado === 'ACTIVO'
          && changeSignature(parseJson(previous.Datos)?.cambios) !== changeSignature(changes))) delivered.add(userId);
        if (result.eventType === 'DETECTADO' || result.eventType === 'REACTIVADO') {
          // La clave compartida con el worker existente evita una segunda
          // notificación del mismo ciclo, incluso tras un reinicio.
          const [[cycle]] = await connection.query(`SELECT MAX(Id_Evento) AS Ciclo_Notificacion FROM pendientes_eventos
            WHERE Id_Pendiente = ? AND Tipo IN ('DETECTADO','REACTIVADO')`, [result.idPendiente]);
          const notificationId = await notifications.createNotification(connection, {
            userId, type: 'PENDIENTE', title: `Cambios en Transfer ${code}`,
            message: `Revisa el listado preparado para ${date}: ${changes.map((c) => c.campo).join(', ')}.`.slice(0, 500),
            entityType: 'PROGRAMACION_CAMBIO', entityId: `${date}:TRANSFER:${id}`,
            data: { ...data, pendienteId: result.idPendiente },
            deduplicationKey: pendingNotificationKey({ Id_Pendiente: result.idPendiente, ...cycle }, data),
          });
          notices.push({ userId, notificationId });
        }
      }
    }
    const [stale] = await connection.query(`SELECT p.Clave_Deduplicacion, p.Id_Usuario_Destino
      FROM pendientes_operativos p INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla
      WHERE r.Codigo = ? AND p.Estado = 'ACTIVO' AND p.Entidad_Tipo = 'PROGRAMACION_CAMBIO'
        AND JSON_UNQUOTE(JSON_EXTRACT(p.Datos, '$.tipo')) = 'TRANSFER'
        AND JSON_UNQUOTE(JSON_EXTRACT(p.Datos, '$.fecha')) = ?`, [RULE_CODE, date]);
    for (const row of stale) {
      if (!expected.has(row.Clave_Deduplicacion) && await pendingService.resolveCondition(row.Clave_Deduplicacion, connection)) {
        // También refrescar a quien acaba de perder audiencia para quitar el aviso.
        delivered.add(Number(row.Id_Usuario_Destino));
        resolvedUsers.add(Number(row.Id_Usuario_Destino));
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  emitUpdates(date, delivered, notices, resolvedUsers);
  return { changed: delivered.size };
}

async function syncForTransferChange(transferId) {
  // Busca la fecha original, aunque el transfer cambie de fecha o se elimine.
  const [rows] = await db.query(`SELECT DISTINCT s.Fecha_Operacion FROM programacion_transfers_snapshot s
    INNER JOIN programacion_transfers_listados l ON l.Fecha_Operacion = s.Fecha_Operacion AND l.Revision = s.Revision_Listado
    WHERE s.Id_Transfer = ?`, [transferId]);
  for (const row of rows) await syncForDate(row.Fecha_Operacion);
}

async function syncSavedLists() {
  const [rows] = await db.query('SELECT Fecha_Operacion FROM programacion_transfers_listados WHERE Revision > 0 ORDER BY Fecha_Operacion');
  for (const row of rows) await syncForDate(row.Fecha_Operacion);
  return { lists: rows.length };
}

module.exports = { FIELDS, operationalSnapshot, changedTransfer, loadRows, saveExportedList,
  syncForDate, syncForTransferChange, syncSavedLists };
