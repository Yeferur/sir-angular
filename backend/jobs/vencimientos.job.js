const cron = require('node-cron');
const { actualizarEstadosReservasVencidas } = require('../services/Reservas/reservas.service');
const { actualizarEstadosTransfersVencidos } = require('../services/Transfers/transfers.service');

const CRON_VENCIMIENTOS = '10 0 * * *';
const TIMEZONE_VENCIMIENTOS = 'America/Bogota';

let tareaVencimientos = null;

async function ejecutarVencimientosAutomaticos() {
  const inicio = new Date().toISOString();
  console.log(`[VENCIMIENTOS] Inicio job automático: ${inicio}`);

  try {
    const resumenReservas = await actualizarEstadosReservasVencidas();
    console.log('[VENCIMIENTOS] Resumen reservas:', resumenReservas);
  } catch (error) {
    console.error('[VENCIMIENTOS] Error procesando reservas:', error);
  }

  try {
    const resumenTransfers = await actualizarEstadosTransfersVencidos();
    console.log('[VENCIMIENTOS] Resumen transfers:', resumenTransfers);
  } catch (error) {
    console.error('[VENCIMIENTOS] Error procesando transfers:', error);
  }

  console.log(`[VENCIMIENTOS] Fin job automático: ${new Date().toISOString()}`);
}

function iniciarVencimientosJob() {
  if (tareaVencimientos) {
    return tareaVencimientos;
  }

  tareaVencimientos = cron.schedule(
    CRON_VENCIMIENTOS,
    () => {
      ejecutarVencimientosAutomaticos().catch((error) => {
        console.error('[VENCIMIENTOS] Error no controlado en ejecución programada:', error);
      });
    },
    {
      scheduled: true,
      timezone: TIMEZONE_VENCIMIENTOS,
    }
  );

  console.log(
    `[VENCIMIENTOS] Job programado ${CRON_VENCIMIENTOS} timezone=${TIMEZONE_VENCIMIENTOS}`
  );

  return tareaVencimientos;
}

module.exports = {
  iniciarVencimientosJob,
  ejecutarVencimientosAutomaticos,
  CRON_VENCIMIENTOS,
  TIMEZONE_VENCIMIENTOS,
};
