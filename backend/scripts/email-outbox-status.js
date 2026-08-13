const db = require('../database/db');
const { getOutboxPolicy } = require('../services/email-outbox.service');

async function main() {
  const policy = getOutboxPolicy();
  const [rows] = await db.query(
    `SELECT Estado, Tipo, COUNT(*) AS Cantidad
       FROM email_outbox
      GROUP BY Estado, Tipo
      ORDER BY Estado, Tipo`
  );
  const [usageRows] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         THEN 1 ELSE 0 END), 0) AS Total_24h,
       COALESCE(SUM(CASE WHEN Tipo = 'schedule'
         AND Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END), 0) AS Horarios_24h,
       COALESCE(SUM(CASE WHEN Tipo = 'password_reset'
         AND Reservado_En >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END), 0) AS Recuperaciones_24h
     FROM email_outbox_dispatches`
  );
  const [controlRows] = await db.query(
    `SELECT Pausado_Hasta, Motivo
       FROM email_outbox_control
      WHERE Id_Control = 1 AND Pausado_Hasta > NOW()`
  );

  console.table(rows);
  console.table([{
    ...usageRows[0],
    Limite_Total: policy.totalLimit,
    Limite_Horarios: policy.scheduleLimit,
    Reserva_Recuperacion: policy.passwordReserve,
  }]);
  if (controlRows.length) console.table(controlRows);
}

main()
  .catch((error) => {
    console.error(`[email-outbox] No se pudo consultar el estado: ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
