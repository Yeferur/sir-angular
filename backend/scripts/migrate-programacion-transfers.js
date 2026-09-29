const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEMAS = {
  programacion_transfers_listados: { primary: 'Fecha_Operacion', columns: {
    Fecha_Operacion: 'date', Revision: 'bigint unsigned', Firma: 'char(64)', Confirmado_En: 'datetime(3)', Confirmado_Por: 'bigint unsigned',
  } },
  programacion_transfers_snapshot: { primary: 'Fecha_Operacion,Revision_Listado,Id_Transfer', columns: {
    Fecha_Operacion: 'date', Revision_Listado: 'bigint unsigned', Id_Transfer: 'bigint unsigned', Datos_Snapshot: 'json',
  } },
};

function assertTestDestination(env, database) {
  if (!['localhost', '127.0.0.1', '::1'].includes(String(env.DB_HOST).toLowerCase())
    || env.NODE_ENV === 'production' || !/(^|_)test(_|$)/i.test(database || '')
    || /(^|_)(prod|production|operativa)(_|$)/i.test(database || '')) {
    throw new Error('La migración de Transfers requiere una base MySQL local identificada como test, fuera de producción.');
  }
}

async function verifySchema(connection) {
  for (const [table, expected] of Object.entries(SCHEMAS)) {
    const [[existing]] = await connection.query(`SELECT ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
    if (!existing) continue;
    const [columns] = await connection.query(`SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
    const [indexes] = await connection.query(`SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [table]);
    const primary = indexes.filter((i) => i.INDEX_NAME === 'PRIMARY').map((i) => i.COLUMN_NAME).join(',');
    const reverse = indexes.filter((i) => i.INDEX_NAME === 'idx_programacion_transfer_referencia').map((i) => i.COLUMN_NAME).join(',');
    if (existing.ENGINE !== 'InnoDB' || columns.length !== Object.keys(expected.columns).length
      || columns.some((c) => expected.columns[c.COLUMN_NAME] !== c.COLUMN_TYPE)
      || primary !== expected.primary
      || (table.endsWith('_snapshot') && reverse !== 'Id_Transfer,Fecha_Operacion')
      || indexes.some((i) => i.INDEX_NAME !== 'PRIMARY' && Number(i.NON_UNIQUE) === 0)) {
      throw new Error(`${table} existe con estructura parcial o incompatible. No se alteraron sus datos.`);
    }
  }
}

async function migrate(connection, env = process.env) {
  const [[destination]] = await connection.query('SELECT DATABASE() AS db, @@hostname AS servidor');
  assertTestDestination(env, destination.db);
  await verifySchema(connection);
  console.log(`Destino local de pruebas confirmado: ${destination.db} (${destination.servidor})`);
  const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', '20260929_programacion_transfers_snapshot.sql'), 'utf8');
  await connection.query(sql);
  await verifySchema(connection);
}

if (require.main === module) {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env') });
  const mysql = require('mysql2/promise');
  (async () => {
    assertTestDestination(process.env, process.env.DB_NAME || process.env.DB_DATABASE);
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS,
      database: process.env.DB_NAME || process.env.DB_DATABASE, multipleStatements: true });
    try { await migrate(connection); } finally { await connection.end(); }
    console.log('Migración de referencia de Transfers aplicada.');
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { assertTestDestination, verifySchema, migrate };
