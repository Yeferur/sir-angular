const { pool, SQL_MAX_ROWS, SQL_TIMEOUT_MS } = require('../../config/db-readonly');
const { decideIaAgentMode } = require('./ia-agent.service');
const { buildIaAction, buildContextPatch } = require('./ia-action-builder.service');
const { lookupOperationalEntity } = require('./ia-entity-lookup.service');
const { buildConversationalResponse, buildToolResponseText, sanitizePlannerNaturalReply } = require('./ia-response-template.service');
const { executeTool } = require('./ia-tool-executor.service');
const { logInteraction } = require('./ia-learning.service');
const { generarSqlCandidato, repararSqlCandidato, normalizeSessionContext } = require('./ia-sql-agent.service');
const { buildSafeIaErrorResponse, isSensitiveIntent, isOutOfDomainIntent, sanitizeUserFacingText } = require('./ia-safe-response.service');
const { buildValidationError, validateSqlCandidate } = require('./ia-sql-validator.service');
const { getIaToolByName } = require('./ia-tool-registry.service');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b';
const IA_DEBUG_SQL = String(process.env.IA_DEBUG_SQL || '').trim().toLowerCase() === 'true';
const DEBUG_IA = String(process.env.DEBUG_IA || '').trim().toLowerCase() === 'true';

function logIa(...args) {
  if (DEBUG_IA) {
    console.info(...args);
  }
}

function warnIa(...args) {
  if (DEBUG_IA) {
    console.warn(...args);
  }
}

function truncateText(value, maxLength = 200) {
  return String(value || '').slice(0, maxLength);
}

function isBlankValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === 'n/a' || normalized === 'na';
  }
  return false;
}

function buildIncompleteInfoSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totals = {
    punto: 0,
    documento: 0,
    telefono: 0,
    precio: 0,
    canal: 0,
  };

  for (const row of safeRows) {
    if (row?.Id_Punto === null || row?.Id_Punto === undefined || row?.Id_Punto === '') totals.punto += 1;
    if (isBlankValue(row?.DNI)) totals.documento += 1;
    if (isBlankValue(row?.Telefono_Pasajero)) totals.telefono += 1;
    if (row?.Precio_Pasajero === null || row?.Precio_Pasajero === undefined || Number(row?.Precio_Pasajero) === 0) {
      totals.precio += 1;
    }
    if (row?.Id_Canal === null || row?.Id_Canal === undefined || row?.Id_Canal === '') totals.canal += 1;
  }

  const labels = [
    ['punto', 'punto de encuentro'],
    ['documento', 'documento'],
    ['telefono', 'telefono'],
    ['precio', 'precio'],
    ['canal', 'canal'],
  ].filter(([key]) => totals[key] > 0);

  if (!safeRows.length) {
    return 'No encontré registros con información pendiente.';
  }

  if (!labels.length) {
    return `Encontré ${safeRows.length} registros con información pendiente.`;
  }

  return `Encontré ${safeRows.length} registros con información pendiente. Principalmente faltan ${labels.map(([, label]) => label).join(', ')}.`;
}

function buildReservaDateClarification(tourName) {
  if (tourName) {
    return `¿Para qué fecha quieres consultar las reservas de ${tourName}?`;
  }

  return '¿Para qué fecha quieres consultar esas reservas?';
}

function sanitizeRowsForPrompt(rows) {
  return rows.map((row) => {
    const clean = {};
    for (const [key, value] of Object.entries(row || {})) {
      clean[key] = value instanceof Date ? value.toISOString() : value;
    }
    return clean;
  });
}

function ensurePermissions(userPermissions, requiredPermissions) {
  const missing = requiredPermissions.filter((permission) => !userPermissions.includes(permission));
  if (!missing.length) {
    return;
  }

  const error = buildValidationError(`Faltan permisos: ${missing.join(', ')}`);
  error.status = 403;
  error.code = 'IA_SQL_PERMISSION_DENIED';
  error.userMessage = 'No tienes permisos para consultar uno o mas modulos involucrados en esa pregunta.';
  error.details = { missingPermissions: missing };
  throw error;
}

async function resumirFilas({ mensaje, intent, rows, tables }) {
  const rowsPreview = sanitizeRowsForPrompt(rows).slice(0, 20);

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      options: {
        temperature: 0.2,
        num_predict: 240,
      },
      messages: [
        {
          role: 'system',
          content: [
            'Eres SIR-IA.',
            'Resume resultados operativos de SQL en espanol para un usuario interno.',
            'No muestres ni menciones SQL, AST, validaciones ni detalles tecnicos internos.',
            'Si no hay filas, dilo con claridad y de forma util.',
            'Se breve, concreto y fiel a los datos.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            pregunta: mensaje,
            intencion: intent,
            tablas: tables,
            totalFilas: rows.length,
            filas: rowsPreview,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`El modelo de resumen respondio con status ${response.status}.`);
  }

  const data = await response.json();
  return String(data?.message?.content || '').trim();
}

async function resumirFilasConContexto({ mensaje, intent, rows, tables, contextPatch }) {
  if (contextPatch?.lastEntityType === 'reserva' && contextPatch?.lastFilters?.filtro === 'informacion_incompleta') {
    return {
      texto: buildIncompleteInfoSummary(rows),
      contextPatch,
    };
  }

  const texto = await resumirFilas({ mensaje, intent, rows, tables });
  return {
    texto,
    contextPatch,
  };
}

async function ejecutarConsultaSegura(sql) {
  const [rows] = await pool.query({
    sql,
    timeout: SQL_TIMEOUT_MS,
  });

  const maxRows = Math.min(100, Math.max(1, SQL_MAX_ROWS));
  if (Array.isArray(rows) && rows.length > maxRows) {
    return rows.slice(0, maxRows);
  }

  return Array.isArray(rows) ? rows : [];
}

async function validarConRetry({ candidate, mensaje, contexto, permisos }) {
  try {
    return {
      candidate,
      validated: validateSqlCandidate(candidate.sql),
      repaired: false,
    };
  } catch (error) {
    warnIa('[IA SQL] error de validación:', error.message);
    logIa('[IA SQL] retry reparación: iniciado');

    const repairedCandidate = await repararSqlCandidato({
      mensaje,
      contexto,
      permisos,
      candidate,
      validationError: error,
    });

    if (repairedCandidate.sql === null) {
      warnIa('[IA SQL] retry reparación: devolvió sql null');
      throw error;
    }

    const validated = validateSqlCandidate(repairedCandidate.sql);
    logIa('[IA SQL] retry reparación: exitoso');
    return {
      candidate: repairedCandidate,
      validated,
      repaired: true,
    };
  }
}

function buildBlockedResponse(reason) {
  if (reason === 'write_tools_not_enabled_in_phase_1') {
    return {
      texto: 'En esta fase solo puedo consultar información. Para cambios operativos futuros usaré tools controladas del backend con validaciones y confirmación.',
      accion: null,
    };
  }

  if (reason === 'general_knowledge') {
    return buildSafeIaErrorResponse(
      { code: 'IA_OUT_OF_DOMAIN' },
      { intent: 'out_of_domain' }
    ).response;
  }

  return buildSafeIaErrorResponse(
    { code: 'IA_SENSITIVE_REQUEST' },
    { intent: 'blocked_sensitive_request' }
  ).response;
}

function buildPlannerWriteGuardResponse() {
  return {
    texto: 'Por ahora solo puedo ayudarte a consultar y preparar el siguiente paso. Si quieres, te ayudo a revisar la información y luego dejamos listo un borrador para una acción operativa futura.',
    accion: null,
  };
}

function normalizeActionPayload(accion) {
  if (!accion || !accion.accion) {
    return null;
  }

  return accion;
}

function buildToolResponse({ mensaje, contexto, toolName, toolResult }) {
  const rowsForAction = toolName === 'diagnosticar_operacion'
    ? [{ __diagnostic: toolResult }]
    : toolResult.rows;

  const accion = normalizeActionPayload(buildIaAction({
    mensaje,
    intent: `tool:${toolName}`,
    entityType: toolResult.entityType,
    expectedAction: toolResult.expectedAction,
    rows: rowsForAction,
    tables: toolResult.tables,
    contexto,
  }));

  const contextPatch = buildContextPatch({
    mensaje,
    intent: `tool:${toolName}`,
    entityType: toolResult.entityType,
    expectedAction: toolResult.expectedAction,
    rows: rowsForAction,
    tables: toolResult.tables,
    accion,
    contextoAnterior: contexto,
  });

  return {
    texto: sanitizeUserFacingText(
      buildToolResponseText({
        toolName,
        toolResult,
      }),
      'No pude realizar esa consulta.'
    ),
    accion,
    contextPatch,
  };
}

async function processSqlMode({ mensaje, historial, contexto, permisos }) {
  const candidate = await generarSqlCandidato({
    mensaje,
    historial,
    permisos,
    contexto,
  });

  logIa('[IA SQL] intención:', truncateText(candidate.intent, 160));
  logIa('[IA SQL] entityType:', truncateText(candidate.entityType || 'unknown', 80));

  if (candidate.sql === null) {
    return {
      payload: buildSafeIaErrorResponse(
        { code: candidate.intent === 'needs_clarification' ? 'IA_NEEDS_CLARIFICATION' : undefined },
        { intent: candidate.intent }
      ).response,
      sqlGenerado: null,
      entityType: candidate.entityType || 'unknown',
      intent: candidate.intent,
      success: false,
    };
  }

  const validationResult = await validarConRetry({
    candidate,
    mensaje,
    contexto,
    permisos,
  });
  const finalCandidate = validationResult.candidate;
  const validated = validationResult.validated;

  if (IA_DEBUG_SQL) {
    logIa('[IA SQL] sql:', validated.sql);
  }

  ensurePermissions(permisos, validated.requiredPermissions);

  const rows = await ejecutarConsultaSegura(validated.sql);
  logIa('[IA SQL] tablas consultadas:', validated.sqlTables.join(', '));
  logIa('[IA SQL] filas:', rows.length);

  const accion = normalizeActionPayload(buildIaAction({
    mensaje,
    intent: finalCandidate.intent,
    entityType: finalCandidate.entityType,
    expectedAction: finalCandidate.expectedAction,
    rows,
    tables: validated.tables,
    contexto,
  }));

  const contextPatch = buildContextPatch({
    mensaje,
    intent: finalCandidate.intent,
    entityType: finalCandidate.entityType,
    expectedAction: finalCandidate.expectedAction,
    rows,
    tables: validated.tables,
    accion,
    contextoAnterior: contexto,
  });

  const resumen = await resumirFilasConContexto({
    mensaje,
    intent: finalCandidate.intent,
    rows,
    tables: validated.tables,
    contextPatch,
  });

  return {
    payload: {
      texto: sanitizeUserFacingText(resumen.texto, 'No pude realizar esa consulta.'),
      accion,
      contextPatch: resumen.contextPatch,
    },
    sqlGenerado: validated.sql,
    entityType: finalCandidate.entityType || 'unknown',
    intent: finalCandidate.intent,
    success: true,
  };
}

function buildFinalResponse({ baseResponse, interactionId, mode, confidence, toolUsed, elapsedMs }) {
  return {
    texto: baseResponse.texto,
    accion: baseResponse.accion || null,
    ...(baseResponse.contextPatch ? { contextPatch: baseResponse.contextPatch } : {}),
    chart: null,
    meta: {
      ...(interactionId ? { interactionId } : {}),
      mode,
      confidence,
      ...(toolUsed ? { toolUsed } : {}),
      elapsedMs,
    },
  };
}

async function procesarChatIa({ mensaje, historial, contexto, user, permisos }) {
  const startedAt = Date.now();
  const safeContext = normalizeSessionContext(contexto);
  const agentDecision = await decideIaAgentMode({
    message: mensaje,
    context: safeContext,
    history: historial,
    user: {
      ...user,
      permissions: permisos,
    },
  });

  logIa('[IA AGENT] modo:', truncateText(agentDecision.mode, 40), 'confianza:', agentDecision.confidence);

  let responsePayload = null;
  let sqlGenerado = null;
  let toolUsada = null;
  let intencion = agentDecision.intent || agentDecision.reason;
  let entidadTipo = null;
  let entidadId = null;
  let exito = false;
  let planJson = null;

  if (agentDecision.usedPlanner) {
    planJson = JSON.stringify({
      mode: agentDecision.mode,
      intent: agentDecision.intent,
      entities: agentDecision.entities || {},
      toolName: agentDecision.toolName || null,
      toolInput: agentDecision.toolInput || {},
      sqlGoal: agentDecision.sqlGoal || null,
      naturalReply: agentDecision.naturalReply || null,
      needsConfirmation: Boolean(agentDecision.needsConfirmation),
      confidence: agentDecision.confidence,
      reason: agentDecision.reason || null,
    });
  }

  if (agentDecision.mode === 'blocked') {
    responsePayload = buildBlockedResponse(agentDecision.reason);
  } else if (agentDecision.mode === 'out_of_domain') {
    responsePayload = buildSafeIaErrorResponse(
      { code: 'IA_OUT_OF_DOMAIN' },
      { intent: 'out_of_domain' }
    ).response;
  } else if (agentDecision.mode === 'conversation') {
    responsePayload = {
      texto: sanitizeUserFacingText(
        sanitizePlannerNaturalReply(
          agentDecision.naturalReply,
          buildConversationalResponse('ambiguous_smalltalk', {
            ...safeContext,
            reason: agentDecision.reason,
          })
        ),
        'Estoy enfocada en ayudarte con la operación de SIR.'
      ),
      accion: null,
    };
    exito = true;
  } else if (agentDecision.mode === 'clarification') {
    if (agentDecision.reason === 'missing_date_for_reservas') {
      responsePayload = {
        texto: buildReservaDateClarification(agentDecision.tourName || safeContext?.lastTourName),
        accion: null,
      };
    } else {
      responsePayload = buildSafeIaErrorResponse(
        { code: 'IA_NEEDS_CLARIFICATION' },
        { intent: 'needs_clarification' }
      ).response;
    }
  } else if (agentDecision.mode === 'entity_lookup') {
    const lookupResult = await lookupOperationalEntity({ mensaje });
    responsePayload = lookupResult || {
      texto: 'No encontré coincidencias operativas para esa búsqueda. Puedes preguntarme por reservas, tours, transfers, puntos, cupos o pagos.',
      accion: null,
    };
    entidadTipo = responsePayload?.contextPatch?.lastEntityType || null;
    entidadId = responsePayload?.contextPatch?.lastResults?.[0]?.id || null;
    exito = Boolean(lookupResult);
  } else if (agentDecision.mode === 'tool_call') {
    if (agentDecision.needsConfirmation) {
      responsePayload = buildPlannerWriteGuardResponse();
    } else if (!getIaToolByName(agentDecision.toolName)) {
      responsePayload = {
        texto: 'Necesito ajustar esa consulta. Puedo revisar reservas, tours, transfers, puntos, cupos o pagos dentro de SIR.',
        accion: null,
      };
    } else {
    toolUsada = agentDecision.toolName || null;
      const toolExecution = await executeTool({
        toolName: agentDecision.toolName,
        input: agentDecision.toolInput,
        user: {
          ...user,
          permissions: permisos,
        },
        context: safeContext,
      });

      if (!toolExecution.success) {
        if (toolExecution.errorCode === 'IA_PERMISSION_DENIED') {
          responsePayload = buildSafeIaErrorResponse({ code: toolExecution.errorCode }, {}).response;
        } else if (toolExecution.errorCode === 'IA_TOOL_VALIDATION_FAILED') {
          responsePayload = {
            texto: toolExecution.message || 'Necesito un poco más de contexto para esa consulta.',
            accion: null,
          };
        } else {
          responsePayload = {
            texto: toolExecution.message || 'No pude ejecutar esa consulta en este momento.',
            accion: null,
          };
        }
      } else {
        entidadTipo = toolExecution.data.entityType || null;
        entidadId = toolExecution.data.rows?.[0]?.Id_Reserva
          || toolExecution.data.rows?.[0]?.Id_Transfer
          || toolExecution.data.rows?.[0]?.Id_Tour
          || toolExecution.data.rows?.[0]?.Id_Punto
          || null;
        responsePayload = buildToolResponse({
          mensaje,
          contexto: safeContext,
          toolName: agentDecision.toolName,
          toolResult: toolExecution.data,
        });
        exito = true;
      }
    }
  } else {
    const sqlResult = await processSqlMode({
      mensaje,
      historial,
      contexto: safeContext,
      permisos,
    });

    responsePayload = sqlResult.payload;
    sqlGenerado = sqlResult.sqlGenerado;
    entidadTipo = sqlResult.entityType;
    intencion = sqlResult.intent || intencion;
    exito = sqlResult.success;
  }

  const elapsedMs = Date.now() - startedAt;
  const interactionId = await logInteraction({
    userId: user?.id || null,
    pregunta: mensaje,
    intencion,
    mode: agentDecision.mode,
    entidadTipo,
    entidadId,
    sqlGenerado,
    planJson,
    toolUsada,
    confidence: agentDecision.confidence,
    respuesta: responsePayload?.texto,
    tiempoMs: elapsedMs,
    exito,
    plannerUsed: Boolean(agentDecision.usedPlanner),
    fastPathUsed: Boolean(agentDecision.usedFastPath),
  });

  return buildFinalResponse({
    baseResponse: responsePayload,
    interactionId,
    mode: agentDecision.mode,
    confidence: agentDecision.confidence,
    toolUsed: toolUsada,
    elapsedMs,
  });
}

module.exports = {
  procesarChatIa,
};
