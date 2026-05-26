const { buildSchemaContextPrompt } = require('./ia-schema-context');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b';

function trimHistory(historial = []) {
  if (!Array.isArray(historial)) {
    return [];
  }

  return historial
    .slice(-6)
    .filter((item) => item && ['user', 'assistant'].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, 800),
    }));
}

function extractJsonObject(text) {
  const content = String(text || '').trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('El modelo no devolvio un JSON valido.');
  }

  return JSON.parse(content.slice(start, end + 1));
}

function normalizeSessionContext(contexto = {}) {
  if (!contexto || typeof contexto !== 'object' || Array.isArray(contexto)) {
    return {};
  }

  const safeResults = Array.isArray(contexto.lastResults)
    ? contexto.lastResults
        .slice(0, 10)
        .map((item) => ({
          id: item?.id ?? null,
          type: String(item?.type || '').slice(0, 40),
          title: String(item?.title || '').slice(0, 160) || undefined,
        }))
        .filter((item) => item.id !== null && item.type)
    : [];

  const safeFilters = contexto.lastFilters && typeof contexto.lastFilters === 'object' && !Array.isArray(contexto.lastFilters)
    ? contexto.lastFilters
    : {};

  return {
    lastIntent: contexto.lastIntent ? String(contexto.lastIntent).slice(0, 300) : undefined,
    lastEntityType: contexto.lastEntityType ? String(contexto.lastEntityType).slice(0, 40) : undefined,
    lastDate: contexto.lastDate ? String(contexto.lastDate).slice(0, 20) : undefined,
    lastTourId: Number.isFinite(Number(contexto.lastTourId)) ? Number(contexto.lastTourId) : null,
    lastTourName: contexto.lastTourName ? String(contexto.lastTourName).slice(0, 160) : null,
    lastResults: safeResults,
    lastFilters: safeFilters,
  };
}

function buildSessionContextPrompt(contexto = {}) {
  const safeContext = normalizeSessionContext(contexto);
  const hasContext = Object.values(safeContext).some((value) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return String(value).trim().length > 0;
  });

  if (!hasContext) {
    return 'Contexto de sesion actual: vacio.';
  }

  return [
    'Contexto de sesion actual:',
    JSON.stringify(safeContext),
    'Uso del contexto:',
    '- Si la pregunta actual es ambigua, por ejemplo "y las pendientes", reutiliza lastEntityType, lastDate, lastTourId, lastTourName y lastFilters si encajan naturalmente.',
    '- Si la pregunta actual habla de reservas con fecha explicita pero no menciona tour, no conserves el tour previo.',
    '- Si la pregunta actual usa expresiones como "y cuales", "las pendientes", "les hace falta informacion", "incompletas" o "sin datos" y el contexto actual es de reservas, reutiliza lastDate y el tour previo solo si el usuario no cambio de tema.',
    '- Si la pregunta actual explicita solo reservas + fecha, interpreta que quiere todas las reservas de esa fecha y limpia cualquier tour previo.',
    '- No inventes contexto si no existe.',
    '- Si el usuario no dio suficiente contexto para desambiguar, devuelve JSON con sql null, intent "needs_clarification", entityType "unknown" y expectedAction null.',
  ].join('\n');
}

function buildBaseSystemPrompt({ permisos, contexto }) {
  const permissionContext = Array.isArray(permisos) ? permisos.join(', ') : 'sin permisos';

  return [
    buildSchemaContextPrompt(),
    `Permisos del usuario actual: ${permissionContext}`,
    buildSessionContextPrompt(contexto),
  ].join('\n\n');
}

function mapCandidateResponse(parsed, fallbackIntent) {
  if (!parsed?.sql) {
    if (parsed?.sql === null) {
      return {
        intent: String(parsed.intent || 'blocked_sensitive_request').slice(0, 300),
        entityType: String(parsed.entityType || 'unknown').slice(0, 100),
        sql: null,
        expectedAction: parsed.expectedAction ?? null,
      };
    }

    throw new Error('El modelo no devolvio una consulta SQL.');
  }

  return {
    intent: String(parsed.intent || fallbackIntent).slice(0, 300),
    entityType: String(parsed.entityType || 'unknown').slice(0, 100),
    sql: String(parsed.sql || '').trim(),
    expectedAction: parsed.expectedAction ?? null,
  };
}

async function generarSqlCandidato({ mensaje, historial, permisos, contexto }) {

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
        temperature: 0.05,
        num_predict: 220,
      },
      messages: [
        {
          role: 'system',
          content: buildBaseSystemPrompt({ permisos, contexto }),
        },
        ...trimHistory(historial),
        {
          role: 'user',
          content: mensaje,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`El modelo SQL respondio con status ${response.status}.`);
  }

  const data = await response.json();
  const content = data?.message?.content || '';
  const parsed = extractJsonObject(content);

  return mapCandidateResponse(parsed, mensaje);
}

async function repararSqlCandidato({ mensaje, contexto, permisos, candidate, validationError }) {
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
        temperature: 0.03,
        num_predict: 220,
      },
      messages: [
        {
          role: 'system',
          content: [
            buildBaseSystemPrompt({ permisos, contexto }),
            'Modo reparacion SQL:',
            '- Debes corregir el SQL fallido para que cumpla exactamente las reglas de lectura segura.',
            '- No relajes ninguna regla.',
            '- Debes devolver nuevamente solo JSON valido.',
            '- Toda consulta corregida debe incluir LIMIT explicito.',
            '- Si es un COUNT simple, usa LIMIT 1.',
            '- Si no puedes corregirla sin violar las reglas, devuelve sql null.',
          ].join('\n\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            preguntaOriginal: mensaje,
            contextoSesion: normalizeSessionContext(contexto),
            sqlFallido: String(candidate?.sql || '').trim(),
            errorValidador: {
              code: validationError?.code || 'IA_SQL_VALIDATION_ERROR',
              message: validationError?.message || 'Error de validacion SQL',
            },
            formatoEsperado: {
              intent: 'string',
              entityType: 'string',
              sql: 'string|null',
              expectedAction: 'any|null',
            },
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`El modelo de reparación SQL respondio con status ${response.status}.`);
  }

  const data = await response.json();
  const content = data?.message?.content || '';
  const parsed = extractJsonObject(content);
  return mapCandidateResponse(parsed, candidate?.intent || mensaje);
}

module.exports = {
  generarSqlCandidato,
  repararSqlCandidato,
  normalizeSessionContext,
};
