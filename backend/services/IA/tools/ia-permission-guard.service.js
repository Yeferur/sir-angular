const { verificarPermiso } = require('../../Permisos/permisos.service');

function resolveUserId(user) {
  const candidate = user?.Id_Usuario ?? user?.id ?? null;
  const normalized = Number(candidate);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

async function assertIaToolPermission({ user, requiredPermission, toolName }) {
  if (!requiredPermission) {
    return true;
  }

  const userId = resolveUserId(user);
  if (!userId) {
    const error = new Error('No tienes permiso para usar esta acción.');
    error.code = 'IA_TOOL_PERMISSION_DENIED';
    error.toolName = toolName || null;
    throw error;
  }

  const allowed = await verificarPermiso(userId, requiredPermission);
  if (!allowed) {
    const error = new Error('No tienes permiso para usar esta acción.');
    error.code = 'IA_TOOL_PERMISSION_DENIED';
    error.toolName = toolName || null;
    throw error;
  }

  return true;
}

module.exports = {
  assertIaToolPermission,
  resolveUserId,
};
