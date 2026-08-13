const { getOutboxPolicy, processOutboxBatch } = require('../services/email-outbox.service');

let timer = null;
let initialTimer = null;
let activeRun = null;
let stopping = false;
let lastWarning = null;

function warnOnce(key, message) {
  if (lastWarning === key) return;
  lastWarning = key;
  console.warn(message);
}

async function runTick() {
  try {
    const result = await processOutboxBatch({ shouldStop: () => stopping });
    if (result.status === 'smtp_not_configured') {
      warnOnce('smtp', '[email-outbox] SMTP no está configurado; la cola permanecerá pendiente.');
    } else if (result.status === 'smtp_configuration_error') {
      warnOnce(
        `smtp-config:${result.reason}`,
        `[email-outbox] Configuración SMTP insegura o inválida (${result.reason}); la cola permanecerá pendiente.`
      );
    } else if (result.status === 'provider_paused') {
      warnOnce(
        `pause:${result.reason}`,
        `[email-outbox] Entrega pausada temporalmente (${result.reason}); la cola permanece pendiente.`
      );
    } else {
      lastWarning = null;
    }
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      warnOnce('table', '[email-outbox] Falta una tabla de la cola; aplica la migración de email outbox. El API continúa activo.');
    } else {
      console.error('[email-outbox] Error procesando la cola:', error?.message || error);
    }
  }
}

function tick() {
  if (stopping) return Promise.resolve();
  if (activeRun) return activeRun;
  activeRun = runTick().finally(() => {
    activeRun = null;
  });
  return activeRun;
}

function iniciarEmailOutboxJob(env = process.env) {
  if (timer || initialTimer) return timer || initialTimer;
  const policy = getOutboxPolicy(env);
  if (!policy.enabled) {
    console.log('[email-outbox] Worker desactivado por configuración.');
    return null;
  }

  stopping = false;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void tick();
  }, 0);
  initialTimer.unref?.();
  timer = setInterval(() => { void tick(); }, policy.intervalMs);
  timer.unref?.();
  console.log(`[email-outbox] Worker activo cada ${policy.intervalMs} ms (lote ${policy.batchSize}).`);
  return timer;
}

async function detenerEmailOutboxJob(options = {}) {
  stopping = true;
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!activeRun) return { completed: true };

  const timeoutMs = Number(options.timeoutMs || 12000);
  let timeout;
  const completed = await Promise.race([
    activeRun.then(() => true),
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  if (timeout) clearTimeout(timeout);
  return { completed };
}

module.exports = { iniciarEmailOutboxJob, detenerEmailOutboxJob, _tick: tick };
