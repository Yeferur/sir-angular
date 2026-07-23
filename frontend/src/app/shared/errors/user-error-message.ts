const TECHNICAL_ERROR_PATTERN = /(?:http failure response|unknown error|https?:\/\/|localhost|\/api\/|\b(?:xhr|networkerror|failed to fetch|econn\w*|socket|sequelize|sqlstate|stack trace)\b|^(?:typeerror|referenceerror|syntaxerror):)/i;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isTechnicalErrorMessage(value: unknown): boolean {
  const message = asText(value);
  return !!message && TECHNICAL_ERROR_PATTERN.test(message);
}

export function sanitizeUserErrorMessage(
  value: unknown,
  fallback = 'No pudimos completar la operación. Intenta nuevamente.'
): string {
  const message = asText(value);
  return message && !isTechnicalErrorMessage(message) ? message : fallback;
}

export function toUserErrorMessage(
  error: any,
  fallback = 'No pudimos completar la operación. Intenta nuevamente.'
): string {
  const status = Number(error?.status || 0);

  if (status === 0) {
    return 'No pudimos conectar con el servicio. Intenta nuevamente.';
  }
  if (status === 401) {
    return 'Tu sesión ya no está disponible. Inicia sesión nuevamente.';
  }
  if (status === 403) {
    return 'No tienes permiso para realizar esta acción.';
  }
  if (status >= 500) {
    return 'El servicio no está disponible en este momento. Intenta nuevamente.';
  }

  const candidate =
    error?.error?.message ||
    error?.error?.error ||
    error?.message;

  return sanitizeUserErrorMessage(candidate, fallback);
}
