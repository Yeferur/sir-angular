// backend/db.js
const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config({ path: "./env/.env" });
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE, // cambia por el nombre real
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
module.exports = pool.promise();
