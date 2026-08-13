const { sendSuccess } = require('../utils/responseEnvelope');

const GENERIC_MESSAGE = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function getPolicy(env = process.env) {
  return {
    maxRequests: boundedInteger(env.PASSWORD_RESET_IP_MAX_REQUESTS, 5, 1, 100),
    windowMs: boundedInteger(env.PASSWORD_RESET_IP_WINDOW_MS, 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
  };
}

function createPasswordResetRateLimit(options = {}) {
  const store = options.store || new Map();
  const now = options.now || (() => Date.now());
  const policy = options.policy || getPolicy(options.env || process.env);

  return function passwordResetRateLimit(req, res, next) {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const current = now();
    const cutoff = current - policy.windowMs;
    const recent = (store.get(key) || []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= policy.maxRequests) {
      store.set(key, recent);
      return sendSuccess(res, { message: GENERIC_MESSAGE });
    }

    recent.push(current);
    store.set(key, recent);

    // La aplicación tiene pocos usuarios, pero evitamos que direcciones antiguas
    // permanezcan indefinidamente si el endpoint recibe tráfico automatizado.
    if (store.size > 5000) {
      for (const [candidate, timestamps] of store) {
        const active = timestamps.filter((timestamp) => timestamp > cutoff);
        if (active.length) store.set(candidate, active);
        else store.delete(candidate);
      }
    }

    return next();
  };
}

const passwordResetRateLimit = createPasswordResetRateLimit();

module.exports = {
  GENERIC_MESSAGE,
  createPasswordResetRateLimit,
  getPolicy,
  passwordResetRateLimit,
};
