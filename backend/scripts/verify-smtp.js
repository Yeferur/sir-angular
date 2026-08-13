const path = require('path');
const dotenv = require('dotenv');

// Replica el orden de carga del backend: el archivo estándar de producción
// tiene prioridad y el directorio histórico queda como respaldo local.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'env', '.env') });

const emailService = require('../services/email.service');
const { getFrontendBaseUrl } = require('../utils/frontend-url');

(async () => {
  const frontendUrl = getFrontendBaseUrl(process.env, {
    allowDevelopmentDefault: false,
    requireHttps: true,
  });
  const config = emailService.getSmtpConfig();
  if (!config) {
    console.error('SMTP_CONFIG_INCOMPLETE');
    console.error('Define SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM.');
    process.exitCode = 1;
    return;
  }

  await emailService.verifySmtpConnection();
  console.log('SMTP_CONNECTION_OK');
  console.log({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    frontendUrl,
  });
})().catch((error) => {
  console.error('SMTP_CONNECTION_ERROR');
  console.error(error?.message || error);
  process.exitCode = 1;
});
