const { CURRENT_RELEASE, publishCurrentRelease } = require('../services/AppUpdates/app-updates.service');

async function publishAppUpdateOnStartup() {
  try {
    const result = await publishCurrentRelease();
    console.log(`[Actualizaciones] ${CURRENT_RELEASE.version} sincronizada (${result.delivered} entregas nuevas).`);
    return result;
  } catch (error) {
    if (error?.code === 'ER_BAD_FIELD_ERROR' || error?.code === 'ER_NO_SUCH_TABLE') {
      console.warn('[Actualizaciones] Falta aplicar la migración 20260922_app_updates_notifications.sql.');
      return null;
    }
    console.error('[Actualizaciones] No se pudo publicar la versión vigente:', error);
    return null;
  }
}

module.exports = { publishAppUpdateOnStartup };
