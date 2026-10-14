// Read-only availability diagnosis. The CLI only accepts disposable validation DBs.
const mysql = require('mysql2/promise');
const path = require('node:path');
const { assertValidationDatabaseName, assertValidationConnection } = require('./validation-database-guard');
const { passengerSeatSql, consumingReservationSql } = require('../services/Reservas/cupos-compartidos');

function fechaBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function diagnoseConnection(connection, database) {
    const [capabilityColumns] = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='aforos' AND COLUMN_NAME='Operacion')
        OR (TABLE_NAME='reservas' AND COLUMN_NAME='Eliminada_En'))`);
    const aforoOperation = capabilityColumns.some((c)=>c.TABLE_NAME==='aforos' && c.COLUMN_NAME==='Operacion');
    const softDelete = capabilityColumns.some((c)=>c.TABLE_NAME==='reservas' && c.COLUMN_NAME==='Eliminada_En');
    const [dates] = await connection.query(`SELECT DISTINCT h.Id_Tour, r.Fecha_Tour
      FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario
      WHERE UPPER(TRIM(r.Tipo_Reserva))='GRUPAL' AND r.Fecha_Tour IS NOT NULL
      UNION SELECT Id_Tour, Fecha_Tour FROM disponibilidad
      ORDER BY Id_Tour, Fecha_Tour`);
    const findings = [];
    for (const date of dates) {
      const [[capacity]] = await connection.query(`SELECT t.Cupo_Base,
        (SELECT ${aforoOperation ? "CASE WHEN a.Operacion='USAR_BASE' THEN NULL ELSE a.Cupo END" : 'a.Cupo'}
          FROM aforos a WHERE a.Id_Tour=t.Id_Tour AND a.Fecha_Aforo=?
          ORDER BY a.Id_Aforo DESC LIMIT 1) AS override_capacity
        FROM tours t WHERE t.Id_Tour=?`, [date.Fecha_Tour, date.Id_Tour]);
      const [[occupancy]] = await connection.query(`SELECT COALESCE(SUM(${passengerSeatSql('p')}),0) AS occupied
        FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario
        LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
        WHERE h.Id_Tour=? AND r.Fecha_Tour=?
          AND ${consumingReservationSql('r', { softDelete })}`,
      [date.Id_Tour, date.Fecha_Tour]);
      const [[stored]] = await connection.query(`SELECT Cupos_Totales,Cupos_Disponibles,Updated_At FROM disponibilidad
        WHERE Id_Tour=? AND Fecha_Tour=?`, [date.Id_Tour, date.Fecha_Tour]);
      const total = Number(capacity?.override_capacity ?? capacity?.Cupo_Base ?? 0);
      const used = Number(occupancy.occupied);
      const expected = total - used;
      if (!stored || Number(stored.Cupos_Totales) !== total || Number(stored.Cupos_Disponibles) !== expected || expected < 0) {
        const dateYmd = typeof date.Fecha_Tour === 'string' ? date.Fecha_Tour.slice(0, 10)
          : date.Fecha_Tour.toISOString().slice(0, 10);
        const today = fechaBogota();
        findings.push({ tour: date.Id_Tour, date: dateYmd,
          period: dateYmd < today ? 'PASADA' : dateYmd === today ? 'HOY' : 'FUTURA',
          capacityCurrentRule: total, capacity: total, occupied: used,
          expectedAvailable: expected, stored: stored || null, overCapacity: expected < 0 });
      }
    }
    const [[orphan]] = await connection.query(`SELECT COUNT(*) AS total FROM pasajeros p
      LEFT JOIN reservas r ON r.Id_Reserva=p.Id_Reserva WHERE r.Id_Reserva IS NULL`);
    return { database, readOnly: true, schemaCapabilities: { aforoOperation, softDelete },
      examined: dates.length, discrepancies: findings.length, findings,
      orphanPassengers: Number(orphan?.total || 0) };
}

async function diagnose(database) {
  assertValidationDatabaseName(database);
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    await assertValidationConnection(connection, database);
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION READ ONLY');
    const report = await diagnoseConnection(connection, database);
    await connection.rollback();
    return report;
  } finally { await connection.end(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--database') { console.error('Uso: --database sir2_*validation_*'); process.exitCode = 2; }
  else diagnose(args[1]).then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
}
module.exports = { diagnose, diagnoseConnection, fechaBogota };
