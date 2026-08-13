const DEFAULT_DEVELOPMENT_FRONTEND_URL = 'http://localhost:4200';

function invalidFrontendUrl(message) {
  const error = new Error(message);
  error.code = 'FRONTEND_URL_INVALID';
  return error;
}

function getFrontendBaseUrl(env = process.env, options = {}) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const allowDevelopmentDefault = options.allowDevelopmentDefault
    ?? !isProduction;
  const requireHttps = options.requireHttps ?? isProduction;
  const configured = String(env.FRONTEND_URL || '').trim();
  const rawValue = configured || (allowDevelopmentDefault ? DEFAULT_DEVELOPMENT_FRONTEND_URL : '');

  if (!rawValue) {
    throw invalidFrontendUrl('FRONTEND_URL es obligatoria para generar enlaces de correo.');
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch (_error) {
    throw invalidFrontendUrl('FRONTEND_URL debe ser una URL absoluta con http:// o https://.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw invalidFrontendUrl('FRONTEND_URL debe usar http:// o https:// y no incluir credenciales.');
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw invalidFrontendUrl('FRONTEND_URL debe usar https:// en producción.');
  }

  return parsed.origin;
}

function buildFrontendUrl(pathname, env = process.env, options = {}) {
  const baseUrl = getFrontendBaseUrl(env, options);
  const normalizedPath = String(pathname || '').startsWith('/')
    ? String(pathname)
    : `/${String(pathname || '')}`;
  return new URL(normalizedPath, `${baseUrl}/`).toString();
}

module.exports = {
  DEFAULT_DEVELOPMENT_FRONTEND_URL,
  getFrontendBaseUrl,
  buildFrontendUrl,
};
