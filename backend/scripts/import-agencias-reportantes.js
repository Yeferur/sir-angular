#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const db = require('../database/db');
const entityService = require('../services/EntidadesReportantes/entidades-reportantes.service');
const marketingService = require('../services/EntidadesReportantes/entidades-mercadeo.service');
const permissionsService = require('../services/Permisos/permisos.service');

const EXPECTED_DATABASE = 'sir2';
const REQUIRED_PERMISSION = 'ENTIDADES_REPORTANTES.VALIDAR';
const ALLOWED_TYPES = new Set(['AGENCIA_NACIONAL', 'AGENCIA_INTERNACIONAL']);
const HOLD_ROWS = [
  {
    row: 38,
    expectedName: 'COLOMBIA TRIPS',
    expectedType: 'AGENCIA_NACIONAL',
    group: 'COLOMBIA TRIPS / COLOMBIA TRIPS S A S',
    reason: 'Pareja con sufijo legal; en espera de confirmación de Mercadeo.',
  },
  {
    row: 333,
    expectedName: 'COLOMBIA TRIPS S A S',
    expectedType: 'AGENCIA_NACIONAL',
    group: 'COLOMBIA TRIPS / COLOMBIA TRIPS S A S',
    reason: 'Pareja con sufijo legal; en espera de confirmación de Mercadeo.',
  },
  {
    row: 193,
    expectedName: 'VACACIONES MEDELLÍN SAS',
    expectedType: 'AGENCIA_NACIONAL',
    group: 'VACACIONES MEDELLÍN SAS / VACACIONES MEDELLÍN',
    reason: 'Pareja con sufijo legal; en espera de confirmación de Mercadeo.',
  },
  {
    row: 425,
    expectedName: 'VACACIONES MEDELLÍN',
    expectedType: 'AGENCIA_NACIONAL',
    group: 'VACACIONES MEDELLÍN SAS / VACACIONES MEDELLÍN',
    reason: 'Pareja con sufijo legal; en espera de confirmación de Mercadeo.',
  },
  {
    row: 294,
    expectedName: 'ᴀᴠᴇɴᴛᴏᴜƦ',
    expectedType: 'AGENCIA_NACIONAL',
    group: 'Fila 294: nombre no normalizable',
    reason: 'La clave normalizada del backend queda vacía; en espera de confirmación de Mercadeo.',
  },
];

function usage() {
  return [
    'Uso:',
    '  node backend/scripts/import-agencias-reportantes.js --archivo <ruta.xlsx> --actor-id <id> [--dry-run | --apply] [--reporte <ruta.json>]',
    '',
    'El modo predeterminado es --dry-run. --apply ejecuta altas validadas.',
    'El actor debe existir, estar activo y tener ENTIDADES_REPORTANTES.VALIDAR.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { mode: null, file: null, actorId: null, reportPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply' || arg === '--dry-run') {
      const nextMode = arg === '--apply' ? 'apply' : 'dry-run';
      if (options.mode && options.mode !== nextMode) {
        throw new Error('Usa solo uno de --dry-run o --apply.');
      }
      options.mode = nextMode;
      continue;
    }
    if (['--archivo', '--actor-id', '--reporte'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${arg}.`);
      index += 1;
      if (arg === '--archivo') options.file = path.resolve(value);
      if (arg === '--actor-id') options.actorId = value;
      if (arg === '--reporte') options.reportPath = path.resolve(value);
      continue;
    }
    throw new Error(`Parámetro no reconocido: ${arg}`);
  }

  options.mode ||= 'dry-run';
  if (options.help) return options;
  if (!options.file) throw new Error('Falta el parámetro obligatorio --archivo.');
  if (!options.actorId || !/^\d+$/.test(options.actorId) || BigInt(options.actorId) <= 0n) {
    throw new Error('--actor-id es obligatorio y debe ser un entero positivo.');
  }
  return options;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value.richText)) return value.richText.map(part => String(part.text || '')).join('');
  if (Object.prototype.hasOwnProperty.call(value, 'text')) return String(value.text ?? '');
  if (Object.prototype.hasOwnProperty.call(value, 'result')) return cellText(value.result);
  if (Object.prototype.hasOwnProperty.call(value, 'formula')) return '';
  throw new Error('La celda contiene un valor de Excel no compatible.');
}

function hasCellValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')) {
    return hasCellValue(value.result);
  }
  if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'formula')) return true;
  return true;
}

function mapSourceType(value) {
  const normalized = String(value ?? '').trim().toLocaleUpperCase('es');
  if (normalized === 'NACIONAL') return 'AGENCIA_NACIONAL';
  if (normalized === 'EXTRANJERA') return 'AGENCIA_INTERNACIONAL';
  return null;
}

function sourceKey(type, normalizedNameKey) {
  return `${type}|${normalizedNameKey}`;
}

function defaultReportPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'reports', `agencias-import-${stamp}.json`);
}

function createReport(options) {
  return {
    reportVersion: 1,
    mode: options.mode,
    targetDatabase: EXPECTED_DATABASE,
    sourceFile: options.file,
    generatedAt: new Date().toISOString(),
    actorId: options.actorId,
    worksheet: null,
    columnsDetected: null,
    rowsRead: 0,
    summary: null,
    inserted: [],
    plannedInsertions: [],
    omittedByDuplicate: [],
    waitingForMarketing: [],
    errors: [],
    existingEntitiesFound: [],
    reportPath: options.reportPath || defaultReportPath(),
  };
}

function pushSystemError(report, error, code = 'IMPORT_ABORTED') {
  report.errors.push({
    scope: 'import',
    code: error.code || code,
    message: error.message || String(error),
  });
}

function summarize(report) {
  report.summary = {
    rowsRead: report.rowsRead,
    inserted: report.inserted.length,
    plannedInsertions: report.plannedInsertions.length,
    omittedByDuplicate: report.omittedByDuplicate.length,
    waitingForMarketing: report.waitingForMarketing.length,
    errors: report.errors.length,
    existingEntitiesFound: report.existingEntitiesFound.length,
  };
}

function writeReport(report) {
  const reportPath = report.reportPath;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, content, { encoding: 'utf8', flag: 'wx' });
}

function printReport(report, reportSaved) {
  console.log(JSON.stringify(report, null, 2));
  console.log(reportSaved
    ? `Reporte guardado en: ${report.reportPath}`
    : `No se pudo guardar el reporte en: ${report.reportPath}`);
}

function readRows(worksheet, columnCount) {
  const rows = [];
  const lastRow = worksheet.rowCount;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let rowHasData = false;
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      if (hasCellValue(row.getCell(columnNumber).value)) {
        rowHasData = true;
        break;
      }
    }
    if (!rowHasData) continue;

    let rawName = '';
    let rawType = '';
    try {
      rawName = cellText(row.getCell(1).value);
      rawType = cellText(row.getCell(2).value);
    } catch (error) {
      rows.push({ row: rowNumber, rawName, rawType, parseError: error.message });
      continue;
    }
    rows.push({ row: rowNumber, rawName, rawType });
  }
  return rows;
}

async function loadSource(report) {
  if (!fs.existsSync(report.sourceFile)) throw new Error(`No existe el archivo: ${report.sourceFile}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(report.sourceFile);
  const worksheet = workbook.worksheets.find(sheet => String(sheet.name).trim() === 'Consolidado');
  if (!worksheet) throw new Error('No se encontró la hoja Consolidado.');

  const columnCount = worksheet.dimensions?.model?.right || worksheet.columnCount;
  const headerName = cellText(worksheet.getRow(1).getCell(1).value).trim();
  const headerType = cellText(worksheet.getRow(1).getCell(2).value).trim();
  if (headerName.toLocaleUpperCase('es') !== 'AGENCIAS'
      || headerType.toLocaleUpperCase('es') !== 'NACIONAL/EXTRANJERA') {
    throw new Error('Los encabezados de las columnas A y B no coinciden con la hoja auditada.');
  }

  report.worksheet = worksheet.name;
  report.columnsDetected = columnCount;
  const rows = readRows(worksheet, columnCount);
  report.rowsRead = rows.length;
  return rows;
}

function prepareHolds(rows, report) {
  const byRow = new Map(rows.map(row => [row.row, row]));
  const heldRows = new Map();
  const heldKeys = new Map();
  const heldDisplayKeys = new Map();
  let fatalMismatch = false;

  for (const specification of HOLD_ROWS) {
    const sourceRow = byRow.get(specification.row);
    let normalizedName = null;
    let mappedType = null;
    let normalizeError = null;
    try {
      if (sourceRow) {
        normalizedName = entityService.normalizeName(sourceRow.rawName);
        mappedType = mapSourceType(sourceRow.rawType);
      }
    } catch (error) {
      normalizeError = error.message;
    }

    if (!sourceRow || normalizedName !== specification.expectedName
        || mappedType !== specification.expectedType || normalizeError) {
      fatalMismatch = true;
      report.errors.push({
        scope: 'source_guard',
        row: specification.row,
        code: 'AUDITED_ROW_MISMATCH',
        originalName: sourceRow?.rawName ?? null,
        sourceType: sourceRow?.rawType ?? null,
        message: `La fila esperada para exclusión de Mercadeo no coincide${normalizeError ? `: ${normalizeError}` : '.'}`,
      });
      continue;
    }

    const hold = {
      row: sourceRow.row,
      originalName: sourceRow.rawName,
      normalizedName,
      sourceType: sourceRow.rawType,
      type: mappedType,
      group: specification.group,
      reason: specification.reason,
    };
    heldRows.set(sourceRow.row, hold);
    heldDisplayKeys.set(sourceKey(mappedType, normalizedName), hold);
    try {
      const key = entityService.searchKey(normalizedName);
      if (key) heldKeys.set(sourceKey(mappedType, key), hold);
    } catch {
      // The original normalized name key still quarantines this audited row.
    }
  }

  return { heldRows, heldKeys, heldDisplayKeys, fatalMismatch };
}

function buildSourcePlan(rows, report, holds) {
  const candidates = [];
  const firstByKey = new Map();

  for (const row of rows) {
    if (row.parseError) {
      report.errors.push({ row: row.row, originalName: row.rawName, sourceType: row.rawType,
        code: 'CELL_VALUE_UNSUPPORTED', message: row.parseError });
      continue;
    }

    const mappedType = mapSourceType(row.rawType);
    let normalizedName;
    try {
      normalizedName = entityService.normalizeName(row.rawName);
    } catch (error) {
      report.errors.push({ row: row.row, originalName: row.rawName, sourceType: row.rawType,
        code: error.errorCode || 'ENTITY_NAME_INVALID', message: error.message });
      continue;
    }

    if (holds.heldRows.has(row.row)) {
      report.waitingForMarketing.push(holds.heldRows.get(row.row));
      continue;
    }

    if (!mappedType || !ALLOWED_TYPES.has(mappedType)) {
      report.errors.push({ row: row.row, originalName: row.rawName, normalizedName, sourceType: row.rawType,
        code: 'ENTITY_TYPE_INVALID', message: 'El tipo no corresponde a Nacional o Extranjera; no se infiere.' });
      continue;
    }

    const displayHold = holds.heldDisplayKeys.get(sourceKey(mappedType, normalizedName));
    let normalizedKey = '';
    try {
      normalizedKey = entityService.searchKey(normalizedName);
    } catch (error) {
      report.errors.push({ row: row.row, originalName: row.rawName, normalizedName, type: mappedType,
        code: error.errorCode || 'ENTITY_NAME_INVALID', message: error.message });
      continue;
    }
    const normalizedHold = normalizedKey ? holds.heldKeys.get(sourceKey(mappedType, normalizedKey)) : null;
    if (displayHold || normalizedHold) {
      const hold = displayHold || normalizedHold;
      report.waitingForMarketing.push({ ...hold, row: row.row, originalName: row.rawName,
        normalizedName, sourceType: row.rawType, type: mappedType });
      continue;
    }
    if (!normalizedKey) {
      report.errors.push({ row: row.row, originalName: row.rawName, normalizedName, sourceType: row.rawType,
        type: mappedType, code: 'ENTITY_NAME_INVALID',
        message: 'La clave normalizada del backend queda vacía; no se transpone ni corrige el nombre.' });
      continue;
    }

    const key = sourceKey(mappedType, normalizedKey);
    const candidate = { row: row.row, originalName: row.rawName, normalizedName,
      sourceType: row.rawType, type: mappedType, normalizedKey, key };
    const first = firstByKey.get(key);
    if (first) {
      report.omittedByDuplicate.push({
        row: candidate.row,
        originalName: candidate.originalName,
        normalizedName,
        type: mappedType,
        reason: 'DUPLICATE_IN_FILE',
        duplicateOfRow: first.row,
      });
      continue;
    }
    firstByKey.set(key, candidate);
    candidates.push(candidate);
  }

  return candidates;
}

async function verifyDatabaseAndActor(actorId) {
  const [[databaseRow]] = await db.query('SELECT DATABASE() AS database_name');
  const databaseName = String(databaseRow?.database_name || '');
  if (databaseName.toLocaleLowerCase('en') !== EXPECTED_DATABASE) {
    const error = new Error(`La conexión activa apunta a ${databaseName || 'ninguna base'}; se requiere ${EXPECTED_DATABASE}.`);
    error.code = 'WRONG_DATABASE';
    throw error;
  }

  const [[actor]] = await db.query(
    'SELECT Id_Usuario, Activo FROM usuarios WHERE Id_Usuario=? LIMIT 1', [actorId]);
  if (!actor) {
    const error = new Error(`No existe el usuario ${actorId}.`);
    error.code = 'ACTOR_NOT_FOUND';
    throw error;
  }
  if (!Number(actor.Activo)) {
    const error = new Error(`El usuario ${actorId} está inactivo.`);
    error.code = 'ACTOR_INACTIVE';
    throw error;
  }

  const hasPermission = await permissionsService.verificarPermiso(actorId, REQUIRED_PERMISSION);
  if (!hasPermission) {
    const error = new Error(`El usuario ${actorId} no tiene ${REQUIRED_PERMISSION} efectivo.`);
    error.code = 'ACTOR_PERMISSION_REQUIRED';
    throw error;
  }
  return databaseName;
}

async function findExistingEntities(candidates) {
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.key, candidate);
  const allMatches = [];
  const items = [...unique.values()];
  const chunkSize = 150;

  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    const predicate = chunk.map(() => '(Tipo=? AND Nombre_Normalizado=?)').join(' OR ');
    const params = chunk.flatMap(candidate => [candidate.type, candidate.normalizedKey]);
    const [rows] = await db.query(`SELECT Id_Entidad_Reportante,Tipo,Nombre,Nombre_Normalizado,
      Activo,Estado_Validacion,Creado_Por,Validado_Por,Validado_En
      FROM entidades_reportantes WHERE ${predicate}`, params);
    allMatches.push(...rows);
  }
  return allMatches;
}

function addExistingEntityReports(report, candidates, existingRows) {
  const candidateIndex = new Map(candidates.map(candidate => [candidate.key, candidate]));
  const existingIndex = new Map();
  for (const entity of existingRows) {
    const key = sourceKey(entity.Tipo, String(entity.Nombre_Normalizado || ''));
    const source = candidateIndex.get(key);
    if (!source) continue;
    const detail = {
      sourceRows: source.sourceRows || [source.row],
      Id_Entidad_Reportante: String(entity.Id_Entidad_Reportante),
      Tipo: entity.Tipo,
      Nombre: entity.Nombre,
      Nombre_Normalizado: entity.Nombre_Normalizado,
      Activo: Number(entity.Activo),
      Estado_Validacion: entity.Estado_Validacion,
      Creado_Por: entity.Creado_Por == null ? null : String(entity.Creado_Por),
      Validado_Por: entity.Validado_Por == null ? null : String(entity.Validado_Por),
      Validado_En: entity.Validado_En,
    };
    report.existingEntitiesFound.push(detail);
    if (!existingIndex.has(key)) existingIndex.set(key, []);
    existingIndex.get(key).push(detail);
  }
  return existingIndex;
}

async function refreshExistingForKey(report, candidate) {
  const matches = await findExistingEntities([candidate]);
  const rows = [];
  for (const entity of matches) {
    const detail = {
      sourceRows: candidate.sourceRows || [candidate.row],
      Id_Entidad_Reportante: String(entity.Id_Entidad_Reportante),
      Tipo: entity.Tipo,
      Nombre: entity.Nombre,
      Nombre_Normalizado: entity.Nombre_Normalizado,
      Activo: Number(entity.Activo),
      Estado_Validacion: entity.Estado_Validacion,
      Creado_Por: entity.Creado_Por == null ? null : String(entity.Creado_Por),
      Validado_Por: entity.Validado_Por == null ? null : String(entity.Validado_Por),
      Validado_En: entity.Validado_En,
    };
    if (!report.existingEntitiesFound.some(item => item.Id_Entidad_Reportante === detail.Id_Entidad_Reportante)) {
      report.existingEntitiesFound.push(detail);
    }
    rows.push(detail);
  }
  return rows;
}

async function run(options, report) {
  const sourceRows = await loadSource(report);
  const holds = prepareHolds(sourceRows, report);
  if (holds.fatalMismatch) {
    const error = new Error('El archivo no coincide con las filas auditadas; se aborta sin consultar ni cambiar la BD.');
    error.code = 'AUDITED_SOURCE_MISMATCH';
    throw error;
  }

  const candidates = buildSourcePlan(sourceRows, report, holds);
  await verifyDatabaseAndActor(options.actorId);

  // Se buscan coincidencias para todo nombre normalizable, incluidos los que
  // esperan confirmación de Mercadeo; ninguno de ellos se actualiza.
  const lookupByKey = new Map();
  for (const row of sourceRows) {
    const mappedType = mapSourceType(row.rawType);
    if (!mappedType || !ALLOWED_TYPES.has(mappedType) || row.parseError) continue;
    try {
      const normalizedName = entityService.normalizeName(row.rawName);
      const normalizedKey = entityService.searchKey(normalizedName);
      if (!normalizedKey) continue;
      const key = sourceKey(mappedType, normalizedKey);
      if (!lookupByKey.has(key)) {
        lookupByKey.set(key, { row: row.row, sourceRows: [], type: mappedType, normalizedKey, key });
      }
      lookupByKey.get(key).sourceRows.push(row.row);
    } catch {
      // La fila ya queda registrada como error o espera en el plan de origen.
    }
  }
  const lookupCandidates = [...lookupByKey.values()];
  const existingRows = await findExistingEntities(lookupCandidates);
  const existingIndex = addExistingEntityReports(report, lookupCandidates, existingRows);

  for (const candidate of candidates) {
    const existing = existingIndex.get(candidate.key) || [];
    if (existing.length) {
      report.omittedByDuplicate.push({
        row: candidate.row,
        originalName: candidate.originalName,
        normalizedName: candidate.normalizedName,
        type: candidate.type,
        reason: 'EXISTS_IN_DATABASE',
        existingEntityIds: existing.map(entity => entity.Id_Entidad_Reportante),
        existingStates: existing.map(entity => entity.Estado_Validacion),
      });
      continue;
    }

    if (options.mode === 'dry-run') {
      report.plannedInsertions.push({ row: candidate.row, originalName: candidate.originalName,
        Nombre: candidate.normalizedName, Tipo: candidate.type });
      continue;
    }

    try {
      const result = await marketingService.createEntity(
        { Tipo: candidate.type, Nombre: candidate.originalName }, options.actorId, true);
      const entity = result?.entity;
      if (!entity) throw new Error('createEntity no devolvió el detalle de la entidad creada.');
      report.inserted.push({ row: candidate.row, originalName: candidate.originalName,
        Nombre: entity.Nombre, Tipo: entity.Tipo,
        Id_Entidad_Reportante: String(entity.Id_Entidad_Reportante),
        Estado_Validacion: entity.Estado_Validacion });
    } catch (error) {
      if (error.errorCode === 'ENTITY_DUPLICATE' || error.code === 'ER_DUP_ENTRY') {
        const racedMatches = await refreshExistingForKey(report, candidate);
        report.omittedByDuplicate.push({ row: candidate.row, originalName: candidate.originalName,
          normalizedName: candidate.normalizedName, type: candidate.type,
          reason: 'EXISTS_IN_DATABASE_DURING_APPLY',
          existingEntityIds: racedMatches.map(entity => entity.Id_Entidad_Reportante),
          existingStates: racedMatches.map(entity => entity.Estado_Validacion) });
      } else {
        report.errors.push({ row: candidate.row, originalName: candidate.originalName,
          normalizedName: candidate.normalizedName, type: candidate.type,
          code: error.errorCode || error.code || 'CREATE_FAILED', message: error.message });
        if (error.code || error.errno || error.sqlState || error.fatal) {
          // A database failure must stop the batch immediately. In particular,
          // do not continue with later rows after a lost or denied connection.
          error.importErrorRecorded = true;
          throw error;
        }
      }
    }
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const report = createReport(options);
  let reportSaved = false;
  try {
    await run(options, report);
  } catch (error) {
    if (!error.importErrorRecorded) pushSystemError(report, error);
  } finally {
    summarize(report);
    try {
      writeReport(report);
      reportSaved = true;
    } catch (error) {
      pushSystemError(report, error, 'REPORT_WRITE_FAILED');
      summarize(report);
    }
    printReport(report, reportSaved);
    await db.end().catch(() => {});
  }

  if (report.errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
