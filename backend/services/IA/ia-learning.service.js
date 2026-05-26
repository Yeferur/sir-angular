const db = require('../../database/db');
const DEBUG_IA = String(process.env.DEBUG_IA || '').trim().toLowerCase() === 'true';

const MISSING_TABLE_CODES = new Set([
  'ER_NO_SUCH_TABLE',
  'ER_BAD_TABLE_ERROR',
]);

async function safeInsert(sql, values) {
  try {
    const [result] = await db.query(sql, values);
    return result;
  } catch (error) {
    if (MISSING_TABLE_CODES.has(error?.code)) {
      return null;
    }

    if (DEBUG_IA) {
      console.warn('[IA LEARNING] no se pudo registrar la interacción:', error.message);
    }
    return null;
  }
}

async function logInteraction({
  userId,
  pregunta,
  intencion,
  mode = null,
  entidadTipo = null,
  entidadId = null,
  sqlGenerado = null,
  planJson = null,
  toolUsada = null,
  confidence = null,
  respuesta,
  tiempoMs,
  exito,
  plannerUsed = false,
  fastPathUsed = false,
}) {
  const extendedSql = [
    'INSERT INTO ia_interacciones',
    '(',
    '  user_id, pregunta, intencion, mode, entidad_tipo, entidad_id,',
    '  sql_generado, plan_json, tool_usada, confidence, respuesta, tiempo_ms, exito, planner_used, fast_path_used',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ].join(' ');

  const extendedValues = [
    userId || null,
    String(pregunta || '').slice(0, 2000),
    String(intencion || '').slice(0, 255),
    mode ? String(mode).slice(0, 60) : null,
    entidadTipo ? String(entidadTipo).slice(0, 100) : null,
    entidadId || null,
    sqlGenerado ? String(sqlGenerado).slice(0, 8000) : null,
    planJson ? String(planJson).slice(0, 12000) : null,
    toolUsada ? String(toolUsada).slice(0, 120) : null,
    Number.isFinite(Number(confidence)) ? Number(confidence) : null,
    String(respuesta || '').slice(0, 4000),
    Number.isFinite(Number(tiempoMs)) ? Number(tiempoMs) : null,
    exito ? 1 : 0,
    plannerUsed ? 1 : 0,
    fastPathUsed ? 1 : 0,
  ];

  let result = await safeInsert(extendedSql, extendedValues);

  if (result === null) {
    result = await safeInsert(
      [
        'INSERT INTO ia_interacciones',
        '(',
        '  user_id, pregunta, intencion, entidad_tipo, entidad_id,',
        '  sql_generado, tool_usada, respuesta, tiempo_ms, exito',
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
      [
        userId || null,
        String(pregunta || '').slice(0, 2000),
        String(intencion || '').slice(0, 255),
        entidadTipo ? String(entidadTipo).slice(0, 100) : null,
        entidadId || null,
        sqlGenerado ? String(sqlGenerado).slice(0, 8000) : null,
        toolUsada ? String(toolUsada).slice(0, 120) : null,
        String(respuesta || '').slice(0, 4000),
        Number.isFinite(Number(tiempoMs)) ? Number(tiempoMs) : null,
        exito ? 1 : 0,
      ]
    );
  }

  const interactionId = result?.insertId ? Number(result.insertId) : null;

  if (interactionId && toolUsada) {
    await safeInsert(
      [
        'INSERT INTO ia_tool_runs',
        '(interaction_id, tool_name, input_json, success, created_at)',
        'VALUES (?, ?, ?, ?, NOW())',
      ].join(' '),
      [
        interactionId,
        String(toolUsada).slice(0, 120),
        null,
        exito ? 1 : 0,
      ]
    );
  }

  return interactionId;
}

module.exports = {
  logInteraction,
};
