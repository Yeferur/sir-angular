const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { connectionOptions } = require('../scripts/create-validation-copy');
const { assertValidationDatabaseName, assertValidationConnection } = require('../scripts/validation-database-guard');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');
const { assertMigrationSafe, readMigrations } = require('../scripts/release-migrate-sir2');

function quoteIdentifier(value) { return `\`${String(value).replaceAll('`', '``')}\``; }

async function evidence(connection) {
  const [columns] = await connection.query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transfers'
      AND COLUMN_NAME IN ('Id_Canal','Id_Entidad_Reportante') ORDER BY COLUMN_NAME`);
  const [foreignKeys] = await connection.query(`SELECT rc.CONSTRAINT_NAME, k.COLUMN_NAME,
      k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
    FROM information_schema.REFERENTIAL_CONSTRAINTS rc
    JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=rc.CONSTRAINT_SCHEMA
      AND k.TABLE_NAME=rc.TABLE_NAME AND k.CONSTRAINT_NAME=rc.CONSTRAINT_NAME
    WHERE rc.CONSTRAINT_SCHEMA=DATABASE() AND rc.TABLE_NAME='transfers'
      AND rc.CONSTRAINT_NAME IN ('fk_transfers_canal','fk_transfers_entidad_reportante')
    ORDER BY rc.CONSTRAINT_NAME`);
  return { columns, foreignKeys };
}

async function applyGuard(connection, migration) {
  for (const statement of migration.statements) {
    assertMigrationSafe(statement);
    await connection.query(statement);
  }
}

test('MySQL temporal: la guarda de esquema transfers agrega solo lo que falta y es idempotente', {
  skip: process.env.TRANSFERS_ENTITY_SCHEMA_GUARD_MYSQL_TEST !== '1', timeout: 120000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });

  const host = String(process.env.DB_HOST || '').toLowerCase();
  const configuredDatabase = process.env.DB_NAME || process.env.DB_DATABASE;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'solo se permite MySQL local');
  assert.equal(configuredDatabase, 'sir2', 'se espera la configuración sir2; no se usará como esquema de prueba');
  assert.notEqual(String(process.env.NODE_ENV).toLowerCase(), 'production');
  assert.notEqual(process.env.SIR_KEEP_VALIDATION_DB, '1', 'el esquema temporal debe borrarse al terminar');

  const database = `sir2_mercadeo_validation_${randomBytes(10).toString('hex')}`;
  assertValidationDatabaseName(database);
  const stopSignalCleanup = installSignalCleanup(database);
  let server;
  let target;
  t.after(async () => {
    stopSignalCleanup();
    if (target) await target.end();
    if (server) await server.end();
    await dropGeneratedDatabase(database);
  });

  server = await mysql.createConnection(connectionOptions());
  const [[serverContext]] = await server.query('SELECT DATABASE() AS selected_database');
  assert.equal(serverContext.selected_database, null, 'la conexión de preparación no debe seleccionar una base');
  const [[existing]] = await server.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  assert.equal(existing, undefined, 'el esquema efímero no debe existir antes de la prueba');
  await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  target = await mysql.createConnection(connectionOptions(database));
  await assertValidationConnection(target, database);
  await target.query(`CREATE TABLE canales_reservas (
    Id_Canal BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY
  ) ENGINE=InnoDB`);
  await target.query(`CREATE TABLE entidades_reportantes (
    Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY
  ) ENGINE=InnoDB`);
  await target.query(`CREATE TABLE transfers (
    Id_Transfer BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Fecha_Registro DATETIME NULL
  ) ENGINE=InnoDB`);

  const migration = (await readMigrations()).find(item => item.name === '20261019_0001_transfers_entidad_schema_guard.sql');
  assert.ok(migration, 'la guarda debe estar registrada en release-migrate-sir2');

  await applyGuard(target, migration);
  const fullState = await evidence(target);
  assert.deepEqual(fullState.columns, [
    { COLUMN_NAME: 'Id_Canal', COLUMN_TYPE: 'bigint unsigned', IS_NULLABLE: 'YES' },
    { COLUMN_NAME: 'Id_Entidad_Reportante', COLUMN_TYPE: 'bigint unsigned', IS_NULLABLE: 'YES' },
  ]);
  assert.deepEqual(fullState.foreignKeys, [
    { CONSTRAINT_NAME: 'fk_transfers_canal', COLUMN_NAME: 'Id_Canal',
      REFERENCED_TABLE_NAME: 'canales_reservas', REFERENCED_COLUMN_NAME: 'Id_Canal',
      DELETE_RULE: 'SET NULL', UPDATE_RULE: 'CASCADE' },
    { CONSTRAINT_NAME: 'fk_transfers_entidad_reportante', COLUMN_NAME: 'Id_Entidad_Reportante',
      REFERENCED_TABLE_NAME: 'entidades_reportantes', REFERENCED_COLUMN_NAME: 'Id_Entidad_Reportante',
      DELETE_RULE: 'RESTRICT', UPDATE_RULE: 'CASCADE' },
  ]);

  await applyGuard(target, migration);
  assert.deepEqual(await evidence(target), fullState, 'la repetición sobre esquema completo no cambia su estado');

  await target.query('ALTER TABLE transfers DROP FOREIGN KEY fk_transfers_entidad_reportante');
  await target.query('ALTER TABLE transfers DROP COLUMN Id_Entidad_Reportante');
  await applyGuard(target, migration);
  assert.deepEqual(await evidence(target), fullState, 'restaura únicamente la entidad faltante');

  await target.query('ALTER TABLE transfers DROP FOREIGN KEY fk_transfers_canal');
  await target.query('ALTER TABLE transfers DROP COLUMN Id_Canal');
  await applyGuard(target, migration);
  assert.deepEqual(await evidence(target), fullState, 'restaura únicamente el canal faltante');
});
