const {
  extractDateFromMessage,
  messageMentionsReserva,
  messageMentionsTour,
  normalizeText,
} = require('./ia-action-builder.service');
const { extractReservationCodeCandidate } = require('./ia-query-normalizer.service');

const SENSITIVE_PATTERN =
  /\b(password|contrasena|contrasenas|contraseña|contraseñas|clave|claves|token|tokens|jwt|secret|secreto|hash|credencial|credenciales|secretos)\b/;

const OPERATIONAL_PATTERN =
  /\b(reserva|reservas|transfer|transfers|tour|tours|aforo|aforos|cupo|cupos|punto|puntos|ruta|rutas|horario|horarios|pago|pagos|abono|abonos|comprobante|comprobantes|operacion)\b/;

const OPERATIONAL_VERB_PATTERN =
  /\b(cuanto|cuantos|cuanta|cuantas|muestrame|muestren|mostrar|dime|ver|consulta|consultar|buscar|busca|hay|tengo|tienen|programados|programadas|pendientes|disponibles|disponibilidad|sin)\b/;

const FOLLOW_UP_PATTERN =
  /\b(y|las|los|cuales|cuáles|pendientes|incompletas|incompletos|sin datos|falta informacion|les hace falta informacion)\b/;

const OUT_OF_DOMAIN_PATTERN =
  /\b(quien es|quién es|hazme|receta|matematica|matematicas|futbol|fútbol|messi|poema|traduce|traduccion|traducción|capital de|historia de|quien gano el partido|quién ganó el partido|partido)\b/;

const HELP_CAPABILITIES_PATTERN =
  /\b(que puedes hacer|qué puedes hacer|ayuda|ayudame|ayúdame|como funciona|cómo funciona|para que sirves|para qué sirves|que sabes hacer|qué sabes hacer|opciones|comandos)\b/;

const GREETING_PATTERN =
  /^(hola|holi|buenas|buenos dias|buenos días|buenas tardes|buenas noches|hey)\b/;

const WELLBEING_PATTERN =
  /\b(como estas|cómo estás|que tal|qué tal|como vas|cómo vas|todo bien|como te va|cómo te va)\b/;

const IDENTITY_PATTERN =
  /\b(quien eres|quién eres|como te llamas|cómo te llamas|eres sir ia|eres maxi)\b/;

const THANKS_PATTERN =
  /\b(gracias|muchas gracias|perfecto gracias|ok gracias|gracias maxi)\b/;

const GOODBYE_PATTERN =
  /\b(chao|hasta luego|nos vemos|hablamos luego)\b/;

const ACKNOWLEDGEMENT_PATTERN =
  /^(ok|listo|vale|entendido|perfecto|bien|dale)\b$/;

const AMBIGUOUS_SMALLTALK_PATTERN =
  /\b(y ahora|que sigue|qué sigue|dime|bueno|aja|ajá|que hago aqui|qué hago aquí)\b/;

const EXTERNAL_REDIRECT_PATTERN =
  /\b(quien gano el partido|quien ganó el partido|quien gana el partido|resultado del partido)\b/;

const TOOL_RULES = [
  {
    toolName: 'consultar_cupos',
    pattern: /\b(cupo|cupos|aforo|aforos|disponibilidad)\b/,
    confidence: 0.92,
    reason: 'capacity_query',
  },
  {
    toolName: 'consultar_transfers',
    pattern: /\btransfer|transfers\b/,
    confidence: 0.9,
    reason: 'transfers_query',
  },
  {
    toolName: 'consultar_pagos',
    pattern: /\b(pendiente(?:s)? de pago|pagos|abonos|comprobante|comprobantes)\b/,
    confidence: 0.88,
    reason: 'payments_query',
  },
  {
    toolName: 'consultar_puntos',
    pattern: /\bpunto|puntos\b/,
    confidence: 0.87,
    reason: 'points_query',
  },
  {
    toolName: 'consultar_tours',
    pattern: /\btour|tours\b/,
    confidence: 0.83,
    reason: 'tours_query',
  },
  {
    toolName: 'consultar_reservas',
    pattern: /\breserva|reservas\b/,
    confidence: 0.84,
    reason: 'reservations_query',
  },
];

function tokenize(message) {
  return normalizeText(message)
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeEntityReference(normalizedMessage) {
  return /\breserva\s+\d+\b|\btransfer\s+\d+\b|\b\d{2,}\b/.test(normalizedMessage);
}

function isShortEntityLikeQuery(message) {
  const normalized = normalizeText(message);
  const words = tokenize(message);

  if (!words.length) return false;
  if (extractDateFromMessage(message)) return false;
  if (OPERATIONAL_VERB_PATTERN.test(normalized)) return false;
  if (words.length <= 4) return true;
  if (/^que es\b|^qué es\b/.test(normalized) && words.length <= 5) return true;
  return false;
}

function extractNamedScope(message) {
  const normalized = normalizeText(message);
  const match = normalized.match(/\breservas?\s+de\s+(.+)$/);
  if (!match) return null;

  const scope = String(match[1] || '')
    .replace(/\b(hoy|manana|mañana|pasado manana|pasado mañana)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!scope) return null;

  return scope
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferToolIntent(normalized, contexto = {}) {
  const hasDate = Boolean(extractDateFromMessage(normalized) || contexto?.lastDate);
  const hasOperationalVerb = OPERATIONAL_VERB_PATTERN.test(normalized);
  const hasFollowUp = FOLLOW_UP_PATTERN.test(normalized) && contexto?.lastEntityType;

  for (const rule of TOOL_RULES) {
    if (!rule.pattern.test(normalized)) {
      continue;
    }

    if (rule.toolName === 'consultar_reservas' && !hasDate && !hasOperationalVerb && !hasFollowUp && !/\bpendiente(?:s)? de pago\b/.test(normalized)) {
      continue;
    }

    return rule;
  }

  return null;
}

function classifyIaIntent({ mensaje, contexto = {} }) {
  const normalized = normalizeText(mensaje);
  const tokens = tokenize(mensaje);
  const hasDate = Boolean(extractDateFromMessage(mensaje) || contexto?.lastDate);
  const mentionsReserva = messageMentionsReserva(mensaje);
  const mentionsTour = messageMentionsTour(mensaje);
  const hasOperationalKeyword = OPERATIONAL_PATTERN.test(normalized);
  const hasOperationalVerb = OPERATIONAL_VERB_PATTERN.test(normalized);
  const reservationCodeCandidate = extractReservationCodeCandidate(mensaje);
  const toolIntent = inferToolIntent(normalized, contexto);
  const hasEntityReference = looksLikeEntityReference(normalized);
  const hasOperationalQuerySignal = Boolean(
    reservationCodeCandidate ||
    toolIntent ||
    hasEntityReference ||
    (hasOperationalKeyword && tokens.length > 1) ||
    (hasOperationalKeyword && (hasOperationalVerb || hasDate || contexto?.lastEntityType || FOLLOW_UP_PATTERN.test(normalized)))
  );

  if (!normalized) {
    return {
      category: 'needs_clarification',
      reason: 'empty_message',
    };
  }

  if (SENSITIVE_PATTERN.test(normalized)) {
    return {
      category: 'sensitive_blocked',
      reason: 'sensitive_terms',
    };
  }

  if (GREETING_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'greeting',
      reason: 'greeting',
      confidence: 0.99,
    };
  }

  if (WELLBEING_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'wellbeing',
      reason: 'wellbeing',
      confidence: 0.99,
    };
  }

  if (IDENTITY_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'identity',
      reason: 'identity',
      confidence: 0.99,
    };
  }

  if (THANKS_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'thanks',
      reason: 'thanks',
      confidence: 0.99,
    };
  }

  if (GOODBYE_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'goodbye',
      reason: 'goodbye',
      confidence: 0.99,
    };
  }

  if (HELP_CAPABILITIES_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'help_capabilities',
      reason: 'capabilities_help',
      confidence: 0.99,
    };
  }

  if (ACKNOWLEDGEMENT_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'acknowledgement',
      reason: 'acknowledgement',
      confidence: 0.97,
    };
  }

  if (EXTERNAL_REDIRECT_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'ambiguous_smalltalk',
      reason: 'sir_only_redirect',
      confidence: 0.98,
    };
  }

  if (AMBIGUOUS_SMALLTALK_PATTERN.test(normalized) && !hasOperationalQuerySignal) {
    return {
      category: 'ambiguous_smalltalk',
      reason: 'ambiguous_smalltalk',
      confidence: 0.94,
    };
  }

  if (
    mentionsReserva &&
    mentionsTour &&
    !hasDate &&
    !(contexto && contexto.lastDate)
  ) {
    return {
      category: 'needs_clarification',
      reason: 'missing_date_for_reservas',
      tourName: extractNamedScope(mensaje),
    };
  }

  if (reservationCodeCandidate) {
    return {
      category: 'entity_lookup',
      reason: 'reservation_code_reference',
      confidence: 0.94,
      entityHint: {
        type: 'reserva_codigo',
        codigo: reservationCodeCandidate.canonical,
      },
    };
  }

  if (looksLikeEntityReference(normalized)) {
    return {
      category: 'entity_lookup',
      reason: 'entity_reference',
      confidence: 0.96,
    };
  }

  if (toolIntent) {
    return {
      category: 'tool_call',
      toolName: toolIntent.toolName,
      reason: toolIntent.reason,
      confidence: toolIntent.confidence,
    };
  }

  if (isShortEntityLikeQuery(mensaje)) {
    return {
      category: 'entity_lookup',
      reason: 'short_entity_query',
      confidence: 0.88,
    };
  }

  if (
    (hasOperationalKeyword && (hasDate || hasOperationalVerb || contexto?.lastEntityType || FOLLOW_UP_PATTERN.test(normalized))) ||
    (FOLLOW_UP_PATTERN.test(normalized) && contexto?.lastEntityType)
  ) {
    return {
      category: 'operational_sql',
      reason: 'operational_query',
      confidence: 0.75,
    };
  }

  if (OUT_OF_DOMAIN_PATTERN.test(normalized)) {
    return {
      category: 'ambiguous_smalltalk',
      reason: 'sir_only_redirect',
      confidence: 0.98,
    };
  }

  return {
    category: 'needs_clarification',
    reason: 'ambiguous_without_context',
    confidence: 0.35,
  };
}

module.exports = {
  classifyIaIntent,
};
