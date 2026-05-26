const SAFE_MESSAGES = {
  sensitive: 'No puedo consultar ni mostrar información sensible del sistema.',
  noPermission: 'No puedo mostrar esa información.',
  blockedQuery: 'No pude realizar esa consulta.',
  unexpected: 'No pude procesar la consulta en este momento.',
  outOfDomain:
    'Puedo ayudarte con información de SIR: reservas, tours, transfers, puntos de encuentro, aforos, pagos y operación.',
  clarification:
    'Puedo ayudarte con información operativa de SIR. Intenta con una consulta más específica.',
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isSensitiveIntent(intent) {
  return normalizeText(intent) === 'blocked_sensitive_request';
}

function isOutOfDomainIntent(intent) {
  return normalizeText(intent) === 'out_of_domain';
}

function containsTechnicalLeak(text) {
  const normalized = normalizeText(text);
  return [
    /\bia_sql_validation_error\b/,
    /\ber_tableaccess_denied_error\b/,
    /\berror sql\b/,
    /\bselect\b/,
    /\bfrom\b/,
    /\bwhere\b/,
    /\bjoin\b/,
    /\bmysql\b/,
    /\btabla\b/,
    /\bcolumna\b/,
    /\bpermiso\b/,
    /\breservas\.leer\b/,
    /\bhistorial\.leer\b/,
    /\bread-only\b/,
    /\bstack\b/,
  ].some((pattern) => pattern.test(normalized));
}

function sanitizeUserFacingText(text, fallback = SAFE_MESSAGES.blockedQuery) {
  const clean = String(text || '').trim();
  if (!clean) {
    return fallback;
  }

  if (containsTechnicalLeak(clean)) {
    return fallback;
  }

  return clean;
}

function buildSafeIaErrorResponse(error, context = {}) {
  const code = String(error?.code || '');
  const intent = String(context?.intent || '');

  if (isSensitiveIntent(intent) || code === 'IA_SENSITIVE_REQUEST') {
    return {
      status: 200,
      expected: true,
      response: {
        texto: SAFE_MESSAGES.sensitive,
        accion: null,
      },
    };
  }

  if (isOutOfDomainIntent(intent) || code === 'IA_OUT_OF_DOMAIN') {
    return {
      status: 200,
      expected: true,
      response: {
        texto: SAFE_MESSAGES.outOfDomain,
        accion: null,
      },
    };
  }

  if (normalizeText(intent) === 'needs_clarification' || code === 'IA_NEEDS_CLARIFICATION') {
    return {
      status: 200,
      expected: true,
      response: {
        texto: SAFE_MESSAGES.clarification,
        accion: null,
      },
    };
  }

  if (code === 'IA_SQL_PERMISSION_DENIED' || code === 'IA_PERMISSION_DENIED') {
    return {
      status: 200,
      expected: true,
      response: {
        texto: SAFE_MESSAGES.noPermission,
        accion: null,
      },
    };
  }

  if (
    code === 'IA_SQL_VALIDATION_ERROR' ||
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    code === 'ER_PARSE_ERROR' ||
    code === 'ER_NO_SUCH_TABLE'
  ) {
    return {
      status: 200,
      expected: true,
      response: {
        texto: SAFE_MESSAGES.blockedQuery,
        accion: null,
      },
    };
  }

  return {
    status: error?.status || 500,
    expected: false,
    response: {
      texto: SAFE_MESSAGES.unexpected,
      accion: null,
    },
  };
}

module.exports = {
  SAFE_MESSAGES,
  buildSafeIaErrorResponse,
  isSensitiveIntent,
  isOutOfDomainIntent,
  sanitizeUserFacingText,
};
