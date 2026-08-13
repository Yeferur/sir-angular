const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('../utils/frontend-url');

const DEFAULT_TIMEOUT_MS = 10000;

function parseBoolean(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(value).trim().toLowerCase());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getSmtpConfig(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 0);
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  const from = String(env.SMTP_FROM || user).trim();

  // El relay SMTP autenticado requiere las dos credenciales. Una configuración
  // parcial se considera desactivada para evitar conexiones sin posibilidad de entrega.
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) {
    return null;
  }

  const timeout = Number(env.SMTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
  const secure = parseBoolean(env.SMTP_SECURE, port === 465);
  const requireTLS = parseBoolean(env.SMTP_REQUIRE_TLS, port === 587);

  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production' && !secure && !requireTLS) {
    const error = new Error('En producción SMTP debe usar TLS explícito o implícito.');
    error.code = 'SMTP_TLS_REQUIRED';
    throw error;
  }

  return {
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
    from,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}

function createTransporter(config, transportFactory = nodemailer.createTransport) {
  if (!config) return null;
  return transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    auth: config.auth,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
  });
}

async function deliver(message, dependencies = {}) {
  const env = dependencies.env || process.env;
  const config = getSmtpConfig(env);
  const transporter = dependencies.transporter
    || createTransporter(config, dependencies.transportFactory || nodemailer.createTransport);

  if (!config || !transporter) {
    console.warn('[email.service] SMTP no configurado; se omitió el envío de correo.');
    return { skipped: true };
  }

  const info = await transporter.sendMail({ from: config.from, ...message });
  return { skipped: false, messageId: info?.messageId || null };
}

function formatDateLabel(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!match) return '—';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'p. m.' : 'a. m.'}`;
}

function renderEmailDocument({ preheader, content }) {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light only">
    <title>SIR Maxitours</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f5f7;color:#202124;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f5f7" style="width:100%;background-color:#f3f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;">
            <tr>
              <td bgcolor="#17191c" style="padding:20px 28px;background-color:#17191c;border-radius:18px 18px 0 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle" style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:-0.4px;">
                      <span style="color:#168cff;">Maxi</span>tours
                    </td>
                    <td align="right" valign="middle">
                      <span style="display:inline-block;padding:6px 10px;border:1px solid #3a3d42;border-radius:999px;color:#d7d9dc;font-size:11px;font-weight:700;letter-spacing:1px;">SIR</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e2e6ea;border-top:0;border-radius:0 0 18px 18px;overflow:hidden;">
                ${content}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 20px 0;color:#7a8088;font-size:12px;line-height:1.6;">
                Mensaje automático de SIR · Maxitours<br>
                Por favor, no respondas a este correo.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderCta(label, url) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td bgcolor="#0a84ff" style="background-color:#0a84ff;border-radius:10px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

function buildPasswordResetMessage({ to, name, resetUrl, expiresInMinutes = 10 }) {
  const safeName = String(name || '').trim() || 'hola';
  const subject = 'Restablece tu contraseña - SIR';
  const text = [
    `Hola ${safeName},`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña en SIR.',
    `Este enlace expirará en ${expiresInMinutes} minutos:`,
    resetUrl,
    '',
    'Si no solicitaste este cambio, ignora este correo: tu contraseña seguirá siendo la misma.',
    'Por seguridad, no compartas este enlace ni tu contraseña con nadie.',
  ].join('\n');

  const html = renderEmailDocument({
    preheader: `Usa este enlace durante los próximos ${expiresInMinutes} minutos para recuperar tu acceso a SIR.`,
    content: `
      <div style="padding:32px 32px 12px;">
        <p style="margin:0 0 10px;color:#0a84ff;font-size:12px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;">Seguridad de la cuenta</p>
        <h1 style="margin:0 0 16px;color:#1d1f22;font-size:28px;line-height:1.2;letter-spacing:-0.5px;">Recupera tu acceso</h1>
        <p style="margin:0 0 10px;color:#33373d;font-size:16px;line-height:1.65;">Hola ${escapeHtml(safeName)},</p>
        <p style="margin:0;color:#5d636b;font-size:15px;line-height:1.7;">
          Recibimos una solicitud para restablecer la contraseña de tu cuenta en SIR. Utiliza el botón para elegir una nueva contraseña.
        </p>
      </div>
      <div style="padding:12px 32px 4px;">
        ${renderCta('Restablecer contraseña', resetUrl)}
      </div>
      <div style="padding:20px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef7ff" style="width:100%;background-color:#eef7ff;border:1px solid #cfe7ff;border-radius:12px;">
          <tr>
            <td style="padding:14px 16px;color:#24577e;font-size:14px;line-height:1.55;">
              <strong style="color:#164a72;">Enlace temporal</strong><br>
              Por seguridad, caduca en <strong>${escapeHtml(expiresInMinutes)} minutos</strong>.
            </td>
          </tr>
        </table>
      </div>
      <div style="padding:20px 32px 28px;">
        <p style="margin:0 0 8px;color:#777d85;font-size:13px;line-height:1.55;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
        <p style="margin:0;word-break:break-all;font-size:12px;line-height:1.6;">
          <a href="${escapeHtml(resetUrl)}" style="color:#0a72d8;text-decoration:underline;">${escapeHtml(resetUrl)}</a>
        </p>
      </div>
      <div style="padding:20px 32px 24px;background-color:#fafbfc;border-top:1px solid #eceff2;">
        <p style="margin:0 0 6px;color:#30343a;font-size:13px;font-weight:700;">¿No solicitaste este cambio?</p>
        <p style="margin:0;color:#6a7078;font-size:13px;line-height:1.6;">
          Ignora este mensaje: tu contraseña seguirá siendo la misma. No compartas este enlace ni tu contraseña con nadie.
        </p>
      </div>`,
  });

  return { to, subject, text, html };
}

async function sendPasswordResetEmail(params, dependencies = {}) {
  return deliver(buildPasswordResetMessage(params), dependencies);
}

function buildScheduleLines(turnos) {
  const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return [...(turnos || [])]
    .sort((a, b) => Number(a.diaSemana) - Number(b.diaSemana))
    .map((day) => ({
      name: String(day.nombreDia || dayNames[Number(day.diaSemana) - 1] || `Día ${day.diaSemana}`),
      schedule: day.esLaborable && day.horaInicio && day.horaFin
        ? `${formatTime(day.horaInicio)} – ${formatTime(day.horaFin)}`
        : 'Descanso',
    }));
}

function buildSchedulePublishedMessage({
  to,
  name,
  weekStart,
  weekEnd,
  turnos,
  channelName,
  vacation,
  isUpdate = false,
  scheduleUrl,
}, env = process.env) {
  const safeName = String(name || '').trim() || 'hola';
  const range = `${formatDateLabel(weekStart)} al ${formatDateLabel(weekEnd)}`;
  const lines = buildScheduleLines(turnos);
  const action = isUpdate ? 'actualizado' : 'publicado';
  const subject = `Tu horario semanal fue ${action} - SIR`;
  const url = scheduleUrl || buildFrontendUrl('/MiHorario', env);
  const vacationText = vacation
    ? `Vacaciones: ${formatDateLabel(vacation.fechaInicio)} al ${formatDateLabel(vacation.fechaFin)}. Regreso: ${formatDateLabel(vacation.fechaRegreso)}.`
    : null;
  const text = [
    `Hola ${safeName},`,
    '',
    `Tu horario de la semana del ${range} fue ${action}.`,
    channelName ? `Canal: ${channelName}` : null,
    vacationText,
    '',
    ...lines.map((line) => `${line.name}: ${line.schedule}`),
    '',
    `Consulta tu horario en: ${url}`,
    'Este correo es informativo. Consulta SIR para ver siempre la versión más reciente.',
  ].filter((line) => line != null).join('\n');

  const rows = lines.map((line, index) => `
    <tr>
      <td bgcolor="${index % 2 === 0 ? '#ffffff' : '#f8fafc'}" style="padding:12px 14px;border-bottom:1px solid #e8ebef;color:#59616b;font-size:14px;">${escapeHtml(line.name)}</td>
      <td align="right" bgcolor="${index % 2 === 0 ? '#ffffff' : '#f8fafc'}" style="padding:12px 14px;border-bottom:1px solid #e8ebef;color:${line.schedule === 'Descanso' ? '#7a8088' : '#20242a'};font-size:14px;font-weight:700;">${escapeHtml(line.schedule)}</td>
    </tr>`).join('');

  const html = renderEmailDocument({
    preheader: `Tu horario del ${range} fue ${action} y ya está disponible en SIR.`,
    content: `
      <div style="padding:30px 32px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 10px;color:#0a84ff;font-size:12px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;">Planificación semanal</p>
              <h1 style="margin:0;color:#1d1f22;font-size:27px;line-height:1.2;letter-spacing:-0.5px;">Tu horario está listo</h1>
            </td>
            <td align="right" valign="top" style="padding-left:12px;">
              <span style="display:inline-block;padding:7px 10px;background-color:${isUpdate ? '#fff6dd' : '#eaf8ef'};border:1px solid ${isUpdate ? '#f1d58b' : '#bde5ca'};border-radius:999px;color:${isUpdate ? '#8b6500' : '#227443'};font-size:11px;font-weight:800;white-space:nowrap;">${isUpdate ? 'ACTUALIZADO' : 'PUBLICADO'}</span>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;color:#5d636b;font-size:15px;line-height:1.7;">
          Hola ${escapeHtml(safeName)}, ya puedes consultar la planificación asignada para esta semana.
        </p>
      </div>
      <div style="padding:0 32px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef7ff" style="width:100%;background-color:#eef7ff;border:1px solid #cfe7ff;border-radius:12px;">
          <tr>
            <td style="padding:15px 16px;color:#24577e;font-size:13px;line-height:1.45;">
              <span style="display:block;margin-bottom:3px;color:#5b7d99;font-size:10px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Semana</span>
              <strong style="color:#164a72;font-size:15px;">${escapeHtml(range)}</strong>
            </td>
          </tr>
        </table>
        ${channelName ? `
        <p style="margin:14px 0 0;color:#646b74;font-size:13px;line-height:1.55;">
          <strong style="color:#30353b;">Canal asignado:</strong> ${escapeHtml(channelName)}
        </p>` : ''}
        ${vacationText ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff8e8" style="width:100%;margin-top:14px;background-color:#fff8e8;border:1px solid #f1dfaa;border-radius:10px;">
          <tr>
            <td style="padding:12px 14px;color:#735a18;font-size:13px;line-height:1.55;">
              <strong>Vacaciones programadas</strong><br>${escapeHtml(vacationText.replace(/^Vacaciones:\s*/, ''))}
            </td>
          </tr>
        </table>` : ''}
      </div>
      <div style="padding:0 32px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e6ea;border-radius:12px;overflow:hidden;">
          <tr>
            <th align="left" bgcolor="#f0f3f6" style="padding:11px 14px;background-color:#f0f3f6;border-bottom:1px solid #dfe3e7;color:#737a83;font-size:10px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Día</th>
            <th align="right" bgcolor="#f0f3f6" style="padding:11px 14px;background-color:#f0f3f6;border-bottom:1px solid #dfe3e7;color:#737a83;font-size:10px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Jornada</th>
          </tr>
          ${rows}
        </table>
      </div>
      <div style="padding:20px 32px 28px;">
        ${renderCta('Abrir Mi horario', url)}
        <p style="margin:16px 0 0;color:#777d85;font-size:12px;line-height:1.6;">
          Este correo es informativo. Consulta SIR para ver siempre la versión más reciente de tu horario.
        </p>
      </div>`,
  });

  return { to, subject, text, html };
}

async function sendSchedulePublishedEmail(params, dependencies = {}) {
  const message = buildSchedulePublishedMessage(params, dependencies.env || process.env);
  return deliver(message, dependencies);
}

async function verifySmtpConnection(dependencies = {}) {
  const config = getSmtpConfig(dependencies.env || process.env);
  const transporter = dependencies.transporter
    || createTransporter(config, dependencies.transportFactory || nodemailer.createTransport);
  if (!config || !transporter) return { configured: false, verified: false };
  await transporter.verify();
  return { configured: true, verified: true };
}

module.exports = {
  buildPasswordResetMessage,
  buildSchedulePublishedMessage,
  getSmtpConfig,
  sendPasswordResetEmail,
  sendSchedulePublishedEmail,
  verifySmtpConnection,
  _private: { buildScheduleLines, escapeHtml, formatDateLabel, formatTime, renderCta, renderEmailDocument },
};
