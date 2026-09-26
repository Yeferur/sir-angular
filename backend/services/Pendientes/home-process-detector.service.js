const pendingService = require('./pendientes.service');
const websocketManager = require('../../websocketManager');

const HOME_RULES = Object.freeze({
  confirmation: 'CONTROL_VIAJE_CIERRE_PENDIENTE',
  programming: 'PROGRAMACION_NO_ACTIVA',
  insurance: 'SEGUROS_INCOMPLETOS',
  commissions: 'COMISIONES_PENDIENTES',
});

function detectionFromProcess(process) {
  const ruleCode = HOME_RULES[process?.id];
  if (!ruleCode) return null;
  return {
    ruleCode,
    deduplicationKey: `HOME:${process.id}`,
    entityType: 'OPERACION',
    entityId: process.id,
    audiencePermission: process.permission,
    title: process.notificationTitle || process.label,
    description: process.description,
    data: {
      count: Number(process.count || 0),
      ruta: process.route,
      ...(process.periodStart ? { periodoDesde: process.periodStart } : {}),
      ...(process.periodEnd ? { periodoHasta: process.periodEnd } : {}),
      ...(process.tourId ? { tourId: process.tourId } : {}),
      ...(process.tourName ? { tourName: process.tourName } : {}),
      ...(process.notificationIdentity ? { notificationIdentity: process.notificationIdentity } : {}),
    },
  };
}

async function syncHomeProcesses(processes = []) {
  const detections = processes.map(detectionFromProcess).filter(Boolean);
  const results = await Promise.all(detections.map((detection) => {
    const count = Number(detection.data.count || 0);
    return count > 0
      ? pendingService.upsertCondition(detection)
      : pendingService.resolveCondition(detection.deduplicationKey);
  }));
  if (results.some((result, index) => Number(detections[index]?.data.count || 0) === 0 && result === true)) {
    websocketManager.broadcastToInternal({ type: 'actividadActualizada', categoria: 'pendientes' });
  }
  return results;
}

module.exports = { HOME_RULES, detectionFromProcess, syncHomeProcesses };
