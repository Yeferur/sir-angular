const mysql = require('mysql2');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'env', '.env') });

const pool = mysql.createPool({
  host: process.env.IA_DB_HOST,
  port: Number(process.env.IA_DB_PORT || 3306),
  user: process.env.IA_DB_USER,
  password: process.env.IA_DB_PASSWORD,
  database: process.env.IA_DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.IA_DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  supportBigNumbers: true,
});

module.exports = {
  pool: pool.promise(),
  SQL_TIMEOUT_MS: Number(process.env.IA_SQL_TIMEOUT_MS || 8000),
  SQL_MAX_ROWS: Number(process.env.IA_SQL_MAX_ROWS || 50),
};
