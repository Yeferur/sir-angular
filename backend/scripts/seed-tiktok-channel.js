#!/usr/bin/env node
'use strict';

// Agrega el canal TIKTOK. Dry-run por defecto; --apply solo después del backup.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const CHANNELS_TABLE = 'canales_origen';
const DATABASE_REQUIRED = 'sir2';
const CHANNEL_NAME = 'TIKTOK';
const CHANNEL_HAS_COMMISSION = 0;

function loadEnvironment() {
  const backendRoot = path.resolve(__dirname, '..');
  for (const relativePath of ['.env', path.join('env', '.env')]) {
    const envPath = path.join(backendRoot, relativePath);
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

async function readTableCounts(connection) {
  const [objects] = await connection.query('SHOW FULL TABLES');
  const counts = new Map();
  for (const row of objects) {
    const name = Object.values(row)[0];
    const type = String(Object.values(row)[1] || '').toUpperCase();
    if (type === 'VIEW') continue;
    const [[result]] = await connection.query(`SELECT COUNT(*) AS total FROM ${connection.escapeId(name)}`);
    counts.set(name, Number(result.total));
  }
  return counts;
}

async function main() {
  loadEnvironment();
  const apply = process.argv.includes('--apply');
  const unexpectedArgs = process.argv.slice(2).filter((arg) => arg !== '--apply' && arg !== '--dry-run');
  if (unexpectedArgs.length) throw new Error(`Argumentos no reconocidos: ${unexpectedArgs.join(', ')}`);

  const database = process.env.DB_NAME || process.env.DB_DATABASE;
  if (database !== DATABASE_REQUIRED) {
    throw new Error(`Guardia: esta operación solo permite ${DATABASE_REQUIRED}; configuración actual=${database || '(vacía)'}.`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database,
    port: Number(process.env.DB_PORT || 3306),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

  try {
    const [[dbRow]] = await connection.query('SELECT DATABASE() AS database_name');
    if (dbRow.database_name !== DATABASE_REQUIRED) throw new Error(`Conectó a ${dbRow.database_name}; se esperaba ${DATABASE_REQUIRED}.`);

    const [channels] = await connection.query(`SELECT Id_Canal, Nombre_Canal, Tiene_Comision FROM ${connection.escapeId(CHANNELS_TABLE)} ORDER BY Id_Canal`);
    const matches = channels.filter((row) => String(row.Nombre_Canal).trim().toLocaleUpperCase('es-CO') === CHANNEL_NAME);
    const [[triggerCount]] = await connection.query(
      `SELECT COUNT(*) AS total FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ?`,
      [CHANNELS_TABLE],
    );
    const preflight = {
      database: dbRow.database_name,
      channelsTable: CHANNELS_TABLE,
      currentChannelCount: channels.length,
      channels,
      tiktokMatches: matches,
      expectedName: CHANNEL_NAME,
      expectedTieneComision: CHANNEL_HAS_COMMISSION,
      expectedInsertCount: matches.length ? 0 : 1,
      targetTableTriggers: Number(triggerCount.total),
    };
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', preflight }, null, 2));

    if (![10, 11].includes(channels.length) || Number(triggerCount.total) !== 0) {
      throw new Error('Preflight distinto de lo esperado (se esperaban 10 canales, o 11 con TIKTOK ya creado, y ningún trigger); no se aplicó ningún cambio.');
    }
    if (matches.length > 1) throw new Error('Hay más de una coincidencia de TIKTOK; se detiene sin modificar.');
    if (matches.length === 1 && Number(matches[0].Tiene_Comision) !== CHANNEL_HAS_COMMISSION) {
      throw new Error('TIKTOK ya existe con Tiene_Comision distinto de 0; se detiene sin modificar.');
    }
    if ((matches.length === 0 && channels.length !== 10) || (matches.length === 1 && channels.length !== 11)) {
      throw new Error('La cantidad de canales no coincide con la presencia de TIKTOK; se detiene sin modificar.');
    }
    if (!apply) return;

    if (matches.length === 1) {
      console.log(JSON.stringify({ verification: 'OK (no-op idempotente)', channelCount: channels.length, tiktok: matches[0], changed: false }, null, 2));
      return;
    }

    const countsBefore = await readTableCounts(connection);
    await connection.beginTransaction();
    try {
      await connection.query(
        `INSERT INTO ${connection.escapeId(CHANNELS_TABLE)} (Nombre_Canal, Tiene_Comision) VALUES (?, ?) ON DUPLICATE KEY UPDATE Tiene_Comision = VALUES(Tiene_Comision)`,
        [CHANNEL_NAME, CHANNEL_HAS_COMMISSION],
      );
      const [afterChannels] = await connection.query(`SELECT Id_Canal, Nombre_Canal, Tiene_Comision FROM ${connection.escapeId(CHANNELS_TABLE)} ORDER BY Id_Canal`);
      const afterMatches = afterChannels.filter((row) => String(row.Nombre_Canal).trim().toLocaleUpperCase('es-CO') === CHANNEL_NAME);
      if (afterChannels.length !== 11 || afterMatches.length !== 1 || Number(afterMatches[0].Tiene_Comision) !== 0) {
        throw new Error(`Verificación del catálogo distinta de lo esperado: ${JSON.stringify({ channelCount: afterChannels.length, tiktok: afterMatches })}`);
      }

      const countsAfter = await readTableCounts(connection);
      const countDifferences = [];
      for (const [tableName, before] of countsBefore) {
        const after = countsAfter.get(tableName);
        const expectedAfter = tableName === CHANNELS_TABLE ? before + 1 : before;
        if (after !== expectedAfter) countDifferences.push({ tableName, before, after, expectedAfter });
      }
      for (const tableName of countsAfter.keys()) {
        if (!countsBefore.has(tableName)) countDifferences.push({ tableName, before: null, after: countsAfter.get(tableName), expectedAfter: null });
      }
      if (countDifferences.length) throw new Error(`Cambios de conteo fuera de lo esperado: ${JSON.stringify(countDifferences)}`);
      await connection.commit();
      console.log(JSON.stringify({ verification: 'OK', channelCount: afterChannels.length, tiktok: afterMatches[0], onlyTableWithCountChange: CHANNELS_TABLE, tableCountDifferences: [{ tableName: CHANNELS_TABLE, before: countsBefore.get(CHANNELS_TABLE), after: countsAfter.get(CHANNELS_TABLE) }] }, null, 2));
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`seed-tiktok-channel: ${error.message}`);
  process.exitCode = 1;
});
