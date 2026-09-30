const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  MIGRATIONS, assertTargetConfiguration, assertConnectedDatabase,
  assertConfirmation, assertMigrationSafe, readMigrations,
} = require('../scripts/release-migrate-sir2');

test('el guard rechaza sir, destino vacío y un nombre confirmado distinto', () => {
  assert.throws(() => assertTargetConfiguration({ DB_NAME: 'sir' }), /rechazado/);
  assert.throws(() => assertTargetConfiguration({ DB_NAME: '' }), /rechazado/);
  assert.throws(() => assertTargetConfiguration({ DB_NAME: 'sir2', DB_DATABASE: 'sir' }), /rechazado/);
  assert.throws(() => assertConnectedDatabase('sir'), /rechazado/);
  assert.throws(() => assertConnectedDatabase(null), /rechazado/);
});

test('sir2 exige confirmación exacta antes del DDL', () => {
  assert.doesNotThrow(() => assertTargetConfiguration({ DB_NAME: 'sir2', DB_DATABASE: 'sir2' }));
  assert.doesNotThrow(() => assertConnectedDatabase('sir2'));
  assert.throws(() => assertConfirmation([]), /--confirm-sir2/);
  assert.throws(() => assertConfirmation(['--confirm-sir2', '--database=sir']), /--confirm-sir2/);
  assert.doesNotThrow(() => assertConfirmation(['--confirm-sir2']));
});

test('rechaza cambio de base y referencias explícitas a sir', () => {
  for (const sql of ['USE sir', 'CREATE DATABASE sir', 'ALTER TABLE sir.usuarios ADD x INT',
    'ALTER TABLE `sir`.`usuarios` ADD x INT']) {
    assert.throws(() => assertMigrationSafe(sql));
  }
});

test('SQL de reservas y runtime usan disponibilidad en minúscula', async () => {
  for (const relative of [
    '../services/Reservas/reservas.service.js',
    '../database/migrations/20260930_runtime_schema.sql',
  ]) {
    const source = await fs.readFile(path.join(__dirname, relative), 'utf8');
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+`?Disponibilidad`?\b/);
    assert.match(source, /\bdisponibilidad\b/);
  }
});

test('las nueve migraciones se leen, incluida la rutina histórica', async () => {
  const migrations = await readMigrations();
  assert.equal(migrations.length, 9);
  assert.deepEqual(migrations.map(x => x.name), [...MIGRATIONS]);
  const historical = migrations.find(x => x.name === '20260911_pendientes_recordatorios_mvp.sql');
  assert.equal(historical.statements.filter(x => x.startsWith('CREATE PROCEDURE')).length, 1);
  assert.ok(historical.statements.some(x => x === 'CALL migrate_recordatorios_mvp()'));
});
