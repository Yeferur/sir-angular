const { normalizeText } = require('./ia-query-normalizer.service');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const IA_MODEL = process.env.IA_MODEL || process.env.OLLAMA_MODEL || 'gemma4:e4b';

const ALLOWED_MODES = new Set([
  'conversation',
  'entity_lookup',
  'tool_call',
  'sql_query',
  'clarification',
  'blocked',
  'out_of_domain',
]);

function trimHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
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
    throw new Error('El planner no devolvio un JSON valido.');
  }

  return JSON.parse(content.slice(start, end + 1));
}

function sanitizeEntities(entities = {}) {
  const safeEntities = entities && typeof entities === 'object' && !Array.isArray(entities) ? entities : {};

  return {
    tourName: safeEntities.tourName ? String(safeEntities.tourName).slice(0, 160) : null,
    reservationCode: safeEntities.reservationCode ? String(safeEntities.reservationCode).slice(0, 40) : null,
    transferId: Number.isFinite(Number(safeEntities.transferId)) ? Number(safeEntities.transferId) : null,
    date: safeEntities.date ? String(safeEntities.date).slice(0, 20) : null,
    pointName: safeEntities.pointName ? String(safeEntities.pointName).slice(0, 160) : null,
    paymentStatus: safeEntities.paymentStatus ? String(safeEntities.paymentStatus).slice(0, 40) : null,
  };
}

function sanitizeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return {};
  }

  const output = {};
  for (const [key, value] of Object.entries(toolInput)) {
    if (value === undefined) continue;
    if (value === null) {
      output[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      output[key] = value.slice(0, 200);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    }
  }
  return output;
}

function normalizePlannerMode(rawMode, rawIntent) {
  const mode = String(rawMode || '').trim();
  if (ALLOWED_MODES.has(mode)) {
    return mode;
  }

  const normalizedIntent = normalizeText(rawIntent);
  if (normalizedIntent === 'out_of_domain') {
    return 'out_of_domain';
  }

  return 'clarification';
}

function normalizePlannerResponse(parsed = {}) {
  const mode = normalizePlannerMode(parsed.mode, parsed.intent);

  return {
    mode,
    intent: String(parsed.intent || mode).slice(0, 200),
    entities: sanitizeEntities(parsed.entities),
    toolName: parsed.toolName ? String(parsed.toolName).slice(0, 120) : null,
    toolInput: sanitizeToolInput(parsed.toolInput),
    sqlGoal: parsed.sqlGoal ? String(parsed.sqlGoal).slice(0, 400) : null,
    naturalReply: parsed.naturalReply ? String(parsed.naturalReply).slice(0, 1200) : null,
    needsConfirmation: Boolean(parsed.needsConfirmation),
    confidence: Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0.35,
    reason: String(parsed.reason || mode).slice(0, 300),
  };
}

function buildAvailableToolsPrompt(availableTools = []) {
  return availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    riskLevel: tool.riskLevel,
    requiresConfirmation: tool.requiresConfirmation,
  }));
}

async function planWithIa({
  message,
  context,
  history,
  availableTools,
  currentDate,
  user,
}) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: IA_MODEL,
      stream: false,
      think: false,
      options: {
        temperature: 0.1,
        num_predict: 320,
      },
      messages: [
        {
          role: 'system',
          content: [
            'Eres Maxi, asistente operativo de SIR para Maxitours.',
            'Puedes conversar de forma natural.',
            'Siempre orientas la conversación a SIR: reservas, tours, transfers, puntos, cupos, pagos, listados y operación.',
            'No respondes temas externos.',
            'No inventas datos de la empresa.',
            'Si necesitas datos reales, debes pedir tool_call o sql_query.',
            'Si existe una tool adecuada, prefieres tool_call antes que sql_query.',
            'SQL libre es solo fallback para preguntas analíticas que no cubra ninguna tool registrada.',
            'No puedes modificar datos directamente.',
            'Para acciones de escritura, debes marcar needsConfirmation true.',
            'Si falta un dato importante, usa mode clarification.',
            'Si el tema no pertenece a SIR o Maxitours, usa mode out_of_domain.',
            'Si el usuario pregunta por operacion amplia, pendientes, recomendaciones, alertas o algo raro para hoy/manana, prioriza tool_call con diagnosticar_operacion.',
            'Si menciona un tour como Guatapé o Río Claro junto con fecha relativa, usa scope tour_fecha.',
            'Si pide revisar la operación de hoy o mañana sin tour específico, usa diagnosticar_operacion con reservas, cupos, pagos, transfers, puntos y listados.',
            'Para listados de buses o propuesta de buses usa simular_listado_buses.',
            'Para puntos por ruta usa consultar_puntos_por_ruta.',
            'Para reserva por código usa consultar_reserva_por_codigo.',
            'Para transfers por fecha usa consultar_transfers_fecha.',
            'Si el usuario pide "simula el listado", "genera una propuesta de buses" o "propuesta logística", usa simular_listado_buses.',
            'Devuelve solo JSON válido.',
            'No incluyas markdown, explicaciones ni texto fuera del JSON.',
            'Ejemplo 1:',
            JSON.stringify({
              userMessage: 'necesito revisar la operación de mañana',
              response: {
                mode: 'tool_call',
                intent: 'diagnostico_operacion',
                entities: {
                  tourName: null,
                  reservationCode: null,
                  transferId: null,
                  date: null,
                  pointName: null,
                  paymentStatus: null,
                },
                toolName: 'diagnosticar_operacion',
                toolInput: {
                  fecha: null,
                  tourName: null,
                  scope: 'mañana',
                  incluir: {
                    reservas: true,
                    cupos: true,
                    pagos: true,
                    transfers: true,
                    puntos: true,
                    listados: true,
                  },
                },
                sqlGoal: null,
                naturalReply: null,
                needsConfirmation: false,
                confidence: 0.92,
                reason: 'diagnostico_operacion_fecha',
              },
            }),
            'Ejemplo 2:',
            JSON.stringify({
              userMessage: 'cómo vamos con guatapé mañana',
              response: {
                mode: 'tool_call',
                intent: 'diagnostico_operacion',
                entities: {
                  tourName: 'Guatapé',
                  reservationCode: null,
                  transferId: null,
                  date: null,
                  pointName: null,
                  paymentStatus: null,
                },
                toolName: 'diagnosticar_operacion',
                toolInput: {
                  fecha: null,
                  tourName: 'Guatapé',
                  scope: 'tour_fecha',
                  incluir: {
                    reservas: true,
                    cupos: true,
                    pagos: true,
                    transfers: false,
                    puntos: true,
                    listados: true,
                  },
                },
                sqlGoal: null,
                naturalReply: null,
                needsConfirmation: false,
                confidence: 0.93,
                reason: 'diagnostico_operacion_tour_fecha',
              },
            }),
            'Usa exactamente este formato:',
            JSON.stringify({
              mode: 'conversation | entity_lookup | tool_call | sql_query | clarification | blocked | out_of_domain',
              intent: 'string',
              entities: {
                tourName: null,
                reservationCode: null,
                transferId: null,
                date: null,
                pointName: null,
                paymentStatus: null,
              },
              toolName: null,
              toolInput: {},
              sqlGoal: null,
              naturalReply: null,
              needsConfirmation: false,
              confidence: 0.0,
              reason: 'string',
            }),
          ].join('\n'),
        },
        ...trimHistory(history),
        {
          role: 'user',
          content: JSON.stringify({
            currentDate: currentDate || null,
            message: String(message || '').slice(0, 1200),
            context: context || {},
            user: {
              id: user?.id || null,
              role: user?.role || null,
              permissions: Array.isArray(user?.permissions) ? user.permissions : [],
            },
            availableTools: buildAvailableToolsPrompt(availableTools),
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`El planner respondio con status ${response.status}.`);
  }

  const data = await response.json();
  const content = data?.message?.content || '';
  const parsed = extractJsonObject(content);
  return normalizePlannerResponse(parsed);
}

module.exports = {
  planWithIa,
};
