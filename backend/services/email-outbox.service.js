const crypto = require('node:crypto');
const os = require('node:os');

const db = require('../database/db');
const emailService = require('./email.service');

const EMAIL_TYPES = Object.freeze({
  PASSWORD_RESET: 'password_reset',
  SCHEDULE: 'schedule',
});

const EMAIL_PRIORITIES = Object.freeze({
  PASSWORD_RESET: 100,
  SCHEDULE: 10,
});

const WORKER_LOCK_NAME = 'sir:email_outbox:worker:v1';
const MAILBOX_TOTAL_CAP_24H = 100;
const MAILBOX_PASSWORD_RESERVE_24H = 10;
const MAILBOX_SCHEDULE_CAP_24H = 90;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(String(value).trim().toLowerCase());
}

function getOutboxPolicy(env = process.env) {
  // Este buzón concreto admite 100 contactos/24 h. El entorno puede reducir
  // el uso, pero nunca ampliar el límite contratado ni eliminar la reserva.
  const totalLimit = Math.min(
    boundedInteger(env.EMAIL_OUTBOX_TOTAL_LIMIT_24H, MAILBOX_TOTAL_CAP_24H, 1, 100000),
    MAILBOX_TOTAL_CAP_24H
  );
  const guaranteedPasswordReserve = Math.min(MAILBOX_PASSWORD_RESERVE_24H, totalLimit);
  const passwordReserve = Math.max(guaranteedPasswordReserve, boundedInteger(
    env.EMAIL_OUTBOX_PASSWORD_RESERVE_24H,
    guaranteedPasswordReserve,
    0,
    totalLimit
  ));
  const defaultScheduleLimit = Math.max(0, totalLimit - passwordReserve);
  const requestedScheduleLimit = boundedInteger(
    env.EMAIL_OUTBOX_SCHEDULE_LIMIT_24H,
    defaultScheduleLimit,
    0,
    totalLimit
  );
  // La reserva de recuperación es una garantía, no una recomendación:
  // ni una variable mal configurada puede permitir que horarios la consuma.
  const scheduleLimit = Math.min(
    requestedScheduleLimit,
    defaultScheduleLimit,
    MAILBOX_SCHEDULE_CAP_24H
  );

  return {
    // Fail-safe: sólo la instancia productiva que declare explícitamente true
    // puede contactar el buzón. Candidatos y entornos antiguos quedan apagados.
    enabled: parseBoolean(env.EMAIL_OUTBOX_ENABLED, false),
    totalLimit,
    passwordReserve,
    scheduleLimit,
    intervalMs: boundedInteger(env.EMAIL_OUTBOX_INTERVAL_MS, 10000, 1000, 3600000),
    batchSize: boundedInteger(env.EMAIL_OUTBOX_BATCH_SIZE, 5, 1, 25),
    lockTimeoutSeconds: boundedInteger(env.EMAIL_OUTBOX_LOCK_TIMEOUT_SECONDS, 60, 30, 86400),
    maxAttempts: boundedInteger(env.EMAIL_OUTBOX_MAX_ATTEMPTS, 24, 1, 100),
    retryBaseSeconds: boundedInteger(env.EMAIL_OUTBOX_RETRY_BASE_SECONDS, 60, 1, 86400),
    retryMaxSeconds: boundedInteger(env.EMAIL_OUTBOX_RETRY_MAX_SECONDS, 21600, 1, 604800),
    configRetrySeconds: boundedInteger(env.EMAIL_OUTBOX_CONFIG_RETRY_SECONDS, 300, 10, 86400),
    providerRetrySeconds: boundedInteger(env.EMAIL_OUTBOX_PROVIDER_RETRY_SECONDS, 3600, 60, 86400),
    passwordMinValiditySeconds: boundedInteger(
      env.EMAIL_OUTBOX_PASSWORD_MIN_VALIDITY_SECONDS,
      120,
      30,
      900
    ),
  };
}

function hashDedupe(parts) {
  const serialized = Array.isArray(parts) ? parts.join('|') : String(parts || '');
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function normalizeRecipient(value) {
  return String(value || '').trim().toLowerCase();
}

function isSingleMailbox(value) {
  const recipient = normalizeRecipient(value);
  if (!recipient || recipient.length > 320 || /[\r\n,;<>\s]/.test(recipient)) return false;
  const parts = recipient.split('@');
  return parts.length === 2
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0])
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(parts[1]);
}

function serializePayload(payload) {
  return JSON.stringify(payload == null ? {} : payload);
}

function parsePayload(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  return JSON.parse(String(value || '{}'));
}

function computeRetryDelaySeconds(attemptNumber, policy) {
  const exponent = Math.max(0, Number(attemptNumber || 1) - 1);
  return Math.min(policy.retryMaxSeconds, policy.retryBaseSeconds * (2 ** exponent));
}

function classifyDeliveryError(error) {
  const code = String(error?.code || '').toUpperCase();
  const command = String(error?.command || '').trim().toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const message = String(error?.message || error?.response || '').toLowerCase();

  if (error?.permanent === true || code === 'EMAIL_PAYLOAD_INVALID' || code === 'EMAIL_TYPE_INVALID') {
    return { permanent: true, reason: 'invalid_message' };
  }

  if (code === 'FRONTEND_URL_INVALID' || code === 'SMTP_TLS_REQUIRED') {
    return { permanent: false, reason: 'app_config' };
  }

  // Nodemailer informa el comando SMTP que falló. Un rechazo de MAIL FROM
  // afecta al remitente configurado y no al destinatario concreto.
  if (command === 'MAIL FROM') {
    return { permanent: false, reason: 'smtp_config' };
  }

  // Sólo una señal inequívoca de cuota debe pausar globalmente el buzón. Un
  // RCPT 450/451 temporal pertenece a ese destinatario y usa backoff por fila.
  if (/(quota|rate[\s_-]*limit|too many|throttl|daily\s+(?:sending\s+)?limit|sending\s+(?:message\s+)?limit|messages?\s+(?:daily\s+)?limit)/i.test(message)) {
    return { permanent: false, reason: 'provider_throttled' };
  }

  // Una credencial o permiso del relay puede corregirse sin recrear el trabajo.
  // SMTP suele responder 535 (clase 5xx), pero no es un rechazo del mensaje.
  if (code === 'EAUTH') {
    return { permanent: false, reason: 'smtp_auth' };
  }

  if (responseCode >= 400 && responseCode < 500) {
    return { permanent: false, reason: 'smtp_transient' };
  }

  if (responseCode >= 500) {
    return { permanent: true, reason: 'smtp_permanent' };
  }

  if (['EENVELOPE', 'EADDRESS'].includes(code)) {
    return { permanent: true, reason: 'invalid_recipient' };
  }

  return { permanent: false, reason: code === 'EAUTH' ? 'smtp_auth' : 'transport_transient' };
}

function releasesQuotaReservation(error) {
  const { reason } = classifyDeliveryError(error);
  // Estos resultados confirman que el proveedor no aceptó el mensaje. Los
  // fallos de transporte ambiguos conservan la reserva porque SMTP sí pudo
  // haberlo aceptado antes de cortar la conexión.
  return [
    'invalid_message',
    'invalid_recipient',
    'smtp_auth',
    'smtp_config',
    'app_config',
    'provider_throttled',
    'smtp_transient',
    'smtp_permanent',
  ].includes(reason);
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds);
}

function quotaDecision(type, usage, policy, now = new Date()) {
  const totalSent = Number(usage.totalSent || 0);
  const scheduleSent = Number(usage.scheduleSent || 0);
  const waits = [];

  if (totalSent >= policy.totalLimit) {
    const oldest = usage.oldestTotal ? new Date(usage.oldestTotal) : now;
    waits.push(addMilliseconds(oldest, (24 * 60 * 60 * 1000) + 1000));
  }

  if (type === EMAIL_TYPES.SCHEDULE && scheduleSent >= policy.scheduleLimit) {
    const oldest = usage.oldestSchedule ? new Date(usage.oldestSchedule) : now;
    waits.push(addMilliseconds(oldest, (24 * 60 * 60 * 1000) + 1000));
  }

  if (!waits.length) return { allowed: true, nextAt: null };
  return {
    allowed: false,
    nextAt: new Date(Math.max(now.getTime() + 1000, ...waits.map((date) => date.getTime()))),
  };
}

async function enqueueEmail({
  type,
  to,
  payload,
  dedupeKey,
  priority,
  maxAttempts,
  availableAt = null,
  expiresAt = null,
}, dependencies = {}) {
  if (!Object.values(EMAIL_TYPES).includes(type)) {
    const error = new Error('El tipo de correo no es válido.');
    error.code = 'EMAIL_TYPE_INVALID';
    throw error;
  }

  const recipient = normalizeRecipient(to);
  // Una fila siempre representa exactamente un destinatario. Así una entrega
  // equivale a una unidad de cuota incluso si Nodemailer admite listas.
  if (!isSingleMailbox(recipient)) {
    const error = new Error('El destinatario de correo no es válido.');
    error.code = 'EMAIL_RECIPIENT_INVALID';
    throw error;
  }

  const executor = dependencies.executor || db;
  const policy = dependencies.policy || getOutboxPolicy(dependencies.env || process.env);
  const normalizedDedupe = String(dedupeKey || '').trim();
  if (!normalizedDedupe) {
    const error = new Error('La clave de deduplicación del correo es obligatoria.');
    error.code = 'EMAIL_DEDUPE_REQUIRED';
    throw error;
  }

  const [result] = await executor.query(
    `INSERT INTO email_outbox
       (Tipo, Prioridad, Destinatario, Payload, Dedupe_Key, Estado, Intentos,
        Max_Intentos, Disponible_En, Expira_En, Fecha_Creacion, Fecha_Actualizacion)
     VALUES (?, ?, ?, ?, ?, 'pendiente', 0, ?, COALESCE(?, NOW()), ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE Id_Email = LAST_INSERT_ID(Id_Email)`,
    [
      type,
      Number(priority || 0),
      recipient,
      serializePayload(payload),
      normalizedDedupe,
      Number(maxAttempts || policy.maxAttempts),
      availableAt,
      expiresAt,
    ]
  );

  return { idEmail: String(result.insertId), deduplicated: Number(result.affectedRows) !== 1 };
}

async function enqueuePasswordResetEmail(message, dependencies = {}) {
  const expiresInMinutes = boundedInteger(message.expiresInMinutes, 10, 1, 1440);
  const now = dependencies.now instanceof Date ? dependencies.now : new Date();
  const recipient = normalizeRecipient(message.to);
  if (!isSingleMailbox(recipient)) {
    const error = new Error('El destinatario de correo no es válido.');
    error.code = 'EMAIL_RECIPIENT_INVALID';
    throw error;
  }
  const dedupeKey = `password_reset:${hashDedupe([recipient, message.resetUrl])}`;
  const executor = dependencies.executor || db;

  // Al crear un enlace nuevo, cualquier reset anterior del mismo buzón deja de
  // ser útil. Se limpia dentro de la misma transacción para evitar que quede un
  // correo viejo esperando mientras el token ya fue reemplazado.
  await executor.query(
    `UPDATE email_outbox
     SET Estado = 'fallido', Fallido_En = NOW(), Ultimo_Error = 'Reemplazado por una solicitud de recuperación más reciente.',
         Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
     WHERE Tipo = 'password_reset' AND Destinatario = ? AND Estado = 'pendiente'
       AND Dedupe_Key <> ?`,
    [recipient, dedupeKey]
  );

  return enqueueEmail({
    type: EMAIL_TYPES.PASSWORD_RESET,
    to: message.to,
    payload: {
      to: message.to,
      name: message.name,
      resetUrl: message.resetUrl,
      expiresInMinutes,
    },
    dedupeKey,
    priority: EMAIL_PRIORITIES.PASSWORD_RESET,
    expiresAt: addMilliseconds(now, expiresInMinutes * 60 * 1000),
  }, { ...dependencies, executor });
}

async function enqueueScheduleEmail(message, publicationId, dependencies = {}) {
  const recipient = normalizeRecipient(message.to);
  if (!isSingleMailbox(recipient)) {
    const error = new Error('El destinatario de correo no es válido.');
    error.code = 'EMAIL_RECIPIENT_INVALID';
    throw error;
  }
  const dedupeKey = `schedule:${hashDedupe([
    publicationId,
    recipient,
    message.weekStart,
    message.weekEnd,
  ])}`;
  const executor = dependencies.executor || db;

  // Si una semana se republica mientras su aviso anterior seguía pendiente
  // (por cuota o caída SMTP), sólo debe llegar la versión más reciente.
  await executor.query(
    `UPDATE email_outbox
     SET Estado = 'fallido', Fallido_En = NOW(),
         Ultimo_Error = 'Reemplazado por una publicación de horario más reciente.',
         Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
     WHERE Tipo = 'schedule' AND Destinatario = ? AND Estado = 'pendiente'
       AND JSON_UNQUOTE(JSON_EXTRACT(Payload, '$.weekStart')) = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(Payload, '$.weekEnd')) = ?
       AND Dedupe_Key <> ?`,
    [recipient, message.weekStart, message.weekEnd, dedupeKey]
  );

  return enqueueEmail({
    type: EMAIL_TYPES.SCHEDULE,
    to: message.to,
    payload: message,
    dedupeKey,
    priority: EMAIL_PRIORITIES.SCHEDULE,
  }, { ...dependencies, executor });
}

function sanitizeError(error) {
  return String(error?.message || error || 'Error de entrega desconocido').slice(0, 2000);
}

async function loadUsage(connection) {
  const [rows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         THEN 1 ELSE 0 END), 0) AS Total_Enviados,
       COALESCE(SUM(CASE WHEN Tipo = 'schedule'
         AND Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END), 0) AS Horarios_Enviados,
       MIN(CASE WHEN Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         THEN Reservado_En END) AS Primer_Envio,
       MIN(CASE WHEN Tipo = 'schedule'
         AND Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN Reservado_En END) AS Primer_Horario
     FROM email_outbox_dispatches`
  );
  const row = rows[0] || {};
  return {
    totalSent: Number(row.Total_Enviados || 0),
    scheduleSent: Number(row.Horarios_Enviados || 0),
    oldestTotal: row.Primer_Envio || null,
    oldestSchedule: row.Primer_Horario || null,
  };
}

async function recoverStaleJobs(connection, policy) {
  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'pendiente', Bloqueado_En = NULL, Bloqueado_Por = NULL,
         Disponible_En = LEAST(Disponible_En, NOW()), Fecha_Actualizacion = NOW(),
         Ultimo_Error = 'Trabajo recuperado después de un bloqueo vencido.'
     WHERE Estado = 'procesando'
       AND (Bloqueado_En IS NULL OR Bloqueado_En < DATE_SUB(NOW(), INTERVAL ? SECOND))`,
    [policy.lockTimeoutSeconds]
  );
}

async function closeExpiredJobs(connection) {
  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'fallido', Fallido_En = NOW(), Bloqueado_En = NULL, Bloqueado_Por = NULL,
         Ultimo_Error = CASE
           WHEN Expira_En IS NOT NULL AND Expira_En <= NOW() THEN 'El correo expiró antes de poder entregarse.'
           ELSE 'El correo agotó el número máximo de intentos.' END,
         Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
     WHERE Estado = 'pendiente'
       AND ((Expira_En IS NOT NULL AND Expira_En <= NOW()) OR Intentos >= Max_Intentos)`
  );
}

async function loadProviderPause(connection, now = new Date()) {
  const [rows] = await connection.query(
    `SELECT Pausado_Hasta, Motivo
       FROM email_outbox_control
      WHERE Id_Control = 1
      LIMIT 1`
  );
  const row = rows[0];
  if (!row?.Pausado_Hasta) return null;
  const resumeAt = new Date(row.Pausado_Hasta);
  if (!Number.isFinite(resumeAt.getTime()) || resumeAt <= now) return null;
  return { resumeAt, reason: row.Motivo || 'provider_pause' };
}

async function pauseProvider(connection, classification, policy, now = new Date()) {
  const delaySeconds = classification.reason === 'provider_throttled'
    ? policy.providerRetrySeconds
    : policy.configRetrySeconds;
  const resumeAt = addMilliseconds(now, delaySeconds * 1000);
  await connection.query(
    `INSERT INTO email_outbox_control
       (Id_Control, Pausado_Hasta, Motivo, Fecha_Actualizacion)
     VALUES (1, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       Pausado_Hasta = VALUES(Pausado_Hasta),
       Motivo = VALUES(Motivo),
       Fecha_Actualizacion = NOW()`,
    [resumeAt, classification.reason]
  );
  return resumeAt;
}

async function loadCandidates(connection, limit) {
  const [rows] = await connection.query(
    `SELECT Id_Email, Tipo, Prioridad, Destinatario, Payload, Intentos, Max_Intentos, Expira_En
     FROM email_outbox
     WHERE Estado = 'pendiente' AND Disponible_En <= NOW()
       AND Intentos < Max_Intentos
       AND (Expira_En IS NULL OR Expira_En > NOW())
     ORDER BY Prioridad DESC, Disponible_En ASC, Id_Email ASC
     LIMIT ?`,
    [Math.max(limit * 4, 20)]
  );
  return rows;
}

async function deferForQuota(connection, idEmail, nextAt) {
  await connection.query(
    `UPDATE email_outbox SET Disponible_En = ?, Fecha_Actualizacion = NOW(),
       Ultimo_Error = 'Envío aplazado para respetar la cuota móvil de 24 horas.'
     WHERE Id_Email = ? AND Estado = 'pendiente'`,
    [nextAt, idEmail]
  );
}

async function deliverRow(row, dependencies = {}) {
  let payload;
  try {
    payload = parsePayload(row.Payload);
  } catch (_error) {
    const error = new Error('El payload persistido del correo no es JSON válido.');
    error.code = 'EMAIL_PAYLOAD_INVALID';
    error.permanent = true;
    throw error;
  }

  const recipient = normalizeRecipient(row.Destinatario);
  if (!isSingleMailbox(recipient) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('El payload persistido del correo no cumple el esquema requerido.');
    error.code = 'EMAIL_PAYLOAD_INVALID';
    error.permanent = true;
    throw error;
  }
  // La columna Destinatario es la unidad auditada por la cuota. Nunca confiar
  // en payload.to (histórico o futuro) para decidir a quién entrega Nodemailer.
  payload = { ...payload, to: recipient };

  const deliveryDependencies = dependencies.emailDependencies || {
    env: dependencies.env || process.env,
  };
  if (row.Tipo === EMAIL_TYPES.PASSWORD_RESET) {
    let resetUrl;
    try {
      resetUrl = new URL(String(payload.resetUrl || ''));
    } catch (_error) {
      resetUrl = null;
    }
    const deliveryEnv = deliveryDependencies.env || dependencies.env || process.env;
    const isProduction = String(deliveryEnv.NODE_ENV || '').trim().toLowerCase() === 'production';
    const isLoopbackDevelopmentUrl = !isProduction
      && resetUrl?.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(resetUrl.hostname);
    if (!resetUrl || (resetUrl.protocol !== 'https:' && !isLoopbackDevelopmentUrl)) {
      const error = new Error('El correo de recuperación no contiene un enlace HTTPS válido.');
      error.code = 'EMAIL_PAYLOAD_INVALID';
      error.permanent = true;
      throw error;
    }
    if (row.Expira_En) {
      const now = dependencies.now instanceof Date ? dependencies.now : new Date();
      const remainingMs = new Date(row.Expira_En).getTime() - now.getTime();
      const policy = dependencies.policy || getOutboxPolicy(dependencies.env || process.env);
      if (remainingMs < policy.passwordMinValiditySeconds * 1000) {
        const error = new Error('El enlace de recuperación no conserva vigencia suficiente para enviarse.');
        error.code = 'EMAIL_PAYLOAD_INVALID';
        error.permanent = true;
        throw error;
      }
      payload = {
        ...payload,
        // Nunca anunciar más vigencia que la realmente disponible.
        expiresInMinutes: Math.max(1, Math.floor(remainingMs / 60000)),
      };
    }
    if (!Number.isFinite(Number(payload.expiresInMinutes)) || Number(payload.expiresInMinutes) < 1) {
      const error = new Error('El correo de recuperación no contiene una vigencia válida.');
      error.code = 'EMAIL_PAYLOAD_INVALID';
      error.permanent = true;
      throw error;
    }
    return (dependencies.emailService || emailService).sendPasswordResetEmail(payload, deliveryDependencies);
  }
  if (row.Tipo === EMAIL_TYPES.SCHEDULE) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.weekStart || ''))
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.weekEnd || ''))
      || !Array.isArray(payload.turnos)) {
      const error = new Error('El correo de horario no contiene una semana o turnos válidos.');
      error.code = 'EMAIL_PAYLOAD_INVALID';
      error.permanent = true;
      throw error;
    }
    return (dependencies.emailService || emailService).sendSchedulePublishedEmail(payload, deliveryDependencies);
  }

  const error = new Error(`Tipo de correo no soportado: ${row.Tipo}`);
  error.code = 'EMAIL_TYPE_INVALID';
  error.permanent = true;
  throw error;
}

async function markSent(connection, row, result) {
  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'enviado', Intentos = Intentos + 1, Enviado_En = NOW(),
         Smtp_Message_Id = ?, Ultimo_Error = NULL, Bloqueado_En = NULL, Bloqueado_Por = NULL,
         Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
     WHERE Id_Email = ? AND Estado = 'procesando'`,
    [result?.messageId || null, row.Id_Email]
  );
}

async function releaseForConfiguration(connection, row, policy, reason) {
  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'pendiente', Disponible_En = DATE_ADD(NOW(), INTERVAL ? SECOND),
         Ultimo_Error = ?, Bloqueado_En = NULL, Bloqueado_Por = NULL, Fecha_Actualizacion = NOW()
     WHERE Id_Email = ? AND Estado = 'procesando'`,
    [policy.configRetrySeconds, reason, row.Id_Email]
  );
}

async function releaseQuotaReservation(connection, dispatchId, row, usage) {
  if (!dispatchId) return false;
  const [result] = await connection.query(
    'DELETE FROM email_outbox_dispatches WHERE Id_Despacho = ?',
    [dispatchId]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  usage.totalSent = Math.max(0, Number(usage.totalSent || 0) - 1);
  if (row.Tipo === EMAIL_TYPES.SCHEDULE) {
    usage.scheduleSent = Math.max(0, Number(usage.scheduleSent || 0) - 1);
  }
  return true;
}

async function releaseForInfrastructure(connection, row, policy, error, classification) {
  const delaySeconds = classification.reason === 'provider_throttled'
    ? policy.providerRetrySeconds
    : policy.configRetrySeconds;
  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'pendiente', Disponible_En = DATE_ADD(NOW(), INTERVAL ? SECOND),
         Ultimo_Error = ?, Bloqueado_En = NULL, Bloqueado_Por = NULL, Fecha_Actualizacion = NOW()
     WHERE Id_Email = ? AND Estado = 'procesando'`,
    [delaySeconds, sanitizeError(error), row.Id_Email]
  );
  return { terminal: false, classification, infrastructureDeferred: true };
}

async function markDeliveryFailure(connection, row, error, policy, now = new Date()) {
  const classification = classifyDeliveryError(error);
  // Una credencial corregible o la cuota externa no debe destruir el trabajo.
  // Se aplaza sin consumir el máximo de intentos; los resets se limpiarán al
  // expirar y los horarios permanecerán disponibles para entrega posterior.
  if (classification.reason === 'smtp_auth'
      || classification.reason === 'smtp_config'
      || classification.reason === 'provider_throttled'
      || classification.reason === 'app_config') {
    return releaseForInfrastructure(connection, row, policy, error, classification);
  }
  const nextAttempt = Number(row.Intentos || 0) + 1;
  const retryDelay = computeRetryDelaySeconds(nextAttempt, policy);
  const retryAt = addMilliseconds(now, retryDelay * 1000);
  const expiresAt = row.Expira_En ? new Date(row.Expira_En) : null;
  const terminal = classification.permanent
    || nextAttempt >= Number(row.Max_Intentos || policy.maxAttempts)
    || (expiresAt && retryAt >= expiresAt);

  if (terminal) {
    await connection.query(
      `UPDATE email_outbox
       SET Estado = 'fallido', Intentos = ?, Fallido_En = NOW(), Ultimo_Error = ?,
           Bloqueado_En = NULL, Bloqueado_Por = NULL, Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
       WHERE Id_Email = ? AND Estado = 'procesando'`,
      [nextAttempt, sanitizeError(error), row.Id_Email]
    );
    return { terminal: true, classification };
  }

  await connection.query(
    `UPDATE email_outbox
     SET Estado = 'pendiente', Intentos = ?, Disponible_En = ?, Ultimo_Error = ?,
         Bloqueado_En = NULL, Bloqueado_Por = NULL, Fecha_Actualizacion = NOW()
     WHERE Id_Email = ? AND Estado = 'procesando'`,
    [nextAttempt, retryAt, sanitizeError(error), row.Id_Email]
  );
  return { terminal: false, classification, retryAt };
}

async function processOutboxBatch(dependencies = {}) {
  const pool = dependencies.db || db;
  const policy = dependencies.policy || getOutboxPolicy(dependencies.env || process.env);
  if (!policy.enabled) return { status: 'disabled', processed: 0 };

  let smtpConfigured = false;
  let smtpConfigurationError = null;
  try {
    smtpConfigured = Boolean(
      (dependencies.emailService || emailService).getSmtpConfig(dependencies.env || process.env)
    );
  } catch (error) {
    smtpConfigurationError = error;
  }

  const connection = await pool.getConnection();
  const workerId = dependencies.workerId || `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  let hasLock = false;
  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 0) AS Acquired', [WORKER_LOCK_NAME]);
    hasLock = Number(lockRows[0]?.Acquired || 0) === 1;
    if (!hasLock) return { status: 'busy', processed: 0 };

    await recoverStaleJobs(connection, policy);
    await closeExpiredJobs(connection);
    // La limpieza de tokens vencidos sigue funcionando aunque falte SMTP, pero
    // ningún trabajo se reclama ni consume un intento/cuota en ese estado.
    if (smtpConfigurationError) {
      return {
        status: 'smtp_configuration_error',
        processed: 0,
        reason: smtpConfigurationError.code || 'SMTP_CONFIGURATION_INVALID',
      };
    }
    if (!smtpConfigured) return { status: 'smtp_not_configured', processed: 0 };
    const providerPause = await loadProviderPause(connection);
    if (providerPause) {
      return {
        status: 'provider_paused',
        processed: 0,
        reason: providerPause.reason,
        resumeAt: providerPause.resumeAt,
      };
    }
    const candidates = await loadCandidates(connection, policy.batchSize);
    if (!candidates.length) return { status: 'idle', processed: 0 };

    const usage = await loadUsage(connection);
    let processed = 0;
    let deferred = 0;
    let providerPaused = null;

    for (const row of candidates) {
      // Durante SIGTERM finaliza el contacto actual, pero no empieza otro. Así
      // PM2 puede reiniciar sir-api sin cortar un envío aceptado por SMTP.
      if (typeof dependencies.shouldStop === 'function' && dependencies.shouldStop()) break;
      if (processed >= policy.batchSize) break;
      const decision = quotaDecision(row.Tipo, usage, policy, new Date());
      if (!decision.allowed) {
        await deferForQuota(connection, row.Id_Email, decision.nextAt);
        deferred += 1;
        continue;
      }

      const [claim] = await connection.query(
        `UPDATE email_outbox
         SET Estado = 'procesando', Bloqueado_En = NOW(), Bloqueado_Por = ?,
             Fecha_Actualizacion = NOW()
         WHERE Id_Email = ? AND Estado = 'pendiente'`,
        [workerId, row.Id_Email]
      );
      if (Number(claim.affectedRows || 0) !== 1) continue;

      // Se reserva una unidad antes de contactar al proveedor. Si el proceso
      // cae después de que SMTP acepta el mensaje pero antes de marcarlo, el
      // intento sigue contado y nunca se rebasa el límite local de 100/24 h.
      const [dispatch] = await connection.query(
        `INSERT INTO email_outbox_dispatches (Id_Email, Tipo, Reservado_En)
         VALUES (?, ?, NOW())`,
        [row.Id_Email, row.Tipo]
      );
      const dispatchId = dispatch.insertId;
      usage.totalSent += 1;
      if (row.Tipo === EMAIL_TYPES.SCHEDULE) usage.scheduleSent += 1;

      try {
        const result = await deliverRow(row, { ...dependencies, policy });
        if (result?.skipped) {
          await releaseQuotaReservation(connection, dispatchId, row, usage);
          await releaseForConfiguration(connection, row, policy, 'SMTP no está configurado; el correo permanece pendiente.');
          providerPaused = {
            reason: 'smtp_config',
            resumeAt: await pauseProvider(connection, { reason: 'smtp_config' }, policy),
          };
          break;
        }
        await markSent(connection, row, result);
        processed += 1;
      } catch (error) {
        if (releasesQuotaReservation(error)) {
          await releaseQuotaReservation(connection, dispatchId, row, usage);
        }
        const failure = await markDeliveryFailure(connection, row, error, policy);
        processed += 1;
        if (failure.infrastructureDeferred) {
          providerPaused = {
            reason: failure.classification.reason,
            resumeAt: await pauseProvider(connection, failure.classification, policy),
          };
          break;
        }
      }
    }

    if (providerPaused) {
      return {
        status: 'provider_paused',
        processed,
        deferred,
        ...providerPaused,
      };
    }
    return { status: processed || deferred ? 'processed' : 'idle', processed, deferred };
  } finally {
    if (hasLock) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [WORKER_LOCK_NAME]);
      } catch (_error) {
        // La conexión al servidor pudo haberse perdido; MySQL libera el lock al cerrarla.
      }
    }
    connection.release();
  }
}

module.exports = {
  EMAIL_TYPES,
  EMAIL_PRIORITIES,
  getOutboxPolicy,
  enqueueEmail,
  enqueuePasswordResetEmail,
  enqueueScheduleEmail,
  isSingleMailbox,
  processOutboxBatch,
  _private: {
    classifyDeliveryError,
    releasesQuotaReservation,
    computeRetryDelaySeconds,
    hashDedupe,
    isSingleMailbox,
    parsePayload,
    quotaDecision,
    loadProviderPause,
    pauseProvider,
    markDeliveryFailure,
    deliverRow,
  },
};
