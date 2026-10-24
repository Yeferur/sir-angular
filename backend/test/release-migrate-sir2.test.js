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

test('migración de perfiles de comisión está en release y protege columnas y FKs', async () => {
  const name = '20261016_0015_perfiles_comision_entidad.sql';
  assert.ok(MIGRATIONS.includes(name));
  assert.deepEqual(REQUIRED_COLUMNS.tours, ['Creado_Por', 'Actualizado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.puntos, ['Creado_Por', 'Actualizado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.liquidaciones, ['Creado_Por', 'Actualizado_Por', 'Monto_Comision_Pagada']);
  assert.ok(REQUIRED_COLUMNS.perfiles_comision_entidad.includes('Id_Entidad_Reportante'));
  assert.deepEqual(REQUIRED_COLUMNS.programaciones, ['Creado_Por']);
  assert.deepEqual(REQUIRED_COLUMNS.historial, ['Actor_Nombre', 'Actor_Rol']);
  for (const [table, constraint] of [
    ['tours', 'fk_tours_creado_por'], ['tours', 'fk_tours_actualizado_por'],
    ['puntos', 'fk_puntos_creado_por'], ['puntos', 'fk_puntos_actualizado_por'],
    ['liquidaciones', 'fk_liquidaciones_creado_por'], ['liquidaciones', 'fk_liquidaciones_actualizado_por'],
    ['programaciones', 'fk_programaciones_creado_por'],
    ['perfiles_comision_entidad', 'fk_perfiles_comision_creado_por'],
    ['perfiles_comision_entidad', 'fk_perfiles_comision_actualizado_por'],
  ]) assert.ok(REQUIRED_FKS.some(([fkTable, fkName, onDelete]) =>
    fkTable === table && fkName === constraint && onDelete === 'SET NULL'));
  assert.ok(REQUIRED_FKS.some(([table, fk, action]) =>
    table === 'perfiles_comision_entidad' && fk === 'fk_perfiles_comision_entidad' && action === 'RESTRICT'));
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  const profileTable = migration.statements.find(statement => statement.startsWith('CREATE TABLE IF NOT EXISTS perfiles_comision_entidad'));
  assert.ok(profileTable);
  assert.match(profileTable, /UNIQUE KEY ux_perfiles_comision_entidad \(Id_Entidad_Reportante\)/);
  assert.match(profileTable, /REFERENCES entidades_reportantes \(Id_Entidad_Reportante\)/);
  assert.doesNotMatch(profileTable, /Tipo_Beneficiario|Id_Canal|Nombre VARCHAR/);
  assert.ok(migration.statements.some(statement => statement.includes('Monto_Comision_Pagada')));
  assert.ok(migration.statements.some(statement => statement.includes('DECIMAL(10,0)')));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('migración nueva agrega el índice de actividad de transfers y queda sin aplicar', async () => {
  const name = '20261020_0016_transfers_entidad_fecha_registro.sql';
  assert.equal(MIGRATIONS[MIGRATIONS.length - 4], name);
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  assert.ok(migration.statements.some(statement => statement.includes('ALTER TABLE transfers ADD INDEX ix_transfers_entidad_registro (Id_Entidad_Reportante, Fecha_Registro)')));
  assert.ok(migration.statements.some(statement => statement.includes('FROM information_schema.STATISTICS')));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('la guarda idempotente del esquema de transfers precede a 0016', async () => {
  const name = '20261019_0001_transfers_entidad_schema_guard.sql';
  const guardIndex = MIGRATIONS.indexOf(name);
  const index0016 = MIGRATIONS.indexOf('20261020_0016_transfers_entidad_fecha_registro.sql');
  assert.ok(guardIndex >= 0);
  assert.ok(guardIndex < index0016);
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.statements.length, 16);
  assert.equal((migration.statements.join('\n').match(/FROM information_schema\.COLUMNS/g) || []).length, 2);
  assert.equal((migration.statements.join('\n').match(/FROM information_schema\.REFERENTIAL_CONSTRAINTS/g) || []).length, 2);
  assert.match(migration.statements.join('\n'), /FOREIGN KEY \(Id_Canal\).*ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.match(migration.statements.join('\n'), /FOREIGN KEY \(Id_Entidad_Reportante\).*ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('migración 0017 registra MERCADEO.EXPORTAR y su asignación por defecto sin aplicarla', async () => {
  const name = '20261021_0017_mercadeo_exportar.sql';
  assert.equal(MIGRATIONS.at(-3), name);
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  assert.ok(migration.statements.some(statement => statement.includes("'MERCADEO.EXPORTAR'")));
  assert.ok(migration.statements.some(statement => /'mercadeo','administrador'/.test(statement)));
  assert.ok(migration.statements.some(statement => statement.includes("VALUES ('CATALOGO',1,1)")));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('migración 0018 agrega marcas de rechazo y la regla de validación sin aplicar', async () => {
  const name = '20261021_0018_entidades_reportantes_validacion.sql';
  assert.equal(MIGRATIONS.at(-2), name);
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  assert.ok(REQUIRED_COLUMNS.reservas.includes('Pendiente_Por_Entidad_En'));
  assert.ok(REQUIRED_COLUMNS.transfers.includes('Pendiente_Por_Entidad_En'));
  assert.ok(migration.statements.some(statement => statement.includes('ALTER TABLE reservas ADD COLUMN Pendiente_Por_Entidad_En')));
  assert.ok(migration.statements.some(statement => statement.includes('ALTER TABLE transfers ADD COLUMN Pendiente_Por_Entidad_En')));
  assert.ok(migration.statements.some(statement => statement.includes('ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION')));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('migración 0019 agrega lectura de reservas y transfers a Mercadeo, sin Historial ni escritura', async () => {
  const name = '20261024_0019_mercadeo_lectura.sql';
  assert.equal(MIGRATIONS.at(-1), name);
  const migration = (await readMigrations()).at(-1);
  assert.equal(migration.name, name);
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations', name), 'utf8');
  for (const code of ['TRANSFERS.LEER', 'RESERVAS.LEER']) assert.ok(sql.includes(code));
  assert.doesNotMatch(sql, /HISTORIAL\.LEER/);
  assert.match(sql, /Nombre_Rol\)\)='mercadeo'/);
  assert.doesNotMatch(sql, /(?:CREAR|ACTUALIZAR|ELIMINAR)\.(?:RESERVAS|TRANSFERS)/);
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});
