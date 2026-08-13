const test = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../services/email.service');

const smtpEnv = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'sir@example.test',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'SIR <sir@example.test>',
  FRONTEND_URL: 'https://sir.example.test',
};

test('considera SMTP configurado sólo cuando las credenciales están completas', () => {
  assert.equal(emailService.getSmtpConfig({ ...smtpEnv, SMTP_PASS: '' }), null);
  const config = emailService.getSmtpConfig(smtpEnv);
  assert.equal(config.secure, false);
  assert.equal(config.requireTLS, true);
  assert.equal(config.auth.user, 'sir@example.test');
});

test('en producción exige TLS para autenticar y enviar por SMTP', () => {
  assert.throws(() => emailService.getSmtpConfig({
    ...smtpEnv,
    NODE_ENV: 'production',
    SMTP_PORT: '25',
    SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'false',
  }), (error) => error.code === 'SMTP_TLS_REQUIRED');

  const implicitTls = emailService.getSmtpConfig({
    ...smtpEnv,
    NODE_ENV: 'production',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
  });
  assert.equal(implicitTls.secure, true);

  const startTls = emailService.getSmtpConfig({
    ...smtpEnv,
    NODE_ENV: 'production',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true',
  });
  assert.equal(startTls.requireTLS, true);
});

test('el correo de recuperación escapa datos y conserva el enlace seguro', async () => {
  let message;
  const result = await emailService.sendPasswordResetEmail({
    to: 'persona@example.test',
    name: '<Asesor>',
    resetUrl: 'https://sir.example.test/reset-password?token=a&b=c',
    expiresInMinutes: 10,
  }, {
    env: smtpEnv,
    transporter: { sendMail: async (value) => { message = value; return { messageId: 'reset-1' }; } },
  });

  assert.deepEqual(result, { skipped: false, messageId: 'reset-1' });
  assert.equal(message.to, 'persona@example.test');
  assert.equal(message.subject, 'Restablece tu contraseña - SIR');
  assert.match(message.html, /Recupera tu acceso/);
  assert.match(message.html, /Enlace temporal/);
  assert.match(message.html, /caduca en <strong>10 minutos/);
  assert.match(message.html, /¿No solicitaste este cambio\?/);
  assert.match(message.html, /&lt;Asesor&gt;/);
  assert.match(message.html, /token=a&amp;b=c/);
  assert.doesNotMatch(message.html, /Hola <Asesor>/);
  assert.doesNotMatch(message.html, /<img\b/i);
  assert.doesNotMatch(message.html, /<style\b/i);
  assert.match(message.html, /role="presentation"/);
  assert.match(message.text, /expirará en 10 minutos/);
  assert.match(message.text, /no compartas este enlace ni tu contraseña/i);
});

test('el correo de horario diferencia una actualización y resume los siete días', async () => {
  let message;
  const turnos = Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: index < 5,
    horaInicio: index < 5 ? '08:00' : null,
    horaFin: index < 5 ? '17:30' : null,
  }));

  await emailService.sendSchedulePublishedEmail({
    to: 'asesor@example.test',
    name: '<Andrea>',
    weekStart: '2026-08-17',
    weekEnd: '2026-08-23',
    turnos,
    channelName: 'Web & <Ventas>',
    vacation: {
      fechaInicio: '2026-08-19',
      fechaFin: '2026-08-21',
      fechaRegreso: '2026-08-24',
    },
    isUpdate: true,
  }, {
    env: smtpEnv,
    transporter: { sendMail: async (value) => { message = value; return {}; } },
  });

  assert.match(message.subject, /actualizado/i);
  assert.match(message.text, /Lunes: 8:00 a\. m\. – 5:30 p\. m\./);
  assert.match(message.text, /Sábado: Descanso/);
  assert.match(message.text, /Vacaciones: 19 de agosto de 2026 al 21 de agosto de 2026/);
  assert.match(message.text, /https:\/\/sir\.example\.test\/MiHorario/);
  assert.match(message.html, /Tu horario está listo/);
  assert.match(message.html, /ACTUALIZADO/);
  assert.match(message.html, /17 de agosto de 2026 al 23 de agosto de 2026/);
  assert.match(message.html, /Vacaciones programadas/);
  assert.match(message.html, /Canal asignado:<\/strong> Web &amp; &lt;Ventas&gt;/);
  assert.match(message.html, /Hola &lt;Andrea&gt;/);
  assert.doesNotMatch(message.html, /Hola <Andrea>/);
  assert.doesNotMatch(message.html, /<img\b/i);
  for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
    assert.match(message.html, new RegExp(`>${day}<`));
  }
});

test('permite previsualizar las plantillas sin crear un transporte SMTP', () => {
  const reset = emailService.buildPasswordResetMessage({
    to: 'persona@example.test',
    name: 'Valentina',
    resetUrl: 'https://sir.example.test/reset-password?token=preview',
    expiresInMinutes: 15,
  });
  assert.equal(reset.to, 'persona@example.test');
  assert.match(reset.text, /15 minutos/);
  assert.match(reset.html, /Maxi<\/span>tours/);

  const schedule = emailService.buildSchedulePublishedMessage({
    to: 'asesor@example.test',
    name: 'Valentina',
    weekStart: '2026-08-17',
    weekEnd: '2026-08-23',
    turnos: [],
  }, { FRONTEND_URL: 'https://sir.example.test' });
  assert.equal(schedule.to, 'asesor@example.test');
  assert.match(schedule.html, /href="https:\/\/sir\.example\.test\/MiHorario"/);
  assert.match(schedule.text, /versión más reciente/);
});

test('rechaza FRONTEND_URL inválida antes de construir enlaces de horarios', () => {
  assert.throws(() => emailService.buildSchedulePublishedMessage({
    to: 'asesor@example.test',
    name: 'Valentina',
    weekStart: '2026-08-17',
    weekEnd: '2026-08-23',
    turnos: [],
  }, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'sir.example.test',
  }), (error) => error.code === 'FRONTEND_URL_INVALID');
});

test('la verificación SMTP no abre conexión si faltan variables', async () => {
  const result = await emailService.verifySmtpConnection({ env: {} });
  assert.deepEqual(result, { configured: false, verified: false });
});
