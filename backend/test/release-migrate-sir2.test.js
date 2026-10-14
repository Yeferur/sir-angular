const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  MIGRATIONS, assertTargetConfiguration, assertConnectedDatabase,
  assertConfirmation, selectMigrationsThrough, assertMigrationSafe, readMigrations,
  REQUIRED_COLUMNS, REQUIRED_FKS,
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
  assert.doesNotThrow(() => assertConfirmation(['--confirm-sir2', '--through', MIGRATIONS[5]]));
  assert.throws(() => assertConfirmation(['--confirm-sir2', '--only', MIGRATIONS[5]]), /--confirm-sir2/);
});

test('el runner permite checkpoints acumulativos para separar ventanas de migración', () => {
  const migrations = MIGRATIONS.map((name) => ({ name }));
  assert.deepEqual(selectMigrationsThrough(migrations, MIGRATIONS[14]), migrations.slice(0, 15));
  assert.deepEqual(selectMigrationsThrough(migrations, MIGRATIONS[15]), migrations.slice(0, 16));
  assert.deepEqual(selectMigrationsThrough(migrations, null), migrations);
  assert.throws(() => selectMigrationsThrough(migrations, 'inventada.sql'), /Checkpoint desconocido/);
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

test('las migraciones se leen, incluida la rutina histórica', async () => {
  const migrations = await readMigrations();
  assert.equal(migrations.length, MIGRATIONS.length);
  assert.deepEqual(migrations.map(x => x.name), [...MIGRATIONS]);
  const historical = migrations.find(x => x.name === '20260911_pendientes_recordatorios_mvp.sql');
  assert.equal(historical.statements.filter(x => x.startsWith('CREATE PROCEDURE')).length, 1);
  assert.ok(historical.statements.some(x => x === 'CALL migrate_recordatorios_mvp()'));
});

test('migración Mercadeo idempotente por inspección de índice y sin cambios destructivos', async () => {
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations/20261010_mercadeo_reservas.sql'), 'utf8');
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal((sql.match(/FROM information_schema\.STATISTICS/g) || []).length, 3);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE\s+)?(?:reservas|pasajeros|permisos)\b/i);
  assert.match(sql, /idx_reservas_fecha_registro_id/);
  assert.match(sql, /idx_pasajeros_dni/);
  assert.match(sql, /idx_pasajeros_nombre/);
  const mercadeo = MIGRATIONS.indexOf('20261010_mercadeo_reservas.sql');
  assert.ok(mercadeo > MIGRATIONS.indexOf('20260930_runtime_schema.sql'));
});

test('migración final de autoría/auditoría está en release y protege columnas y FKs', async () => {
  const name = '20261013_0014_final_authoring_audit_schema.sql';
  assert.equal(MIGRATIONS.at(-1), name);
  assert.deepEqual(REQUIRED_COLUMNS.tours, ['Creado_Por', 'Actualizado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.puntos, ['Creado_Por', 'Actualizado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.liquidaciones, ['Creado_Por', 'Actualizado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.programaciones, ['Creado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.historial, ['Actor_Nombre', 'Actor_Rol']);
  for (const [table, constraint] of [
    ['tours', 'fk_tours_creado_por'], ['tours', 'fk_tours_actualizado_por'],
    ['puntos', 'fk_puntos_creado_por'], ['puntos', 'fk_puntos_actualizado_por'],
    ['liquidaciones', 'fk_liquidaciones_creado_por'], ['liquidaciones', 'fk_liquidaciones_actualizado_por'],
    ['programaciones', 'fk_programaciones_creado_por'],
  ]) assert.ok(REQUIRED_FKS.some(([fkTable, fkName, onDelete]) =>
    fkTable === table && fkName === constraint && onDelete === 'SET NULL'));
  const migration = (await readMigrations()).at(-1);
  assert.equal(migration.name, name);
  assert.ok(migration.statements.some(statement => statement.startsWith('UPDATE historial h')));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});
