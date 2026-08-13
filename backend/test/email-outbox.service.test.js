const test = require('node:test');
const assert = require('node:assert/strict');

const outbox = require('../services/email-outbox.service');

const { EMAIL_TYPES, _private } = outbox;
const enabledPolicy = (overrides = {}) => ({
  ...outbox.getOutboxPolicy({ EMAIL_OUTBOX_ENABLED: 'true' }),
  ...overrides,
});

test('la política reserva 10 de 100 correos para recuperación y limita horarios a 90', () => {
  const policy = outbox.getOutboxPolicy({});
  assert.equal(policy.totalLimit, 100);
  assert.equal(policy.passwordReserve, 10);
  assert.equal(policy.scheduleLimit, 90);
  assert.equal(policy.lockTimeoutSeconds, 60);
  assert.equal(policy.maxAttempts, 24);
  assert.equal(policy.enabled, false);

  const explicitlyEnabled = outbox.getOutboxPolicy({ EMAIL_OUTBOX_ENABLED: 'true' });
  assert.equal(explicitlyEnabled.enabled, true);

  const custom = outbox.getOutboxPolicy({
    EMAIL_OUTBOX_TOTAL_LIMIT_24H: '80',
    EMAIL_OUTBOX_PASSWORD_RESERVE_24H: '15',
  });
  assert.equal(custom.totalLimit, 80);
  assert.equal(custom.scheduleLimit, 65);

  const cannotConsumeReserve = outbox.getOutboxPolicy({
    EMAIL_OUTBOX_TOTAL_LIMIT_24H: '100',
    EMAIL_OUTBOX_PASSWORD_RESERVE_24H: '10',
    EMAIL_OUTBOX_SCHEDULE_LIMIT_24H: '99',
  });
  assert.equal(cannotConsumeReserve.scheduleLimit, 90);

  const tinyMailbox = outbox.getOutboxPolicy({
    EMAIL_OUTBOX_TOTAL_LIMIT_24H: '5',
  });
  assert.equal(tinyMailbox.passwordReserve, 5);
  assert.equal(tinyMailbox.scheduleLimit, 0);

  const unsafeEnvironment = outbox.getOutboxPolicy({
    EMAIL_OUTBOX_TOTAL_LIMIT_24H: '500',
    EMAIL_OUTBOX_PASSWORD_RESERVE_24H: '0',
    EMAIL_OUTBOX_SCHEDULE_LIMIT_24H: '500',
  });
  assert.equal(unsafeEnvironment.totalLimit, 100);
  assert.equal(unsafeEnvironment.passwordReserve, 10);
  assert.equal(unsafeEnvironment.scheduleLimit, 90);
});

test('la cuota móvil frena horarios al llegar a 90 pero conserva espacio para recuperar contraseñas', () => {
  const policy = outbox.getOutboxPolicy({});
  const now = new Date('2026-08-13T12:00:00.000Z');
  const usage = {
    totalSent: 90,
    scheduleSent: 90,
    oldestTotal: new Date('2026-08-12T13:00:00.000Z'),
    oldestSchedule: new Date('2026-08-12T13:30:00.000Z'),
  };

  const schedule = _private.quotaDecision(EMAIL_TYPES.SCHEDULE, usage, policy, now);
  const password = _private.quotaDecision(EMAIL_TYPES.PASSWORD_RESET, usage, policy, now);

  assert.equal(schedule.allowed, false);
  assert.equal(schedule.nextAt.toISOString(), '2026-08-13T13:30:01.000Z');
  assert.equal(password.allowed, true);
});

test('el límite total de 100 bloquea cualquier categoría hasta que venza el envío más antiguo', () => {
  const policy = outbox.getOutboxPolicy({});
  const now = new Date('2026-08-13T12:00:00.000Z');
  const usage = {
    totalSent: 100,
    scheduleSent: 90,
    oldestTotal: new Date('2026-08-12T12:15:00.000Z'),
    oldestSchedule: new Date('2026-08-12T13:30:00.000Z'),
  };

  const decision = _private.quotaDecision(EMAIL_TYPES.PASSWORD_RESET, usage, policy, now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.nextAt.toISOString(), '2026-08-13T12:15:01.000Z');
});

test('los reintentos usan backoff exponencial acotado', () => {
  const policy = outbox.getOutboxPolicy({
    EMAIL_OUTBOX_RETRY_BASE_SECONDS: '60',
    EMAIL_OUTBOX_RETRY_MAX_SECONDS: '300',
  });
  assert.equal(_private.computeRetryDelaySeconds(1, policy), 60);
  assert.equal(_private.computeRetryDelaySeconds(2, policy), 120);
  assert.equal(_private.computeRetryDelaySeconds(3, policy), 240);
  assert.equal(_private.computeRetryDelaySeconds(4, policy), 300);
  assert.equal(_private.computeRetryDelaySeconds(20, policy), 300);
});

test('distingue fallos permanentes de destinatario y fallos transitorios/cuota del proveedor', () => {
  assert.deepEqual(
    _private.classifyDeliveryError({ code: 'EENVELOPE', responseCode: 550, message: 'Mailbox unavailable' }),
    { permanent: true, reason: 'smtp_permanent' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ responseCode: 451, message: 'Try again later' }),
    { permanent: false, reason: 'smtp_transient' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ responseCode: 550, message: 'Daily quota limit exceeded' }),
    { permanent: false, reason: 'provider_throttled' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ responseCode: 550, message: 'Daily sending limit exceeded' }),
    { permanent: false, reason: 'provider_throttled' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ code: 'EAUTH', responseCode: 535, message: 'Authentication failed' }),
    { permanent: false, reason: 'smtp_auth' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ code: 'FRONTEND_URL_INVALID', message: 'FRONTEND_URL inválida' }),
    { permanent: false, reason: 'app_config' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ command: 'MAIL FROM', responseCode: 553, message: 'Sender rejected' }),
    { permanent: false, reason: 'smtp_config' }
  );
  assert.deepEqual(
    _private.classifyDeliveryError({ command: 'RCPT TO', responseCode: 550, message: 'Mailbox unavailable' }),
    { permanent: true, reason: 'smtp_permanent' }
  );
  assert.equal(_private.classifyDeliveryError({ code: 'ECONNECTION' }).permanent, false);
});

test('deduplica solicitudes de recuperación iguales y diferencia un token nuevo', async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ insertId: calls.length, affectedRows: 1 }];
    },
  };
  const base = {
    to: 'Usuario@Example.com',
    name: 'Usuario',
    resetUrl: 'https://sir.example/reset-password?token=uno',
    expiresInMinutes: 10,
  };

  await outbox.enqueuePasswordResetEmail(base, { executor, now: new Date('2026-08-13T12:00:00Z') });
  await outbox.enqueuePasswordResetEmail(base, { executor, now: new Date('2026-08-13T12:00:00Z') });
  await outbox.enqueuePasswordResetEmail(
    { ...base, resetUrl: 'https://sir.example/reset-password?token=dos' },
    { executor, now: new Date('2026-08-13T12:01:00Z') }
  );

  const inserts = calls.filter((call) => /INSERT INTO email_outbox/.test(call.sql));
  const replacements = calls.filter((call) => /Reemplazado por una solicitud/.test(call.sql));
  assert.equal(inserts.length, 3);
  assert.equal(replacements.length, 3);
  assert.match(inserts[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(inserts[0].params[2], 'usuario@example.com');
  assert.equal(inserts[0].params[4], inserts[1].params[4]);
  assert.notEqual(inserts[1].params[4], inserts[2].params[4]);
  assert.equal(replacements[0].params[1], inserts[0].params[4]);
  assert.match(inserts[0].params[4], /^password_reset:[a-f0-9]{64}$/);
});

test('cada fila acepta exactamente un buzón para que una entrega sea una unidad de cuota', async () => {
  const executor = { async query() { throw new Error('no debe insertar'); } };
  for (const to of [
    'a@example.com,b@example.com',
    'a@example.com; b@example.com',
    'Nombre <a@example.com>',
    'a@example.com\r\nBcc: b@example.com',
  ]) {
    await assert.rejects(() => outbox.enqueueEmail({
      type: EMAIL_TYPES.SCHEDULE,
      to,
      payload: {},
      dedupeKey: `test:${to}`,
    }, { executor }), (error) => error.code === 'EMAIL_RECIPIENT_INVALID');
  }
  assert.equal(_private.isSingleMailbox('asesor+sir@viajesmaxitours.co'), true);
});

test('deduplica un correo de horario dentro de la misma publicación', async () => {
  const keys = [];
  const replacements = [];
  const executor = {
    async query(sql, params) {
      if (/Reemplazado por una publicación/.test(sql)) {
        replacements.push(params);
        return [{ affectedRows: 0 }];
      }
      keys.push(params[4]);
      return [{ insertId: 42, affectedRows: keys.length === 1 ? 1 : 2 }];
    },
  };
  const message = {
    to: 'asesor@example.com', name: 'Asesor', weekStart: '2026-08-17', weekEnd: '2026-08-23', turnos: [],
  };

  const first = await outbox.enqueueScheduleEmail(message, 'publicacion-1', { executor });
  const repeated = await outbox.enqueueScheduleEmail(message, 'publicacion-1', { executor });
  await outbox.enqueueScheduleEmail(message, 'publicacion-2', { executor });

  assert.equal(first.deduplicated, false);
  assert.equal(repeated.deduplicated, true);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
  assert.equal(replacements.length, 3);
  assert.deepEqual(replacements[2].slice(0, 3), [
    'asesor@example.com',
    '2026-08-17',
    '2026-08-23',
  ]);
  assert.equal(replacements[2][3], keys[2]);
});

test('sin SMTP el worker limpia expirados sin reclamar trabajos ni consumir intentos', async () => {
  const connection = workerConnection(null);
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    emailService: { getSmtpConfig: () => null },
    policy: enabledPolicy(),
  });

  assert.deepEqual(result, { status: 'smtp_not_configured', processed: 0 });
  assert.ok(connection.calls.some((call) => /El correo expiró antes/.test(call.sql)));
  assert.equal(connection.calls.some((call) => /SET Estado = 'procesando'/.test(call.sql)), false);
  assert.equal(connection.released, true);
});

test('el worker no se activa por omisión ni abre una conexión de base de datos', async () => {
  let connectionRequested = false;
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { connectionRequested = true; throw new Error('no debe conectar'); } },
    env: {},
  });
  assert.deepEqual(result, { status: 'disabled', processed: 0 });
  assert.equal(connectionRequested, false);
});

test('una configuración SMTP insegura no reclama trabajos ni consume cuota', async () => {
  const connection = workerConnection(null);
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    emailService: {
      getSmtpConfig() {
        throw Object.assign(new Error('TLS requerido'), { code: 'SMTP_TLS_REQUIRED' });
      },
    },
    policy: enabledPolicy(),
  });

  assert.deepEqual(result, {
    status: 'smtp_configuration_error',
    processed: 0,
    reason: 'SMTP_TLS_REQUIRED',
  });
  assert.equal(connection.calls.some((call) => /SET Estado = 'procesando'/.test(call.sql)), false);
  assert.equal(connection.calls.some((call) => /INSERT INTO email_outbox_dispatches/.test(call.sql)), false);
  assert.equal(connection.released, true);
});

function workerConnection(row, providerPause = null) {
  const calls = [];
  let released = false;
  return {
    calls,
    get released() { return released; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/GET_LOCK/.test(sql)) return [[{ Acquired: 1 }]];
      if (/FROM email_outbox_control/.test(sql)) {
        return [[providerPause ? {
          Pausado_Hasta: providerPause.resumeAt,
          Motivo: providerPause.reason,
        } : []].flat()];
      }
      if (/SELECT Id_Email, Tipo/.test(sql)) {
        return [Array.isArray(row) ? row : (row ? [row] : [])];
      }
      if (/Total_Enviados/.test(sql)) {
        return [[{
          Total_Enviados: 0,
          Horarios_Enviados: 0,
          Primer_Envio: null,
          Primer_Horario: null,
        }]];
      }
      if (/INSERT INTO email_outbox_dispatches/.test(sql)) {
        return [{ affectedRows: 1, insertId: 501 }];
      }
      return [{ affectedRows: 1 }];
    },
    release() { released = true; },
  };
}

test('el worker entrega un pendiente y lo marca enviado bajo el lock global', async () => {
  const connection = workerConnection({
    Id_Email: 7,
    Tipo: EMAIL_TYPES.PASSWORD_RESET,
    Destinatario: 'usuario@example.com',
    Payload: JSON.stringify({
      to: 'usuario@example.com',
      name: 'Usuario',
      resetUrl: 'https://sir.example/reset-password?token=abc',
      expiresInMinutes: 10,
    }),
    Intentos: 0,
    Max_Intentos: 8,
    Expira_En: new Date(Date.now() + 600000),
  });
  let receivedDependencies = null;
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    env: { SMTP_HOST: 'smtp.test', marker: 'injected' },
    policy: enabledPolicy({ batchSize: 1 }),
    emailService: {
      getSmtpConfig: () => ({ configured: true }),
      async sendPasswordResetEmail(_payload, dependencies) {
        receivedDependencies = dependencies;
        return { skipped: false, messageId: 'message-7' };
      },
    },
    workerId: 'test-worker',
  });

  assert.equal(result.processed, 1);
  assert.equal(connection.released, true);
  assert.equal(receivedDependencies.env.marker, 'injected');
  assert.ok(connection.calls.some((call) => /SET Estado = 'enviado'/.test(call.sql)));
  assert.ok(connection.calls.some((call) => /INSERT INTO email_outbox_dispatches/.test(call.sql)));
  assert.ok(connection.calls.some((call) => /RELEASE_LOCK/.test(call.sql)));
});

test('un fallo transitorio vuelve a pendiente con backoff y no se cuenta como enviado', async () => {
  const connection = workerConnection({
    Id_Email: 9,
    Tipo: EMAIL_TYPES.SCHEDULE,
    Destinatario: 'asesor@example.com',
    Payload: JSON.stringify({
      to: 'asesor@example.com',
      name: 'Asesor',
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      turnos: [],
    }),
    Intentos: 0,
    Max_Intentos: 8,
    Expira_En: null,
  });
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    env: { SMTP_HOST: 'smtp.test' },
    policy: enabledPolicy({ batchSize: 1 }),
    emailService: {
      getSmtpConfig: () => ({ configured: true }),
      async sendSchedulePublishedEmail() {
        const error = new Error('socket closed');
        error.code = 'ECONNECTION';
        throw error;
      },
    },
    workerId: 'test-worker',
  });

  assert.equal(result.processed, 1);
  assert.ok(connection.calls.some((call) => (
    /SET Estado = 'pendiente', Intentos = \?/.test(call.sql)
    && call.params[0] === 1
    && call.params[2] === 'socket closed'
  )));
  assert.equal(connection.calls.some((call) => /SET Estado = 'enviado'/.test(call.sql)), false);
  assert.equal(connection.calls.some((call) => /DELETE FROM email_outbox_dispatches/.test(call.sql)), false);
});

test('una pausa global activa no reclama ni contacta nuevos trabajos', async () => {
  const connection = workerConnection({
    Id_Email: 10,
    Tipo: EMAIL_TYPES.SCHEDULE,
    Payload: '{}',
    Intentos: 0,
    Max_Intentos: 8,
  }, {
    reason: 'smtp_auth',
    resumeAt: new Date(Date.now() + 300000),
  });
  let contacted = false;
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    env: { SMTP_HOST: 'smtp.test' },
    policy: enabledPolicy(),
    emailService: {
      getSmtpConfig: () => ({ configured: true }),
      async sendSchedulePublishedEmail() { contacted = true; },
    },
  });

  assert.equal(result.status, 'provider_paused');
  assert.equal(result.reason, 'smtp_auth');
  assert.equal(contacted, false);
  assert.equal(connection.calls.some((call) => /SET Estado = 'procesando'/.test(call.sql)), false);
});

test('el primer fallo de proveedor abre el circuito y detiene el resto del lote', async () => {
  const rows = [21, 22].map((id) => ({
    Id_Email: id,
    Tipo: EMAIL_TYPES.SCHEDULE,
    Destinatario: `asesor${id}@example.com`,
    Payload: JSON.stringify({
      to: `asesor${id}@example.com`,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      turnos: [],
    }),
    Intentos: 0,
    Max_Intentos: 8,
    Expira_En: null,
  }));
  const connection = workerConnection(rows);
  let contacts = 0;
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    env: { SMTP_HOST: 'smtp.test' },
    policy: enabledPolicy({ batchSize: 5 }),
    emailService: {
      getSmtpConfig: () => ({ configured: true }),
      async sendSchedulePublishedEmail() {
        contacts += 1;
        throw Object.assign(new Error('Authentication failed'), { code: 'EAUTH', responseCode: 535 });
      },
    },
    workerId: 'test-worker',
  });

  assert.equal(result.status, 'provider_paused');
  assert.equal(result.reason, 'smtp_auth');
  assert.equal(contacts, 1);
  assert.ok(connection.calls.some((call) => /INSERT INTO email_outbox_control/.test(call.sql)));
});

test('al solicitar apagado termina el correo actual y no contacta el siguiente', async () => {
  const rows = [31, 32].map((id) => ({
    Id_Email: id,
    Tipo: EMAIL_TYPES.SCHEDULE,
    Destinatario: `asesor${id}@example.com`,
    Payload: JSON.stringify({
      to: `asesor${id}@example.com`,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      turnos: [],
    }),
    Intentos: 0,
    Max_Intentos: 8,
    Expira_En: null,
  }));
  const connection = workerConnection(rows);
  let contacts = 0;
  let stopping = false;
  const result = await outbox.processOutboxBatch({
    db: { async getConnection() { return connection; } },
    policy: enabledPolicy({ batchSize: 5 }),
    emailService: {
      getSmtpConfig: () => ({ configured: true }),
      async sendSchedulePublishedEmail() {
        contacts += 1;
        stopping = true;
        return { skipped: false, messageId: 'shutdown-safe' };
      },
    },
    shouldStop: () => stopping,
    workerId: 'test-worker',
  });

  assert.equal(contacts, 1);
  assert.equal(result.processed, 1);
});

test('un rechazo SMTP inequívoco libera la reserva de cuota y conserva el trabajo', async () => {
  for (const error of [
    Object.assign(new Error('Authentication failed'), { code: 'EAUTH', responseCode: 535 }),
    Object.assign(new Error('Daily quota limit exceeded'), { responseCode: 550 }),
    Object.assign(new Error('FRONTEND_URL inválida'), { code: 'FRONTEND_URL_INVALID' }),
    Object.assign(new Error('Sender rejected'), { command: 'MAIL FROM', responseCode: 553 }),
  ]) {
    const connection = workerConnection({
      Id_Email: 11,
      Tipo: EMAIL_TYPES.SCHEDULE,
      Destinatario: 'asesor@example.com',
      Payload: JSON.stringify({
        to: 'asesor@example.com',
        name: 'Asesor',
        weekStart: '2026-08-17',
        weekEnd: '2026-08-23',
        turnos: [],
      }),
      Intentos: 0,
      Max_Intentos: 8,
      Expira_En: null,
    });
    const result = await outbox.processOutboxBatch({
      db: { async getConnection() { return connection; } },
      env: { SMTP_HOST: 'smtp.test' },
      policy: enabledPolicy({ batchSize: 1 }),
      emailService: {
        getSmtpConfig: () => ({ configured: true }),
        async sendSchedulePublishedEmail() { throw error; },
      },
      workerId: 'test-worker',
    });

    assert.equal(result.processed, 1);
    assert.ok(connection.calls.some((call) => (
      /DELETE FROM email_outbox_dispatches/.test(call.sql)
      && call.params[0] === 501
    )));
    assert.ok(connection.calls.some((call) => /DATE_ADD\(NOW\(\), INTERVAL \? SECOND\)/.test(call.sql)));
  }
});

test('autenticación y cuota externa se aplazan sin agotar intentos ni borrar el horario', async () => {
  for (const error of [
    Object.assign(new Error('Authentication failed'), { code: 'EAUTH', responseCode: 535 }),
    Object.assign(new Error('Daily quota limit exceeded'), { responseCode: 550 }),
    Object.assign(new Error('FRONTEND_URL inválida'), { code: 'FRONTEND_URL_INVALID' }),
    Object.assign(new Error('Sender rejected'), { command: 'MAIL FROM', responseCode: 553 }),
  ]) {
    const calls = [];
    const connection = {
      async query(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; },
    };
    const result = await _private.markDeliveryFailure(connection, {
      Id_Email: 12,
      Intentos: 7,
      Max_Intentos: 8,
      Expira_En: null,
    }, error, outbox.getOutboxPolicy({}));

    assert.equal(result.terminal, false);
    assert.equal(result.infrastructureDeferred, true);
    assert.equal(_private.releasesQuotaReservation(error), true);
    assert.ok(calls.some((call) => /DATE_ADD\(NOW\(\), INTERVAL \? SECOND\)/.test(call.sql)));
    assert.equal(calls.some((call) => /Payload = JSON_OBJECT/.test(call.sql)), false);
    assert.equal(calls.some((call) => /Intentos =/.test(call.sql)), false);
  }
  assert.equal(_private.releasesQuotaReservation(Object.assign(new Error('socket closed'), {
    code: 'ECONNECTION',
  })), false);
});

test('al reintentar recuperación la plantilla informa la vigencia restante real', async () => {
  let delivered = null;
  await _private.deliverRow({
    Tipo: EMAIL_TYPES.PASSWORD_RESET,
    Destinatario: 'usuario@example.com',
    Payload: JSON.stringify({
      to: 'usuario@example.com',
      resetUrl: 'https://sir.example/reset-password?token=abc',
      expiresInMinutes: 10,
    }),
    Expira_En: new Date('2026-08-13T12:02:05.000Z'),
  }, {
    now: new Date('2026-08-13T12:00:00.000Z'),
    emailService: {
      async sendPasswordResetEmail(payload) {
        delivered = payload;
        return { skipped: false, messageId: 'remaining-time' };
      },
    },
  });

  assert.equal(delivered.expiresInMinutes, 2);
});

test('en desarrollo permite recuperación HTTP sólo sobre loopback', async () => {
  let delivered = null;
  await _private.deliverRow({
    Tipo: EMAIL_TYPES.PASSWORD_RESET,
    Destinatario: 'usuario@example.com',
    Payload: JSON.stringify({
      resetUrl: 'http://localhost:4200/reset-password#token=abc',
      expiresInMinutes: 10,
    }),
  }, {
    env: { NODE_ENV: 'development' },
    emailService: {
      async sendPasswordResetEmail(payload) {
        delivered = payload;
        return { skipped: false, messageId: 'local-reset' };
      },
    },
  });
  assert.equal(delivered.to, 'usuario@example.com');

  await assert.rejects(() => _private.deliverRow({
    Tipo: EMAIL_TYPES.PASSWORD_RESET,
    Destinatario: 'usuario@example.com',
    Payload: JSON.stringify({
      resetUrl: 'http://sir.example.com/reset-password#token=abc',
      expiresInMinutes: 10,
    }),
  }, { env: { NODE_ENV: 'development' } }), (error) => error.code === 'EMAIL_PAYLOAD_INVALID');
});

test('no inicia SMTP si al enlace de recuperación le quedan menos de dos minutos', async () => {
  let called = false;
  await assert.rejects(() => _private.deliverRow({
    Tipo: EMAIL_TYPES.PASSWORD_RESET,
    Destinatario: 'usuario@example.com',
    Payload: JSON.stringify({
      to: 'usuario@example.com',
      resetUrl: 'https://sir.example/reset-password?token=abc',
      expiresInMinutes: 10,
    }),
    Expira_En: new Date('2026-08-13T12:01:59.000Z'),
  }, {
    now: new Date('2026-08-13T12:00:00.000Z'),
    policy: outbox.getOutboxPolicy({}),
    emailService: {
      async sendPasswordResetEmail() { called = true; },
    },
  }), (error) => error.code === 'EMAIL_PAYLOAD_INVALID' && error.permanent === true);
  assert.equal(called, false);
});

test('la entrega fuerza el destinatario auditado y no permite ampliar la cuota desde payload', async () => {
  let delivered = null;
  await _private.deliverRow({
    Tipo: EMAIL_TYPES.SCHEDULE,
    Destinatario: 'asesor@example.com',
    Payload: JSON.stringify({
      to: ['otro@example.com', 'tercero@example.com'],
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      turnos: [],
    }),
  }, {
    emailService: {
      async sendSchedulePublishedEmail(payload) {
        delivered = payload;
        return { skipped: false, messageId: 'forced-recipient' };
      },
    },
  });

  assert.equal(delivered.to, 'asesor@example.com');
});

test('rechaza payload de horario inválido antes de contactar SMTP', async () => {
  let called = false;
  await assert.rejects(() => _private.deliverRow({
    Tipo: EMAIL_TYPES.SCHEDULE,
    Destinatario: 'asesor@example.com',
    Payload: JSON.stringify({
      to: 'asesor@example.com',
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      turnos: {},
    }),
  }, {
    emailService: {
      async sendSchedulePublishedEmail() { called = true; },
    },
  }), (error) => error.code === 'EMAIL_PAYLOAD_INVALID' && error.permanent === true);
  assert.equal(called, false);
});
