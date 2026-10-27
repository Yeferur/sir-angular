'use strict';

// Step 5 rehearsal only. Default mode is read-only. This script never falls
// back to another MySQL connection or database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('../database/db');
const reservas = require('../services/Reservas/reservas.service');
const transfers = require('../services/Transfers/transfers.service');
const entities = require('../services/EntidadesReportantes/entidades-reportantes.service');
const entityActivity = require('../services/EntidadesReportantes/entidades-mercadeo.service');
const confirmacion = require('../services/Confirmacion/confirmacion.service');
const programacionNovedades = require('../services/Programacion/programacion-novedades.service');
const mercadeo = require('../services/Mercadeo/mercadeo.service');
const comisiones = require('../services/Comisiones/comisiones.service');
const comisionGrupos = require('../services/Comisiones/comisiones-grupos.service');
const listadoGeneral = require('../services/Programacion/listado-general.service');
const pendientesJob = require('../jobs/pendientes.job');

const BACKUP_DIR = path.resolve(__dirname, '../database/backups');
const COUNTS_PATH = path.join(BACKUP_DIR, 'sir2-step5-20261026T074450Z.counts.json');
const SQL_BACKUP_PATH = path.join(BACKUP_DIR, 'sir2-step5-20261026T074450Z.sql');
const EXPECTED_BACKUP_SHA256 = '6a0aa089d725876f58809bf774ad0910ff6c6675f297d56eb3d4f9f27ec3e007';
const DEFAULT_RUN_ID = '20261026_smoke01';
const TEMP_DATE = '2026-11-20';
const FINAL_DATE = '2026-10-17';
const REGISTRATION_DATE = '2026-10-10 12:00:00';
const MYSQL_TEMPORAL_TYPES = new Set(['date', 'datetime', 'timestamp', 'time', 'year']);
let columnMetadataByTable = new Map();

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function selectColumnPreservingMysqlDate(table, column, dataType) {
  const identifier = quoteIdentifier(column);
  if (!MYSQL_TEMPORAL_TYPES.has(String(dataType || '').toLowerCase())) return identifier;
  return `CAST(${identifier} AS CHAR) AS ${identifier}`;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function installProcessOutputLog(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `\n=== Inicio ${new Date().toISOString()} ===\n`, 'utf8');
  for (const [streamName, stream] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk, ...args) => {
      const encoding = typeof args[0] === 'string' ? args[0] : 'utf8';
      const output = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${streamName}] ${output}`, 'utf8');
      return originalWrite(chunk, ...args);
    };
  }
}

function serializeError(error) {
  return {
    message: String(error?.message || error || 'Error desconocido'),
    stack: error?.stack ? String(error.stack) : null,
    code: error?.code == null ? null : String(error.code),
  };
}

function parseArgs(argv) {
  const args = { mode: '--dry-run', manifest: null, runId: DEFAULT_RUN_ID };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (['--dry-run', '--rehearse', '--cleanup-dry-run', '--cleanup'].includes(item)) args.mode = item;
    else if (item === '--manifest') args.manifest = argv[++index] || null;
    else if (item === '--run-id') args.runId = String(argv[++index] || '').trim();
    else throw new Error(`Opción no reconocida: ${item}`);
  }
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(args.runId)) throw new Error('El identificador de ejecución no es válido.');
  if (['--cleanup-dry-run', '--cleanup'].includes(args.mode) && !args.manifest) throw new Error(`${args.mode} requiere --manifest <ruta>.`);
  return args;
}

async function assertSir2() {
  const [[identity]] = await db.query("SELECT DATABASE() AS databaseName, CURRENT_USER() AS mysqlUser, DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS today");
  if (identity?.databaseName !== 'sir2') {
    throw new Error(`Guardia de conexión: la base activa es ${identity?.databaseName || '(ninguna)'}, no sir2. No se escribió nada.`);
  }
  if (String(identity.today) !== '2026-10-26') {
    throw new Error(`Guardia de fecha: sir2 reporta ${String(identity.today)}, no 2026-10-26. No se escribió nada.`);
  }
  return identity;
}

async function tableNames() {
  const [rows] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  return rows.map(row => row.TABLE_NAME);
}

async function countSnapshot() {
  const result = [];
  for (const table of await tableNames()) {
    const [[row]] = await db.query(`SELECT COUNT(*) AS rowsCount FROM ${quoteIdentifier(table)}`);
    result.push({ table, rows: Number(row.rowsCount) });
  }
  return result;
}

function compareCounts(expected, actual) {
  const expectedMap = new Map((expected || []).map(row => [row.table, Number(row.rows)]));
  const actualMap = new Map((actual || []).map(row => [row.table, Number(row.rows)]));
  const names = [...new Set([...expectedMap.keys(), ...actualMap.keys()])].sort();
  return names.flatMap(table => {
    const before = expectedMap.get(table);
    const after = actualMap.get(table);
    return before === after ? [] : [{ table, before: before ?? null, after: after ?? null }];
  });
}

async function primaryKeyMetadata() {
  const [tables] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  const [columns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='PRIMARY'
    ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const [allColumns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`);
  columnMetadataByTable = new Map();
  for (const row of allColumns) {
    if (!columnMetadataByTable.has(row.TABLE_NAME)) columnMetadataByTable.set(row.TABLE_NAME, new Map());
    columnMetadataByTable.get(row.TABLE_NAME).set(row.COLUMN_NAME, row.DATA_TYPE);
  }
  const map = new Map();
  for (const row of columns) {
    if (!map.has(row.TABLE_NAME)) map.set(row.TABLE_NAME, []);
    map.get(row.TABLE_NAME).push(row.COLUMN_NAME);
  }
  const noPrimaryKey = tables.map(row => row.TABLE_NAME).filter(name => !map.has(name));
  if (noPrimaryKey.length) throw new Error(`No se puede crear un manifiesto exacto: tablas sin PK: ${noPrimaryKey.join(', ')}`);
  return Object.fromEntries(tables.map(row => [row.TABLE_NAME, map.get(row.TABLE_NAME)]));
}

async function capturePrimaryKeys(metadata) {
  const tables = {};
  for (const [table, columns] of Object.entries(metadata)) {
    const select = columns.map(column => selectColumnPreservingMysqlDate(
      table, column, columnMetadataByTable.get(table)?.get(column),
    )).join(',');
    const [rows] = await db.query(`SELECT ${select} FROM ${quoteIdentifier(table)}`);
    tables[table] = rows.map(row => columns.map(column => row[column] == null ? null : String(row[column])));
  }
  return { database: 'sir2', capturedAt: new Date().toISOString(), primaryKeys: metadata, tables };
}

function keySignature(values) { return JSON.stringify(values); }

function diffPrimaryKeys(before, after) {
  const result = {};
  for (const table of Object.keys(after.tables)) {
    const oldKeys = new Set((before.tables[table] || []).map(keySignature));
    const fresh = (after.tables[table] || []).filter(values => !oldKeys.has(keySignature(values)));
    if (fresh.length) result[table] = fresh;
  }
  return result;
}

function loadSnapshot() {
  if (!fs.existsSync(COUNTS_PATH) || !fs.existsSync(SQL_BACKUP_PATH)) {
    throw new Error('No se encontró el snapshot de conteos o el backup SQL previo.');
  }
  const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(SQL_BACKUP_PATH)).digest('hex');
  if (expectedHash !== EXPECTED_BACKUP_SHA256) throw new Error('El SHA-256 del backup no coincide; no se escribirá en la BD.');
  return JSON.parse(fs.readFileSync(COUNTS_PATH, 'utf8'));
}

async function assertPreflight(snapshot) {
  const identity = await assertSir2();
  const current = await countSnapshot();
  const differences = compareCounts(snapshot.counts, current);
  if (differences.length) throw new Error(`El conteo de sir2 difiere del snapshot: ${JSON.stringify(differences)}`);
  const [[entitiesCount]] = await db.query(`SELECT COUNT(*) AS count,
    SUM(Tipo='AGENCIA_NACIONAL') AS national,
    SUM(Tipo='AGENCIA_INTERNACIONAL') AS international,
    SUM(Nombre LIKE 'ZZ_TEST\\_%') AS testRows
    FROM entidades_reportantes WHERE Activo=1 AND Estado_Validacion<>'RECHAZADA'`);
  const [[channelCount]] = await db.query(`SELECT COUNT(*) AS total,
    SUM(Id_Canal=11 AND UPPER(Nombre_Canal)='TIKTOK' AND Tiene_Comision=0) AS validTikTok
    FROM canales_origen`);
  const [[commissionCount]] = await db.query('SELECT COUNT(*) AS total FROM tour_comisiones');
  const [[reservationCount]] = await db.query('SELECT COUNT(*) AS total FROM reservas');
  const [[transferCount]] = await db.query('SELECT COUNT(*) AS total FROM transfers');
  if (Number(entitiesCount.count) !== 422 || Number(entitiesCount.testRows) !== 0) throw new Error('Guardia de entidades: no coincide 422/0 ZZ_TEST_.');
  if (Number(channelCount.total) !== 11 || Number(channelCount.validTikTok) !== 1) throw new Error('Guardia de canales: TIKTOK o el total de canales difiere del esperado.');
  if (Number(commissionCount.total) !== 27) throw new Error('Guardia de tour_comisiones: el total no es 27.');
  if (Number(reservationCount.total) !== 0 || Number(transferCount.total) !== 0) throw new Error('Guardia inicial: ya hay reservas o transfers; no se escribirá.');
  const [actors] = await db.query(`SELECT u.Id_Usuario,u.Nombres_Apellidos
    FROM usuarios u INNER JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE u.Activo=1 AND LOWER(TRIM(r.Nombre_Rol))='asesor' ORDER BY u.Id_Usuario`);
  if (!actors.length) throw new Error('No hay un asesor activo para atribuir la prueba.');
  return {
    identity,
    counts: current,
    countsTotal: current.reduce((sum, row) => sum + row.rows, 0),
    entities: { activeValidated: Number(entitiesCount.count), national: Number(entitiesCount.national), international: Number(entitiesCount.international), zzTest: Number(entitiesCount.testRows) },
    channels: { total: Number(channelCount.total), tiktokId11NoCommission: Number(channelCount.validTikTok) === 1 },
    tourCommissions: Number(commissionCount.total),
    reservations: Number(reservationCount.total),
    transfers: Number(transferCount.total),
    actors: actors.map(row => ({ Id_Usuario: Number(row.Id_Usuario), Nombres_Apellidos: row.Nombres_Apellidos })),
  };
}

async function loadReservationInputs() {
  const [[realEntity]] = await db.query(`SELECT Id_Entidad_Reportante,Tipo,Nombre
    FROM entidades_reportantes WHERE Tipo='AGENCIA_NACIONAL' AND Activo=1
      AND Estado_Validacion='VALIDADA' ORDER BY Id_Entidad_Reportante LIMIT 1`);
  const [[hour]] = await db.query('SELECT Id_Horario,Id_Punto FROM horarios WHERE Id_Tour=2 ORDER BY Id_Horario LIMIT 1');
  const [prices] = await db.query(`SELECT Tipo_Pasajero,Precio FROM tour_precios
    WHERE Id_Tour=2 AND Id_Plan=33 AND Id_Moneda=1`);
  const [commissions] = await db.query(`SELECT Id_Canal,Valor FROM tour_comisiones
    WHERE Id_Tour=2 AND Id_Canal IN (2,4)`);
  if (!realEntity || !hour || prices.length < 3 || commissions.length !== 2) throw new Error('Faltan entidad válida, horario, precios o comisiones para el ensayo.');
  return {
    realEntity,
    hour,
    prices: Object.fromEntries(prices.map(row => [String(row.Tipo_Pasajero).toUpperCase(), Number(row.Precio)])),
    commissions: Object.fromEntries(commissions.map(row => [Number(row.Id_Canal), Number(row.Valor)])),
  };
}

function passenger(index, type, inputs, confirmation) {
  const normalized = String(type).toUpperCase();
  const phoneSerial = String(7000000000 + index).slice(-10);
  const documentSerial = String(9900000000 + index);
  const commission = normalized === 'INFANTE' || ![2, 4].includes(Number(inputs.channelId))
    ? 0
    : Number(inputs.commissions[Number(inputs.channelId)] || 0);
  return {
    Nombre_Pasajero: `Pasajero Sintetico ${index}`,
    DNI: documentSerial,
    Nacionalidad: 'Colombiana',
    Telefono_Pasajero: `+57${phoneSerial}`,
    Tipo_Pasajero: normalized,
    Id_Plan: 33,
    Precio_Tour: Number(inputs.prices[normalized] || 0),
    Precio_Pasajero: Number(inputs.prices[normalized] || 0),
    Comision: commission,
    Id_Punto: Number(inputs.hour.Id_Punto),
    Confirmacion: confirmation ? 1 : 0,
  };
}

async function createReservation({ runId, actorId, entityId, reporterName, sequence, marker, inputs, fechaTour = TEMP_DATE }) {
  const channelId = 2;
  const commissionInputs = { ...inputs, channelId };
  const payload = {
    cabeceraReserva: {
      Id_Tour: 2,
      Id_Horario: Number(inputs.hour.Id_Horario),
      Fecha_Tour: fechaTour,
      Tipo_Reserva: 'Grupal',
      Id_Canal: channelId,
      Id_Entidad_Reportante: entityId,
      Id_Moneda: 1,
      Idioma_Reserva: 'ESPAÑOL',
      Telefono_Reportante: '+573990000101',
      Nombre_Reportante: reporterName,
      Observaciones: marker,
      Id_Punto: Number(inputs.hour.Id_Punto),
    },
    pasajeros: [passenger(sequence * 2, 'ADULTO', commissionInputs, true), passenger(sequence * 2 + 1, 'NIÑO', commissionInputs, false)],
    pagos: [{ Tipo: 'Pago Directo', Monto: 0, Observaciones: 'Pago en el punto; prueba de carga.' }],
  };
  const created = await reservas.crearReservaConPasajerosYPagos(payload, {}, actorId);
  const [[row]] = await db.query(`SELECT Id_Reserva,Estado,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      Id_Canal,Id_Entidad_Reportante,Observaciones
    FROM reservas WHERE Id_Reserva=? LIMIT 1`, [created.Id_Reserva]);
  if (!row) throw new Error(`El servicio creó ${created.Id_Reserva} pero no se pudo releer.`);
  if (!['Confirmada', 'Completada'].includes(row.Estado)) throw new Error(`Reserva ${row.Id_Reserva}: estado inesperado ${row.Estado}.`);
  return row;
}

async function createTransfer({ actorId, channelId, entityId, holder, marker, serial }) {
  const payload = {
    Id_Canal: channelId,
    Id_Entidad_Reportante: entityId,
    Titular: holder,
    DNI: String(9800000000 + serial),
    Tel_Contacto: `+573990001${String(serial).padStart(3, '0')}`,
    Cantidad_Personas: 2,
    Servicio: 1,
    Salida: 'AEROPUERTO JOSE MARIA CORDOVA',
    Llegada: 'HOTEL FICTICIO MEDELLIN',
    FechaTransfer: '2026-11-21',
    HoraRecogida: '10:30 AM',
    NombreReporta: `Reportante sintetico ${serial}`,
    TelefonoTransfer: `+573990002${String(serial).padStart(3, '0')}`,
    Moneda: 'COP',
    Pago: { Tipo: 'PagaEnPunto', Observaciones: 'Pago en el punto; prueba de carga.' },
    Observaciones: marker,
  };
  const created = await transfers.crearTransferSvc(payload, { userId: actorId });
  const [[row]] = await db.query(`SELECT Id_Transfer,
      CONCAT('TRS', LPAD(Id_Transfer, 5, '0')) AS Codigo_Transfer,
      Estado,DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      Id_Canal,Id_Entidad_Reportante,Observaciones,Nombre_Titular
    FROM transfers WHERE Id_Transfer=? LIMIT 1`, [created.Id_Transfer]);
  if (!row) throw new Error(`El servicio creó transfer ${created.Id_Transfer} pero no se pudo releer.`);
  if (!created.Codigo_Transfer || row.Codigo_Transfer !== created.Codigo_Transfer) {
    throw new Error(`Código de transfer inconsistente para ${created.Id_Transfer}: servicio=${created.Codigo_Transfer || '(vacío)'}, BD/renderizado=${row.Codigo_Transfer || '(vacío)'}.`);
  }
  const expected = Number(channelId) === 2 ? 'Confirmado' : 'Confirmado';
  if (row.Estado !== expected) throw new Error(`Transfer ${row.Id_Transfer}: estado esperado Confirmado, recibido ${row.Estado}.`);
  return row;
}

async function queryRowsByKeys(table, columns, keys) {
  if (!keys?.length) return [];
  const tableColumns = columnMetadataByTable.get(table);
  if (!tableColumns) throw new Error(`No se cargó metadata de columnas para ${table}.`);
  const select = [...tableColumns.entries()].map(([column, dataType]) =>
    selectColumnPreservingMysqlDate(table, column, dataType)).join(',');
  const predicates = keys.map(() => `(${columns.map(column => `${quoteIdentifier(column)}=?`).join(' AND ')})`).join(' OR ');
  const params = keys.flatMap(key => key);
  const [rows] = await db.query(`SELECT ${select} FROM ${quoteIdentifier(table)} WHERE ${predicates}`, params);
  return rows;
}

async function captureNewRows(before, after, metadata) {
  const keyDiff = diffPrimaryKeys(before, after);
  const rowsByTable = {};
  for (const [table, keys] of Object.entries(keyDiff)) {
    rowsByTable[table] = await queryRowsByKeys(table, metadata[table], keys);
  }
  return { keyDiff, rowsByTable };
}

async function writeManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();
  atomicJson(manifestPath, manifest);
}

async function runPendingJobTracked(manifest, manifestPath, stage) {
  const startedAt = new Date().toISOString();
  manifest.pendingJobRuns ||= [];
  manifest.state = 'PENDIENTES_JOB_START';
  manifest.pendingJob = { state: 'STARTED', stage, startedAt };
  await writeManifest(manifestPath, manifest);
  console.log(JSON.stringify({ event: 'PENDIENTES_JOB_START', stage, startedAt }));

  try {
    const result = await pendientesJob.ejecutarPendientes();
    const finishedAt = new Date().toISOString();
    const run = {
      state: 'DONE', stage, startedAt, finishedAt, result: result ?? null,
      ...(result === null ? { warning: 'ejecutarPendientes resolvió null; revisar stderr del log porque el job captura errores internos.' } : {}),
    };
    manifest.state = 'PENDIENTES_JOB_DONE';
    manifest.pendingJob = run;
    manifest.pendingJobRuns.push(run);
    await writeManifest(manifestPath, manifest);
    console.log(JSON.stringify({ event: 'PENDIENTES_JOB_DONE', stage, finishedAt, result: result ?? null }));
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const serializedError = serializeError(error);
    const run = { state: 'FAILED', stage, startedAt, finishedAt, error: serializedError };
    manifest.state = 'PENDIENTES_JOB_FAILED';
    manifest.pendingJob = run;
    manifest.pendingJobRuns.push(run);
    await writeManifest(manifestPath, manifest);
    console.error(JSON.stringify({ event: 'PENDIENTES_JOB_FAILED', stage, finishedAt, error: serializedError }));
    throw error;
  }
}

async function controlledSql(manifest, manifestPath, createdReservations, createdTransfers, metadata, beforeKeys) {
  const availabilityKeys = [
    { Id_Tour: 2, Fecha_Tour: TEMP_DATE },
    { Id_Tour: 2, Fecha_Tour: FINAL_DATE },
  ];
  const availabilityOriginal = [];
  for (const key of availabilityKeys) {
    const [[row]] = await db.query(`SELECT Id_Disponibilidad,Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      Cupos_Totales,Cupos_Disponibles,DATE_FORMAT(Updated_At,'%Y-%m-%d %H:%i:%s.%f') AS Updated_At
      FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=? LIMIT 1`,
    [key.Id_Tour, key.Fecha_Tour]);
    availabilityOriginal.push({ key, before: row || null });
  }
  manifest.controlledSql.availability.push(...availabilityOriginal);
  const reservationOriginals = [];
  for (const row of createdReservations) {
    const [[current]] = await db.query(`SELECT Id_Reserva,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,Estado
      FROM reservas WHERE Id_Reserva=? LIMIT 1`, [row.Id_Reserva]);
    reservationOriginals.push(current);
  }
  const transferOriginals = [];
  for (const row of createdTransfers) {
    const [[current]] = await db.query(`SELECT Id_Transfer,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro
      FROM transfers WHERE Id_Transfer=? LIMIT 1`, [row.Id_Transfer]);
    transferOriginals.push(current);
  }
  manifest.controlledSql.reservationsBefore = reservationOriginals;
  manifest.controlledSql.transfersBefore = transferOriginals;
  await writeManifest(manifestPath, manifest);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const ids = createdReservations.map(row => row.Id_Reserva);
    if (!ids.length || ids.some(id => !/^[A-Za-z0-9_-]+$/.test(String(id)))) throw new Error('Los IDs del ensayo no son seguros para mover.');
    const marks = ids.map(() => '?').join(',');
    const [moved] = await conn.query(`UPDATE reservas SET Fecha_Tour=?,Fecha_Registro=?
      WHERE Id_Reserva IN (${marks}) AND Fecha_Tour=?`, [FINAL_DATE, REGISTRATION_DATE, ...ids, TEMP_DATE]);
    if (Number(moved.affectedRows) !== ids.length) throw new Error(`Movimiento de fecha: afectadas ${moved.affectedRows}, esperadas ${ids.length}.`);

    const [[occupancy]] = await conn.query(`SELECT COALESCE(SUM(CASE WHEN UPPER(TRIM(p.Tipo_Pasajero)) IN ('ADULTO','NIÑO','NINO') THEN 1 ELSE 0 END),0) AS seats
      FROM reservas r INNER JOIN horarios h ON h.Id_Horario=r.Id_Horario
      INNER JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      WHERE h.Id_Tour=2 AND r.Fecha_Tour=? AND UPPER(TRIM(r.Tipo_Reserva))='GRUPAL'
        AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO')`, [FINAL_DATE]);
    const seats = Number(occupancy.seats || 0);
    if (seats > 380) throw new Error(`Ocupación ${seats} supera capacidad Guatapé 380.`);
    await conn.query(`INSERT INTO disponibilidad (Id_Tour,Fecha_Tour,Cupos_Totales,Cupos_Disponibles)
      VALUES (2,?,380,?) ON DUPLICATE KEY UPDATE Cupos_Totales=VALUES(Cupos_Totales),
      Cupos_Disponibles=VALUES(Cupos_Disponibles),Updated_At=CURRENT_TIMESTAMP(3)`, [FINAL_DATE, 380 - seats]);
    const [deletedTemporary] = await conn.query('DELETE FROM disponibilidad WHERE Id_Tour=2 AND Fecha_Tour=?', [TEMP_DATE]);
    if (Number(deletedTemporary.affectedRows) > 1) throw new Error('Se borró más de una disponibilidad temporal.');

    for (const row of createdTransfers) {
      await conn.query('UPDATE transfers SET Fecha_Registro=? WHERE Id_Transfer=?', [REGISTRATION_DATE, row.Id_Transfer]);
    }
    await conn.commit();
    manifest.controlledSql.dateMove = {
      from: TEMP_DATE, to: FINAL_DATE, reservationIds: ids,
      rowsUpdated: Number(moved.affectedRows), seats, capacity: 380,
      availabilityAfter: { Id_Tour: 2, Fecha_Tour: FINAL_DATE, Cupos_Totales: 380, Cupos_Disponibles: 380 - seats },
      temporaryAvailabilityDeleted: Number(deletedTemporary.affectedRows),
    };
    manifest.controlledSql.registerDateAfter = { reservations: ids.map(Id_Reserva => ({ Id_Reserva, Fecha_Registro: REGISTRATION_DATE })),
      transfers: createdTransfers.map(row => ({ Id_Transfer: row.Id_Transfer, Fecha_Registro: REGISTRATION_DATE })) };
    await writeManifest(manifestPath, manifest);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }

  // The non-awaited app hook is drained explicitly for each changed reservation.
  for (const row of createdReservations) {
    await programacionNovedades.syncForReservationChange({ reservationId: row.Id_Reserva, fecha: FINAL_DATE });
  }
  const states = await reservas.actualizarEstadosReservasVencidas();
  manifest.stateNormalization = states;
  await writeManifest(manifestPath, manifest);

  // Create the attendance confirmation through the app service before the
  // controlled timestamp update below. The service is what creates the row.
  const attendancePassengers = await confirmacion.obtenerPasajerosPorTour(2, FINAL_DATE);
  if (attendancePassengers.length !== 8) throw new Error(`Asistencia de ensayo: se esperaban 8 pasajeros, hay ${attendancePassengers.length}.`);
  const attendance = await confirmacion.actualizarConfirmacion({
    Id_Tour: 2, Fecha: FINAL_DATE,
    // This rehearsal needs a fully closed historical journey so the
    // commission-group payment path can be exercised safely.
    pasajeros: attendancePassengers.map(row => ({ Id_Pasajero: Number(row.Id_Pasajero), Confirmacion: 1 })),
  }, manifest.actorId);

  // The service call above must have created the journey row before the
  // script is allowed to set its historical Confirmada_En value.
  const [[journey]] = await db.query(`SELECT Id_Confirmacion,Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
    Total_Pasajeros,Total_Viajaron,Total_No_Viajaron,
    DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En,Confirmada_Por
    FROM confirmaciones_jornada WHERE Id_Tour=2 AND Fecha_Tour=? LIMIT 1`, [FINAL_DATE]);
  if (!journey) throw new Error('actualizarConfirmacion no generó una fila en confirmaciones_jornada.');
  manifest.attendance = { Id_Tour: 2, Fecha: FINAL_DATE,
    serviceResult: attendance,
    passengerCount: attendancePassengers.length };
  manifest.controlledSql.journeyBefore = { Id_Confirmacion: journey.Id_Confirmacion, Confirmada_En: journey.Confirmada_En };
  await writeManifest(manifestPath, manifest);

  // Timestamp every history event created by the rehearsal, including the
  // attendance service call above.
  const [historyRows] = await db.query(`SELECT h.Id_Historial,h.Tabla,h.Id_Registro,h.Accion,
    DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s.%f') AS Fecha_Hora_Registro
    FROM historial h WHERE h.Tabla IN ('reservas','transfers','entidades_reportantes','pasajeros')
    AND h.Fecha_Hora_Registro >= ? ORDER BY h.Id_Historial`, ['2026-10-26 00:00:00']);
  const baselineHistory = new Set((beforeKeys.tables.historial || []).map(keySignature));
  const freshHistory = historyRows.filter(row => !baselineHistory.has(keySignature([String(row.Id_Historial)])));
  if (freshHistory.length) {
    manifest.controlledSql.historyBefore = freshHistory.map(row => ({ Id_Historial: Number(row.Id_Historial), Fecha_Hora_Registro: row.Fecha_Hora_Registro }));
    const ids = freshHistory.map(row => Number(row.Id_Historial));
    await db.query(`UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial IN (${ids.map(() => '?').join(',')})`,
      [`${FINAL_DATE} 12:00:00`, ...ids]);
    manifest.controlledSql.historyAfter = ids.map(Id_Historial => ({ Id_Historial, Fecha_Hora_Registro: `${FINAL_DATE} 12:00:00` }));
  }

  const journeyDate = `${FINAL_DATE} 13:00:00`;
  const [journeyUpdate] = await db.query('UPDATE confirmaciones_jornada SET Confirmada_En=? WHERE Id_Confirmacion=?', [journeyDate, journey.Id_Confirmacion]);
  if (Number(journeyUpdate.affectedRows) !== 1) throw new Error(`Confirmada_En: filas afectadas ${journeyUpdate.affectedRows}, esperado 1.`);
  const [[journeyAfter]] = await db.query(`SELECT Id_Confirmacion,DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En
    FROM confirmaciones_jornada WHERE Id_Confirmacion=? LIMIT 1`, [journey.Id_Confirmacion]);
  if (!journeyAfter || journeyAfter.Confirmada_En !== journeyDate) throw new Error('No se verificó el valor histórico de Confirmada_En.');
  manifest.controlledSql.journeyAfter = { Id_Confirmacion: Number(journeyAfter.Id_Confirmacion), Confirmada_En: journeyAfter.Confirmada_En };
  await writeManifest(manifestPath, manifest);
}

async function moveAdjustmentReservationToFinalDate(row, manifest, manifestPath) {
  const availabilityBefore = [];
  for (const date of [TEMP_DATE, FINAL_DATE]) {
    const [[current]] = await db.query(`SELECT Id_Disponibilidad,Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      Cupos_Totales,Cupos_Disponibles,DATE_FORMAT(Updated_At,'%Y-%m-%d %H:%i:%s.%f') AS Updated_At
      FROM disponibilidad WHERE Id_Tour=2 AND Fecha_Tour=? LIMIT 1`, [date]);
    availabilityBefore.push({ Id_Tour: 2, Fecha_Tour: date, row: current || null });
  }

  const conn = await db.getConnection();
  let seats;
  let deletedTemporary;
  try {
    await conn.beginTransaction();
    const [moved] = await conn.query(`UPDATE reservas SET Fecha_Tour=?,Fecha_Registro=?
      WHERE Id_Reserva=? AND Fecha_Tour=?`, [FINAL_DATE, REGISTRATION_DATE, row.Id_Reserva, TEMP_DATE]);
    if (Number(moved.affectedRows) !== 1) throw new Error(`Ajuste de comisión: no se movió ${row.Id_Reserva} desde ${TEMP_DATE}.`);
    const [[occupancy]] = await conn.query(`SELECT COALESCE(SUM(CASE WHEN UPPER(TRIM(p.Tipo_Pasajero)) IN ('ADULTO','NIÑO','NINO') THEN 1 ELSE 0 END),0) AS seats
      FROM reservas r INNER JOIN horarios h ON h.Id_Horario=r.Id_Horario
      INNER JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      WHERE h.Id_Tour=2 AND r.Fecha_Tour=? AND UPPER(TRIM(r.Tipo_Reserva))='GRUPAL'
        AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO')`, [FINAL_DATE]);
    seats = Number(occupancy.seats || 0);
    if (seats > 380) throw new Error(`Ocupación de ajuste ${seats} supera capacidad Guatapé 380.`);
    await conn.query(`INSERT INTO disponibilidad (Id_Tour,Fecha_Tour,Cupos_Totales,Cupos_Disponibles)
      VALUES (2,?,380,?) ON DUPLICATE KEY UPDATE Cupos_Totales=VALUES(Cupos_Totales),
      Cupos_Disponibles=VALUES(Cupos_Disponibles),Updated_At=CURRENT_TIMESTAMP(3)`, [FINAL_DATE, 380 - seats]);
    const [deleted] = await conn.query('DELETE FROM disponibilidad WHERE Id_Tour=2 AND Fecha_Tour=?', [TEMP_DATE]);
    if (Number(deleted.affectedRows) > 1) throw new Error('El ajuste borró más de una disponibilidad temporal.');
    deletedTemporary = Number(deleted.affectedRows);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }

  manifest.controlledSql.postPaymentAdjustment = {
    reservationId: row.Id_Reserva, dateFrom: TEMP_DATE, dateTo: FINAL_DATE,
    registrationDate: REGISTRATION_DATE, seats, capacity: 380, availabilityBefore,
    availabilityAfter: { Id_Tour: 2, Fecha_Tour: FINAL_DATE, Cupos_Totales: 380, Cupos_Disponibles: 380 - seats },
    temporaryAvailabilityDeleted: deletedTemporary,
  };
  await writeManifest(manifestPath, manifest);
}

async function timestampNewHistory(manifest, manifestPath, beforeKeys) {
  const baselineHistory = new Set((beforeKeys.tables.historial || []).map(keySignature));
  const [rows] = await db.query(`SELECT Id_Historial FROM historial
    WHERE Fecha_Hora_Registro >= ? ORDER BY Id_Historial`, ['2026-10-26 00:00:00']);
  const fresh = rows.filter(row => !baselineHistory.has(keySignature([String(row.Id_Historial)])));
  if (!fresh.length) return;
  const ids = fresh.map(row => Number(row.Id_Historial));
  await db.query(`UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial IN (${ids.map(() => '?').join(',')})`,
    [`${FINAL_DATE} 12:00:00`, ...ids]);
  manifest.controlledSql.historyAfter ||= [];
  manifest.controlledSql.historyAfter.push(...ids.map(Id_Historial => ({ Id_Historial, Fecha_Hora_Registro: `${FINAL_DATE} 12:00:00` })));
  await writeManifest(manifestPath, manifest);
}

async function payAndPrepareAdjustment({ runId, actorId, entityId, reporterName, marker, inputs, manifest, manifestPath,
  createdReservations, beforeKeys }) {
  const filters = { desde: FINAL_DATE, hasta: FINAL_DATE, Id_Entidad_Reportante: entityId,
    Tipo: 'AGENCIA_NACIONAL', Estado: 'PENDIENTE', page: 1, limit: 20 };
  const before = await comisionGrupos.listarGrupos(filters);
  const group = before.grupos.find(item => Number(item.Id_Entidad_Reportante) === Number(entityId)
    && item.Fecha_Tour === FINAL_DATE);
  if (!group || !group.Puede_Pagar || Number(group.Cantidad_Reservas_Pendientes) < 1
    || Number(group.Monto_Pendiente) <= 0) {
    throw new Error(`No se preparó el grupo real pagable de ${entityId} para ${FINAL_DATE}.`);
  }
  manifest.commissionCases = { readyToPayBefore: {
    endpoint: 'GET /api/comisiones/grupos', filters,
    Id_Entidad_Reportante: Number(group.Id_Entidad_Reportante), Fecha_Tour: group.Fecha_Tour,
    Puede_Pagar: group.Puede_Pagar, Cantidad_Reservas_Pendientes: Number(group.Cantidad_Reservas_Pendientes),
    Monto_Pendiente: Number(group.Monto_Pendiente),
  } };
  await writeManifest(manifestPath, manifest);

  const payment = await comisionGrupos.marcarGrupoPagado(group.Id, {
    Monto_Pendiente_Esperado: Math.round(Number(group.Monto_Pendiente)),
    Cantidad_Reservas_Pendientes_Esperada: Number(group.Cantidad_Reservas_Pendientes),
    Forma_Pago: 'EFECTIVO', Nombre_Receptor: `Receptor Sintetico ${runId}`,
    DNI_Receptor: `99${String(actorId).slice(-6)}`, Fecha_Pago: '2026-10-26',
  }, actorId, null);
  manifest.commissionCases.paid = payment;
  await writeManifest(manifestPath, manifest);

  const paidGroups = await comisionGrupos.listarGrupos({ ...filters, Estado: 'PAGADO' });
  const paidGroup = paidGroups.grupos.find(item => Number(item.Id_Entidad_Reportante) === Number(entityId)
    && item.Fecha_Tour === FINAL_DATE);
  if (!paidGroup || Number(paidGroup.Cantidad_Lotes_Pagados) < 1) {
    throw new Error('El grupo no aparece pagado después de marcarlo con el servicio.');
  }
  manifest.commissionCases.paidFilter = { filters: { ...filters, Estado: 'PAGADO' }, returnedRows: paidGroups.grupos.length,
    matchingPaidLots: Number(paidGroup.Cantidad_Lotes_Pagados), Monto_Pagado: Number(paidGroup.Monto_Pagado) };
  await writeManifest(manifestPath, manifest);

  const adjustment = await createReservation({ runId, actorId, entityId, reporterName, sequence: 5, marker, inputs });
  createdReservations.push(adjustment);
  manifest.reservations.push({ Id_Reserva: adjustment.Id_Reserva, Id_Canal: Number(adjustment.Id_Canal),
    Id_Entidad_Reportante: Number(adjustment.Id_Entidad_Reportante), estadoAtCreate: adjustment.Estado,
    fechaAtCreate: adjustment.Fecha_Tour, sharedReporterSearch: reporterName, role: 'post-payment-adjustment' });
  await writeManifest(manifestPath, manifest);
  await moveAdjustmentReservationToFinalDate(adjustment, manifest, manifestPath);
  await programacionNovedades.syncForReservationChange({ reservationId: adjustment.Id_Reserva, fecha: FINAL_DATE });
  manifest.postAdjustmentStateNormalization = await reservas.actualizarEstadosReservasVencidas();

  const attendancePassengers = await confirmacion.obtenerPasajerosPorTour(2, FINAL_DATE);
  const attendance = await confirmacion.actualizarConfirmacion({
    Id_Tour: 2, Fecha: FINAL_DATE,
    pasajeros: attendancePassengers.map(row => ({ Id_Pasajero: Number(row.Id_Pasajero), Confirmacion: 1 })),
  }, actorId);
  if (attendancePassengers.length !== 10) throw new Error(`Asistencia tras el ajuste: se esperaban 10 pasajeros, hay ${attendancePassengers.length}.`);
  const [[journey]] = await db.query(`SELECT Id_Confirmacion,DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En
    FROM confirmaciones_jornada WHERE Id_Tour=2 AND Fecha_Tour=? LIMIT 1`, [FINAL_DATE]);
  if (!journey) throw new Error('actualizarConfirmacion no dejó confirmaciones_jornada después del ajuste.');
  const journeyDate = `${FINAL_DATE} 13:00:00`;
  const [updated] = await db.query('UPDATE confirmaciones_jornada SET Confirmada_En=? WHERE Id_Confirmacion=?',
    [journeyDate, journey.Id_Confirmacion]);
  if (Number(updated.affectedRows) !== 1) throw new Error('No se fijó la fecha histórica de confirmación después del ajuste.');
  await timestampNewHistory(manifest, manifestPath, beforeKeys);
  manifest.commissionCases.adjustment = { Id_Reserva: adjustment.Id_Reserva,
    serviceResult: { Id_Tour: 2, Fecha_Tour: FINAL_DATE, passengerCount: attendancePassengers.length, attendance },
    journeyConfirmedAt: journeyDate };
  await writeManifest(manifestPath, manifest);

  const pendingGroups = await comisionGrupos.listarGrupos(filters);
  const pendingAdjustment = pendingGroups.grupos.find(item => Number(item.Id_Entidad_Reportante) === Number(entityId)
    && item.Fecha_Tour === FINAL_DATE);
  if (!pendingAdjustment || !pendingAdjustment.Tiene_Ajuste_Pendiente
    || Number(pendingAdjustment.Cantidad_Reservas_Pendientes) !== 1 || !pendingAdjustment.Puede_Pagar) {
    throw new Error('La reserva posterior al pago no produjo el ajuste pendiente esperado.');
  }
  manifest.commissionCases.adjustmentAfter = { filters, Id_Entidad_Reportante: Number(entityId),
    Fecha_Tour: pendingAdjustment.Fecha_Tour, Tiene_Ajuste_Pendiente: Boolean(pendingAdjustment.Tiene_Ajuste_Pendiente),
    Cantidad_Reservas_Pendientes: Number(pendingAdjustment.Cantidad_Reservas_Pendientes),
    Monto_Pendiente: Number(pendingAdjustment.Monto_Pendiente), Puede_Pagar: Boolean(pendingAdjustment.Puede_Pagar) };
  await runPendingJobTracked(manifest, manifestPath, 'post-adjustment');
  manifest.pendingJobAfterAdjustment = { completed: true, at: new Date().toISOString() };
  await writeManifest(manifestPath, manifest);
}

async function createOpenJourneyReservation({ runId, actorId, entityId, reporterName, marker, inputs,
  manifest, manifestPath, createdReservations }) {
  const today = '2026-10-26';
  const row = await createReservation({ runId, actorId, entityId, reporterName, sequence: 6, marker, inputs, fechaTour: today });
  createdReservations.push(row);
  manifest.reservations.push({ Id_Reserva: row.Id_Reserva, Id_Canal: Number(row.Id_Canal),
    Id_Entidad_Reportante: Number(row.Id_Entidad_Reportante), estadoAtCreate: row.Estado,
    fechaAtCreate: row.Fecha_Tour, sharedReporterSearch: reporterName, role: 'open-today-journey' });
  await programacionNovedades.syncForReservationChange({ reservationId: row.Id_Reserva, fecha: today });
  manifest.openJourneyStateNormalization = await reservas.actualizarEstadosReservasVencidas();
  await runPendingJobTracked(manifest, manifestPath, 'open-journey');
  const state = await confirmacion.obtenerEstadoConfirmacion(today, 2);
  const journey = (state.jornadas || []).find(item => Number(item.Id_Tour) === 2);
  if (!journey || journey.Confirmada_En) throw new Error('La jornada del 2026-10-26 no quedó abierta para la prueba.');
  manifest.openJourney = { Id_Tour: 2, Fecha_Tour: today, status: state, createdReservationId: row.Id_Reserva };
  manifest.pendingJobAfterOpenJourney = { completed: true, at: new Date().toISOString() };
  await writeManifest(manifestPath, manifest);
}

async function runSmokeCase(manifest, manifestPath, spec) {
  let result;
  try {
    const value = await spec.run();
    const details = spec.summarize(value);
    const valid = Boolean(spec.validate(value, details));
    result = { name: spec.name, endpoint: spec.endpoint, service: spec.service, filters: spec.filters,
      ok: valid, ...details };
    if (!valid) result.error = spec.validationError || 'El resultado no coincide con las filas esperadas.';
  } catch (error) {
    result = { name: spec.name, endpoint: spec.endpoint, service: spec.service, filters: spec.filters,
      ok: false, error: error?.message || String(error) };
  }
  manifest.smoke.push(result);
  await writeManifest(manifestPath, manifest);
  return result;
}

function sameIds(actual, expected) {
  const left = [...actual].map(String).sort();
  const right = [...expected].map(String).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function dependencyDeleteOrder(targetTables = null) {
  const names = await tableNames();
  const targets = new Set(targetTables || names);
  const [edges] = await db.query(`SELECT TABLE_NAME AS child,REFERENCED_TABLE_NAME AS parent
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
  const children = new Map(names.map(name => [name, new Set()]));
  for (const edge of edges) children.get(edge.parent)?.add(edge.child);
  const state = new Map();
  const ordered = [];
  function visit(name) {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) throw new Error(`Ciclo de claves foráneas al limpiar ${name}.`);
    state.set(name, 1);
    for (const child of children.get(name) || []) if (targets.has(child)) visit(child);
    state.set(name, 2);
    ordered.push(name);
  }
  for (const name of targets) {
    if (!names.includes(name)) throw new Error(`Tabla de limpieza no encontrada: ${name}.`);
    visit(name);
  }
  return ordered.filter(name => targets.has(name));
}

function sameKeySet(left, right) {
  const signature = rows => (rows || []).map(keySignature).sort();
  return JSON.stringify(signature(left)) === JSON.stringify(signature(right));
}

async function deleteExactNewRows(manifest, beforeKeys, metadata) {
  const currentKeys = await capturePrimaryKeys(metadata);
  const actualNewRows = diffPrimaryKeys(beforeKeys, currentKeys);
  const manifestRows = manifest.createdIdsByTable || {};
  const tableNames = [...new Set([...Object.keys(actualNewRows), ...Object.keys(manifestRows)])].sort();
  for (const table of tableNames) {
    const actual = actualNewRows[table] || [];
    const recorded = manifestRows[table]?.ids || [];
    if (!sameKeySet(actual, recorded)) {
      throw new Error(`Las claves nuevas de ${table} difieren del manifiesto; se cancela la limpieza.`);
    }
    if (manifestRows[table] && JSON.stringify(manifestRows[table].pk) !== JSON.stringify(metadata[table])) {
      throw new Error(`La PK registrada para ${table} difiere de la BD; se cancela la limpieza.`);
    }
  }
  const order = await dependencyDeleteOrder(Object.keys(manifestRows));
  const deleted = {};
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    try {
      for (const table of order) {
        const entry = manifestRows[table];
        const keys = entry?.ids || [];
        if (!keys.length) continue;
        const columns = entry.pk.map(String);
        const predicates = keys.map(() => `(${columns.map(column => `${quoteIdentifier(column)}=?`).join(' AND ')})`).join(' OR ');
        const params = keys.flatMap(key => key);
        const [result] = await conn.query(`DELETE FROM ${quoteIdentifier(table)} WHERE ${predicates}`, params);
        if (Number(result.affectedRows) !== keys.length) {
          throw new Error(`Limpieza detenida: ${table} borró ${result.affectedRows}, manifestaba ${keys.length}.`);
        }
        deleted[table] = Number(result.affectedRows);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  } finally { conn.release(); }
  return { newRows: manifestRows, deleted };
}

async function cleanupManifest(manifestPath, manifest, baselineCounts, metadata, beforeKeys) {
  const cleanup = await deleteExactNewRows(manifest, beforeKeys, metadata);
  const actual = await countSnapshot();
  const differences = compareCounts(baselineCounts.counts, actual);
  manifest.cleanup = { at: new Date().toISOString(), deleted: cleanup.deleted, countDifferences: differences,
    countsAfter: actual, exactMatch: differences.length === 0 };
  manifest.state = differences.length ? 'CLEANUP_COUNT_MISMATCH' : 'CLEANED';
  await writeManifest(manifestPath, manifest);
  if (differences.length) throw new Error(`La limpieza no volvió al snapshot: ${JSON.stringify(differences)}`);
  return cleanup;
}

async function runReadOnlyDryRun() {
  const snapshot = loadSnapshot();
  const preflight = await assertPreflight(snapshot);
  const metadata = await primaryKeyMetadata();
  const noPkCount = 0;
  const manifestPath = path.join(BACKUP_DIR, `sir2-step5-${DEFAULT_RUN_ID}.manifest.json`);
  const keysPath = path.join(BACKUP_DIR, `sir2-step5-${DEFAULT_RUN_ID}.baseline-keys.json`);
  const channelQuotas = { 'AGENCIA NACIONAL': 470, 'AGENCIA INTERNACIONAL': 110, MAXI: 80, IG: 70, META: 70,
    ELLOS: 50, VIATOR: 30, WEB: 30, TIKTOK: 30, FREELANCE: 60 };
  const proposed = { rehearsalReservations: 4, rehearsalTransfers: 4, pendingEntities: 2,
    targetDate: FINAL_DATE, temporaryDate: TEMP_DATE, channelQuotas, largeLoadWillNotStartBeforeRehearsalCleanup: true };
  console.log(JSON.stringify({ mode: '--dry-run (solo lectura)', backup: { path: SQL_BACKUP_PATH, sha256: EXPECTED_BACKUP_SHA256 },
    identity: preflight.identity, countTables: preflight.counts.length, totalRows: preflight.countsTotal,
    countsMatchSnapshot: true, entities: preflight.entities, channels: preflight.channels,
    tourCommissions: preflight.tourCommissions, reservations: preflight.reservations, transfers: preflight.transfers,
    actorsAvailable: preflight.actors.length, primaryKeyTables: Object.keys(metadata).length, noPrimaryKeyTables: noPkCount,
    proposed, manifestPath, keysPath }, null, 2));
}

async function runRehearsal(runId) {
  const snapshot = loadSnapshot();
  const preflight = await assertPreflight(snapshot);
  const metadata = await primaryKeyMetadata();
  const beforeKeys = await capturePrimaryKeys(metadata);
  const manifestPath = path.join(BACKUP_DIR, `sir2-step5-${runId}.manifest.json`);
  const keysPath = path.join(BACKUP_DIR, `sir2-step5-${runId}.baseline-keys.json`);
  atomicJson(keysPath, beforeKeys);
  const actorId = preflight.actors[0].Id_Usuario;
  const marker = `ZZ_TEST_${runId}`;
  const reporterName = `SMOKE_FILTER_${runId}`;
  const holder = `SMOKE_FILTER_HOLDER_${runId}`;
  const manifest = {
    schemaVersion: 1, database: 'sir2', mode: 'rehearsal', runId, state: 'WRITING_REHEARSAL',
    createdAt: new Date().toISOString(), backup: { path: SQL_BACKUP_PATH, sha256: EXPECTED_BACKUP_SHA256 },
    countsSnapshot: COUNTS_PATH, baselineKeysPath: keysPath, actorId,
    countsBefore: preflight.counts, countsTotalBefore: preflight.countsTotal,
    logPath: path.join(BACKUP_DIR, `sir2-step5-${runId}.log`), pendingJobRuns: [],
    marker, entitiesCreated: [], entitiesDeletedByRejection: [], reservations: [], transfers: [],
    rejectionEvidence: [], controlledSql: { availability: [] }, smoke: [],
  };
  await writeManifest(manifestPath, manifest);

  const inputs = await loadReservationInputs();
  const entityAResult = await entities.quickCreate({ channelId: 2, name: `${marker}_A`, actorId, canValidate: false });
  const entityAId = Number(entityAResult.entity.Id_Entidad_Reportante);
  if (!entityAResult.created || entityAResult.entity.Estado_Validacion !== 'PENDIENTE_VALIDACION') throw new Error('ZZ_TEST_A no se creó como PENDIENTE_VALIDACION.');
  manifest.entitiesCreated.push({ Id_Entidad_Reportante: entityAId, Nombre: entityAResult.entity.Nombre, Estado_Validacion: entityAResult.entity.Estado_Validacion, role: 'activity-and-filter' });
  await writeManifest(manifestPath, manifest);

  const entityBResult = await entities.quickCreate({ channelId: 2, name: `${marker}_B`, actorId, canValidate: false });
  const entityBId = Number(entityBResult.entity.Id_Entidad_Reportante);
  if (!entityBResult.created || entityBResult.entity.Estado_Validacion !== 'PENDIENTE_VALIDACION') throw new Error('ZZ_TEST_B no se creó como PENDIENTE_VALIDACION.');
  manifest.entitiesCreated.push({ Id_Entidad_Reportante: entityBId, Nombre: entityBResult.entity.Nombre, Estado_Validacion: entityBResult.entity.Estado_Validacion, role: 'rejection-flow' });
  await writeManifest(manifestPath, manifest);

  const createdReservations = [];
  for (const [sequence, entityId] of [[1, entityAId], [2, entityAId], [3, Number(inputs.realEntity.Id_Entidad_Reportante)], [4, entityBId]]) {
    const row = await createReservation({ runId, actorId, entityId, reporterName, sequence, marker, inputs });
    createdReservations.push(row);
    manifest.reservations.push({ Id_Reserva: row.Id_Reserva, Id_Canal: Number(row.Id_Canal), Id_Entidad_Reportante: Number(row.Id_Entidad_Reportante), estadoAtCreate: row.Estado, fechaAtCreate: row.Fecha_Tour, sharedReporterSearch: reporterName });
    await writeManifest(manifestPath, manifest);
  }

  const createdTransfers = [];
  for (const [serial, channelId, entityId] of [
    [21, 2, entityAId], [22, 2, Number(inputs.realEntity.Id_Entidad_Reportante)],
    [23, 2, entityBId], [24, 11, null],
  ]) {
    const row = await createTransfer({ actorId, channelId, entityId, holder, marker, serial });
    createdTransfers.push(row);
    manifest.transfers.push({ Id_Transfer: Number(row.Id_Transfer), Codigo_Transfer: row.Codigo_Transfer,
      Id_Canal: Number(row.Id_Canal), Id_Entidad_Reportante: row.Id_Entidad_Reportante == null ? null : Number(row.Id_Entidad_Reportante),
      Estado: row.Estado, sharedHolderSearch: holder });
    await writeManifest(manifestPath, manifest);
  }

  const rejectedBefore = [];
  for (const row of createdReservations.filter(item => Number(item.Id_Entidad_Reportante) === entityBId)) {
    const [[current]] = await db.query(`SELECT Id_Reserva,Estado,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      Id_Canal,Id_Entidad_Reportante,Pendiente_Por_Entidad_En,Observaciones
      FROM reservas WHERE Id_Reserva=?`, [row.Id_Reserva]);
    rejectedBefore.push({ kind: 'RESERVA', ...current });
  }
  for (const row of createdTransfers.filter(item => Number(item.Id_Entidad_Reportante) === entityBId)) {
    const [[current]] = await db.query(`SELECT Id_Transfer,Estado,
      DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      Id_Canal,Id_Entidad_Reportante,Pendiente_Por_Entidad_En,Observaciones
      FROM transfers WHERE Id_Transfer=?`, [row.Id_Transfer]);
    rejectedBefore.push({ kind: 'TRANSFER', ...current });
  }
  const rejected = await entities.validateEntity(entityBId, 'RECHAZADA', actorId, 'Rechazo de ensayo; limpieza inmediata.');
  const rejectedAfter = [];
  for (const item of rejectedBefore) {
    const table = item.kind === 'RESERVA' ? 'reservas' : 'transfers';
    const pk = item.kind === 'RESERVA' ? 'Id_Reserva' : 'Id_Transfer';
    const [[current]] = await db.query(`SELECT ${pk},Estado,Id_Canal,Id_Entidad_Reportante,Pendiente_Por_Entidad_En,Observaciones
      FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(pk)}=?`, [item[pk]]);
    rejectedAfter.push({ kind: item.kind, ...current });
  }
  manifest.entitiesDeletedByRejection.push({ Id_Entidad_Reportante: entityBId, Nombre: entityBResult.entity.Nombre, serviceResult: rejected,
    operationsBefore: rejectedBefore, operationsAfter: rejectedAfter });
  manifest.rejectionEvidence.push({ entityId: entityBId, returned: rejected, operationsBefore: rejectedBefore, operationsAfter: rejectedAfter });
  await writeManifest(manifestPath, manifest);

  await controlledSql(manifest, manifestPath, createdReservations, createdTransfers, metadata, beforeKeys);

  await runPendingJobTracked(manifest, manifestPath, 'after-controlled-sql');
  const realEntityId = Number(inputs.realEntity.Id_Entidad_Reportante);
  await payAndPrepareAdjustment({ runId, actorId, entityId: realEntityId, reporterName, marker, inputs,
    manifest, manifestPath, createdReservations, beforeKeys });
  await createOpenJourneyReservation({ runId, actorId, entityId: realEntityId, reporterName, marker, inputs,
    manifest, manifestPath, createdReservations });

  const captured = await captureNewRows(beforeKeys, await capturePrimaryKeys(metadata), metadata);
  manifest.createdIdsByTable = captured.keyDiff;
  manifest.createdRowsByEffectTable = {};
  for (const table of ['notificaciones', 'pendientes_operativos', 'pendientes_eventos', 'programacion_alertas',
    'historial', 'detalle_historial', 'confirmaciones_jornada', 'disponibilidad', 'liquidaciones',
    'comisiones_grupos_pago', 'comisiones_grupos_pago_reservas']) {
    if (captured.rowsByTable[table]?.length) manifest.createdRowsByEffectTable[table] = captured.rowsByTable[table];
  }
  manifest.state = 'REHEARSAL_READY_FOR_FILTER_SMOKE';
  await writeManifest(manifestPath, manifest);

  const entityAName = `${marker}_A`;
  const entityReservations = createdReservations.filter(row => Number(row.Id_Entidad_Reportante) === entityAId);
  const entityTransfers = createdTransfers.filter(row => Number(row.Id_Entidad_Reportante) === entityAId);
  const channelReservationIds = createdReservations.filter(row => Number(row.Id_Canal) === 2).map(row => String(row.Id_Reserva));
  const allTransferIds = createdTransfers.map(row => String(row.Id_Transfer));
  const expectedCommissionIds = [createdReservations[0], createdReservations[1], createdReservations[4]]
    .map(row => String(row.Id_Reserva));
  const expectedFinalDateIds = createdReservations.slice(0, 5).map(row => String(row.Id_Reserva));
  const dateRangeFilters = { fechaRegistroDesde: '2026-10-10', fechaRegistroHasta: '2026-10-10', page: 1, pageSize: 100 };
  const testCases = [
    {
      name: 'Ver Reservas por canal y texto', endpoint: 'GET /api/reservas', service: 'reservas.service.filtrarReservas',
      filters: { Id_Canal: 2, q: reporterName, page: 1, limit: 100 },
      run: () => reservas.filtrarReservas({ Id_Canal: 2, q: reporterName, page: 1, limit: 100 }),
      summarize: result => ({ returnedRows: result.data?.length || 0, returnedIds: (result.data || []).map(row => String(row.Id_Reserva)), total: result.total }),
      validate: (_result, details) => sameIds(details.returnedIds, channelReservationIds),
      validationError: 'Ver Reservas no devolvió exactamente las reservas del ensayo para canal 2 y búsqueda de texto.',
    },
    {
      name: 'Ver Transfer por texto, servicio, rango y estado', endpoint: 'GET /api/Transfer/Buscar', service: 'transfers.service.filtrarTransfersSvc',
      filters: { q: holder, Id_Servicio: 1, Id_Rango: 1, Estado: ['Confirmado', 'Pendiente de datos'], page: 1, limit: 100 },
      run: () => transfers.filtrarTransfersSvc({ q: holder, Id_Servicio: 1, Id_Rango: 1,
        Estado: ['Confirmado', 'Pendiente de datos'], page: 1, limit: 100 }),
      summarize: result => ({ returnedRows: result.data?.length || 0, returnedIds: (result.data || []).map(row => String(row.Id_Transfer)), total: result.total }),
      validate: (_result, details) => sameIds(details.returnedIds, allTransferIds),
      validationError: 'Ver Transfer no devolvió exactamente los transfers del ensayo con los filtros disponibles.',
    },
    {
      name: 'Mercadeo origen por canal y entidad', endpoint: 'GET /api/mercadeo/origen', service: 'mercadeo.service.buscarOrigenReservas',
      filters: { categoria: 2, idEntidadReportante: entityAId, ...dateRangeFilters, tipo: 'TODOS' },
      run: () => mercadeo.buscarOrigenReservas({ categoria: 2, idEntidadReportante: entityAId,
        ...dateRangeFilters, tipo: 'TODOS' }),
      summarize: result => ({ returnedRows: result.items?.length || 0,
        reservationIds: (result.items || []).filter(item => item.tipo === 'RESERVA').map(item => String(item.id_reserva)),
        transferIds: (result.items || []).filter(item => item.tipo === 'TRANSFER').map(item => String(item.id_transfer)),
        totalOperaciones: result.totalOperaciones }),
      validate: (_result, details) => sameIds(details.reservationIds, entityReservations.map(row => String(row.Id_Reserva)))
        && sameIds(details.transferIds, entityTransfers.map(row => String(row.Id_Transfer))),
      validationError: 'Mercadeo origen no devolvió las operaciones esperadas de la entidad A.',
    },
    {
      name: 'Mercadeo reservas por canal y entidad', endpoint: 'GET /api/mercadeo/reservas', service: 'mercadeo.service.buscarReservasMercadeo',
      filters: { categoria: 2, idEntidadReportante: entityAId, ...dateRangeFilters },
      run: () => mercadeo.buscarReservasMercadeo({ categoria: 2, idEntidadReportante: entityAId, ...dateRangeFilters }),
      summarize: result => ({ returnedRows: result.items?.length || 0, returnedIds: (result.items || []).map(row => String(row.Id_Reserva)), totalReservas: result.totalReservas }),
      validate: (_result, details) => sameIds(details.returnedIds, entityReservations.map(row => String(row.Id_Reserva))),
      validationError: 'Mercadeo reservas no devolvió las reservas esperadas de la entidad A.',
    },
    {
      name: 'Mercadeo transfers por canal y entidad', endpoint: 'GET /api/mercadeo/transfers', service: 'mercadeo.service.buscarTransfersMercadeo',
      filters: { categoria: 2, idEntidadReportante: entityAId, ...dateRangeFilters },
      run: () => mercadeo.buscarTransfersMercadeo({ categoria: 2, idEntidadReportante: entityAId, ...dateRangeFilters }),
      summarize: result => ({ returnedRows: result.items?.length || 0, returnedIds: (result.items || []).map(row => String(row.Id_Transfer)), totalTransfers: result.totalTransfers }),
      validate: (_result, details) => sameIds(details.returnedIds, entityTransfers.map(row => String(row.Id_Transfer))),
      validationError: 'Mercadeo transfers no devolvió el transfer esperado de la entidad A.',
    },
    {
      name: 'Entidades reportantes con actividad', endpoint: 'GET /api/entidades-reportantes/actividad', service: 'entidades-mercadeo.service.listActivity',
      filters: { buscar: entityAName, actividad: 'CON_RESERVAS', desde: '2026-10-10', hasta: '2026-10-10', page: 1, pageSize: 10 },
      run: () => entityActivity.listActivity({ buscar: entityAName, actividad: 'CON_RESERVAS', desde: '2026-10-10', hasta: '2026-10-10', page: 1, pageSize: 10 }),
      summarize: result => ({ returnedRows: result.items?.length || 0,
        returnedIds: (result.items || []).map(row => String(row.Id_Entidad_Reportante)),
        activity: result.items?.[0] ? { Reservas: Number(result.items[0].Reservas), Transfers: Number(result.items[0].Transfers), Operaciones: Number(result.items[0].Operaciones) } : null }),
      validate: (_result, details) => sameIds(details.returnedIds, [String(entityAId)])
        && Number(details.activity?.Reservas) === 2 && Number(details.activity?.Transfers) === 1,
      validationError: 'La actividad de entidad A no mostró sus dos reservas y un transfer.',
    },
    {
      name: 'Detalle de entidad con operaciones', endpoint: `GET /api/entidades-reportantes/${entityAId}`, service: 'entidades-mercadeo.service.detail',
      filters: { desde: '2026-10-10', hasta: '2026-10-10' },
      run: () => entityActivity.detail(entityAId, { desde: '2026-10-10', hasta: '2026-10-10' }),
      summarize: result => ({ returnedRows: result?.entity ? 1 : 0, entityId: Number(result?.entity?.Id_Entidad_Reportante),
        period: result?.period ? { Reservas: Number(result.period.Reservas), Transfers: Number(result.period.Transfers), Operaciones: Number(result.period.Operaciones) } : null }),
      validate: (_result, details) => details.entityId === entityAId && Number(details.period?.Operaciones) === 3,
      validationError: 'El detalle de entidad A no mostró las tres operaciones del período.',
    },
    {
      name: 'Comisiones por fecha, canal, reportante y estado', endpoint: 'GET /api/comisiones', service: 'comisiones.service.listarComisiones',
      filters: { Fecha: FINAL_DATE, Id_Canal: 2, Nombre_Reportante: reporterName, Estado: 'PENDIENTE' },
      run: () => comisiones.listarComisiones({ Fecha: FINAL_DATE, Id_Canal: 2, Nombre_Reportante: reporterName, Estado: 'PENDIENTE' }),
      summarize: result => {
        const rows = (result || []).flatMap(channel => (channel.reportantes || []).flatMap(reportant => reportant.reservas || []));
        return { returnedRows: rows.length, reservationIds: rows.map(row => String(row.Id_Reserva)) };
      },
      validate: (_result, details) => sameIds(details.reservationIds, expectedCommissionIds),
      validationError: 'El listado de comisiones no devolvió las reservas pendientes esperadas.',
    },
    {
      name: 'Comisiones grupos pagados por período, entidad, tipo y estado', endpoint: 'GET /api/comisiones/grupos', service: 'comisiones-grupos.service.listarGrupos',
      filters: manifest.commissionCases.paidFilter.filters,
      run: async () => manifest.commissionCases.paidFilter,
      summarize: result => ({ returnedRows: Number(result.returnedRows), matchingPaidLots: Number(result.matchingPaidLots), Monto_Pagado: Number(result.Monto_Pagado) }),
      validate: (_result, details) => details.returnedRows === 1 && details.matchingPaidLots === 1 && details.Monto_Pagado > 0,
      validationError: 'El filtro de estado pagado no devolvió el lote de comisión recién pagado.',
    },
    {
      name: 'Comisiones grupos con ajuste por período, entidad, tipo y estado', endpoint: 'GET /api/comisiones/grupos', service: 'comisiones-grupos.service.listarGrupos',
      filters: { desde: FINAL_DATE, hasta: FINAL_DATE, Id_Entidad_Reportante: realEntityId,
        Tipo: 'AGENCIA_NACIONAL', Estado: 'PENDIENTE', page: 1, limit: 20 },
      run: () => comisionGrupos.listarGrupos({ desde: FINAL_DATE, hasta: FINAL_DATE,
        Id_Entidad_Reportante: realEntityId, Tipo: 'AGENCIA_NACIONAL', Estado: 'PENDIENTE', page: 1, limit: 20 }),
      summarize: result => {
        const group = result.grupos?.find(item => Number(item.Id_Entidad_Reportante) === realEntityId);
        return { returnedRows: result.grupos?.length || 0, Id_Entidad_Reportante: group ? Number(group.Id_Entidad_Reportante) : null,
          Fecha_Tour: group?.Fecha_Tour || null, Tiene_Ajuste_Pendiente: Boolean(group?.Tiene_Ajuste_Pendiente),
          Cantidad_Reservas_Pendientes: Number(group?.Cantidad_Reservas_Pendientes || 0), Puede_Pagar: Boolean(group?.Puede_Pagar) };
      },
      validate: (_result, details) => details.returnedRows === 1 && details.Id_Entidad_Reportante === realEntityId
        && details.Tiene_Ajuste_Pendiente && details.Cantidad_Reservas_Pendientes === 1 && details.Puede_Pagar,
      validationError: 'No apareció el ajuste pendiente listo para pagar tras añadir la reserva posterior al pago.',
    },
    {
      name: 'Programación general por canal', endpoint: 'POST /api/programacion/listado-general/consultar', service: 'listado-general.service.consultarListadoGeneral',
      filters: { format: 'nuevo', reportType: 'reservas_grupales', filters: { canales: [2], fechaTour: FINAL_DATE } },
      run: () => listadoGeneral.consultarListadoGeneral({ canales: [2], fechaTour: FINAL_DATE }, 'nuevo', 'reservas_grupales'),
      summarize: result => ({ returnedRows: result.items?.length || 0, returnedIds: (result.items || []).map(row => String(row.Id_Reserva)), totalReservas: result.totalReservas }),
      validate: (_result, details) => sameIds(details.returnedIds, expectedFinalDateIds),
      validationError: 'Programación general no devolvió las cinco reservas del canal 2 para la fecha histórica.',
    },
    {
      name: 'Confirmación de viaje con jornada cerrada', endpoint: 'GET /api/confirmacion/estado', service: 'confirmacion.service.obtenerEstadoConfirmacion',
      filters: { Fecha: FINAL_DATE, Id_Tour: 2 },
      run: () => confirmacion.obtenerEstadoConfirmacion(FINAL_DATE, 2),
      summarize: result => { const row = result.jornadas?.find(item => Number(item.Id_Tour) === 2); return {
        returnedRows: result.jornadas?.length || 0, Confirmada: Boolean(row?.Confirmada), Requiere_Confirmacion: Boolean(row?.Requiere_Confirmacion),
        Total_Pasajeros: Number(row?.Total_Pasajeros || 0), Total_Viajaron: Number(row?.Total_Viajaron || 0), Confirmada_En: Boolean(row?.Confirmada_En),
      }; },
      validate: (_result, details) => details.returnedRows === 1 && details.Confirmada && !details.Requiere_Confirmacion
        && details.Total_Pasajeros === 10 && details.Total_Viajaron === 10 && Boolean(details.Confirmada_En),
      validationError: 'La jornada histórica no quedó confirmada con los diez pasajeros.',
    },
    {
      name: 'Confirmación de viaje con jornada abierta', endpoint: 'GET /api/confirmacion/estado', service: 'confirmacion.service.obtenerEstadoConfirmacion',
      filters: { Fecha: '2026-10-26', Id_Tour: 2 },
      run: () => confirmacion.obtenerEstadoConfirmacion('2026-10-26', 2),
      summarize: result => { const row = result.jornadas?.find(item => Number(item.Id_Tour) === 2); return {
        returnedRows: result.jornadas?.length || 0, Confirmada: Boolean(row?.Confirmada), Requiere_Confirmacion: Boolean(row?.Requiere_Confirmacion),
        Total_Pasajeros: Number(row?.Total_Pasajeros || 0), Confirmada_En: Boolean(row?.Confirmada_En),
      }; },
      validate: (_result, details) => details.returnedRows === 1 && details.Requiere_Confirmacion && !details.Confirmada && !details.Confirmada_En,
      validationError: 'La jornada del día 2026-10-26 no apareció abierta como se esperaba.',
    },
  ];

  for (const spec of testCases) {
    const result = await runSmokeCase(manifest, manifestPath, spec);
    if (!result.ok) {
      manifest.state = 'FILTER_SMOKE_FAILED_NO_CLEANUP';
      await writeManifest(manifestPath, manifest);
      console.log(JSON.stringify({ status: manifest.state, manifestPath, failedTest: result, completedTests: manifest.smoke }, null, 2));
      return { stopped: true, manifestPath, failedTest: result };
    }
  }

  manifest.state = 'FILTER_SMOKE_PASSED_CLEANUP_REQUIRED';
  await writeManifest(manifestPath, manifest);
  console.log(JSON.stringify({ status: manifest.state, manifestPath,
    createdIdsByTable: manifest.createdIdsByTable, smoke: manifest.smoke,
    commissionCases: manifest.commissionCases }, null, 2));
  return { stopped: false, manifestPath };
}

async function runCleanup(manifestPath, dryRun = false) {
  const resolved = path.resolve(manifestPath);
  if (!resolved.startsWith(`${BACKUP_DIR}${path.sep}`)) throw new Error('La ruta del manifiesto debe estar dentro del directorio de backups de sir2.');
  const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (manifest.database !== 'sir2' || !manifest.baselineKeysPath || (!dryRun && manifest.state === 'CLEANED')) throw new Error('Manifiesto inválido o ya limpiado.');
  const snapshot = loadSnapshot();
  const metadata = await primaryKeyMetadata();
  const beforeKeys = JSON.parse(fs.readFileSync(manifest.baselineKeysPath, 'utf8'));
  if (dryRun) {
    const currentKeys = await capturePrimaryKeys(metadata);
    const currentKeyTables = currentKeys.tables || {};
    const actualNewRows = diffPrimaryKeys(beforeKeys, currentKeys);
    const manifestRows = manifest.createdIdsByTable || {};
    const manifestIds = entry => Array.isArray(entry) ? entry : (Array.isArray(entry?.ids) ? entry.ids : []);
    const names = [...new Set([...Object.keys(actualNewRows), ...Object.keys(manifestRows), ...Object.keys(currentKeyTables)])].sort();
    const recordedKeyDifferences = [];
    const primaryKeyDefinitionDifferences = [];
    const missingBaselineKeys = [];
    const manifestRowStatus = [];
    for (const table of names) {
      const entry = manifestRows[table];
      const recorded = manifestIds(entry);
      const actual = actualNewRows[table] || [];
      if (!sameKeySet(actual, recorded)) {
        recordedKeyDifferences.push({ table, actualIds: actual.length, manifestIds: recorded.length });
      }
      if (!sameKeySet(beforeKeys.primaryKeys?.[table] || [], metadata[table] || [])) {
        primaryKeyDefinitionDifferences.push({ table, baseline: beforeKeys.primaryKeys?.[table] || [], current: metadata[table] || [] });
      }
      const currentSet = new Set((currentKeyTables[table] || []).map(keySignature));
      const baselineKeys = beforeKeys.tables?.[table] || [];
      const missing = baselineKeys.filter(key => !currentSet.has(keySignature(key)));
      if (missing.length) missingBaselineKeys.push({ table, count: missing.length, keys: missing });
      if (recorded.length) {
        const present = recorded.filter(key => currentSet.has(keySignature(key)));
        const absent = recorded.filter(key => !currentSet.has(keySignature(key)));
        manifestRowStatus.push({
          table,
          manifestIds: recorded,
          presentCount: present.length,
          absentCount: absent.length,
          status: present.length === 0 ? 'NO_EXISTE' : (absent.length === 0 ? 'EXISTE' : 'PARCIAL'),
          wouldDelete: present.length,
        });
      }
    }
    const currentCounts = await countSnapshot();
    const manifestDelta = new Map(Object.entries(manifestRows).map(([table, entry]) => [table, manifestIds(entry).length]));
    const baselineCountDifferences = compareCounts(snapshot.counts, currentCounts);
    const expectedUncleanCounts = snapshot.counts.map(row => ({ ...row, rows: Number(row.rows) + (manifestDelta.get(row.table) || 0) }));
    const uncleanCountDifferences = compareCounts(expectedUncleanCounts, currentCounts);
    const everyManifestIdAbsent = manifestRowStatus.every(row => row.absentCount === row.manifestIds.length);
    const currentKeysEqualBaseline = names.every(table => sameKeySet(currentKeyTables[table], beforeKeys.tables?.[table] || []));
    const baselineKeysExact = missingBaselineKeys.length === 0 && primaryKeyDefinitionDifferences.length === 0;
    const alreadyClean = everyManifestIdAbsent && currentKeysEqualBaseline && baselineKeysExact && baselineCountDifferences.length === 0;
    const exactPendingCleanup = manifestRowStatus.every(row => row.presentCount === row.manifestIds.length)
      && recordedKeyDifferences.length === 0 && baselineKeysExact && uncleanCountDifferences.length === 0;
    const perTable = snapshot.counts.map(row => ({ table: row.table, baseline: row.rows,
      current: currentCounts.find(item => item.table === row.table)?.rows ?? null,
      manifestIds: manifestDelta.get(row.table) || 0,
      wouldDelete: manifestRowStatus.find(item => item.table === row.table)?.wouldDelete || 0 }));
    const status = alreadyClean ? 'DRY_RUN_ALREADY_CLEAN_NO_WRITE'
      : (exactPendingCleanup ? 'DRY_RUN_EXACT_NO_WRITE' : 'DRY_RUN_MISMATCH_NO_WRITE');
    const result = { status,
      manifestPath: resolved, totalRowsBefore: currentCounts.reduce((sum, row) => sum + row.rows, 0),
      keyDifferences: alreadyClean ? [] : recordedKeyDifferences,
      primaryKeyDefinitionDifferences, missingBaselineKeys, baselineCountDifferences,
      uncleanCountDifferences: alreadyClean ? [] : uncleanCountDifferences,
      manifestRowStatus, perTable };
    console.log(JSON.stringify(result, null, 2));
    if (status === 'DRY_RUN_MISMATCH_NO_WRITE') throw new Error('Dry-run de limpieza no coincide con snapshot y manifiesto.');
    return result;
  }
  const cleanup = await cleanupManifest(resolved, manifest, snapshot, metadata, beforeKeys);
  console.log(JSON.stringify({ status: 'CLEANED', manifestPath: resolved, deleted: cleanup.deleted, countsMatchSnapshot: true }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === '--rehearse') {
    const manifestPath = path.join(BACKUP_DIR, `sir2-step5-${args.runId}.manifest.json`);
    const logPath = path.join(BACKUP_DIR, `sir2-step5-${args.runId}.log`);
    installProcessOutputLog(logPath);
    console.log(JSON.stringify({ event: 'SCRIPT_START', runId: args.runId, manifestPath, logPath }));
  }
  if (args.mode === '--dry-run') return runReadOnlyDryRun();
  if (args.mode === '--rehearse') return runRehearsal(args.runId);
  if (args.mode === '--cleanup-dry-run') return runCleanup(args.manifest, true);
  if (args.mode === '--cleanup') return runCleanup(args.manifest, false);
  throw new Error('Modo no soportado.');
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'STOPPED', code: error.code || null, message: error.message,
    note: 'No se ejecutará una ruta alternativa de conexión ni se aplicará una restauración automática.' }));
  process.exitCode = 1;
}).finally(async () => {
  try { await db.end(); } catch (_) { /* pool may already be closed */ }
});
