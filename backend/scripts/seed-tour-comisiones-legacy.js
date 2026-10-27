#!/usr/bin/env node
'use strict';

// Carga idempotente de las comisiones legacy autorizadas para sir2.
// Dry-run por defecto. Para escribir, pasar --apply después del backup.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const CHANNELS_TABLE = 'canales_origen';
const DATABASE_REQUIRED = 'sir2';
const CHANNELS = [1, 2, 4];
const TOURS = [
  { id: 1, name: 'RÍO CLARO', values: [26000, 25000, 26000] },
  { id: 2, name: 'GUATAPÉ', values: [25000, 24000, 25000] },
  { id: 3, name: 'CITY TOUR + GRAFFITOUR', values: [20000, 19000, 20000] },
  { id: 4, name: 'SANTA FE DE ANTIOQUIA', values: [23000, 22000, 23000] },
  { id: 5, name: 'HACIENDA NÁPOLES', values: [26000, 25000, 26000] },
  { id: 6, name: 'SILLETERO', values: [15000, 15000, 15000] },
  { id: 7, name: 'TOUR DE LUCES', values: [15000, 15000, 15000] },
  { id: 8, name: 'PABLO ESCOBAR', values: [25000, 25000, 25000] },
  { id: 10, name: 'COFFEE TOUR', values: [22000, 21000, 22000] },
];

const expectedRows = TOURS.flatMap((tour) => CHANNELS.map((channelId, index) => ({
  Id_Tour: tour.id,
  Id_Canal: channelId,
  Valor: tour.values[index],
})));

function loadEnvironment() {
  const backendRoot = path.resolve(__dirname, '..');
  for (const relativePath of ['.env', path.join('env', '.env')]) {
    const envPath = path.join(backendRoot, relativePath);
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

function expectedNames(value) {
  return String(value ?? '').trim().toLocaleUpperCase('es-CO');
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

function assertEqualRows(actualRows) {
  const normalized = actualRows.map((row) => ({
    Id_Tour: Number(row.Id_Tour),
    Id_Canal: Number(row.Id_Canal),
    Valor: Number(row.Valor),
  })).sort((a, b) => a.Id_Tour - b.Id_Tour || a.Id_Canal - b.Id_Canal);
  const expected = [...expectedRows].sort((a, b) => a.Id_Tour - b.Id_Tour || a.Id_Canal - b.Id_Canal);
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`La verificación de tour_comisiones no coincide. Esperado=${JSON.stringify(expected)} Actual=${JSON.stringify(normalized)}`);
  }
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

    const [tourRows] = await connection.query('SELECT Id_Tour, Nombre_Tour FROM tours WHERE Id_Tour IN (?) ORDER BY Id_Tour', [TOURS.map((tour) => tour.id)]);
    const tourProblems = TOURS.flatMap((expected) => {
      const actual = tourRows.find((tour) => Number(tour.Id_Tour) === expected.id);
      return !actual || expectedNames(actual.Nombre_Tour) !== expectedNames(expected.name)
        ? [{ Id_Tour: expected.id, expected: expected.name, actual: actual?.Nombre_Tour ?? null }]
        : [];
    });

    const [channelRows] = await connection.query(
      `SELECT Id_Canal, Nombre_Canal, Tiene_Comision FROM ${connection.escapeId(CHANNELS_TABLE)} WHERE Id_Canal IN (?) ORDER BY Id_Canal`,
      [CHANNELS],
    );
    const channelProblems = CHANNELS.flatMap((id) => {
      const actual = channelRows.find((channel) => Number(channel.Id_Canal) === id);
      return !actual || Number(actual.Tiene_Comision) !== 1
        ? [{ Id_Canal: id, expected_Tiene_Comision: 1, actual: actual ?? null }]
        : [];
    });

    const [[triggerCount]] = await connection.query(
      `SELECT COUNT(*) AS total FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'tour_comisiones'`,
    );
    const [existingRows] = await connection.query('SELECT Id_Tour, Id_Canal, Valor FROM tour_comisiones ORDER BY Id_Tour, Id_Canal');
    const rowCountBefore = existingRows.length;
    const alreadyApplied = rowCountBefore === expectedRows.length
      && (() => { try { assertEqualRows(existingRows); return true; } catch (_) { return false; } })();
    const preflight = {
      database: dbRow.database_name,
      channelsTable: CHANNELS_TABLE,
      expectedTourCount: TOURS.length,
      foundTourCount: tourRows.length,
      tours: tourRows,
      tourProblems,
      channels: channelRows,
      channelProblems,
      existingCommissionRows: rowCountBefore,
      expectedCommissionInserts: alreadyApplied ? 0 : expectedRows.length,
      idempotentNoOp: alreadyApplied,
      targetTableTriggers: Number(triggerCount.total),
    };
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', preflight }, null, 2));

    if (tourProblems.length || channelProblems.length || (rowCountBefore !== 0 && !alreadyApplied) || Number(triggerCount.total) !== 0) {
      throw new Error('Preflight distinto de lo aprobado; no se aplicó ningún cambio.');
    }
    if (!apply) return;
    if (alreadyApplied) {
      console.log(JSON.stringify({ verification: 'OK (no-op idempotente)', rows: rowCountBefore, changed: false }, null, 2));
      return;
    }

    const countsBefore = await readTableCounts(connection);
    await connection.beginTransaction();
    try {
      for (const row of expectedRows) {
        await connection.query(
          'INSERT INTO tour_comisiones (Id_Tour, Id_Canal, Valor) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE Valor = VALUES(Valor)',
          [row.Id_Tour, row.Id_Canal, row.Valor],
        );
      }

      const [afterRows] = await connection.query('SELECT Id_Tour, Id_Canal, Valor FROM tour_comisiones ORDER BY Id_Tour, Id_Canal');
      assertEqualRows(afterRows);
      const countsAfter = await readTableCounts(connection);
      const countDifferences = [];
      for (const [tableName, before] of countsBefore) {
        const after = countsAfter.get(tableName);
        const expectedAfter = tableName === 'tour_comisiones' ? before + expectedRows.length : before;
        if (after !== expectedAfter) countDifferences.push({ tableName, before, after, expectedAfter });
      }
      for (const tableName of countsAfter.keys()) {
        if (!countsBefore.has(tableName)) countDifferences.push({ tableName, before: null, after: countsAfter.get(tableName), expectedAfter: null });
      }
      if (countDifferences.length) throw new Error(`Cambios de conteo fuera de lo esperado: ${JSON.stringify(countDifferences)}`);
      await connection.commit();
      console.log(JSON.stringify({ verification: 'OK', rows: afterRows.length, values: afterRows, onlyTableWithCountChange: 'tour_comisiones', tableCountDifferences: [{ tableName: 'tour_comisiones', before: countsBefore.get('tour_comisiones'), after: countsAfter.get('tour_comisiones') }] }, null, 2));
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`seed-tour-comisiones-legacy: ${error.message}`);
  process.exitCode = 1;
});
