const db = require('../../database/db');
const policy = require('./pendientes-policy.service');
const pendingService = require('./pendientes.service');

const PENDING_STATES = ['Pendiente', 'Pendiente de datos', 'Pendiente de pago'];

function descriptionFor(entityLabel, state) {
  if (state === 'Pendiente de datos') return `${entityLabel} tiene información operativa pendiente.`;
  if (state === 'Pendiente de pago') return `${entityLabel} tiene el pago o su comprobación pendiente.`;
  return `${entityLabel} todavía requiere datos y confirmación de pago.`;
}

async function syncRule(ruleCode, rows, mapper) {
  const detections = rows.map(mapper);
  const detectedKeys = new Set(detections.map((item) => item.deduplicationKey));
  for (const detection of detections) await pendingService.upsertCondition(detection);

  const currentKeys = await pendingService.activeKeysForRule(ruleCode);
  for (const key of currentKeys) {
    if (!detectedKeys.has(key)) await pendingService.resolveCondition(key);
  }
  return detections.length;
}

async function syncReservationPendings() {
  const rule = await policy.getRuleByCode('RESERVA_ESTADO_PENDIENTE');
  if (!rule?.activa) return 0;
  const days = Math.min(Math.max(Number(rule.configuracion?.diasAnticipacion) || 30, 1), 365);
  const [rows] = await db.query(
    `SELECT r.Id_Reserva, r.Estado, r.Fecha_Tour,
            CASE WHEN LOWER(TRIM(COALESCE(ro.Nombre_Rol, ''))) <> 'cliente' THEN r.Creado_Por ELSE NULL END AS Destino_Interno
       FROM reservas r
       LEFT JOIN usuarios u ON u.Id_Usuario = r.Creado_Por
       LEFT JOIN roles ro ON ro.Id_Rol = u.Id_Rol
      WHERE r.Fecha_Tour BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND r.Estado IN (?)`,
    [days, PENDING_STATES]
  );
  return syncRule(rule.codigo, rows, (row) => ({
    ruleCode: rule.codigo,
    deduplicationKey: `RESERVA:${row.Id_Reserva}:ESTADO_PENDIENTE`,
    entityType: 'RESERVA',
    entityId: row.Id_Reserva,
    userId: row.Destino_Interno || null,
    audiencePermission: row.Destino_Interno ? null : 'RESERVAS.LEER',
    title: `Reserva ${row.Id_Reserva}: ${row.Estado}`,
    description: descriptionFor('La reserva', row.Estado),
    operationDate: row.Fecha_Tour,
    data: { estadoOrigen: row.Estado, ruta: `/Reservas/EditarReserva/${row.Id_Reserva}` },
  }));
}

async function syncTransferPendings() {
  const rule = await policy.getRuleByCode('TRANSFER_ESTADO_PENDIENTE');
  if (!rule?.activa) return 0;
  const days = Math.min(Math.max(Number(rule.configuracion?.diasAnticipacion) || 30, 1), 365);
  const [rows] = await db.query(
    `SELECT tr.Id_Transfer, tr.Estado, tr.Fecha_Transfer,
            CASE WHEN LOWER(TRIM(COALESCE(ro.Nombre_Rol, ''))) <> 'cliente' THEN tr.Creado_Por ELSE NULL END AS Destino_Interno
       FROM transfers tr
       LEFT JOIN usuarios u ON u.Id_Usuario = tr.Creado_Por
       LEFT JOIN roles ro ON ro.Id_Rol = u.Id_Rol
      WHERE tr.Fecha_Transfer BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND tr.Estado IN (?)`,
    [days, PENDING_STATES]
  );
  return syncRule(rule.codigo, rows, (row) => ({
    ruleCode: rule.codigo,
    deduplicationKey: `TRANSFER:${row.Id_Transfer}:ESTADO_PENDIENTE`,
    entityType: 'TRANSFER',
    entityId: row.Id_Transfer,
    userId: row.Destino_Interno || null,
    audiencePermission: row.Destino_Interno ? null : 'TRANSFERS.LEER',
    title: `Transfer TR-${String(row.Id_Transfer).padStart(4, '0')}: ${row.Estado}`,
    description: descriptionFor('El transfer', row.Estado),
    operationDate: row.Fecha_Transfer,
    data: { estadoOrigen: row.Estado, ruta: `/Transfers/EditarTransfer/${row.Id_Transfer}` },
  }));
}

async function syncDomainStatePendings() {
  const [reservations, transfers] = await Promise.all([
    syncReservationPendings(),
    syncTransferPendings(),
  ]);
  return { reservations, transfers };
}

module.exports = {
  PENDING_STATES,
  descriptionFor,
  syncReservationPendings,
  syncTransferPendings,
  syncDomainStatePendings,
};
