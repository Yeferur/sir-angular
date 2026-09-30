// CRITICAL: Database `sir` and PM2 process `app` belong to the current
// production system and must never be modified by this release.
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const TARGET_DATABASE = 'sir2';
const MIGRATIONS = Object.freeze([
  '20260911_p0_permissions_notifications.sql',
  '20260911_pendientes_recordatorios_mvp.sql',
  '20260813_email_outbox.sql',
  '20260920_revision_cache_permisos.sql',
  '20260921_programacion_cambios_pendientes.sql',
  '20260922_app_updates_notifications.sql',
  '20260922_reminder_email.sql',
  '20260929_programacion_transfers_snapshot.sql',
  '20260930_runtime_schema.sql',
]);

function assertTargetConfiguration(env) {
  const names = [env.DB_NAME, env.DB_DATABASE].filter(value => value !== undefined && value !== null && value !== '');
  if (!names.length || names.some(name => name !== TARGET_DATABASE)) {
    throw new Error('Destino rechazado: la configuración debe seleccionar exactamente sir2.');
  }
}

function assertConnectedDatabase(database) {
  if (database !== TARGET_DATABASE) {
    throw new Error('Destino rechazado: SELECT DATABASE() no devolvió exactamente sir2.');
  }
}

function assertConfirmation(args) {
  if (args.length !== 1 || args[0] !== '--confirm-sir2') {
    throw new Error('Sin --confirm-sir2 no se ejecuta SQL.');
  }
}

function findDelimiter(sql, delimiter) {
  let quote = null;
  for (let i = 0; i <= sql.length - delimiter.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === '\\') { i++; continue; }
      if (char === quote) {
        if (sql[i + 1] === quote) { i++; continue; }
        quote = null;
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (sql.startsWith(delimiter, i)) {
      return i;
    }
  }
  return -1;
}

function parseMigrationSql(sql) {
  let delimiter = ';';
  let pending = '';
  const statements = [];
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*(?:--(?:\s|$)|#)/.test(line)) continue;
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      if (pending.trim()) throw new Error('DELIMITER dentro de una sentencia incompleta.');
      delimiter = directive[1];
      continue;
    }
    pending += `${line}\n`;
    let at;
    while ((at = findDelimiter(pending, delimiter)) !== -1) {
      const statement = pending.slice(0, at).trim();
      if (statement) statements.push(statement);
      pending = pending.slice(at + delimiter.length);
    }
  }
  if (pending.trim()) throw new Error('SQL sin delimitador final.');
  return statements;
}

function assertMigrationSafe(sql) {
  if (/\bUSE\s+[`\w]/i.test(sql)
    || /\b(?:CREATE|DROP|ALTER)\s+DATABASE\b/i.test(sql)
    || /(?:\bsir\b|`sir`)\s*\./i.test(sql)
    || /`sir`\s*\.\s*`/i.test(sql)) {
    throw new Error('La migración intenta cambiar de base o referirse a sir.');
  }
}

async function readMigrations() {
  const result = [];
  for (const name of MIGRATIONS) {
    const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8');
    const statements = parseMigrationSql(sql);
    if (!statements.length) throw new Error(`Migración vacía: ${name}`);
    for (const statement of statements) assertMigrationSafe(statement);
    result.push({ name, statements });
  }
  return result;
}

async function applyMigrations(connection, migrations) {
  for (const { name, statements } of migrations) {
    const [[target]] = await connection.query('SELECT DATABASE() AS db');
    assertConnectedDatabase(target?.db);
    for (const [index, statement] of statements.entries()) {
      try { await connection.query(statement); }
      catch (error) {
        throw new Error(`${name}, sentencia ${index + 1}: ${error.code || error.message}`);
      }
    }
    console.log(`Migración aplicada: ${name}`);
  }
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--confirm-sir2')) assertConfirmation(args);
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assertTargetConfiguration(process.env);
  const migrations = await readMigrations();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: TARGET_DATABASE,
    multipleStatements: false,
  });
  try {
    const [[target]] = await connection.query('SELECT DATABASE() AS db');
    assertConnectedDatabase(target?.db);
    console.log('TARGET DATABASE: sir2');
    assertConfirmation(args);
    await applyMigrations(connection, migrations);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  TARGET_DATABASE, MIGRATIONS, assertTargetConfiguration,
  assertConnectedDatabase, assertConfirmation, parseMigrationSql,
  assertMigrationSafe, readMigrations, applyMigrations,
};
