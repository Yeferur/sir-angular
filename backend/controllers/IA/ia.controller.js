const { obtenerPermisosUsuario } = require('../../middlewares/permissionsMiddleware');
const { procesarChatIa } = require('../../services/IA/ia-orchestrator.service');
const { buildSafeIaErrorResponse } = require('../../services/IA/ia-safe-response.service');

function withDefaultIaShape(response, meta = {}) {
  return {
    texto: response?.texto || 'No pude procesar la consulta en este momento.',
    accion: response?.accion || null,
    ...(response?.contextPatch ? { contextPatch: response.contextPatch } : {}),
    chart: response?.chart ?? null,
    meta: response?.meta || meta,
  };
}

async function postIaChat(req, res) {
  const mensaje = String(req.body?.mensaje || '').trim();
  const historial = Array.isArray(req.body?.historial) ? req.body.historial : [];
  const contexto = req.body?.contexto && typeof req.body.contexto === 'object' && !Array.isArray(req.body.contexto)
    ? req.body.contexto
    : {};

  if (!mensaje) {
    return res.status(400).json({
      texto: 'Necesito un mensaje para procesar la consulta.',
      accion: null,
      chart: null,
      meta: {
        mode: 'clarification',
        confidence: 0,
        elapsedMs: 0,
      },
    });
  }

  try {
    const permisos = Array.isArray(req.userPermissions)
      ? req.userPermissions
      : await obtenerPermisosUsuario(req.user.id);

    const respuesta = await procesarChatIa({
      mensaje,
      historial,
      contexto,
      user: req.user,
      permisos,
    });

    return res.json(withDefaultIaShape(respuesta));
  } catch (error) {
    const safe = buildSafeIaErrorResponse(error, {
      intent: error?.intent,
    });

    if (safe.expected) {
      console.warn('IA safe block:', error?.code || error?.message || 'EXPECTED_BLOCK');
      return res.status(safe.status).json(withDefaultIaShape(safe.response));
    }

    console.error('IA controller error:', error);

    return res.status(safe.status).json(withDefaultIaShape(safe.response));
  }
}

module.exports = {
  postIaChat,
};
