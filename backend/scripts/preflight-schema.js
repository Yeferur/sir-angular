// Read-only schema/data preflight. Canonical sir2 requires an explicit read-only flag.
const mysql = require('mysql2/promise');
const path = require('node:path');
const { assertValidationDatabaseName } = require('./validation-database-guard');

function parseArgs(args) {
  const index = args.indexOf('--database');
  const database = index >= 0 ? args[index + 1] : '';
  if (database === 'sir2') {
    if (args.length !== 3 || !args.includes('--canonical-read-only')) {
      throw new Error('sir2 requiere --database sir2 --canonical-read-only.');
    }
  } else {
    if (args.length !== 2) throw new Error('Uso: --database sir2_*validation_*');
    assertValidationDatabaseName(database);
  }
  return { database };
}

async function run(database = parseArgs(process.argv.slice(2)).database) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  try {
    const [[selected]] = await connection.query('SELECT DATABASE() AS db, VERSION() AS version');
    if (selected.db !== database) throw new Error('La conexión no seleccionó la base temporal solicitada.');

    const [tables] = await connection.query(`
      SELECT t.TABLE_NAME, t.ENGINE, t.TABLE_ROWS, t.DATA_LENGTH, t.INDEX_LENGTH,
             t.TABLE_COLLATION
        FROM information_schema.TABLES t
       WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
       ORDER BY t.TABLE_NAME`, [database]);
    const [columns] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]);
    const [indexes] = await connection.query(`
      SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]);
    const [foreignKeys] = await connection.query(`
      SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
             k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r USING (CONSTRAINT_SCHEMA, CONSTRAINT_NAME, TABLE_NAME)
       WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`, [database]);

    const engineTargets = ['tour_comisiones', 'ia_interacciones', 'ia_tool_runs'];
    const engineTables = tables.filter((t) => engineTargets.includes(t.TABLE_NAME));
    const rowCounts = [];
    for (const table of engineTables) {
      const safeName = `\`${String(table.TABLE_NAME).replace(/`/g, '``')}\``;
      const [[count]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${safeName}`);
      rowCounts.push({ table: table.TABLE_NAME, count: String(count.row_count) });
    }

    const names = new Set(tables.map((row) => row.TABLE_NAME));
    let orphans = [];
    if (['pagos_reservas', 'reservas', 'liquidaciones', 'pagos_transfers', 'transfers'].every((name) => names.has(name))) {
      [orphans] = await connection.query(`
        SELECT 'pagos_reservas.Id_Reserva' AS relacion, COUNT(*) AS cantidad
          FROM pagos_reservas p LEFT JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
         WHERE p.Id_Reserva IS NOT NULL AND r.Id_Reserva IS NULL
        UNION ALL
        SELECT 'liquidaciones.Id_Reserva', COUNT(*)
          FROM liquidaciones l LEFT JOIN reservas r ON r.Id_Reserva = l.Id_Reserva
         WHERE l.Id_Reserva IS NOT NULL AND r.Id_Reserva IS NULL
        UNION ALL
        SELECT 'pagos_transfers.Id_Transfer', COUNT(*)
          FROM pagos_transfers p LEFT JOIN transfers t ON t.Id_Transfer = p.Id_Transfer
         WHERE p.Id_Transfer IS NOT NULL AND t.Id_Transfer IS NULL`);
    }

    process.stdout.write(`${JSON.stringify({
      readOnly: true,
      database: selected.db,
      version: selected.version,
      tables,
      columns,
      indexes,
      foreignKeys,
      engineRowCounts: rowCounts,
      financialOrphans: orphans.map((row) => ({ ...row, cantidad: String(row.cantidad) })),
    }, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
  if (args) run(args.database).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { parseArgs, run };
