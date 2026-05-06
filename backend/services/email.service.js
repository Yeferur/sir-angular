const nodemailer = require('nodemailer');

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !from) {
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
    from
  };
}

function createTransporter() {
  const config = getSmtpConfig();
  if (!config) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl, expiresInMinutes = 30 }) {
  const transporter = createTransporter();
  const config = getSmtpConfig();

  if (!transporter || !config) {
    console.warn('[email.service] SMTP no configurado; se omitió el envío de correo.');
    return { skipped: true };
  }

  const safeName = name ? String(name).trim() : 'hola';
  const subject = 'Restablece tu contraseña - SIR';
  const text = [
    `Hola ${safeName},`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña en SIR.',
    `Este enlace expirará en ${expiresInMinutes} minutos:`,
    resetUrl,
    '',
    'Si no solicitaste este cambio, puedes ignorar este correo.'
  ].join('\n');

  const html = `
    <div style="margin:0;padding:0;background:#0b0b0f;color:#f3f4f6;font-family:Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#121218;border:1px solid #27272a;border-radius:16px;padding:28px;">
          <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hola ${safeName},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#cbd5e1;">
            Recibimos una solicitud para restablecer tu contraseña en SIR.
            Este enlace expira en ${expiresInMinutes} minutos.
          </p>
          <p style="margin:24px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#0a84ff;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;">Restablecer contraseña</a>
          </p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#94a3b8;">
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </p>
          <p style="margin:0 0 16px;word-break:break-all;font-size:13px;line-height:1.6;color:#93c5fd;">${resetUrl}</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
            Si no solicitaste este cambio, puedes ignorar este correo.
          </p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text,
    html
  });

  return { skipped: false };
}

module.exports = {
  sendPasswordResetEmail
};
