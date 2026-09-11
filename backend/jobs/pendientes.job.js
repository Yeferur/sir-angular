const { syncDomainStatePendings } = require('../services/Pendientes/domain-state-detector.service');
const { processDueReminders } = require('../services/Recordatorios/recordatorios-trigger.service');
const { processDuePendings } = require('../services/Pendientes/pendientes-trigger.service');

const DEFAULT_INTERVAL_MS = 60 * 1000;
let timer = null;
let initialTimer = null;
let activeRun = null;

function getInterval(env = process.env) {
  const configured = Number(env.PENDIENTES_JOB_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  return Math.min(Math.max(Number.isFinite(configured) ? configured : DEFAULT_INTERVAL_MS, 60_000), 60 * 60 * 1000);
}

async function execute() {
  if (activeRun) return activeRun;
  activeRun = Promise.all([syncDomainStatePendings(), processDueReminders(), processDuePendings()])
    .catch((error) => {
      if (error?.code === 'ER_NO_SUCH_TABLE') {
        console.warn('[Pendientes] Falta aplicar la migración del módulo; la detección queda en espera.');
        return null;
      }
      console.error('[Pendientes] Error sincronizando estados de Reservas/Transfers:', error);
      return null;
    })
    .finally(() => { activeRun = null; });
  return activeRun;
}

function iniciarPendientesJob(env = process.env) {
  if (timer || initialTimer) return timer || initialTimer;
  const interval = getInterval(env);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void execute();
  }, 0);
  initialTimer.unref?.();
  timer = setInterval(() => { void execute(); }, interval);
  timer.unref?.();
  console.log(`[Pendientes] Detector activo cada ${interval} ms.`);
  return timer;
}

async function detenerPendientesJob() {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
  if (activeRun) await activeRun;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  getInterval,
  iniciarPendientesJob,
  detenerPendientesJob,
  ejecutarPendientes: execute,
};
