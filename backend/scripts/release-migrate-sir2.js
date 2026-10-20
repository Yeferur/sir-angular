// CRITICAL: Database `sir` and PM2 process `app` belong to the current
// production system and must never be modified by this release.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { diagnoseConnection } = require('./diagnose-validation-disponibilidad');

const TARGET_DATABASE = 'sir2';
const MIGRATIONS = Object.freeze([
  '20261012_0001_schema_migrations.sql',
  '20260911_p0_permissions_notifications.sql',
  '20260911_pendientes_recordatorios_mvp.sql',
  '20260813_email_outbox.sql',
  '20260920_revision_cache_permisos.sql',
  '20260921_programacion_cambios_pendientes.sql',
  '20260922_app_updates_notifications.sql',
  '20260922_reminder_email.sql',
  '20260929_programacion_transfers_snapshot.sql',
  '20260930_runtime_schema.sql',
  '20261010_mercadeo_reservas.sql',
  '20261012_0002_permission_catalog_revision.sql',
  '20261013_0003_soft_delete_and_roles_mysql.sql',
  '20261013_0004_chat_schema_mysql.sql',
  '20261012_0005_programacion_manual.sql',
  '20261012_0006_tour_comisiones_innodb.sql',
  '20261013_0008_tour_comisiones_fks.sql',
  '20261012_0007_ia_tables_innodb.sql',
  '20261013_0009_ia_tool_runs_fk.sql',
  '20261013_0011_financial_restrict_fks_mysql.sql',
  '20261013_0012_entidades_reportantes.sql',
  '20261013_0013_entidades_mercadeo.sql',
  '20261013_0014_final_authoring_audit_schema.sql',
  '20261016_0015_perfiles_comision_entidad.sql',
]);

function assertTargetConfiguration(env) {
  const names = [env.DB_NAME, env.DB_DATABASE].filter(value => value !== undefined && value !== null && value !== '');
  if (!names.length || names.some(name => name !== TARGET_DATABASE)) {
    throw new Error('Destino rechazado: la configuración debe seleccionar exactamente sir2.');
  }
}

function assertConnectedDatabase(database) {
  if (database !== TARGET_DATABASE) {
    throw new Error('Destino rechazado: SELECT DATABASE() no devolvió exactamente sir2.');
  }
}

function assertConfirmation(args) {
  if (!['--confirm-sir2'].includes(args[0]) || (args.length !== 1 && args.length !== 3)
    || (args.length === 3 && args[1] !== '--through')) {
    throw new Error('Sin --confirm-sir2 no se ejecuta SQL.');
  }
}

function selectMigrationsThrough(migrations, filename) {
  if (!filename) return migrations;
  const index = migrations.findIndex((migration) => migration.name === filename);
  if (index < 0) throw new Error(`Checkpoint desconocido: ${filename}`);
  return migrations.slice(0, index + 1);
}

function findDelimiter(sql, delimiter) {
  let quote = null;
  for (let i = 0; i <= sql.length - delimiter.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === '\\') { i++; continue; }
      if (char === quote) {
        if (sql[i + 1] === quote) { i++; continue; }
        quote = null;
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (sql.startsWith(delimiter, i)) {
      return i;
    }
  }
  return -1;
}

function parseMigrationSql(sql) {
  let delimiter = ';';
  let pending = '';
  const statements = [];
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*(?:--(?:\s|$)|#)/.test(line)) continue;
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      if (pending.trim()) throw new Error('DELIMITER dentro de una sentencia incompleta.');
      delimiter = directive[1];
      continue;
    }
    pending += `${line}\n`;
    let at;
    while ((at = findDelimiter(pending, delimiter)) !== -1) {
      const statement = pending.slice(0, at).trim();
      if (statement) statements.push(statement);
      pending = pending.slice(at + delimiter.length);
    }
  }
  if (pending.trim()) throw new Error('SQL sin delimitador final.');
  return statements;
}

function assertMigrationSafe(sql) {
  if (/\bUSE\s+[`\w]/i.test(sql)
    || /\b(?:CREATE|DROP|ALTER)\s+DATABASE\b/i.test(sql)
    || /(?:\bsir\b|`sir`)\s*\./i.test(sql)
    || /`sir`\s*\.\s*`/i.test(sql)) {
    throw new Error('La migración intenta cambiar de base o referirse a sir.');
  }
}

async function readMigrations() {
  const result = [];
  for (const name of MIGRATIONS) {
    const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8');
    const statements = parseMigrationSql(sql);
    if (!statements.length) throw new Error(`Migración vacía: ${name}`);
    for (const statement of statements) assertMigrationSafe(statement);
    result.push({ name, statements, checksum: crypto.createHash('sha256').update(sql).digest('hex') });
  }
  return result;
}

const CREATE_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  Migration_Id VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Version VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Checksum_SHA256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Estado ENUM('APLICANDO','APLICADA','FALLIDA') NOT NULL,
  Iniciada_En DATETIME(3) NOT NULL,
  Aplicada_En DATETIME(3) NULL,
  Duracion_Ms BIGINT UNSIGNED NULL,
  Paso_Actual VARCHAR(190) NULL,
  Error_Resumen VARCHAR(1000) NULL,
  Aplicada_Por VARCHAR(128) NULL,
  PRIMARY KEY (Migration_Id),
  KEY ix_schema_migrations_estado_fecha (Estado, Iniciada_En)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const REQUIRED_COLUMNS = Object.freeze({
  schema_migrations: ['Migration_Id', 'Checksum_SHA256', 'Estado', 'Paso_Actual'],
  permisos_cache_revision: ['Tipo', 'Id_Entidad', 'Revision'],
  reservas: ['Eliminada_En', 'Eliminada_Por', 'Motivo_Eliminacion', 'Id_Entidad_Reportante'],
  aforos: ['Operacion'],
  chat_conversaciones: ['Tipo', 'Directa_Usuario_Menor', 'Directa_Usuario_Mayor'],
  chat_participantes: ['Id_Conversacion', 'Id_Usuario', 'Ultimo_Mensaje_Leido_Id'],
  chat_mensajes: ['Id_Mensaje', 'Id_Conversacion', 'Id_Remite', 'Cuerpo'],
  programacion_importaciones: ['Id_Importacion', 'Estado', 'Fecha_Creacion'],
  programacion_importacion_archivos: ['Storage_Key', 'SHA256', 'Id_Archivo_Anterior'],
  programacion_listados_manual: ['Parser_Version', 'Numero_Intento', 'Metadata_JSON'],
  programacion_listado_filas_raw: ['Datos_JSON', 'Numero_Fila'],
  programacion_listado_rutas: ['Codigo_Ruta', 'Orden_Bloque'],
  programacion_listado_items: ['Id_Reserva', 'Estado_Match', 'Orden_En_Ruta'],
  programacion_listado_pasajeros: ['Id_Listado_Item', 'Nombre_Snapshot', 'Estado_Match'],
  programacion_exportaciones: ['Id_Exportacion', 'Version_Formato'],
  programacion_exportacion_filas: ['Id_Row', 'Id_Exportacion', 'Snapshot_JSON'],
  entidades_reportantes: ['Id_Entidad_Reportante', 'Tipo', 'Nombre', 'Estado_Validacion', 'Creado_Por', 'Fecha_Creacion'],
  entidad_reportante_puntos: ['Id_Entidad_Reportante', 'Id_Punto', 'Estado_Validacion', 'Validado_Por', 'Validado_En'],
  tours: ['Creado_Por', 'Actualizado_Por'],
  puntos: ['Creado_Por', 'Actualizado_Por'],
  liquidaciones: ['Creado_Por', 'Actualizado_Por', 'Monto_Comision_Pagada'],
  perfiles_comision_entidad: ['Id_Perfil_Comision', 'Id_Entidad_Reportante', 'Forma_Pago', 'Activo', 'Fecha_Registro'],
  programaciones: ['Creado_Por'],
  historial: ['Actor_Nombre', 'Actor_Rol'],
});

const REQUIRED_FKS = Object.freeze([
  ['reservas', 'fk_reservas_eliminada_por', 'SET NULL'],
  ['chat_participantes', 'fk_chat_part_ultimo_mensaje', 'RESTRICT'],
  ['tour_comisiones', 'fk_tour_comisiones_tour', 'RESTRICT'],
  ['tour_comisiones', 'fk_tour_comisiones_canal', 'RESTRICT'],
  ['ia_tool_runs', 'fk_ia_tool_runs_interaccion', 'RESTRICT'],
  ['pagos_reservas', 'fk_pagosreserva_reserva_restrict', 'RESTRICT'],
  ['pagos_transfers', 'fk_pagostransfers_transfer_restrict', 'RESTRICT'],
  ['liquidaciones', 'fk_liquidacion_reserva_restrict', 'RESTRICT'],
  ['reservas', 'fk_reservas_entidad_reportante', 'RESTRICT'],
  ['entidad_reportante_puntos', 'fk_entidad_puntos_entidad', 'RESTRICT'],
  ['entidad_reportante_puntos', 'fk_entidad_puntos_punto', 'RESTRICT'],
  ['tours', 'fk_tours_creado_por', 'SET NULL'],
  ['tours', 'fk_tours_actualizado_por', 'SET NULL'],
  ['puntos', 'fk_puntos_creado_por', 'SET NULL'],
  ['puntos', 'fk_puntos_actualizado_por', 'SET NULL'],
  ['liquidaciones', 'fk_liquidaciones_creado_por', 'SET NULL'],
  ['liquidaciones', 'fk_liquidaciones_actualizado_por', 'SET NULL'],
  ['perfiles_comision_entidad', 'fk_perfiles_comision_entidad', 'RESTRICT'],
  ['perfiles_comision_entidad', 'fk_perfiles_comision_creado_por', 'SET NULL'],
  ['perfiles_comision_entidad', 'fk_perfiles_comision_actualizado_por', 'SET NULL'],
  ['programaciones', 'fk_programaciones_creado_por', 'SET NULL'],
]);

function migrationVersion(name) { return name.match(/^\d{8}_(\d{4})_/)?.[1] || '0000'; }

async function acquireMigrationLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK('sir2_schema_migrations', 0) AS acquired");
  if (Number(row?.acquired) !== 1) throw new Error('Otro runner mantiene el advisory lock de migraciones.');
}

async function releaseMigrationLock(connection) {
  await connection.query("SELECT RELEASE_LOCK('sir2_schema_migrations')");
}

async function ensureLedger(connection, migrations) {
  await connection.query(CREATE_LEDGER_SQL);
  const bootstrap = migrations.find((migration) => migration.name === '20261012_0001_schema_migrations.sql');
  if (!bootstrap) throw new Error('No está incluida la migración bootstrap del ledger.');
  await connection.query(`
    INSERT INTO schema_migrations
      (Migration_Id, Version, Checksum_SHA256, Estado, Iniciada_En, Aplicada_En, Duracion_Ms, Aplicada_Por)
    VALUES (?, ?, ?, 'APLICADA', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), 0, 'release-runner-bootstrap')
    ON DUPLICATE KEY UPDATE
      Checksum_SHA256 = IF(Estado = 'APLICADA', Checksum_SHA256, VALUES(Checksum_SHA256))`,
  [bootstrap.name, migrationVersion(bootstrap.name), bootstrap.checksum]);
}

async function readMigrationStatus(connection, migrations) {
  const [[target]] = await connection.query('SELECT DATABASE() AS db');
  assertConnectedDatabase(target?.db);
  const [tables] = await connection.query(`SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'`);
  if (!tables.length) return migrations.map(({ name, checksum }) => ({ name, checksum, estado: 'PENDIENTE', motivo: 'ledger ausente' }));
  const [rows] = await connection.query(`SELECT Migration_Id, Checksum_SHA256, Estado, Paso_Actual, Error_Resumen
    FROM schema_migrations ORDER BY Migration_Id`);
  const byId = new Map(rows.map((row) => [row.Migration_Id, row]));
  return migrations.map(({ name, checksum }) => {
    const row = byId.get(name);
    if (!row) return { name, checksum, estado: 'PENDIENTE' };
    if (row.Checksum_SHA256 !== checksum) return { name, checksum, estado: 'DRIFT', checksumRegistrado: row.Checksum_SHA256 };
    return { name, checksum, estado: row.Estado, paso: row.Paso_Actual, error: row.Error_Resumen };
  });
}

async function readSchemaDrift(connection) {
  const [rows] = await connection.query(`SELECT TABLE_NAME, COLUMN_NAME
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
  const found = new Map();
  for (const row of rows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!found.get(table)?.has(column)) missing.push(`${table}.${column}`);
    }
  }
  const [engines] = await connection.query(`SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tour_comisiones','ia_interacciones','ia_tool_runs')`);
  const engineDrift = engines.filter((row) => row.ENGINE !== 'InnoDB').map((row) => `${row.TABLE_NAME}:${row.ENGINE}`);
  for (const expected of ['tour_comisiones', 'ia_interacciones', 'ia_tool_runs']) {
    if (!engines.some((row) => row.TABLE_NAME === expected)) missing.push(`${expected} (tabla requerida para conversión)`);
  }
  const [foreignKeys] = await connection.query(`SELECT TABLE_NAME,CONSTRAINT_NAME,DELETE_RULE
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()`);
  const foreignKeyDrift = REQUIRED_FKS.filter(([table, name, deletion]) =>
    !foreignKeys.some((fk) => fk.TABLE_NAME === table && fk.CONSTRAINT_NAME === name && fk.DELETE_RULE === deletion))
    .map(([table, name, deletion]) => `${table}.${name}:${deletion}`);
  return { missing, engineDrift, foreignKeyDrift };
}

async function classifyDatabase(connection) {
  const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
  if (!tables.length) return { kind: 'clean', tables: 0, ready: false };
  const names = new Set(tables.map((row) => row.TABLE_NAME.toLowerCase()));
  const missingFoundation = ['usuarios', 'reservas'].filter((name) => !names.has(name));
  return {
    kind: 'existing',
    tables: tables.length,
    ready: missingFoundation.length === 0,
    missingFoundation,
  };
}

async function applyMigrations(connection, migrations, { verifyFinal = true } = {}) {
  const [[target]] = await connection.query('SELECT DATABASE() AS db');
  assertConnectedDatabase(target?.db);
  // Mandatory read-only gate before the advisory lock, ledger bootstrap, or DDL.
  const availabilityPreflight = await readAvailabilityPreflight(connection);
  const blockingFindings = availabilityPreflight.findings.filter(finding => finding.period !== 'PASADA');
  if (blockingFindings.length || availabilityPreflight.orphanPassengers) {
    console.log(JSON.stringify({ availabilityPreflight }, null, 2));
    throw new Error('Preflight bloqueante: discrepancia de hoy/futura o pasajeros huérfanos; no se inicia ninguna migración.');
  }
  if (availabilityPreflight.discrepancies) console.warn(JSON.stringify({ availabilityWarnings: availabilityPreflight.findings }, null, 2));
  const baseState = await classifyDatabase(connection);
  if (baseState.kind === 'clean') {
    throw new Error('La base está vacía. El baseline de instalación limpia aún no está certificado; no se crea ledger ni se aplica DDL.');
  }
  if (!baseState.ready) {
    throw new Error(`Base existente incompleta; faltan tablas base: ${baseState.missingFoundation.join(', ')}. Se requiere restaurar/comparar copia antes del ledger.`);
  }
  await acquireMigrationLock(connection);
  try {
    await ensureLedger(connection, migrations);
    for (const { name, statements, checksum } of migrations) {
      const [[known]] = await connection.query(
        'SELECT Checksum_SHA256, Estado FROM schema_migrations WHERE Migration_Id = ?', [name]
      );
      if (known && known.Checksum_SHA256 !== checksum) {
        throw new Error(`Checksum distinto para ${name}; las migraciones son inmutables. Prepare una nueva migración de reparación.`);
      }
      if (known?.Estado === 'APLICADA') {
        console.log(`Sin cambios: ${name}`);
        continue;
      }
      if (known) {
        throw new Error(`${name} está ${known.Estado}; inspeccione el último paso antes de reintentar. El runner canónico no repite DDL parcial automáticamente.`);
      }
      const started = Date.now();
      await connection.query(`
        INSERT INTO schema_migrations
          (Migration_Id, Version, Checksum_SHA256, Estado, Iniciada_En, Paso_Actual, Error_Resumen, Aplicada_Por)
        VALUES (?, ?, ?, 'APLICANDO', CURRENT_TIMESTAMP(3), NULL, NULL, ?)
        ON DUPLICATE KEY UPDATE Checksum_SHA256=VALUES(Checksum_SHA256), Estado='APLICANDO',
          Iniciada_En=CURRENT_TIMESTAMP(3), Aplicada_En=NULL, Error_Resumen=NULL`,
      [name, migrationVersion(name), checksum, process.env.USERNAME || process.env.USER || 'release-runner']);
      try {
        for (const [index, statement] of statements.entries()) {
          await connection.query(statement);
          await connection.query('UPDATE schema_migrations SET Paso_Actual = ? WHERE Migration_Id = ?', [`${index + 1}/${statements.length}`, name]);
        }
        await connection.query(`UPDATE schema_migrations
          SET Estado='APLICADA', Aplicada_En=CURRENT_TIMESTAMP(3), Duracion_Ms=?, Paso_Actual=NULL, Error_Resumen=NULL
          WHERE Migration_Id=? AND Checksum_SHA256=?`, [Date.now() - started, name, checksum]);
        console.log(`Migración aplicada: ${name}`);
      } catch (error) {
        await connection.query(`UPDATE schema_migrations
          SET Estado='FALLIDA', Duracion_Ms=?, Error_Resumen=?, Paso_Actual=COALESCE(Paso_Actual, 'inicio')
          WHERE Migration_Id=?`, [Date.now() - started, String(error.code || error.message).slice(0, 1000), name]);
        throw new Error(`${name}: ${error.code || error.message}; quedó registrada como FALLIDA para inspección/reanudación.`);
      }
    }
    if (verifyFinal) {
      const drift = await readSchemaDrift(connection);
      if (drift.missing.length || drift.engineDrift.length || drift.foreignKeyDrift.length) {
        throw new Error(`Drift después de migraciones. Faltan: ${drift.missing.join(', ') || 'ninguna'}; motores: ${drift.engineDrift.join(', ') || 'ninguno'}; FKs: ${drift.foreignKeyDrift.join(', ') || 'ninguna'}`);
      }
    }
  } finally {
    await releaseMigrationLock(connection);
  }
}

async function readAvailabilityPreflight(connection) {
  const [[target]] = await connection.query('SELECT DATABASE() AS db');
  assertConnectedDatabase(target?.db);
  await connection.query('START TRANSACTION READ ONLY');
  try {
    return await diagnoseConnection(connection, TARGET_DATABASE);
  } finally {
    await connection.rollback();
  }
}

async function main(args = process.argv.slice(2)) {
  const mode = args[0] || '--plan';
  if (mode === '--confirm-sir2') {
    assertConfirmation(args);
  } else if (!['--plan', '--status', '--preflight-disponibilidad'].includes(mode) || args.length !== 1) {
    throw new Error('Uso: --plan | --status | --preflight-disponibilidad | --confirm-sir2 [--through <archivo.sql>]');
  }
  const migrations = await readMigrations();
  if (mode === '--plan') {
    console.log(JSON.stringify(migrations.map(({ name, checksum, statements }) => ({ name, checksum, statements: statements.length })), null, 2));
    return;
  }
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assertTargetConfiguration(process.env);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: TARGET_DATABASE,
    multipleStatements: false,
  });
  try {
    const [[target]] = await connection.query('SELECT DATABASE() AS db');
    assertConnectedDatabase(target?.db);
    if (mode === '--preflight-disponibilidad') {
      console.log(JSON.stringify(await readAvailabilityPreflight(connection), null, 2));
      return;
    }
    if (mode === '--status') {
      console.log(JSON.stringify({
        databaseState: await classifyDatabase(connection),
        availabilityPreflight: await readAvailabilityPreflight(connection),
        migrations: await readMigrationStatus(connection, migrations),
        schemaDrift: await readSchemaDrift(connection),
      }, null, 2));
      return;
    }
    const through = args.length === 3 ? args[2] : null;
    const selectedMigrations = selectMigrationsThrough(migrations, through);
    console.log('TARGET DATABASE: sir2');
    console.log(`CHECKPOINT: ${selectedMigrations.at(-1)?.name || 'ninguno'}`);
    await applyMigrations(connection, selectedMigrations, { verifyFinal: !through });
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  TARGET_DATABASE, MIGRATIONS, assertTargetConfiguration,
  assertConnectedDatabase, assertConfirmation, selectMigrationsThrough, parseMigrationSql,
  assertMigrationSafe, readMigrations, applyMigrations, readMigrationStatus,
  readSchemaDrift, migrationVersion, CREATE_LEDGER_SQL, REQUIRED_COLUMNS, REQUIRED_FKS,
  classifyDatabase,
  readAvailabilityPreflight,
};
