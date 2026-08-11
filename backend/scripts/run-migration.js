const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'env', '.env') });

async function main() {
  const migrationName = path.basename(String(process.argv[2] || ''));
  if (!/^\d{8}_[a-z0-9_]+\.sql$/i.test(migrationName)) {
    throw new Error('Indica el nombre de una migración SQL válida.');
  }
  const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', migrationName), 'utf8');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME || process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
  });
  try {
    await connection.query(sql);
    console.log(`Migración aplicada: ${migrationName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
