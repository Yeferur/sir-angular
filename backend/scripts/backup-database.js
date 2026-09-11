const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
for (const fileName of ['.env', path.join('env', '.env'), '.env.production']) {
  const envPath = path.join(backendRoot, fileName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
}

function required(name, fallbackName = null) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : null);
  if (!value) throw new Error(`Falta la variable de entorno ${name}${fallbackName ? `/${fallbackName}` : ''}.`);
  return value;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sqlValue(connection, value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return connection.escape(JSON.stringify(value));
  return connection.escape(value);
}

async function main() {
  const outputDir = path.resolve(
    process.argv[2] || path.join(backendRoot, 'database', 'backups')
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const backupUser = process.env.BACKUP_DB_USER || required('DB_USER');
  const backupPassword = Object.prototype.hasOwnProperty.call(process.env, 'BACKUP_DB_PASSWORD')
    ? process.env.BACKUP_DB_PASSWORD
    : (process.env.DB_PASSWORD || process.env.DB_PASS || '');
  const backupDatabase = process.env.BACKUP_DB_NAME || required('DB_NAME', 'DB_DATABASE');
  const connection = await mysql.createConnection({
    host: required('DB_HOST'),
    user: backupUser,
    password: backupPassword,
    database: backupDatabase,
    port: Number(process.env.DB_PORT || 3306),
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  const databaseName = backupDatabase;
  const baseName = `${databaseName}-${timestamp()}`;
  const finalPath = path.join(outputDir, `${baseName}.sql`);
  const temporaryPath = `${finalPath}.tmp`;
  const chunks = [
    `-- SIR Angular logical backup`,
    `-- Database: ${databaseName}`,
    `-- Generated: ${new Date().toISOString()}`,
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS=0;',
    '',
  ];

  try {
    const [objects] = await connection.query('SHOW FULL TABLES');
    const tables = [];
    const views = [];
    for (const row of objects) {
      const name = Object.values(row)[0];
      const type = String(Object.values(row)[1] || '').toUpperCase();
      (type === 'VIEW' ? views : tables).push(name);
    }

    let totalRows = 0;
    for (const table of tables) {
      const escapedTable = connection.escapeId(table);
      const [[createRow]] = await connection.query(`SHOW CREATE TABLE ${escapedTable}`);
      const createSql = createRow['Create Table'];
      chunks.push(`DROP TABLE IF EXISTS ${escapedTable};`, `${createSql};`, '');

      const [rows, fields] = await connection.query(`SELECT * FROM ${escapedTable}`);
      totalRows += rows.length;
      const columns = fields.map((field) => connection.escapeId(field.name)).join(', ');
      for (let start = 0; start < rows.length; start += 250) {
        const values = rows.slice(start, start + 250).map((row) => (
          `(${fields.map((field) => sqlValue(connection, row[field.name])).join(', ')})`
        ));
        chunks.push(`INSERT INTO ${escapedTable} (${columns}) VALUES\n${values.join(',\n')};`, '');
      }
    }

    for (const view of views) {
      const escapedView = connection.escapeId(view);
      const [[createRow]] = await connection.query(`SHOW CREATE VIEW ${escapedView}`);
      chunks.push(`DROP VIEW IF EXISTS ${escapedView};`, `${createRow['Create View']};`, '');
    }

    chunks.push('SET FOREIGN_KEY_CHECKS=1;', '');
    fs.writeFileSync(temporaryPath, chunks.join('\n'), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, finalPath);

    const digest = crypto.createHash('sha256').update(fs.readFileSync(finalPath)).digest('hex');
    fs.writeFileSync(`${finalPath}.sha256`, `${digest}  ${path.basename(finalPath)}\n`, 'utf8');
    const size = fs.statSync(finalPath).size;
    console.log(JSON.stringify({ backup: finalPath, checksum: digest, bytes: size, tables: tables.length, views: views.length, rows: totalRows }));
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`No se pudo crear el respaldo: ${error.message}`);
  process.exitCode = 1;
});
