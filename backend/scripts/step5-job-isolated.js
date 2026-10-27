'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOG_DIR = path.resolve(__dirname, '../database/backups');
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = path.join(LOG_DIR, `sir2-step5-job-isolated-${RUN_STAMP}.log`);

function logEvent(event, data = {}) {
  fs.appendFileSync(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`, 'utf8');
}

function installOutputLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `=== start ${new Date().toISOString()} ===\n`, 'utf8');
  for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk, ...args) => {
      const encoding = typeof args[0] === 'string' ? args[0] : 'utf8';
      const output = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
      logEvent('PROCESS_OUTPUT', { stream: name, output });
      return originalWrite(chunk, ...args);
    };
  }
}

installOutputLog();

const db = require('../database/db');
const domainPendings = require('../services/Pendientes/domain-state-detector.service');
const reminderTrigger = require('../services/Recordatorios/recordatorios-trigger.service');
const pendingTrigger = require('../services/Pendientes/pendientes-trigger.service');
const transferNovedades = require('../services/Programacion/programacion-transfers-novedades.service');

const COUNT_TABLES = [
  'notificaciones', 'pendientes_operativos', 'pendientes_eventos', 'email_outbox',
  'recordatorios', 'programacion_transfers_listados', 'programacion_transfers_snapshot',
];

function serializeError(error) {
  return {
    message: String(error?.message || error || 'Error desconocido'),
    stack: error?.stack ? String(error.stack) : null,
    code: error?.code == null ? null : String(error.code),
  };
}

function monitorTask(module, method, label, tasks, finishOrder) {
  const original = module[method];
  module[method] = function monitoredTask(...args) {
    const startedAt = new Date().toISOString();
    logEvent('TASK_START', { task: label, startedAt });
    let result;
    try { result = original.apply(this, args); }
    catch (error) { result = Promise.reject(error); }
    const observed = Promise.resolve(result).then((value) => {
      const finishedAt = new Date().toISOString();
      finishOrder.push(label);
      logEvent(finishOrder.length === 1 ? 'FIRST_TASK_DONE' : 'TASK_DONE', {
        task: label, finishedAt, result: value ?? null,
      });
      return { task: label, status: 'DONE', result: value ?? null };
    }, (error) => {
      const finishedAt = new Date().toISOString();
      finishOrder.push(label);
      const serialized = serializeError(error);
      logEvent('TASK_FAILED', { task: label, finishedAt, error: serialized });
      return { task: label, status: 'FAILED', error: serialized };
    });
    tasks.push({ label, promise: observed });
    // Return the original outcome to pendientes.job.js so its own behavior is observed.
    return Promise.resolve(result);
  };
}

function quoteIdentifier(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

async function readCounts() {
  const counts = {};
  for (const table of COUNT_TABLES) {
    const [[row]] = await db.query(`SELECT COUNT(*) AS filas FROM ${quoteIdentifier(table)}`);
    counts[table] = Number(row.filas);
  }
  return counts;
}

async function readOutbox() {
  const [byState] = await db.query('SELECT Estado, COUNT(*) AS filas FROM email_outbox GROUP BY Estado ORDER BY Estado');
  const [pending] = await db.query(`SELECT Id_Email,Tipo,Estado,Disponible_En,Intentos,Max_Intentos
    FROM email_outbox WHERE LOWER(Estado) IN ('pendiente','procesando') ORDER BY Disponible_En,Id_Email`);
  const [rows] = await db.query('SELECT * FROM email_outbox ORDER BY Id_Email');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { byState, pending, total: rows.length, fingerprint };
}

async function readOperationStates() {
  const [reservas] = await db.query('SELECT Id_Reserva,Estado FROM reservas ORDER BY Id_Reserva');
  const [transfers] = await db.query('SELECT Id_Transfer,Estado FROM transfers ORDER BY Id_Transfer');
  return {
    reservas: reservas.map((row) => ({ id: String(row.Id_Reserva), estado: row.Estado })),
    transfers: transfers.map((row) => ({ id: String(row.Id_Transfer), estado: row.Estado })),
  };
}

async function readPendingRows() {
  const [notifications] = await db.query(`SELECT Id_Notificacion,Tipo,Entidad_Tipo,Entidad_Id,Leida,Fecha_Lectura,Fecha_Creacion,Clave_Deduplicacion
    FROM notificaciones ORDER BY Id_Notificacion`);
  const [operational] = await db.query(`SELECT Id_Pendiente,Estado,Entidad_Tipo,Entidad_Id,Clave_Deduplicacion,
      Siguiente_Recordatorio,Ultima_Deteccion,Fecha_Actualizacion
    FROM pendientes_operativos ORDER BY Id_Pendiente`);
  const [events] = await db.query(`SELECT Id_Evento,Id_Pendiente,Tipo,Fecha_Creacion
    FROM pendientes_eventos ORDER BY Id_Evento`);
  const [[pending14]] = await db.query(`SELECT Id_Pendiente,Estado,Entidad_Tipo,Entidad_Id,
      Siguiente_Recordatorio,Ultima_Deteccion,Fecha_Actualizacion
    FROM pendientes_operativos WHERE Id_Pendiente=14`);
  return { notifications, operational, events, pending14: pending14 || null };
}

function diffCounts(before, after) {
  return Object.fromEntries(COUNT_TABLES.map((table) => [table, after[table] - before[table]]));
}

function diffRows(before, after, key) {
  const oldById = new Map(before.map((row) => [String(row[key]), row]));
  const newById = new Map(after.map((row) => [String(row[key]), row]));
  const ids = new Set([...oldById.keys(), ...newById.keys()]);
  return [...ids].sort().flatMap((id) => {
    const oldRow = oldById.get(id) || null;
    const newRow = newById.get(id) || null;
    return JSON.stringify(oldRow) === JSON.stringify(newRow) ? [] : [{ id, before: oldRow, after: newRow }];
  });
}

function diffStates(before, after) {
  const changes = {};
  for (const type of ['reservas', 'transfers']) {
    const oldById = new Map(before[type].map((row) => [row.id, row.estado]));
    const newById = new Map(after[type].map((row) => [row.id, row.estado]));
    const ids = new Set([...oldById.keys(), ...newById.keys()]);
    changes[type] = [...ids].sort().flatMap((id) => {
      const oldState = oldById.get(id) ?? null;
      const newState = newById.get(id) ?? null;
      return oldState === newState ? [] : [{ id, before: oldState, after: newState }];
    });
  }
  return changes;
}

async function main() {
  const [[identity]] = await db.query(`SELECT DATABASE() AS databaseName,
    DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s') AS nowLocal`);
  if (identity?.databaseName !== 'sir2') throw new Error(`Guardia: base actual ${identity?.databaseName || '(ninguna)'}, se exige sir2.`);

  const before = {
    counts: await readCounts(),
    outbox: await readOutbox(),
    operationStates: await readOperationStates(),
    pendingRows: await readPendingRows(),
  };
  logEvent('PREFLIGHT', { identity, counts: before.counts, outboxByState: before.outbox.byState,
    pendingEmails: before.outbox.pending, dueRecords: await readDueRecords() });
  if (before.outbox.pending.length) {
    logEvent('STOP_PENDING_EMAIL_OUTBOX', { pendingEmails: before.outbox.pending });
    console.error('STOP: email_outbox contiene mensajes pendientes de envío; no se ejecutó el job.');
    process.exitCode = 2;
    return;
  }

  const tasks = [];
  const finishOrder = [];
  monitorTask(domainPendings, 'syncDomainStatePendings', 'syncDomainStatePendings', tasks, finishOrder);
  monitorTask(reminderTrigger, 'processDueReminders', 'processDueReminders', tasks, finishOrder);
  monitorTask(pendingTrigger, 'processDuePendings', 'processDuePendings', tasks, finishOrder);
  monitorTask(transferNovedades, 'syncSavedLists', 'syncSavedLists', tasks, finishOrder);
  const job = require('../jobs/pendientes.job');

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  logEvent('JOB_START', { startedAt, timeoutMs: 120000, invocationCount: 1 });
  let timeoutHandle;
  const timeoutPromise = new Promise(() => {
    timeoutHandle = setTimeout(() => {
      logEvent('TIMEOUT', { timeoutMs: 120000, startedAt, timedOutAt: new Date().toISOString(),
        tasksStarted: tasks.map((task) => task.label), tasksFinished: finishOrder });
      process.exit(124);
    }, 120000);
  });

  let result = null;
  let jobError = null;
  try {
    result = await Promise.race([job.ejecutarPendientes(), timeoutPromise]);
    logEvent('JOB_PROMISE_SETTLED', { result: result ?? null, settledAt: new Date().toISOString(),
      tasksStillRunning: tasks.filter((task) => !finishOrder.includes(task.label)).map((task) => task.label) });
  } catch (error) {
    jobError = serializeError(error);
    logEvent('JOB_ERROR', { error: jobError, failedAt: new Date().toISOString() });
  }

  const taskResults = await Promise.race([Promise.all(tasks.map((task) => task.promise)), timeoutPromise]);
  clearTimeout(timeoutHandle);
  const finishedAt = new Date().toISOString();
  const after = {
    counts: await readCounts(),
    outbox: await readOutbox(),
    operationStates: await readOperationStates(),
    pendingRows: await readPendingRows(),
  };
  const stateChanges = diffStates(before.operationStates, after.operationStates);
  const tableRowChanges = {
    notificaciones: diffRows(before.pendingRows.notifications, after.pendingRows.notifications, 'Id_Notificacion'),
    pendientes_operativos: diffRows(before.pendingRows.operational, after.pendingRows.operational, 'Id_Pendiente'),
    pendientes_eventos: diffRows(before.pendingRows.events, after.pendingRows.events, 'Id_Evento'),
  };
  const summary = {
    startedAt, finishedAt, durationMs: Date.now() - startedMs,
    result: result ?? null, error: jobError,
    tasks: taskResults, firstTaskDone: finishOrder[0] || null,
    taskFinishOrder: finishOrder, countsBefore: before.counts, countsAfter: after.counts,
    countDelta: diffCounts(before.counts, after.counts),
    emailOutboxBefore: { total: before.outbox.total, byState: before.outbox.byState, fingerprint: before.outbox.fingerprint },
    emailOutboxAfter: { total: after.outbox.total, byState: after.outbox.byState, fingerprint: after.outbox.fingerprint },
    emailOutboxUnchanged: before.outbox.fingerprint === after.outbox.fingerprint,
    stateChanges, tableRowChanges,
    pending14Before: before.pendingRows.pending14, pending14After: after.pendingRows.pending14,
  };
  logEvent('JOB_FINISHED', summary);
  console.log(JSON.stringify(summary, null, 2));
  if (jobError || taskResults.some((task) => task.status === 'FAILED')) process.exitCode = 1;
}

async function readDueRecords() {
  const [[reminders]] = await db.query(`SELECT COUNT(*) AS filas,COALESCE(SUM(Enviar_Correo=1),0) AS conCorreo
    FROM recordatorios WHERE Estado='ACTIVO' AND Activo=1 AND Siguiente_Trigger IS NOT NULL
      AND Siguiente_Trigger<=NOW() AND (Suprimido_Hasta IS NULL OR Suprimido_Hasta<=NOW())`);
  const [[pendings]] = await db.query(`SELECT COUNT(*) AS filas FROM pendientes_operativos p
    INNER JOIN reglas_pendientes r ON r.Id_Regla=p.Id_Regla AND r.Activa=1
    WHERE p.Estado='ACTIVO' AND p.Siguiente_Recordatorio IS NOT NULL AND p.Siguiente_Recordatorio<=NOW()
      AND (p.Suprimido_Hasta IS NULL OR p.Suprimido_Hasta<=NOW())`);
  return { dueReminders: Number(reminders.filas), dueReminderEmails: Number(reminders.conCorreo), duePendings: Number(pendings.filas) };
}

main().catch((error) => {
  const serialized = serializeError(error);
  logEvent('SCRIPT_ERROR', { error: serialized });
  console.error(JSON.stringify({ event: 'SCRIPT_ERROR', error: serialized }));
  process.exitCode = 1;
}).finally(async () => {
  try { await db.end(); }
  catch (error) { logEvent('DB_CLOSE_ERROR', { error: serializeError(error) }); }
});

