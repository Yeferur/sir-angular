const { extractDateFromMessage, normalizeText } = require('./ia-action-builder.service');
const { classifyIaIntent } = require('./ia-intent-classifier.service');
const { planWithIa } = require('./ia-planner.service');
const { extractReservationCodeCandidate } = require('./ia-query-normalizer.service');
const { getIaToolByName, listIaTools } = require('./ia-tool-registry.service');

const WRITE_INTENT_PATTERN =
  /\b(crea|crear|creame|créame|actualiza|actualizar|edita|editar|modifica|modificar|elimina|eliminar|borra|borrar|cancela|cancelar|confirma|confirmar|asigna|asignar|registra|registrar|genera una reserva|haz una reserva)\b/;

const STOPWORDS = new Set([
  'cuantas', 'cuantos', 'cuanta', 'cuanto', 'hay', 'de', 'del', 'la', 'las', 'el', 'los',
  'para', 'por', 'con', 'sin', 'pendientes', 'pendiente', 'pago', 'pagos', 'hoy', 'manana',
  'mañana', 'transfers', 'transfer', 'reservas', 'reserva', 'puntos', 'punto', 'tours', 'tour',
  'cupos', 'cupo', 'aforos', 'aforo', 'consultar', 'consulta',
]);

function pickConfidence(value, fallback = 0.7) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function cleanupEntityTerm(rawMessage) {
  const withoutDates = normalizeText(rawMessage)
    .replace(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2})\b/g, ' ')
    .replace(/\b(hoy|manana|mañana|pasado manana|pasado mañana)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ');

  const parts = withoutDates
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word));

  return parts.join(' ').trim() || null;
}

function buildToolInput(toolName, message, context = {}) {
  const normalized = normalizeText(message);
  const date = extractDateFromMessage(message) || context?.lastDate || null;
  const entityTerm = cleanupEntityTerm(message) || context?.lastTourName || null;

  switch (toolName) {
    case 'consultar_reservas':
      return {
        ...(date ? { date } : {}),
        ...(/pendiente(?:s)? de pago/.test(normalized) ? { paymentStatus: 'pending' } : {}),
        ...(/\b(cuantas|cuantos|cuanta|cuanto|hay|total)\b/.test(normalized) ? { countOnly: true } : {}),
        ...(entityTerm && /\bde\b/.test(normalized) ? { tourLike: entityTerm } : {}),
      };
    case 'consultar_cupos':
      return {
        ...(date ? { date } : {}),
        ...(entityTerm ? { tourLike: entityTerm } : {}),
      };
    case 'consultar_transfers':
      return {
        ...(date ? { date } : {}),
        ...(/\b(cuantos|cuantas|cuanto|cuanta|hay|total)\b/.test(normalized) ? { countOnly: true } : {}),
      };
    case 'consultar_pagos':
      return {
        entityType: 'reservas',
        paymentStatus: 'pending',
        ...(date ? { date } : {}),
        ...(entityTerm && /\bde\b/.test(normalized) ? { tourLike: entityTerm } : {}),
        ...(/\b(cuantas|cuantos|cuanta|cuanto|hay|total)\b/.test(normalized) ? { countOnly: true } : {}),
      };
    case 'consultar_puntos':
      return {
        query: entityTerm || normalizeText(message),
      };
    case 'consultar_tours':
      return entityTerm ? { query: entityTerm } : {};
    case 'consultar_reserva_por_codigo': {
      const candidate = extractReservationCodeCandidate(message);
      return candidate ? { codigoReserva: candidate.original } : {};
    }
    case 'consultar_transfer_por_codigo': {
      const match = String(message || '').match(/(\d{1,10})/);
      return match ? { codigoTransfer: match[1] } : {};
    }
    case 'simular_listado_buses': {
      const directTourName = /\bguatape|guatapé\b/.test(normalized)
        ? 'Guatapé'
        : /\brio claro|rioclaro\b/.test(normalized)
          ? 'Río Claro'
          : context?.lastTourName || null;
      return {
        fecha: date,
        ...(directTourName ? { tourName: directTourName } : {}),
      };
    }
    case 'consultar_transfers_fecha':
      return {
        ...(date ? { fecha: date } : {}),
      };
    case 'buscar_entidad':
      return {
        query: cleanupEntityTerm(message) || String(message || '').trim(),
      };
    case 'diagnosticar_operacion': {
      const directTourName = /\bguatape|guatapé\b/.test(normalized)
        ? 'Guatapé'
        : /\brio claro|rioclaro\b/.test(normalized)
          ? 'Río Claro'
          : context?.lastTourName || null;
      const scope = directTourName && date
        ? 'tour_fecha'
        : /\bmanana|mañana\b/.test(normalized)
          ? 'mañana'
          : /\bhoy\b/.test(normalized)
            ? 'hoy'
            : date
              ? 'fecha'
              : 'general';
      const isTourDiagnostic = scope === 'tour_fecha';

      return {
        fecha: scope === 'fecha' || scope === 'tour_fecha' ? date : null,
        tourName: isTourDiagnostic ? directTourName : null,
        scope,
        incluir: {
          reservas: true,
          cupos: true,
          pagos: true,
          transfers: !isTourDiagnostic,
          puntos: true,
          listados: true,
        },
      };
    }
    default:
      return {};
  }
}

function getCurrentDateYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function getFastPathDirectEntity(message, context = {}) {
  const normalized = normalizeText(message);
  const reservationCodeCandidate = extractReservationCodeCandidate(message);

  if (/\b(operacion|operación|raro|pendientes?|recomiendas revisar|como vamos|cómo vamos)\b/.test(normalized)
    && /\b(hoy|manana|mañana|guatape|guatapé|rio claro|rioclaro)\b/.test(normalized)) {
    return {
      mode: 'tool_call',
      intent: 'diagnostico_operacion',
      toolName: 'diagnosticar_operacion',
      toolInput: buildToolInput('diagnosticar_operacion', message, context),
      reason: 'fast_path_operational_diagnostic',
      confidence: 0.9,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {},
    };
  }

  if (/\b(simula|simular|propuesta de buses|plan logistico|plan logístico|listado de buses)\b/.test(normalized)
    && /\b(hoy|manana|mañana|guatape|guatapé|rio claro|rioclaro)\b/.test(normalized)) {
    return {
      mode: 'tool_call',
      intent: 'simular_listado_buses',
      toolName: 'simular_listado_buses',
      toolInput: buildToolInput('simular_listado_buses', message, context),
      reason: 'fast_path_simular_listado',
      confidence: 0.91,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {},
    };
  }

  if (reservationCodeCandidate) {
    return {
      mode: 'tool_call',
      intent: 'consultar_reserva_por_codigo',
      toolName: 'consultar_reserva_por_codigo',
      toolInput: {
        codigoReserva: reservationCodeCandidate.original,
      },
      reason: 'fast_path_reservation_code_tool',
      confidence: 0.98,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {
        reservationCode: reservationCodeCandidate.original,
      },
    };
  }

  if (/^reserva\s+\d{1,10}$/i.test(String(message || '').trim())) {
    return {
      mode: 'entity_lookup',
      intent: 'lookup_reserva_id',
      reason: 'fast_path_reserva_id',
      confidence: 0.97,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {},
    };
  }

  if (/^transfer\s+\d{1,10}$/i.test(String(message || '').trim())) {
    const match = String(message || '').match(/(\d{1,10})/);
    return {
      mode: 'tool_call',
      intent: 'consultar_transfer_por_codigo',
      toolName: 'consultar_transfer_por_codigo',
      toolInput: {
        codigoTransfer: match?.[1] || '',
      },
      reason: 'fast_path_transfer_tool',
      confidence: 0.97,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {},
    };
  }

  const directTerms = new Set([
    'guatape',
    'guatapé',
    'rio claro',
    'rioclaro',
    'puntos del poblado',
    'poblado',
  ]);

  if (directTerms.has(normalized)) {
    return {
      mode: 'entity_lookup',
      intent: 'lookup_operational_entity',
      reason: 'fast_path_direct_entity',
      confidence: 0.93,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      entities: {
        tourName: normalized.includes('guata') ? 'Guatapé' : null,
        pointName: normalized.includes('poblado') ? 'Poblado' : normalized.includes('rio') ? 'Río Claro' : null,
      },
    };
  }

  const classification = classifyIaIntent({
    mensaje: message,
    contexto: context,
  });

  if (classification.category === 'sensitive_blocked' || classification.category === 'out_of_domain') {
    return {
      mode: classification.category === 'out_of_domain' ? 'out_of_domain' : 'blocked',
      intent: classification.category,
      reason: classification.reason || classification.category,
      confidence: pickConfidence(classification.confidence, 0.98),
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
    };
  }

  if (classification.category === 'entity_lookup') {
    return {
      mode: 'entity_lookup',
      intent: 'entity_lookup',
      reason: classification.reason || 'entity_lookup',
      confidence: pickConfidence(classification.confidence, 0.9),
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
      ...(classification.entityHint ? { entityHint: classification.entityHint } : {}),
      entities: {},
    };
  }

  if (classification.category === 'tool_call') {
    const tool = getIaToolByName(classification.toolName);
    if (tool) {
      return {
        mode: 'tool_call',
        intent: classification.toolName,
        toolName: tool.name,
        toolInput: buildToolInput(tool.name, message, context),
        reason: classification.reason || 'tool_match',
        confidence: pickConfidence(classification.confidence, 0.88),
        source: 'fast_path',
        usedPlanner: false,
        usedFastPath: true,
        entities: {},
      };
    }
  }

  return null;
}

function normalizePlannerDecision(plan, context = {}) {
  const tool = plan?.toolName ? getIaToolByName(plan.toolName) : null;
  const normalized = {
    mode: plan?.mode || 'clarification',
    intent: plan?.intent || plan?.reason || 'planner',
    reason: plan?.reason || plan?.intent || 'planner',
    confidence: pickConfidence(plan?.confidence, 0.35),
    naturalReply: plan?.naturalReply || null,
    entities: plan?.entities || {},
    sqlGoal: plan?.sqlGoal || null,
    needsConfirmation: Boolean(plan?.needsConfirmation),
    source: 'planner',
    usedPlanner: true,
    usedFastPath: false,
  };

  if (normalized.mode === 'tool_call') {
    if (!tool) {
      return {
        ...normalized,
        mode: 'clarification',
        reason: 'planner_tool_not_registered',
      };
    }

    return {
      ...normalized,
      toolName: tool.name,
      toolInput: Object.keys(plan?.toolInput || {}).length
        ? plan.toolInput
        : buildToolInput(tool.name, context?.lastUserMessage || '', context),
    };
  }

  return normalized;
}

async function decideIaAgentMode({ message, context, history, user }) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return {
      mode: 'clarification',
      intent: 'clarification',
      reason: 'empty_message',
      confidence: 0.2,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
    };
  }

  if (WRITE_INTENT_PATTERN.test(normalized)) {
    return {
      mode: 'blocked',
      intent: 'write_request',
      reason: 'write_tools_not_enabled_in_phase_1',
      confidence: 0.99,
      source: 'fast_path',
      usedPlanner: false,
      usedFastPath: true,
    };
  }

  const fastPathDecision = getFastPathDirectEntity(message, context);
  if (fastPathDecision) {
    return fastPathDecision;
  }

  try {
    const plannerPlan = await planWithIa({
      message,
      context: {
        ...(context || {}),
        lastUserMessage: message,
      },
      history,
      availableTools: listIaTools(),
      currentDate: getCurrentDateYmd(),
      user,
    });

    return normalizePlannerDecision(plannerPlan, {
      ...(context || {}),
      lastUserMessage: message,
    });
  } catch (error) {
    const fallbackClassification = classifyIaIntent({
      mensaje: message,
      contexto: context,
    });

    if (fallbackClassification.category === 'operational_sql') {
      return {
        mode: 'sql_query',
        intent: fallbackClassification.reason || 'operational_query',
        reason: 'planner_unavailable_sql_fallback',
        confidence: pickConfidence(fallbackClassification.confidence, 0.68),
        source: 'fallback',
        usedPlanner: false,
        usedFastPath: false,
      };
    }

    return {
      mode: 'clarification',
      intent: 'needs_clarification',
      reason: 'planner_unavailable',
      confidence: 0.3,
      source: 'fallback',
      usedPlanner: false,
      usedFastPath: false,
      error: error?.message || 'planner_unavailable',
    };
  }
}

module.exports = {
  decideIaAgentMode,
};
