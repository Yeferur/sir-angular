const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  MIGRATIONS, assertTargetConfiguration, assertConnectedDatabase,
  assertConfirmation, selectMigrationsThrough, assertMigrationSafe, readMigrations,
  REQUIRED_COLUMNS, REQUIRED_FKS,
  REQUIRED_TABLE_COLLATIONS, RETIRED_TABLES, RETIRED_COLUMNS,
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
  assert.deepEqual(REQUIRED_COLUMNS.canales_origen, ['Id_Canal', 'Nombre_Canal', 'Tiene_Comision']);
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
  assert.ok(MIGRATIONS.indexOf(name) < MIGRATIONS.indexOf('20261021_0017_mercadeo_exportar.sql'));
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
  assert.ok(MIGRATIONS.indexOf(name) < MIGRATIONS.indexOf('20261021_0018_entidades_reportantes_validacion.sql'));
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  assert.ok(migration.statements.some(statement => statement.includes("'MERCADEO.EXPORTAR'")));
  assert.ok(migration.statements.some(statement => /'mercadeo','administrador'/.test(statement)));
  assert.ok(migration.statements.some(statement => statement.includes("VALUES ('CATALOGO',1,1)")));
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('migración 0018 agrega marcas de rechazo y la regla de validación sin aplicar', async () => {
  const name = '20261021_0018_entidades_reportantes_validacion.sql';
  assert.ok(MIGRATIONS.indexOf(name) < MIGRATIONS.indexOf('20261024_0019_mercadeo_lectura.sql'));
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
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations', name), 'utf8');
  for (const code of ['TRANSFERS.LEER', 'RESERVAS.LEER']) assert.ok(sql.includes(code));
  assert.doesNotMatch(sql, /HISTORIAL\.LEER/);
  assert.match(sql, /Nombre_Rol\)\)='mercadeo'/);
  assert.doesNotMatch(sql, /(?:CREAR|ACTUALIZAR|ELIMINAR)\.(?:RESERVAS|TRANSFERS)/);
  assert.equal(migration.statements.some(statement => /^\s*(?:DROP|TRUNCATE|DELETE)\b/i.test(statement)), false);
});

test('el runner conserva 0020 como checkpoint anterior a 0021 y --through se detiene en ella', async () => {
  const name = '20261025_0020_entidad_rechazada_correccion.sql';
  const nextName = '20261025_0021_comisiones_grupos_pago.sql';
  assert.ok(MIGRATIONS.indexOf(name) < MIGRATIONS.indexOf(nextName));
  const migrations = await readMigrations();
  assert.ok(migrations.findIndex(item => item.name === name) < migrations.findIndex(item => item.name === nextName));
  const selected = selectMigrationsThrough(migrations, name);
  assert.equal(selected.at(-1).name, name);
  assert.ok(selected.at(-1).statements.some(statement =>
    statement.includes('ENTIDAD_REPORTANTE_RECHAZADA_SIN_REASIGNAR')));
  assert.equal(MIGRATIONS.at(-4), nextName);
});

test('la migración 0021 registra lotes, vínculo nullable y no hace backfill', async () => {
  const name = '20261025_0021_comisiones_grupos_pago.sql';
  assert.equal(MIGRATIONS.at(-4), name);
  const migration = (await readMigrations()).at(-4);
  assert.equal(migration.name, name);
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations', name), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS comisiones_grupos_pago/);
  assert.match(sql, /ENUM\('PENDIENTE','PAGADO','ANULADO'\)/);
  assert.match(sql, /UNIQUE KEY ux_comisiones_grupo_entidad_fecha_lote \(Id_Entidad_Reportante, Fecha_Tour, Numero_Lote\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS comisiones_grupos_pago_reservas/);
  assert.match(sql, /Id_Reserva VARCHAR\(20\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
  assert.match(sql, /Nombre_Receptor_Snap VARCHAR\(255\)/);
  assert.match(sql, /ADD COLUMN Id_Grupo_Comision BIGINT UNSIGNED NULL/);
  assert.match(sql, /ADD CONSTRAINT fk_liquidaciones_grupo_comision/);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE)\s+liquidaciones\b/i);
});

test('la migración 0022 agrega las cuatro FK aprobadas y alinea collation sin cambiar datos', async () => {
  const name = '20261025_0022_integridad.sql';
  assert.equal(MIGRATIONS.at(-3), name);
  assert.deepEqual(REQUIRED_TABLE_COLLATIONS, [['tour_comisiones', 'utf8mb4_unicode_ci']]);
  for (const [table, constraint, onDelete] of [
    ['pasajeros', 'fk_pasajeros_plan', 'RESTRICT'],
    ['disponibilidad', 'fk_disponibilidad_tour', 'RESTRICT'],
    ['confirmaciones_jornada', 'fk_confirmaciones_jornada_tour', 'RESTRICT'],
    ['confirmaciones_jornada', 'fk_confirmaciones_jornada_confirmada_por', 'SET NULL'],
  ]) {
    assert.ok(REQUIRED_FKS.some(([fkTable, fkName, action]) =>
      fkTable === table && fkName === constraint && action === onDelete));
  }
  const migration = (await readMigrations()).find(item => item.name === name);
  assert.equal(migration.name, name);
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations', name), 'utf8');
  assert.match(sql, /FOREIGN KEY \(Id_Plan\) REFERENCES planes_tours\(Id_Plan\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(sql, /ALTER TABLE disponibilidad\s+ADD CONSTRAINT fk_disponibilidad_tour\s+FOREIGN KEY \(Id_Tour\) REFERENCES tours\(Id_Tour\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(sql, /ALTER TABLE confirmaciones_jornada\s+ADD CONSTRAINT fk_confirmaciones_jornada_tour\s+FOREIGN KEY \(Id_Tour\) REFERENCES tours\(Id_Tour\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(Confirmada_Por\) REFERENCES usuarios\(Id_Usuario\)\s+ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.match(sql, /CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
  assert.doesNotMatch(sql, /^\s*(?:INSERT\s+INTO\b|UPDATE\s+\w+|DELETE\s+FROM\b|TRUNCATE\b)/im);
});

test('la migración 0023 retira las tablas y columnas legacy y conserva snapshots y módulos protegidos', async () => {
  const name = '20261026_0023_limpieza_legacy.sql';
  assert.equal(MIGRATIONS.at(-2), name);
  assert.deepEqual(RETIRED_TABLES, [
    'beneficiarios_comision',
    'beneficiarios_comision_documentos',
    'mensaje_destinatario',
    'mensajes',
  ]);
  assert.deepEqual(RETIRED_COLUMNS, [
    ['reservas', 'Id_Beneficiario_Comision'],
    ['liquidaciones', 'Id_Beneficiario_Comision'],
  ]);

  const migration = (await readMigrations()).find(item => item.name === name);
  assert.ok(migration);
  const sql = await fs.readFile(path.join(__dirname, '../database/migrations', name), 'utf8');
  assert.match(sql, /ALTER TABLE reservas DROP FOREIGN KEY fk_reservas_beneficiario_comision/);
  assert.match(sql, /ALTER TABLE reservas DROP INDEX idx_reservas_beneficiario_comision/);
  assert.match(sql, /ALTER TABLE reservas DROP COLUMN Id_Beneficiario_Comision/);
  assert.match(sql, /ALTER TABLE liquidaciones DROP FOREIGN KEY fk_liquidaciones_beneficiario_comision/);
  assert.match(sql, /ALTER TABLE liquidaciones DROP INDEX idx_liquidaciones_beneficiario/);
  assert.match(sql, /ALTER TABLE liquidaciones DROP COLUMN Id_Beneficiario_Comision/);
  assert.ok(sql.indexOf('DROP TABLE beneficiarios_comision_documentos')
    < sql.indexOf('DROP TABLE beneficiarios_comision;'));
  assert.ok(sql.indexOf('DROP TABLE mensaje_destinatario') < sql.indexOf('DROP TABLE mensajes;'));
  assert.doesNotMatch(sql, /Nombre_Beneficiario_Snap|Nombre_Receptor_Snap|DNI_Receptor_Snap|Forma_Pago|Cuenta_Bancaria/);
  assert.doesNotMatch(sql, /DROP TABLE (?:ia_|chat_|planes_tours|programacion_)/i);
});

test('la migración 0024 renombra el catálogo y conserva las FK de runtime', async () => {
  const name = '20261026_0024_rename_canales_origen.sql';
  assert.equal(MIGRATIONS.at(-1), name);
  for (const [table, constraint, onDelete] of [
    ['reservas', 'fk_reservas_canal', 'SET NULL'],
    ['tour_comisiones', 'fk_tour_comisiones_canal', 'RESTRICT'],
    ['transfers', 'fk_transfers_canal', 'SET NULL'],
  ]) {
    assert.ok(REQUIRED_FKS.some(([fkTable, fkName, action, referencedTable]) =>
      fkTable === table && fkName === constraint && action === onDelete && referencedTable === 'canales_origen'));
  }
  const migration = (await readMigrations()).at(-1);
  assert.equal(migration.name, name);
  assert.equal(migration.statements.length, 1);
  const rename = migration.statements[0].match(/^RENAME TABLE ([A-Za-z0-9_]+) TO ([A-Za-z0-9_]+)$/i);
  assert.ok(rename);
  assert.equal(rename[2], 'canales_origen');
  assert.notEqual(rename[1], rename[2]);
  assert.doesNotMatch(migration.statements.join('\n'), /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
});
