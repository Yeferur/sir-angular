const pendingService = require('./pendientes.service');

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
    title: process.label,
    description: process.description,
    data: { count: Number(process.count || 0), ruta: process.route },
  };
}

async function syncHomeProcesses(processes = []) {
  const detections = processes.map(detectionFromProcess).filter(Boolean);
  return Promise.all(detections.map((detection) => {
    const count = Number(detection.data.count || 0);
    return count > 0
      ? pendingService.upsertCondition(detection)
      : pendingService.resolveCondition(detection.deduplicationKey);
  }));
}

module.exports = { HOME_RULES, detectionFromProcess, syncHomeProcesses };
