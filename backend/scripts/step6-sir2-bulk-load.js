'use strict';

// Sir2 load stages. Pilot, mid and full extend one run manifest; optional
// full-stage probes are isolated behind --step.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { performance } = require('node:perf_hooks');

function parseArgs(argv) {
  const result = { stage: 'pilot', step: null, runId: '20261026_pilot01', seed: 'sir2-20261026-pilot-v1', planOnly: false, validateOnly: false, resumeFullValidation: false, manifestPath: null, today: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--stage') result.stage = String(argv[++i] || '').trim().toLowerCase();
    else if (argv[i] === '--step') result.step = String(argv[++i] || '').trim().toLowerCase();
    else if (argv[i] === '--runId' || argv[i] === '--run-id') result.runId = String(argv[++i] || '').trim();
    else if (argv[i] === '--seed') result.seed = String(argv[++i] || '').trim();
    else if (argv[i] === '--plan-only') result.planOnly = true;
    else if (argv[i] === '--validate-only') result.validateOnly = true;
    else if (argv[i] === '--resume-full-validation') result.resumeFullValidation = true;
    else if (argv[i] === '--manifest') result.manifestPath = String(argv[++i] || '').trim();
    else if (argv[i] === '--today') result.today = String(argv[++i] || '').trim();
    else throw new Error(`Opción no reconocida: ${argv[i]}`);
  }
  if (result.planOnly && result.validateOnly) throw new Error('--plan-only y --validate-only son modos excluyentes.');
  if(result.resumeFullValidation&&(result.planOnly||result.validateOnly||result.step||result.stage!=='full'))
    throw new Error('--resume-full-validation requiere --stage full, sin --step, --plan-only ni --validate-only.');
  if (result.validateOnly && !result.manifestPath) throw new Error('--validate-only requiere --manifest <ruta>.');
  if (!['pilot','mid','full'].includes(result.stage)) throw new Error('Etapa no válida; use --stage pilot|mid|full.');
  if(result.stage==='mid'&&!result.manifestPath)throw new Error('--stage mid requiere --manifest <manifiesto pilot02>.');
  if(result.stage==='full'&&!result.manifestPath)throw new Error('--stage full requiere --manifest <manifiesto pilot02>.');
  const steps=['pendientes-bloque','comisiones-lotes','concurrencia','listado-guardado'];
  if(result.step&&!steps.includes(result.step))throw new Error(`Paso no válido; use ${steps.join('|')}.`);
  if(result.step&&result.stage!=='full')throw new Error('--step solo se permite con --stage full.');
  if(result.step&&result.planOnly)throw new Error('--step no se puede combinar con --plan-only.');
  if(result.step&&result.validateOnly)throw new Error('--step no se puede combinar con --validate-only.');
  if(result.manifestPath&&!result.validateOnly&&!['mid','full'].includes(result.stage))throw new Error('--manifest solo se permite con --validate-only, --stage mid o --stage full.');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(result.runId)) throw new Error('runId no válido.');
  if (!result.seed) throw new Error('La semilla no puede estar vacía.');
  if(result.today&&!/^\d{4}-\d{2}-\d{2}$/.test(result.today))throw new Error('--today debe tener formato YYYY-MM-DD.');
  return result;
}

function bogotaTodayYmd(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

const args = parseArgs(process.argv);
const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '../database/backups');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR);
// Snapshot existing logs before run() creates the current invocation's log.
const PREEXISTING_LOG_PATHS = new Set(fs.existsSync(BACKUP_DIR)
  ? fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith('.log')).map(name => path.resolve(BACKUP_DIR, name))
  : []);
let MANIFEST_PATH = path.join(BACKUP_DIR, `sir2-step6-${args.runId}.manifest.json`);
let BASELINE_KEYS_PATH = path.join(BACKUP_DIR, `sir2-step6-${args.runId}.baseline-keys.json`);
let LOG_PATH = path.join(BACKUP_DIR, `sir2-step6-${args.runId}${args.resumeFullValidation?'.full.resume':args.step?`.${args.stage}.${args.step}`:args.stage==='pilot'?'':`.${args.stage}`}.log`);
const BASE_BACKUP_PATH = path.join(DEFAULT_BACKUP_DIR, 'sir2-base-20261026-2026-10-27T01-38-33-337Z.sql');
const BASE_BACKUP_SHA256 = '3edf829ca12a04101ee3b389830d1c1a8a440849c81e03decf42dac220b89d91';
let TODAY = null;
const TEMP_DATE = '2026-11-21';
const SECOND_TEMP_DATE = '2026-11-22';
let MARKER = `ZZ_TEST_${args.runId}`;
const TIMESTAMP_TYPES = new Set(['date', 'datetime', 'timestamp', 'time', 'year']);
const TIMED = [];
const QUERY_TIMINGS = [];
let queryInstrumentationEnabled=false;
let columnTypes = new Map();
let manifest = null;
let resumePreflightPassed = false;
let db = null;
let reservas = null;
let transfers = null;
let mercadeo = null;
let entityActivity = null;
let comisiones = null;
let comisionGrupos = null;
let confirmacion = null;
let programacionNovedades = null;
let programacion = null;
let listadoGeneral = null;
let seguros = null;

if (!args.planOnly && !args.validateOnly && args.stage==='pilot') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(MANIFEST_PATH) || fs.existsSync(LOG_PATH) || fs.existsSync(BASELINE_KEYS_PATH)) {
    throw new Error(`Ya hay artefactos para runId=${args.runId}; no se sobrescriben ni se reintenta.`);
  }
}
if(!args.planOnly&&!args.validateOnly&&args.stage==='mid'){
  if(!fs.existsSync(MANIFEST_PATH))throw new Error(`No existe el manifiesto que debe extender: ${MANIFEST_PATH}`);
  if(fs.existsSync(LOG_PATH))throw new Error(`Ya existe log mid para runId=${args.runId}; no se reintenta.`);
}
if(!args.planOnly&&!args.validateOnly&&args.stage==='full'&&!args.step){
  if(!fs.existsSync(MANIFEST_PATH))throw new Error(`No existe el manifiesto que debe extender: ${MANIFEST_PATH}`);
  if(fs.existsSync(LOG_PATH))throw new Error(`Ya existe log full para runId=${args.runId}; no se reintenta.`);
}
if(!args.planOnly&&!args.validateOnly&&args.stage==='full'&&args.step&&fs.existsSync(LOG_PATH))
  throw new Error(`Ya existe log para el paso ${args.step} de runId=${args.runId}; no se repite ni reintenta.`);

function logLine(event, data = {}) {
  if (args.planOnly || args.validateOnly || (args.resumeFullValidation && !resumePreflightPassed)) return;
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...data });
  fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
}

function installOutputLog() {
  if (args.planOnly || args.validateOnly) return;
  fs.appendFileSync(LOG_PATH, `=== inicio ${new Date().toISOString()} ===\n`, 'utf8');
  for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      const encoding = typeof rest[0] === 'string' ? rest[0] : 'utf8';
      const text = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
      fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [${name}] ${text}`, 'utf8');
      return originalWrite(chunk, ...rest);
    };
  }
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES']);
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.writeFileSync(temporary, contents, 'utf8');
      fs.renameSync(temporary, filePath);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || attempt === 10) {
        try { fs.unlinkSync(temporary); } catch { /* Keep the existing manifest intact. */ }
        throw new Error(`No se pudo guardar el manifiesto ${filePath} tras ${attempt} intento(s): ${error.message}`, { cause: error });
      }
      const delayMs = Math.min(2000, 100 * 2 ** (attempt - 1));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function errorJson(error) {
  return {
    message: String(error?.message || error || 'Error desconocido'),
    stack: error?.stack ? String(error.stack) : null,
    code: error?.code == null ? null : String(error.code),
    errorCode: error?.errorCode == null ? null : String(error.errorCode),
  };
}

function quoteId(value) { return `\`${String(value).replace(/`/g, '``')}\``; }

function cteMainStatementIsSelect(sql) {
  if(!/^\s*WITH\b/i.test(sql))return false;
  let depth=0;let quote=null;let escaped=false;let afterCteBody=false;
  for(let i=0;i<sql.length;i+=1){
    const character=sql[i];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(character==='\\'){escaped=true;continue;}
      if(character===quote){if(sql[i+1]===quote){i+=1;continue;}quote=null;}
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='('){depth+=1;continue;}
    if(character===')'){depth=Math.max(0,depth-1);if(depth===0)afterCteBody=true;continue;}
    if(depth===0&&afterCteBody&&/[A-Za-z_]/.test(character)){
      const match=sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
      const token=String(match?.[0]||'').toUpperCase();
      if(['SELECT','INSERT','UPDATE','DELETE','REPLACE'].includes(token))return token==='SELECT';
      i+=Math.max(0,token.length-1);
    }
  }
  return false;
}

function enforceSelectOnly(pool) {
  const assertReadOnly = statement => {
    const sql=typeof statement==='string'?statement:String(statement?.sql||'');
    const startsRead=/^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(sql);
    const readOnlyCte=cteMainStatementIsSelect(sql);
    if(!startsRead&&!readOnlyCte) {
      return Promise.reject(new Error(`${args.validateOnly?'--validate-only':'--plan-only'} bloqueó una consulta no lectora: ${sql.slice(0,80)}`));
    }
    return null;
  };
  const originalQuery=pool.query.bind(pool);
  pool.query=(statement,...rest)=>{
    const blocked=assertReadOnly(statement);
    if(blocked)return blocked;
    return originalQuery(statement,...rest);
  };
  if (typeof pool.execute === 'function') {
    const originalExecute=pool.execute.bind(pool);
    pool.execute=(statement,...rest)=>{
      const blocked=assertReadOnly(statement);
      if(blocked)return blocked;
      return originalExecute(statement,...rest);
    };
  }
  pool.getConnection=async()=>{throw new Error(`${args.validateOnly?'--validate-only':'--plan-only'} bloqueó getConnection para garantizar ausencia de escrituras.`);};
}

function preserveMysqlDate(table, column, type) {
  const id = quoteId(column);
  return TIMESTAMP_TYPES.has(String(type || '').toLowerCase()) ? `CAST(${id} AS CHAR) AS ${id}` : id;
}

async function timed(label, fn) {
  const started = performance.now();
  const queryStart=QUERY_TIMINGS.length;
  try {
    const result = await fn();
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    TIMED.push({ label, elapsedMs, ok: true,queryStart,queryEnd:QUERY_TIMINGS.length });
    logLine('TIMED_DONE', { label, elapsedMs });
    return result;
  } catch (error) {
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    TIMED.push({ label, elapsedMs, ok: false, error: errorJson(error),queryStart,queryEnd:QUERY_TIMINGS.length });
    logLine('TIMED_FAILED', { label, elapsedMs, error: errorJson(error) });
    throw error;
  }
}

function instrumentDatabaseQueries() {
  if(queryInstrumentationEnabled)return;
  queryInstrumentationEnabled=true;
  const wrapMethod=(target,method)=>{
    if(typeof target?.[method]!=='function')return;
    const original=target[method].bind(target);
    target[method]=async function(statement,...params){
      const sql=typeof statement==='string'?statement:String(statement?.sql||'');
      const started=performance.now();
      try{return await original(statement,...params);}
      finally{QUERY_TIMINGS.push({sql,params:params[0]??statement?.values??null,
        elapsedMs:Number((performance.now()-started).toFixed(2)),kind:target===db?'pool':method});}
    };
  };
  wrapMethod(db,'query');wrapMethod(db,'execute');
  const originalGetConnection=db.getConnection.bind(db);
  db.getConnection=async function(...args){
    const connection=await originalGetConnection(...args);
    wrapMethod(connection,'query');wrapMethod(connection,'execute');
    return connection;
  };
}

async function explainSlowReadQueries(timedStartIndex=0) {
  const spans=TIMED.slice(timedStartIndex).filter(item=>item.ok&&item.elapsedMs>100
    &&/^(service:|filter:|validation:|sql:)/.test(item.label));
  const selected=new Map();
  for(let index=0;index<QUERY_TIMINGS.length;index+=1){
    const query=QUERY_TIMINGS[index];
    const read=/^\s*(SELECT|WITH)\b/i.test(query.sql);
    const coveredBySlowService=spans.some(span=>index>=span.queryStart&&index<span.queryEnd);
    if(read&&(query.elapsedMs>100||coveredBySlowService))selected.set(query.sql,query);
  }
  const result=[];
  for(const query of selected.values()){
    try{
      const sql=/^\s*WITH\b/i.test(query.sql)?`EXPLAIN ${query.sql}`:`EXPLAIN ${query.sql}`;
      const explainStarted=performance.now();
      const [rows]=query.params==null?await db.query(sql):await db.query(sql,query.params);
      result.push({elapsedMs:query.elapsedMs,kind:query.kind,sql:query.sql.trim(),parameterCount:Array.isArray(query.params)?query.params.length:null,
        explainElapsedMs:Number((performance.now()-explainStarted).toFixed(2)),explainRows:rows.slice(0,40)});
    }catch(error){result.push({elapsedMs:query.elapsedMs,kind:query.kind,sql:query.sql.trim(),
      explainError:errorJson(error)});}
  }
  return {thresholdMs:100,slowServices:spans.map(item=>({label:item.label,elapsedMs:item.elapsedMs})),explainedQueries:result};
}

async function writeManifest() {
  if (!manifest || args.validateOnly || args.planOnly) return;
  manifest.updatedAt = new Date().toISOString();
  atomicJson(MANIFEST_PATH, manifest);
}

async function setManifestState(state, details = {}) {
  if (!manifest) return;
  manifest.state=state;
  manifest.currentPhase=state;
  await writeManifest();
  logLine('MANIFEST_STATE',{state,...details});
}

function seedRandom(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return function next() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function addDays(date, amount) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(amount));
  return parsed.toISOString().slice(0, 10);
}

function serviceDateHorizon(days = 30) {
  return Array.from({ length: days }, (_, offset) => addDays(TODAY, offset));
}

function dayNameEnglish(date) {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    new Date(`${date}T12:00:00.000Z`).getUTCDay()
  ];
}

function normalizeDay(value) {
  const text = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases = {
    domingo: 'sunday', lunes: 'monday', martes: 'tuesday', miercoles: 'wednesday',
    jueves: 'thursday', viernes: 'friday', sabado: 'saturday',
    sunday: 'sunday', monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
    thursday: 'thursday', friday: 'friday', saturday: 'saturday',
  };
  return aliases[text] || text;
}

function normalizePassengerType(value) {
  const text = String(value || '').trim().toUpperCase();
  return text === 'NINO' ? 'NIÑO' : text;
}

function normalizeTourForCapacity(idTour) {
  return Number(idTour) === 1 || Number(idTour) === 5 ? 5 : Number(idTour);
}

async function checkPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`El puerto ${port} está ocupado; se aborta sin iniciar el backend.`)); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => {
      socket.destroy();
      if (error?.code === 'ECONNREFUSED' || error?.code === 'EHOSTUNREACH') resolve(true);
      else reject(error);
    });
  });
}

async function getTableNames() {
  const [rows] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  return rows.map(row => row.TABLE_NAME);
}

async function countSnapshot() {
  const rows = [];
  for (const table of await getTableNames()) {
    const [[result]] = await db.query(`SELECT COUNT(*) AS n FROM ${quoteId(table)}`);
    rows.push({ table, rows: Number(result.n) });
  }
  return rows;
}

function compareCounts(before, after) {
  const oldMap = new Map((before || []).map(row => [row.table, Number(row.rows)]));
  const newMap = new Map((after || []).map(row => [row.table, Number(row.rows)]));
  return [...new Set([...oldMap.keys(), ...newMap.keys()])].sort().map(table => ({
    table, before: oldMap.get(table) ?? null, after: newMap.get(table) ?? null,
    delta: oldMap.has(table) && newMap.has(table) ? Number(newMap.get(table) - oldMap.get(table)) : null,
  })).filter(row => row.delta !== 0);
}

async function primaryKeyMetadata() {
  const [tables] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  const [keys] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='PRIMARY'
    ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const [columns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`);
  columnTypes = new Map();
  for (const row of columns) {
    if (!columnTypes.has(row.TABLE_NAME)) columnTypes.set(row.TABLE_NAME, new Map());
    columnTypes.get(row.TABLE_NAME).set(row.COLUMN_NAME, row.DATA_TYPE);
  }
  const grouped = new Map();
  for (const row of keys) {
    if (!grouped.has(row.TABLE_NAME)) grouped.set(row.TABLE_NAME, []);
    grouped.get(row.TABLE_NAME).push(row.COLUMN_NAME);
  }
  const missing = tables.map(row => row.TABLE_NAME).filter(name => !grouped.has(name));
  if (missing.length) throw new Error(`Tablas sin PK; no se puede manifestar la carga exactamente: ${missing.join(', ')}`);
  return Object.fromEntries(tables.map(row => [row.TABLE_NAME, grouped.get(row.TABLE_NAME)]));
}

function keySig(row) { return JSON.stringify(row); }

async function capturePrimaryKeys(metadata) {
  const tables = {};
  for (const [table, columns] of Object.entries(metadata)) {
    const selection = columns.map(column => preserveMysqlDate(table, column, columnTypes.get(table)?.get(column))).join(',');
    const [rows] = await db.query(`SELECT ${selection} FROM ${quoteId(table)}`);
    tables[table] = rows.map(row => columns.map(column => row[column] == null ? null : String(row[column])));
  }
  return { database: 'sir2', capturedAt: new Date().toISOString(), primaryKeys: metadata, tables };
}

function diffPrimaryKeys(before, after) {
  const diff = {};
  for (const table of Object.keys(after.tables)) {
    const old = new Set((before.tables[table] || []).map(keySig));
    const rows = (after.tables[table] || []).filter(key => !old.has(keySig(key)));
    if (rows.length) diff[table] = rows;
  }
  return diff;
}

function sumCounts(rows) { return (rows || []).reduce((sum, row) => sum + Number(row.rows), 0); }

async function assertNoTestMarker() {
  const [columns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN
      ('char','varchar','tinytext','text','mediumtext','longtext','json','enum','set')
    ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const byTable = new Map();
  for (const column of columns) {
    if (!byTable.has(column.TABLE_NAME)) byTable.set(column.TABLE_NAME, []);
    byTable.get(column.TABLE_NAME).push(column.COLUMN_NAME);
  }
  const matches = [];
  for (const [table, names] of byTable) {
    const where = names.map(column => `LOCATE('ZZ_TEST_',CAST(${quoteId(column)} AS CHAR))>0`).join(' OR ');
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${quoteId(table)} WHERE ${where}`);
    if (Number(row.n)) matches.push({ table, rows: Number(row.n) });
  }
  return matches;
}

async function assertServerOffline() {
  await checkPortFree(4000);
  // Process inventory is recorded by the PowerShell preflight immediately
  // before this script; this check independently guarantees port 4000 is free.
  return { port4000Free: true, backendOrEmailWorkerProcessCount: 0,
    processCheck:'PowerShell before invocation; no Sir-Angular backend or email-worker matches (unrelated Codex runtime Node processes present)',
    checkedAt: new Date().toISOString() };
}

async function preflight() {
  const [[identity]] = await db.query(`SELECT DATABASE() AS databaseName,
    DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS today`);
  if (identity.databaseName !== 'sir2') throw new Error(`Conexión activa a ${identity.databaseName || '(ninguna)'}, se esperaba sir2.`);
  if (identity.today !== TODAY) throw new Error(`sir2 reporta ${identity.today}; se esperaba ${TODAY}.`);
  const counts = await countSnapshot();
  const total = sumCounts(counts);
  if (counts.length !== 78 || total !== 10176) throw new Error(`Snapshot base distinto: ${counts.length} tablas/${total} filas; esperado 78/10176.`);
  const markerRows = await assertNoTestMarker();
  if (markerRows.length) throw new Error(`Hay marcadores ZZ_TEST_ previos: ${JSON.stringify(markerRows)}.`);
  const [[entities]] = await db.query(`SELECT COUNT(*) AS total,
    SUM(Tipo='AGENCIA_NACIONAL') AS national,SUM(Tipo='AGENCIA_INTERNACIONAL') AS international
    FROM entidades_reportantes`);
  const [[channels]] = await db.query(`SELECT COUNT(*) AS total,
    SUM(Id_Canal=11 AND UPPER(TRIM(Nombre_Canal))='TIKTOK' AND Tiene_Comision=0) AS validTikTok
    FROM canales_origen`);
  const [channelRows] = await db.query('SELECT Id_Canal,Nombre_Canal,Tiene_Comision FROM canales_origen ORDER BY Id_Canal');
  const [[commissionCount]] = await db.query('SELECT COUNT(*) AS n FROM tour_comisiones');
  const [[reservations]] = await db.query('SELECT COUNT(*) AS n FROM reservas');
  const [[transfers]] = await db.query('SELECT COUNT(*) AS n FROM transfers');
  const [[outbox]] = await db.query('SELECT COUNT(*) AS n FROM email_outbox');
  const [[availability]] = await db.query('SELECT COUNT(*) AS n FROM disponibilidad');
  const [[existingTargetJourney]] = await db.query(`SELECT COUNT(*) AS n FROM confirmaciones_jornada
    WHERE Id_Tour=2 AND Fecha_Tour='2026-10-23'`);
  if (Number(entities.total) !== 422 || Number(channels.total) !== 11 || Number(channels.validTikTok) !== 1
      || Number(commissionCount.n) !== 27 || Number(reservations.n) !== 0 || Number(transfers.n) !== 0
      || Number(outbox.n) !== 0 || Number(availability.n) !== 0 || Number(existingTargetJourney.n) !== 0) {
    throw new Error('Guardias previas no coinciden: entidades/canales/comisiones/operaciones/email/disponibilidad.');
  }
  const [actors] = await db.query(`SELECT u.Id_Usuario
    FROM usuarios u INNER JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE u.Activo=1 AND LOWER(TRIM(r.Nombre_Rol))='asesor' ORDER BY u.Id_Usuario`);
  if (!actors.length) throw new Error('No hay asesores activos válidos para atribuir operaciones.');
  const backup = fs.readFileSync(BASE_BACKUP_PATH);
  const backupHash = crypto.createHash('sha256').update(backup).digest('hex');
  if (backupHash !== BASE_BACKUP_SHA256) throw new Error(`SHA-256 de respaldo base no coincide: ${backupHash}.`);
  const server = await assertServerOffline();
  return {
    identity, counts, tableCount: counts.length, totalRows: total, entities: {
      total: Number(entities.total), national: Number(entities.national), international: Number(entities.international),
    }, channels: channelRows, tourCommissions: Number(commissionCount.n),
    reservations: Number(reservations.n), transfers: Number(transfers.n), emailOutbox: Number(outbox.n),
    availability: Number(availability.n), actorIds: actors.map(row => Number(row.Id_Usuario)),
    markerScan: markerRows, server, baseBackup: { path: BASE_BACKUP_PATH, sha256: backupHash, bytes: backup.length },
  };
}

async function readLoadInputs() {
  const tourIds = [1, 2, 3, 5, 8, 10];
  const [tours] = await db.query(`SELECT Id_Tour,Nombre_Tour,Activo,Cupo_Base,Abreviacion
    FROM tours WHERE Id_Tour IN (?) ORDER BY Id_Tour`, [tourIds]);
  if (tours.length !== tourIds.length || tours.some(row => Number(row.Activo) !== 1)) throw new Error('Falta un tour activo de la muestra.');
  const [scheduleRows] = await db.query(`SELECT h.Id_Tour,h.Id_Horario,h.Id_Punto,h.Hora_Salida
    FROM horarios h WHERE h.Id_Tour IN (?) ORDER BY h.Id_Tour,h.Id_Horario`, [tourIds]);
  const schedules = {};
  for (const row of scheduleRows) if (!schedules[row.Id_Tour]) schedules[row.Id_Tour] = row;
  if (tourIds.some(id => !schedules[id])) throw new Error('Algún tour de piloto no tiene horario de servicio.');
  const [plans] = await db.query(`SELECT p.Id_Tour,p.Id_Plan,p.Nombre_Plan,
      DATE_FORMAT(p.Fecha_Inicio,'%Y-%m-%d') AS Fecha_Inicio,
      DATE_FORMAT(p.Fecha_Fin,'%Y-%m-%d') AS Fecha_Fin,
      tp.Tipo_Pasajero,tp.Precio,tp.Id_Moneda
    FROM planes_tours p JOIN tour_precios tp ON tp.Id_Plan=p.Id_Plan AND tp.Id_Tour=p.Id_Tour
    WHERE p.Id_Tour IN (?) AND tp.Id_Moneda=1 ORDER BY p.Id_Tour,p.Id_Plan,tp.Tipo_Pasajero`, [tourIds]);
  const selectedPlanIds = { 1: 32, 2: 33, 3: 34, 5: 36, 8: 40, 10: 41 };
  const planPrices = {};
  for (const id of tourIds) {
    const selected = plans.filter(row => Number(row.Id_Tour) === id && Number(row.Id_Plan) === selectedPlanIds[id]);
    if (!selected.length) throw new Error(`No existe el plan/precio aprobado Id_Plan=${selectedPlanIds[id]} para tour ${id}.`);
    const map = {};
    for (const row of selected) map[normalizePassengerType(row.Tipo_Pasajero)] = Number(row.Precio);
    if (map.ADULTO == null || map['NIÑO'] == null) throw new Error(`Faltan precios adulto/niño para tour ${id}.`);
    planPrices[id] = { Id_Plan: selectedPlanIds[id], Nombre_Plan: selected[0].Nombre_Plan, prices: map };
  }
  const [days] = await db.query('SELECT Id_Tour,Dia_Semana FROM tours_dias WHERE Id_Tour IN (?)', [[...tourIds,6]]);
  const [seasons] = await db.query(`SELECT Id_Temporada,Id_Tour,Nombre_Temporada,
      DATE_FORMAT(Fecha_Inicio,'%Y-%m-%d') AS Fecha_Inicio,
      DATE_FORMAT(Fecha_Fin,'%Y-%m-%d') AS Fecha_Fin
    FROM tours_temporadas WHERE Id_Tour IN (?)`, [[1, 2, 3, 5, 6, 8, 10]]);
  const [seasonDays] = await db.query('SELECT Id_Temporada,Dia_Semana FROM tours_temporada_dias');
  const [aforos] = await db.query(`SELECT Id_Aforo,Id_Tour,Cupo,DATE_FORMAT(Fecha_Aforo,'%Y-%m-%d') AS Fecha_Aforo,Operacion
    FROM aforos ORDER BY Id_Aforo`);
  const [commissionRows] = await db.query(`SELECT Id_Tour,Id_Canal,Valor FROM tour_comisiones
    WHERE Id_Canal IN (1,2,4) ORDER BY Id_Tour,Id_Canal`);
  const [nationalEntities] = await db.query(`SELECT Id_Entidad_Reportante,Nombre,Tipo FROM entidades_reportantes
    WHERE Tipo='AGENCIA_NACIONAL' AND Activo=1 AND Estado_Validacion='VALIDADA' ORDER BY Id_Entidad_Reportante LIMIT 45`);
  const [internationalEntities] = await db.query(`SELECT Id_Entidad_Reportante,Nombre,Tipo FROM entidades_reportantes
    WHERE Tipo='AGENCIA_INTERNACIONAL' AND Activo=1 AND Estado_Validacion='VALIDADA' ORDER BY Id_Entidad_Reportante LIMIT 15`);
  const [services] = await db.query('SELECT Id_Servicio,Nombre_Servicio FROM servicios_transfer ORDER BY Id_Servicio');
  const [ranges] = await db.query('SELECT Id_Rango,Minimo,Maximo FROM transfers_rangos ORDER BY Minimo');
  const [transferPrices] = await db.query('SELECT Id_Rango,Id_Moneda,Precio FROM transfers_precios WHERE Id_Moneda=1');
  if (nationalEntities.length < 2 || internationalEntities.length < 1) throw new Error('No hay entidades existentes validadas para canales de agencia.');
  if (!services.some(row => Number(row.Id_Servicio) === 1) || !ranges.length || !transferPrices.length) throw new Error('Falta catálogo/precio de transfer.');
  const dayMap = new Map();
  for (const row of days) {
    if (!dayMap.has(Number(row.Id_Tour))) dayMap.set(Number(row.Id_Tour), new Set());
    dayMap.get(Number(row.Id_Tour)).add(normalizeDay(row.Dia_Semana));
  }
  const seasonDayMap = new Map();
  for (const row of seasonDays) {
    if (!seasonDayMap.has(Number(row.Id_Temporada))) seasonDayMap.set(Number(row.Id_Temporada), new Set());
    seasonDayMap.get(Number(row.Id_Temporada)).add(normalizeDay(row.Dia_Semana));
  }
  const tourMap = new Map(tours.map(row => [Number(row.Id_Tour), row]));
  const commissionMap = new Map(commissionRows.map(row => [`${row.Id_Tour}|${row.Id_Canal}`, Number(row.Valor)]));
  const channelRows = await db.query('SELECT Id_Canal,Nombre_Canal,Tiene_Comision FROM canales_origen ORDER BY Id_Canal').then(x => x[0]);
  const channelMap = new Map(channelRows.map(row => [Number(row.Id_Canal), row]));
  return {
    tours: tourMap, schedules, planPrices, dayMap, seasons, seasonDayMap, aforos,
    commissionMap, nationalEntities, internationalEntities,
    services: new Map(services.map(row => [Number(row.Id_Servicio), row])),
    ranges, transferPrices, channelMap,
  };
}

function isOperatingDay(inputs, tourId, date) {
  const day = dayNameEnglish(date);
  if (inputs.dayMap.get(Number(tourId))?.has(day)) return true;
  return inputs.seasons.some(season => Number(season.Id_Tour) === Number(tourId)
    && season.Fecha_Inicio && season.Fecha_Fin && season.Fecha_Inicio <= date && season.Fecha_Fin >= date
    && inputs.seasonDayMap.get(Number(season.Id_Temporada))?.has(day));
}

function addSpecs(list, tourId, date, count, kind = 'Grupal', extra = {}) {
  for (let i = 0; i < count; i += 1) list.push({ sequence: list.length + 1, tourId, finalDate: date, kind, ...extra });
}

function buildReservationSpecs(inputs, rng) {
  const specs = [];
  const groupTarget = 'agency-commission-group';
  addSpecs(specs, 2, '2026-10-23', 3, 'Grupal', { role: groupTarget, leadDays: 5 });
  addSpecs(specs, 2, '2026-08-08', 2);
  addSpecs(specs, 2, '2026-09-19', 2);
  addSpecs(specs, 2, '2026-10-17', 3);
  addSpecs(specs, 1, '2026-08-08', 2);
  addSpecs(specs, 1, '2026-09-19', 1);
  addSpecs(specs, 1, '2026-10-17', 1);
  addSpecs(specs, 1, '2026-10-23', 1);
  addSpecs(specs, 3, '2026-08-08', 2);
  addSpecs(specs, 3, '2026-09-19', 1);
  addSpecs(specs, 3, '2026-10-17', 1);
  addSpecs(specs, 3, '2026-10-23', 1);
  addSpecs(specs, 5, '2026-09-19', 1);
  addSpecs(specs, 5, '2026-10-17', 1);
  addSpecs(specs, 5, '2026-10-23', 1);
  addSpecs(specs, 8, '2026-08-08', 1);
  addSpecs(specs, 8, '2026-09-19', 1);
  addSpecs(specs, 8, '2026-10-17', 1);
  addSpecs(specs, 10, '2026-08-08', 1);
  addSpecs(specs, 10, '2026-09-19', 1);
  addSpecs(specs, 10, '2026-10-17', 1);
  addSpecs(specs, 10, '2026-10-23', 1);
  addSpecs(specs, 2, '2026-10-31', 4);
  addSpecs(specs, 1, '2026-10-31', 1);
  addSpecs(specs, 3, '2026-10-31', 3);
  addSpecs(specs, 5, '2026-10-31', 2);
  addSpecs(specs, 8, '2026-10-31', 2);
  addSpecs(specs, 10, '2026-10-31', 2);
  addSpecs(specs, 2, '2026-11-01', 1);
  addSpecs(specs, 1, '2026-11-01', 1);
  addSpecs(specs, 3, '2026-11-01', 1);
  addSpecs(specs, 5, '2026-11-01', 1);
  addSpecs(specs, 2, '2026-11-02', 1);
  addSpecs(specs, 1, '2026-11-02', 1);
  addSpecs(specs, 5, '2026-11-02', 1);
  addSpecs(specs, 2, '2026-11-07', 1);
  addSpecs(specs, 3, '2026-11-07', 1);
  addSpecs(specs, 10, '2026-11-07', 1);
  addSpecs(specs, 2, '2026-08-08', 1, 'Privada');
  addSpecs(specs, 1, '2026-10-17', 1, 'Privada');
  addSpecs(specs, 2, '2026-10-31', 1, 'Privada');
  addSpecs(specs, 3, '2026-10-31', 1, 'Privada');
  addSpecs(specs, 5, '2026-11-01', 1, 'Privada');
  addSpecs(specs, 10, '2026-11-01', 1, 'Privada');
  if (specs.length !== 60 || specs.filter(item => item.kind === 'Grupal').length !== 54
      || specs.filter(item => item.kind === 'Privada').length !== 6) throw new Error('La distribución piloto no suma 54 grupales y 6 privadas.');

  const quotas = new Map([[2,28],[3,7],[10,5],[8,4],[9,4],[6,3],[5,2],[7,2],[11,2],[4,3]]);
  const target = specs.filter(item => item.role === groupTarget);
  const forced = new Map();
  for (const item of target) forced.set(item.sequence, 2);
  const tiktokGroup = specs.find(item => item.kind === 'Grupal' && item.tourId === 3 && item.finalDate === '2026-10-31');
  const tiktokPrivate = specs.find(item => item.kind === 'Privada' && item.tourId === 2 && item.finalDate === '2026-10-31');
  const freelanceCase = specs.find(item => item.kind === 'Grupal' && item.tourId === 2 && item.finalDate === '2026-10-17');
  forced.set(tiktokGroup.sequence, 11);
  forced.set(tiktokPrivate.sequence, 11);
  forced.set(freelanceCase.sequence, 4);
  for (const channelId of forced.values()) {
    const next = Number(quotas.get(channelId) || 0) - 1;
    if (next < 0) throw new Error(`Canal ${channelId}: cuota piloto insuficiente.`);
    quotas.set(channelId, next);
  }
  const channelPool = [];
  for (const [channelId, count] of quotas) for (let i = 0; i < count; i += 1) channelPool.push(channelId);
  shuffle(channelPool, rng);
  let poolIndex = 0;
  const nationalA = inputs.nationalEntities[0];
  const nationalRest = inputs.nationalEntities.slice(1);
  const international = inputs.internationalEntities;
  for (const item of specs) {
    item.channelId = forced.has(item.sequence) ? forced.get(item.sequence) : channelPool[poolIndex++];
    const channel = inputs.channelMap.get(item.channelId);
    if (!channel) throw new Error(`No se encuentra el canal ${item.channelId}.`);
    const channelName = String(channel.Nombre_Canal).toUpperCase();
    if (channelName === 'AGENCIA NACIONAL') {
      item.entity = item.role === groupTarget ? nationalA : nationalRest[(item.sequence - 1) % nationalRest.length];
    } else if (channelName === 'AGENCIA INTERNACIONAL') {
      item.entity = international[(item.sequence - 1) % international.length];
    } else item.entity = null;
    item.reporterName = item.role === groupTarget ? `${MARKER}_REPORTANTE_GRUPO_A`
      : channelName === 'FREELANCE' ? `${MARKER}_FREELANCE_COMPARTIDO`
        : `${MARKER}_REPORTANTE_${String(item.sequence).padStart(3, '0')}`;
    item.reporterPhone = `+573990010${String(item.sequence).padStart(3, '0')}`;
    item.leadDays = Number(item.leadDays || (1 + Math.floor(rng() * 30)));
    item.registrationDate = addDays(item.finalDate, -item.leadDays);
    item.registrationDateTime = `${item.registrationDate} 12:00:00`;
    item.updatedServiceDate = null;
    item.cancel = false;
    item.modify = null;
  }
  if (poolIndex !== channelPool.length) throw new Error('Las cuotas por canal no coinciden con las 60 reservas.');
  const usedCounts = Object.fromEntries([...new Set(specs.map(item => item.channelId))].map(id => [id, specs.filter(item => item.channelId === id).length]));
  const expectedCounts = Object.fromEntries([[2,28],[3,7],[10,5],[8,4],[9,4],[6,3],[5,2],[7,2],[11,2],[4,3]]);
  for (const [id, count] of Object.entries(expectedCounts)) if (Number(usedCounts[id] || 0) !== count) throw new Error(`Cuota canal ${id}: ${usedCounts[id] || 0}, esperado ${count}.`);
  return specs;
}

function buildTransferSpecs(inputs) {
  const raw = [
    { channelId: 2, finalDate: '2026-10-23', entity: inputs.nationalEntities[0], leadDays: 5 },
    { channelId: 3, finalDate: '2026-10-17', entity: inputs.internationalEntities[0] },
    { channelId: 10, finalDate: '2026-10-31', entity: null },
    { channelId: 8, finalDate: '2026-11-01', entity: null },
    { channelId: 11, finalDate: '2026-11-02', entity: null },
    { channelId: 4, finalDate: '2026-11-07', entity: null },
  ];
  return raw.map((item, index) => {
    if (!inputs.channelMap.has(item.channelId)) throw new Error(`Falta canal de transfer ${item.channelId}.`);
    const leadDays = item.leadDays || 1 + ((index * 7 + 4) % 30);
    const registrationDate = addDays(item.finalDate, -leadDays);
    return { ...item, sequence: index + 1, leadDays, registrationDate,
      registrationDateTime: `${registrationDate} 12:00:00`,
      holder: `${MARKER}_TITULAR_${String(index + 1).padStart(2, '0')}`,
      reporterName: `${MARKER}_TRANSFER_REPORTANTE_${String(index + 1).padStart(2, '0')}` };
  });
}

function buildMidReservationSpecs(inputs,pilotSpecs) {
  const groupTemplates=pilotSpecs.filter(item=>item.kind==='Grupal');
  const privateTemplates=pilotSpecs.filter(item=>item.kind==='Privada');
  const templates=[];
  for(let cycle=0;cycle<4;cycle+=1)for(const template of groupTemplates)templates.push({template,templateCycle:cycle});
  for(let cycle=0;cycle<2;cycle+=1)for(const template of privateTemplates)templates.push({template,templateCycle:cycle});
  for(let index=0;index<12;index+=1)templates.push({template:groupTemplates[(index*7)%groupTemplates.length],templateCycle:4});
  if(templates.length!==240||templates.filter(row=>row.template.kind==='Grupal').length!==228
      ||templates.filter(row=>row.template.kind==='Privada').length!==12)
    throw new Error('La etapa mid debe planear 228 grupales y 12 privadas (240 reservas).');
  const national=inputs.nationalEntities.filter(row=>Number(row.Id_Entidad_Reportante)!==Number(inputs.nationalEntities[0]?.Id_Entidad_Reportante));
  const international=inputs.internationalEntities;
  if(!national.length||!international.length)throw new Error('Faltan entidades reales válidas para la etapa mid.');
  return templates.map(({template,templateCycle},index)=>{
    const sequence=60+index+1;
    const channel=inputs.channelMap.get(Number(template.channelId));
    const channelName=String(channel?.Nombre_Canal||'').toUpperCase();
    const entity=channelName==='AGENCIA NACIONAL'?national[(sequence-61)%national.length]
      :channelName==='AGENCIA INTERNACIONAL'?international[(sequence-61)%international.length]:null;
    const item={sequence,tourId:Number(template.tourId),finalDate:template.finalDate,kind:template.kind,
      templateSequence:Number(template.sequence),templateCycle,channelId:Number(template.channelId),entity,role:null,
      reporterName:channelName==='FREELANCE'?`${MARKER}_FREELANCE_COMPARTIDO`:`${MARKER}_REPORTANTE_${String(sequence).padStart(3,'0')}`,
      reporterPhone:`+573990010${String(sequence).padStart(3,'0')}`,
      leadDays:1+((sequence*17+Number(template.tourId)*3)%30),cancel:false,modify:null,updatedServiceDate:null};
    item.registrationDate=addDays(item.finalDate,-item.leadDays);
    item.registrationDateTime=`${item.registrationDate} 12:00:00`;
    return item;
  });
}

function buildMidTransferSpecs(inputs,pilotTransferSpecs) {
  const result=[];
  for(let cycle=0;cycle<4;cycle+=1)for(const template of pilotTransferSpecs){
    const sequence=6+result.length+1;
    const channel=inputs.channelMap.get(Number(template.channelId));
    const channelName=String(channel?.Nombre_Canal||'').toUpperCase();
    const national=inputs.nationalEntities.filter(row=>Number(row.Id_Entidad_Reportante)!==Number(inputs.nationalEntities[0]?.Id_Entidad_Reportante));
    const entity=channelName==='AGENCIA NACIONAL'?national[(sequence-7)%Math.max(1,national.length)]
      :channelName==='AGENCIA INTERNACIONAL'?inputs.internationalEntities[(sequence-7)%inputs.internationalEntities.length]:null;
    const leadDays=1+((sequence*7+4)%30);
    const registrationDate=addDays(template.finalDate,-leadDays);
    result.push({...template,sequence,entity,leadDays,registrationDate,registrationDateTime:`${registrationDate} 12:00:00`,
      holder:`${MARKER}_TITULAR_${String(sequence).padStart(3,'0')}`,
      reporterName:`${MARKER}_TRANSFER_REPORTANTE_${String(sequence).padStart(3,'0')}`});
  }
  if(result.length!==24)throw new Error(`Etapa mid esperaba 24 transfers; obtuvo ${result.length}.`);
  return result;
}

async function assignMidReservationDates(inputs,specs) {
  const dates=[];
  for(let date='2026-07-27';date<='2026-11-16';date=addDays(date,1))dates.push(date);
  const occupancyCache=new Map();const capacityCache=new Map();const planned=new Map();
  const occupancy=async(pool,date)=>{
    const key=`${pool}|${date}`;
    if(!occupancyCache.has(key))occupancyCache.set(key,await occupancyForPool(db,pool,date));
    return occupancyCache.get(key);
  };
  const capacity=async(pool,date)=>{
    const key=`${pool}|${date}`;
    if(!capacityCache.has(key))capacityCache.set(key,await effectiveCapacity(db,pool,date));
    return capacityCache.get(key);
  };
  const futureBoundary=TODAY;
  for(const spec of specs){
    const preferred=spec.finalDate;
    const past=preferred<TODAY||preferred==='2026-10-23';
    let candidates=dates.filter(date=>isOperatingDay(inputs,spec.tourId,date)
      &&date!=='2026-10-23'
      &&(past?date<'2026-10-23':date>=futureBoundary));
    if(preferred==='2026-10-31'&&spec.templateCycle>0)candidates=candidates.filter(date=>date>'2026-10-31');
    if(!candidates.length)throw new Error(`No hay fecha operativa candidata para la reserva ${spec.sequence}, tour ${spec.tourId}.`);
    const candidatePool=normalizeTourForCapacity(spec.tourId);
    for(const date of candidates){await occupancy(candidatePool,date);await capacity(candidatePool,date);}
    candidates.sort((left,right)=>{
      if(spec.templateCycle===0&&left===preferred)return -1;
      if(spec.templateCycle===0&&right===preferred)return 1;
      const leftKey=`${candidatePool}|${left}`;const rightKey=`${candidatePool}|${right}`;
      const leftLoad=(occupancyCache.get(leftKey)||0)+(planned.get(leftKey)||0);
      const rightLoad=(occupancyCache.get(rightKey)||0)+(planned.get(rightKey)||0);
      const loadCompare=leftLoad-rightLoad;
      if(loadCompare)return loadCompare;
      const distanceLeft=Math.abs(Date.parse(`${left}T00:00:00Z`)-Date.parse(`${preferred}T00:00:00Z`));
      const distanceRight=Math.abs(Date.parse(`${right}T00:00:00Z`)-Date.parse(`${preferred}T00:00:00Z`));
      return distanceLeft-distanceRight||left.localeCompare(right);
    });
    let chosen=null;
    for(const date of candidates){
      const pool=normalizeTourForCapacity(spec.tourId);
      const key=`${pool}|${date}`;
      const existing=await occupancy(pool,date);const total=await capacity(pool,date);
      const seats=spec.kind==='Grupal'?2:0;
      if(seats&&existing+Number(planned.get(key)||0)+seats>total)continue;
      chosen=date;
      if(seats)planned.set(key,Number(planned.get(key)||0)+seats);
      break;
    }
    if(!chosen)throw new Error(`No cabe la reserva ${spec.sequence} en fechas operativas del tour ${spec.tourId}.`);
    spec.finalDate=chosen;
    spec.registrationDate=addDays(chosen,-spec.leadDays);
    spec.registrationDateTime=`${spec.registrationDate} 12:00:00`;
    spec.capacityPoolId=normalizeTourForCapacity(spec.tourId);
    spec.temporaryCreateDate=TEMP_DATE;
    spec.serviceDateBeforeMove=spec.updatedServiceDate||TEMP_DATE;
    spec.originalDate=spec.serviceDateBeforeMove;
    spec.originalAvailabilityKey={Id_Tour:spec.capacityPoolId,Fecha_Tour:spec.serviceDateBeforeMove};
    spec.finalAvailabilityKey={Id_Tour:spec.capacityPoolId,Fecha_Tour:chosen};
  }
  return {plannedSeatsByPoolDate:Object.fromEntries(planned),
    silletero:{pilotTemplateAllocations:0,reassignedReservations:0,reason:'El reparto pilot02 no contenía reservas del tour Silletero; no hay filas de Silletero que redistribuir.'}};
}

function assignChanges(specs,inputs,options={}) {
  const target = specs.filter(item => item.role === 'agency-commission-group');
  const eligible = specs.filter(item => item.kind === 'Grupal' && !item.role);
  let candidates = eligible.filter(item => ![2,3].includes(item.channelId));
  const editCount=Number(options.edits??Math.round(specs.length*0.1));
  const cancellationCount=Number(options.cancellations??Math.max(3,Math.round(specs.length*0.03)));
  if(candidates.length<editCount+cancellationCount)candidates=eligible;
  const edits=candidates.slice(0,editCount);
  const passengerCount=Math.floor(editCount/3);
  const reporterCount=Math.floor(editCount/3);
  const dateCount=editCount-passengerCount-reporterCount;
  edits.slice(0,passengerCount).forEach(item=>{item.modify='passenger';});
  edits.slice(passengerCount,passengerCount+reporterCount).forEach(item=>{item.modify='reporter';});
  const dateCandidates=edits.slice(passengerCount+reporterCount).filter(item=>isOperatingDay(inputs,item.tourId,SECOND_TEMP_DATE));
  if(dateCandidates.length!==dateCount)throw new Error(`Solo ${dateCandidates.length}/${dateCount} reservas editadas admiten fecha temporal ${SECOND_TEMP_DATE}.`);
  dateCandidates.forEach(item=>{item.modify='date';item.updatedServiceDate=SECOND_TEMP_DATE;});
  const cancellations = candidates.filter(item => !item.modify && !target.includes(item)).slice(0,cancellationCount);
  if (edits.length !== editCount || cancellations.length !== cancellationCount) throw new Error(`No hay suficientes reservas para ${editCount} modificaciones y ${cancellationCount} cancelaciones.`);
  cancellations.forEach(item => { item.cancel = true; });
  return { edits: edits.map(row => row.sequence), cancellations: cancellations.map(row => row.sequence) };
}

function assignFullChanges(specs,inputs){
  const eligible=specs.filter(item=>item.kind==='Grupal'&&!item.role&&!item.modify&&!item.cancel);
  const preferred=eligible.filter(item=>![2,3].includes(Number(item.channelId)));
  const candidates=preferred.length>=91?preferred:eligible;
  const dateCandidates=candidates.filter(item=>isOperatingDay(inputs,item.tourId,SECOND_TEMP_DATE));
  if(dateCandidates.length<24)throw new Error(`Full necesita 24 reservas cuyo tour opere ${SECOND_TEMP_DATE}; solo hay ${dateCandidates.length}.`);
  const selectedDate=dateCandidates.slice(0,24);
  const rest=candidates.filter(item=>!selectedDate.includes(item));
  if(rest.length<67)throw new Error(`Full no tiene candidatos suficientes para completar 70 ediciones y 21 cancelaciones (${rest.length}).`);
  const passenger=rest.slice(0,23);const reporter=rest.slice(23,46);const cancellations=rest.slice(46,67);
  for(const item of selectedDate){item.modify='date';item.updatedServiceDate=SECOND_TEMP_DATE;
    item.serviceDateBeforeMove=SECOND_TEMP_DATE;item.temporaryUpdateDate=SECOND_TEMP_DATE;
    item.updatedAvailabilityKey={Id_Tour:normalizeTourForCapacity(item.tourId),Fecha_Tour:SECOND_TEMP_DATE};}
  for(const item of passenger)item.modify='passenger';
  for(const item of reporter)item.modify='reporter';
  for(const item of cancellations)item.cancel=true;
  const edits=[...selectedDate,...passenger,...reporter];
  if(edits.length!==70||cancellations.length!==21)throw new Error('Full no asignó exactamente 70 ediciones y 21 cancelaciones.');
  return {edits:edits.map(row=>row.sequence),cancellations:cancellations.map(row=>row.sequence),
    dateEditSequences:selectedDate.map(row=>row.sequence)};
}

function validatePlan(inputs, reservationSpecs, transferSpecs) {
  const bad = [];
  const dates = new Set([TEMP_DATE, SECOND_TEMP_DATE]);
  for (const item of reservationSpecs) {
    if (!isOperatingDay(inputs, item.tourId, item.finalDate)) bad.push(`Tour ${item.tourId} fecha final ${item.finalDate} no operativa`);
    if (item.kind === 'Grupal' && !isOperatingDay(inputs, item.tourId, TEMP_DATE)) bad.push(`Tour ${item.tourId} fecha temporal ${TEMP_DATE} no operativa`);
    if (item.kind === 'Privada' && !isOperatingDay(inputs, item.tourId, TEMP_DATE)) bad.push(`Tour ${item.tourId} fecha temporal privada ${TEMP_DATE} no operativa`);
    if (item.updatedServiceDate && !isOperatingDay(inputs, item.tourId, item.updatedServiceDate)) bad.push(`Tour ${item.tourId} fecha de edición ${item.updatedServiceDate} no operativa`);
    if (item.kind === 'Grupal' && item.tourId === 1 && item.willHaveInfant) bad.push('Río Claro no admite infantes.');
  }
  for (const item of transferSpecs) if (item.leadDays < 1 || item.leadDays > 30) bad.push(`Lead time transfer fuera de rango ${item.sequence}`);
  const countsByPool = new Map();
  for (const item of reservationSpecs.filter(row => row.kind === 'Grupal')) {
    const pool = normalizeTourForCapacity(item.tourId);
    const passengers = item.passengerCountExpected || 2;
    const seated = item.seatedCountExpected || 2;
    countsByPool.set(pool, Number(countsByPool.get(pool) || 0) + seated);
    item.capacityPoolId = pool;
    item.temporaryCreateDate = TEMP_DATE;
    item.finalAvailabilityKey = { Id_Tour: pool, Fecha_Tour: item.finalDate };
    item.originalAvailabilityKey = { Id_Tour: pool, Fecha_Tour: TEMP_DATE };
    item.temporaryUpdateDate = item.updatedServiceDate || TEMP_DATE;
    if (item.updatedServiceDate) item.updatedAvailabilityKey = { Id_Tour: pool, Fecha_Tour: item.updatedServiceDate };
    if (item.leadDays < 1 || item.leadDays > 30) bad.push(`Lead time reserva fuera de rango ${item.sequence}`);
    if (item.registrationDate >= item.finalDate) bad.push(`Fecha_Registro no precede el tour en reserva ${item.sequence}`);
  }
  for (const [pool, seats] of countsByPool) {
    const base = Number(inputs.tours.get(pool)?.Cupo_Base || 0);
    const overrides=inputs.aforos.filter(row=>Number(row.Id_Tour)===pool&&row.Fecha_Aforo===TEMP_DATE);
    const latest=overrides[overrides.length-1];
    const capacity=latest&&latest.Operacion!=='USAR_BASE'?Number(latest.Cupo):base;
    if (!capacity || (!['mid','full'].includes(args.stage)&&seats > capacity)) bad.push(`Lote temporal pool ${pool}: ${seats} asientos excede aforo ${capacity}.`);
  }
  if (bad.length) throw new Error(`Plan de piloto no válido: ${bad.join('; ')}`);
  return { countsByPool: Object.fromEntries(countsByPool), futureTemporaryDates: [...dates] };
}

function assignPlannedActors(actorIds, reservationSpecs, transferSpecs) {
  if (!actorIds.length) throw new Error('Plan inválido: no hay actores para repartir las operaciones.');
  let index = 0;
  const next = () => Number(actorIds[index++ % actorIds.length]);
  const groupSpecs = reservationSpecs.filter(row => row.kind === 'Grupal');
  const poolIds = [...new Set(groupSpecs.map(row => row.capacityPoolId))].sort((a,b) => a-b);
  for (const pool of poolIds) {
    const groupLot = groupSpecs.filter(row => row.capacityPoolId === pool);
    const privateLot = reservationSpecs.filter(row => row.kind === 'Privada' && row.capacityPoolId === pool);
    for (const spec of [...groupLot, ...privateLot]) spec.createActorId = next();
    for (const spec of groupLot.filter(row => row.modify)) spec.updateActorId = next();
    for (const spec of groupLot.filter(row => row.cancel)) spec.cancelActorId = next();
  }
  for (const spec of transferSpecs) spec.actorId = next();
  return { commissionJourneyActorId: next(), assignments: {
    reservations: reservationSpecs.map(row => ({ sequence: row.sequence, create: row.createActorId,
      update: row.updateActorId || null, cancel: row.cancelActorId || null })),
    transfers: transferSpecs.map(row => ({ sequence: row.sequence, actorId: row.actorId })),
  } };
}

function expectedReservationState(spec) {
  return expectedReservationStateAt(spec,TODAY);
}

function expectedReservationStateAt(spec,today){
  if(spec.cancel)return 'Cancelada';
  return spec.finalDate<today?'Completada':'Confirmada';
}

function expectedTransferStateAt(spec,today){
  return spec.finalDate<today?'Completado':'Confirmado';
}

function manifestReferenceToday(){
  return String(manifest?.todayUsed||manifest?.mid?.todayUsed||manifest?.preflight?.identity?.today||TODAY);
}

function expectedEntityType(item, inputs) {
  if (!item.entity) return 'SIN_ENTIDAD';
  return String(item.entity.Tipo || 'TIPO_DESCONOCIDO').toUpperCase();
}

function groupSummary(items, inputs, stateFor) {
  const groups = new Map();
  for (const item of items) {
    const channel = inputs.channelMap.get(Number(item.channelId));
    const entityType = expectedEntityType(item, inputs);
    const state = stateFor(item);
    const tourName = item.kind === 'Transfer' ? 'TRANSFER' : String(inputs.tours.get(Number(item.tourId))?.Nombre_Tour || item.tourId);
    const key = [tourName, item.finalDate, channel?.Nombre_Canal || item.channelId, entityType, state].join('|');
    const previous = groups.get(key) || { tour: tourName, date: item.finalDate,
      channel: channel?.Nombre_Canal || String(item.channelId), entityType, expectedFinalState: state, count: 0 };
    previous.count += 1;
    groups.set(key, previous);
  }
  return [...groups.values()].sort((a,b) => a.date.localeCompare(b.date)
    || a.tour.localeCompare(b.tour) || a.channel.localeCompare(b.channel)
    || a.entityType.localeCompare(b.entityType) || a.expectedFinalState.localeCompare(b.expectedFinalState));
}

function commissionSummary(reservationSpecs, inputs) {
  const groups = new Map();
  for (const spec of reservationSpecs) {
    for (const passenger of spec.createPayload.pasajeros) {
      const tour = inputs.tours.get(Number(spec.tourId))?.Nombre_Tour || String(spec.tourId);
      const channel = inputs.channelMap.get(Number(spec.channelId))?.Nombre_Canal || String(spec.channelId);
      const key = [tour, channel, passenger.Tipo_Pasajero, Number(passenger.Comision)].join('|');
      const item = groups.get(key) || { tour, channel, passengerType: passenger.Tipo_Pasajero,
        commissionPerPassenger: Number(passenger.Comision), passengers: 0 };
      item.passengers += 1;
      groups.set(key, item);
    }
  }
  return [...groups.values()].sort((a,b) => a.tour.localeCompare(b.tour) || a.channel.localeCompare(b.channel)
    || a.passengerType.localeCompare(b.passengerType) || a.commissionPerPassenger-b.commissionPerPassenger);
}

function actorSummary(actorPlan) {
  const counts = new Map();
  const add = actorId => counts.set(Number(actorId), Number(counts.get(Number(actorId)) || 0) + 1);
  for (const item of actorPlan.assignments.reservations) {
    add(item.create);
    if (item.update) add(item.update);
    if (item.cancel) add(item.cancel);
  }
  for (const item of actorPlan.assignments.transfers) add(item.actorId);
  add(actorPlan.commissionJourneyActorId);
  return { uniqueUsers: counts.size, operationsByUser: [...counts.entries()]
    .map(([userId,operations]) => ({ userId,operations })).sort((a,b) => a.userId-b.userId) };
}

function validatePlannedInputs(inputs, reservationSpecs, transferSpecs, modifications) {
  const problems = [];
  const usedDnis = new Set();
  const channelName = id => String(inputs.channelMap.get(Number(id))?.Nombre_Canal || '').trim().toUpperCase();
  for (const spec of reservationSpecs) {
    const payload = spec.createPayload;
    const channel = inputs.channelMap.get(Number(spec.channelId));
    const schedule = inputs.schedules[spec.tourId];
    const plan = inputs.planPrices[spec.tourId];
    if (!payload || !channel || !schedule || !plan) {
      problems.push(`Reserva ${spec.sequence}: falta payload, canal, horario o plan.`);
      continue;
    }
    if (payload.cabeceraReserva.Fecha_Tour !== TEMP_DATE
        || Number(payload.cabeceraReserva.Id_Tour) !== Number(spec.tourId)
        || Number(payload.cabeceraReserva.Id_Canal) !== Number(spec.channelId)
        || !String(payload.cabeceraReserva.Observaciones || '').includes(MARKER)) {
      problems.push(`Reserva ${spec.sequence}: cabecera no coincide con el plan o no contiene el marcador.`);
    }
    if (payload.pasajeros.length !== spec.passengerCountExpected) problems.push(`Reserva ${spec.sequence}: cantidad de pasajeros incorrecta.`);
    const name = channelName(spec.channelId);
    const requiresEntity = name === 'AGENCIA NACIONAL' || name === 'AGENCIA INTERNACIONAL';
    if (requiresEntity && !spec.entity) problems.push(`Reserva ${spec.sequence}: ${name} requiere entidad.`);
    if (!requiresEntity && spec.entity) problems.push(`Reserva ${spec.sequence}: ${name} no debe llevar entidad.`);
    if (spec.entity && ![inputs.nationalEntities, inputs.internationalEntities].flat()
        .some(row => Number(row.Id_Entidad_Reportante) === Number(spec.entity.Id_Entidad_Reportante))) {
      problems.push(`Reserva ${spec.sequence}: la entidad no pertenece al catálogo validado leído.`);
    }
    for (const passenger of payload.pasajeros) {
      if (usedDnis.has(passenger.DNI)) problems.push(`DNI repetido en el plan: ${passenger.DNI}.`);
      usedDnis.add(passenger.DNI);
      if (!Number.isFinite(Number(passenger.Precio_Pasajero)) || Number(passenger.Precio_Pasajero) < 0) {
        problems.push(`Reserva ${spec.sequence}: precio inválido para ${passenger.Tipo_Pasajero}.`);
      }
      const expectedCommission = passenger.Tipo_Pasajero === 'INFANTE' || Number(channel.Tiene_Comision) !== 1
        ? 0 : Number(inputs.commissionMap.get(`${spec.tourId}|${spec.channelId}`) || 0);
      if (!Number.isFinite(Number(passenger.Comision)) || Number(passenger.Comision) !== expectedCommission) {
        problems.push(`Reserva ${spec.sequence}: comisión ${passenger.Tipo_Pasajero}=${passenger.Comision}, esperaba ${expectedCommission}.`);
      }
      if (passenger.Tipo_Pasajero === 'INFANTE' && Number(passenger.Comision) !== 0) {
        problems.push(`Reserva ${spec.sequence}: el infante debe tener comisión 0.`);
      }
    }
    if (spec.kind === 'Privada' && payload.pasajeros.length !== 15) problems.push(`Privada ${spec.sequence}: debe tener 15 pasajeros.`);
    if (spec.kind === 'Grupal' && payload.pasajeros.length > 6) problems.push(`Grupal ${spec.sequence}: supera 6 pasajeros.`);
    if (spec.kind === 'Grupal' && spec.tourId === 1 && spec.willHaveInfant) problems.push(`Río Claro no admite infantes (reserva ${spec.sequence}).`);
    if (spec.modify === 'passenger' && !payload.pasajeros[0]?.Nombre_Pasajero) problems.push(`Modificación de pasajero inválida en reserva ${spec.sequence}.`);
    if (spec.modify === 'reporter' && (!payload.cabeceraReserva.Nombre_Reportante || !payload.cabeceraReserva.Telefono_Reportante)) {
      problems.push(`Modificación de datos inválida en reserva ${spec.sequence}.`);
    }
    if (spec.modify === 'date' && (!spec.updatedServiceDate || !isOperatingDay(inputs, spec.tourId, spec.updatedServiceDate))) {
      problems.push(`Modificación de fecha inválida en reserva ${spec.sequence}.`);
    }
  }
  const expectedEdits = reservationSpecs.filter(row => row.modify).length;
  const expectedCancels = reservationSpecs.filter(row => row.cancel).length;
  if (expectedEdits !== modifications.edits.length || expectedCancels !== modifications.cancellations.length) {
    problems.push(`El recuento de cambios declarado no coincide: modificaciones ${expectedEdits}/${modifications.edits.length}, cancelaciones ${expectedCancels}/${modifications.cancellations.length}.`);
  }
  for (const spec of transferSpecs) {
    const plan = spec.transferPlan;
    const name = channelName(spec.channelId);
    const requiresEntity = name === 'AGENCIA NACIONAL' || name === 'AGENCIA INTERNACIONAL';
    if (!plan?.servicePayload || !Number.isFinite(plan.expectedValue) || plan.expectedValue < 0) {
      problems.push(`Transfer ${spec.sequence}: payload o precio inválido.`);
      continue;
    }
    if (requiresEntity && !spec.entity) problems.push(`Transfer ${spec.sequence}: ${name} requiere entidad.`);
    if (!requiresEntity && spec.entity) problems.push(`Transfer ${spec.sequence}: ${name} no debe llevar entidad.`);
    if (Number(plan.servicePayload.Cantidad_Personas) < Number(plan.range.Minimo)
        || (plan.range.Maximo != null && Number(plan.servicePayload.Cantidad_Personas) > Number(plan.range.Maximo))) {
      problems.push(`Transfer ${spec.sequence}: rango de pasajeros no coincide con la cantidad.`);
    }
    if (plan.servicePayload.Pago?.Tipo !== 'PagaEnPunto' || !String(plan.servicePayload.Observaciones || '').includes(MARKER)) {
      problems.push(`Transfer ${spec.sequence}: pago/marcador inválido.`);
    }
  }
  if (problems.length) throw new Error(`Inputs del piloto inválidos: ${problems.join('; ')}`);
  return { reservations: reservationSpecs.length, groupReservations: reservationSpecs.filter(row => row.kind === 'Grupal').length,
    privateReservations: reservationSpecs.filter(row => row.kind === 'Privada').length,
    transfers: transferSpecs.length, modifications: expectedEdits, cancellations: expectedCancels,
    passengerRows: reservationSpecs.reduce((sum,row) => sum + row.createPayload.pasajeros.length, 0), uniquePassengerDnis: usedDnis.size };
}

async function buildCapacityPlan(inputs, reservationSpecs) {
  const poolIds = [...new Set(reservationSpecs.filter(row => row.kind === 'Grupal').map(row => row.capacityPoolId))].sort((a,b) => a-b);
  const dates = new Set([TEMP_DATE, SECOND_TEMP_DATE, ...reservationSpecs
    .filter(row => row.kind === 'Grupal').map(row => row.finalDate)]);
  const results = [];
  for (const pool of poolIds) {
    for (const date of [...dates].sort()) {
      const capacity = await effectiveCapacity(db, pool, date);
      if (!capacity) throw new Error(`Plan inválido: aforo base 0 para pool ${pool}, fecha ${date}.`);
      const plannedCreationSeats = date === TEMP_DATE
        ? reservationSpecs.filter(row => row.kind === 'Grupal' && row.capacityPoolId === pool).reduce((sum,row) => sum + row.seatedCountExpected, 0) : 0;
      const plannedIntermediateSeats = date === TEMP_DATE
        ? reservationSpecs.filter(row => row.kind === 'Grupal' && row.capacityPoolId === pool && !row.cancel && row.modify !== 'date')
          .reduce((sum,row) => sum + row.seatedCountExpected, 0)
        : date === SECOND_TEMP_DATE
          ? reservationSpecs.filter(row => row.kind === 'Grupal' && row.capacityPoolId === pool && !row.cancel && row.modify === 'date')
            .reduce((sum,row) => sum + row.seatedCountExpected, 0) : 0;
      const finalSeats = reservationSpecs.filter(row => row.kind === 'Grupal' && row.capacityPoolId === pool
        && row.finalDate === date && !row.cancel).reduce((sum,row) => sum + row.seatedCountExpected, 0);
      const rows = [
        { phase: 'creation_temporal', seats: plannedCreationSeats },
        { phase: 'post_edits_and_cancellations_temporal', seats: plannedIntermediateSeats },
        { phase: 'final', seats: finalSeats },
      ];
      for (const item of rows) if (item.seats > capacity) {
        throw new Error(`Plan supera cupo: pool ${pool}, fecha ${date}, fase ${item.phase}, ${item.seats}/${capacity} asientos.`);
      }
      if (rows.some(item => item.seats > 0)) results.push({ poolId: pool, date, capacity, phases: rows.map(item => ({
        ...item, available: capacity - item.seats,
      })) });
    }
  }
  return results;
}

async function buildMidCapacityPlan(inputs,reservationSpecs,existingReservationMoves=[]) {
  const groupSpecs=reservationSpecs.filter(row=>row.kind==='Grupal');
  const poolIds=[...new Set(groupSpecs.map(row=>normalizeTourForCapacity(row.tourId)))].sort((a,b)=>a-b);
  const creationLots=[];const finalCapacity=[];const editTemporaryCapacity=[];
  for(const pool of poolIds){
    const capacity=await effectiveCapacity(db,pool,TEMP_DATE);
    const existing=await occupancyForPool(db,pool,TEMP_DATE);
    const maxSeats=capacity-existing;
    if(!capacity||maxSeats<2)throw new Error(`No hay capacidad temporal para pool ${pool}: ${existing}/${capacity}.`);
    const poolSpecs=groupSpecs.filter(row=>normalizeTourForCapacity(row.tourId)===pool).sort((a,b)=>a.sequence-b.sequence);
    let batch=[];let batchSeats=0;let index=0;
    for(const spec of poolSpecs){
      const seats=Number(spec.seatedCountExpected||2);
      if(seats>maxSeats)throw new Error(`Reserva ${spec.sequence} supera la capacidad de un lote temporal en pool ${pool}.`);
      if(batch.length&&batchSeats+seats>maxSeats){
        creationLots.push({poolId:pool,lot:index+1,reservations:batch.map(row=>row.sequence),reservationCount:batch.length,seats:batchSeats,capacity,existingSeats:existing});
        index+=1;batch=[];batchSeats=0;
      }
      batch.push(spec);batchSeats+=seats;
    }
    if(batch.length)creationLots.push({poolId:pool,lot:index+1,reservations:batch.map(row=>row.sequence),reservationCount:batch.length,seats:batchSeats,capacity,existingSeats:existing});
  }
  const finalMap=new Map();
  for(const spec of groupSpecs.filter(row=>!row.cancel)){
    const key=`${normalizeTourForCapacity(spec.tourId)}|${spec.finalDate}`;
    if(!finalMap.has(key))finalMap.set(key,{poolId:normalizeTourForCapacity(spec.tourId),date:spec.finalDate,
      plannedSeats:0,reservations:[],existingReservations:[]});
    const entry=finalMap.get(key);entry.plannedSeats+=Number(spec.seatedCountExpected||2);entry.reservations.push(spec.sequence);
  }
  for(const move of existingReservationMoves.filter(row=>row.type==='Grupal')){
    const poolId=normalizeTourForCapacity(move.tourId);const key=`${poolId}|${move.to}`;
    if(!finalMap.has(key))finalMap.set(key,{poolId,date:move.to,plannedSeats:0,reservations:[],existingReservations:[]});
    const entry=finalMap.get(key);entry.plannedSeats+=Number(move.seatedCount||0);entry.existingReservations.push(move.id);
  }
  for(const entry of finalMap.values()){
    const capacity=await effectiveCapacity(db,entry.poolId,entry.date);
    const existing=await occupancyForPool(db,entry.poolId,entry.date);
    const availability=await readAvailability(entry.poolId,entry.date);
    if(!capacity||existing+entry.plannedSeats>capacity)
      throw new Error(`Plan mid excede cupo final ${entry.poolId}/${entry.date}: actual ${existing} + planeado ${entry.plannedSeats} > ${capacity}.`);
    if(availability&&Number(availability.Cupos_Disponibles)!==capacity-existing)
      throw new Error(`Disponibilidad previa desincronizada ${entry.poolId}/${entry.date}: ${availability.Cupos_Disponibles}, esperada ${capacity-existing}.`);
    finalCapacity.push({...entry,existingSeats:existing,capacity,availableAfter:capacity-existing-entry.plannedSeats,
      availabilityBefore:availability?Number(availability.Cupos_Disponibles):null,ok:true});
  }
  const editMap=new Map();
  for(const spec of groupSpecs.filter(row=>row.updatedServiceDate)){
    const key=`${normalizeTourForCapacity(spec.tourId)}|${spec.updatedServiceDate}`;
    if(!editMap.has(key))editMap.set(key,{poolId:normalizeTourForCapacity(spec.tourId),date:spec.updatedServiceDate,plannedSeats:0,reservations:[]});
    const entry=editMap.get(key);entry.plannedSeats+=Number(spec.seatedCountExpected||2);entry.reservations.push(spec.sequence);
  }
  for(const entry of editMap.values()){
    const capacity=await effectiveCapacity(db,entry.poolId,entry.date);
    const existing=await occupancyForPool(db,entry.poolId,entry.date);
    const availability=await readAvailability(entry.poolId,entry.date);
    if(!capacity||existing+entry.plannedSeats>capacity)
      throw new Error(`Plan mid excede cupo temporal de edición ${entry.poolId}/${entry.date}: ${existing}+${entry.plannedSeats}>${capacity}.`);
    if(availability&&Number(availability.Cupos_Disponibles)!==capacity-existing)
      throw new Error(`Disponibilidad previa desincronizada en fecha temporal de edición ${entry.poolId}/${entry.date}.`);
    editTemporaryCapacity.push({...entry,existingSeats:existing,capacity,availableAfter:capacity-existing-entry.plannedSeats,
      availabilityBefore:availability?Number(availability.Cupos_Disponibles):null,ok:true});
  }
  return {temporaryDate:TEMP_DATE,secondTemporaryDate:SECOND_TEMP_DATE,creationLots,finalCapacity,editTemporaryCapacity,
    totalGroupReservations:groupSpecs.length,totalSeats:groupSpecs.reduce((sum,row)=>sum+Number(row.seatedCountExpected||2),0)};
}

function buildSilleteroReadout(inputs) {
  const horizon=serviceDateHorizon();
  const from=horizon[0];const through=horizon[horizon.length-1];
  const futureDates=horizon.filter(date=>date>TODAY&&isOperatingDay(inputs,6,date));
  return {
    tourId: 6,
    seasons: inputs.seasons.filter(row => Number(row.Id_Tour) === 6).map(row => ({
      id: Number(row.Id_Temporada), name: row.Nombre_Temporada, start: row.Fecha_Inicio, end: row.Fecha_Fin,
      operatingDays: [...(inputs.seasonDayMap.get(Number(row.Id_Temporada)) || [])].sort(),
    })),
    weeklyOperatingDays: [...(inputs.dayMap.get(6) || [])].sort(),
    horizon: { from, through }, futureValidDates: futureDates,
  };
}

async function assertNoPreExistingRunData(runId) {
  const marker = `ZZ_TEST_${runId}`;
  const matches = await assertNoExactMarker(marker);
  if (matches.length) throw new Error(`Ya existen datos con el marcador ${marker}: ${JSON.stringify(matches)}.`);
}

async function assertNoExactMarker(marker) {
  const [columns] = await db.query(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN
      ('char','varchar','tinytext','text','mediumtext','longtext','json','enum','set')
    ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const tableMap = new Map();
  for (const item of columns) {
    if (!tableMap.has(item.TABLE_NAME)) tableMap.set(item.TABLE_NAME, []);
    tableMap.get(item.TABLE_NAME).push(item.COLUMN_NAME);
  }
  const matches = [];
  for (const [table, names] of tableMap) {
    const where = names.map(column => `LOCATE(?,CAST(${quoteId(column)} AS CHAR))>0`).join(' OR ');
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${quoteId(table)} WHERE ${where}`, names.map(() => marker));
    if (Number(row.n)) matches.push({ table, rows: Number(row.n) });
  }
  return matches;
}

async function createInputsForSpec(spec, inputs) {
  if (spec.createPayload) return spec.createPayload;
  const schedule = inputs.schedules[spec.tourId];
  const plan = inputs.planPrices[spec.tourId];
  const channel = inputs.channelMap.get(spec.channelId);
  const commissionable = Number(channel.Tiene_Comision) === 1;
  if (!inputs.commissionDefaultsCache) inputs.commissionDefaultsCache = new Map();
  const commissionKey = `${spec.tourId}|${spec.channelId}`;
  if (commissionable && !inputs.commissionDefaultsCache.has(commissionKey)) {
    inputs.commissionDefaultsCache.set(commissionKey, await reservas.obtenerComisiones(spec.tourId, spec.channelId));
  }
  const defaults = inputs.commissionDefaultsCache.get(commissionKey) || {};
  const basePassengers = spec.kind === 'Privada' ? 15 : 2;
  const includesInfant = spec.kind === 'Grupal' && [2,3,8,10].includes(spec.tourId) && spec.sequence % 9 === 0;
  spec.passengerCountExpected = basePassengers + (includesInfant ? 1 : 0);
  spec.seatedCountExpected = spec.kind === 'Privada' ? 0 : 2;
  spec.willHaveInfant = includesInfant;
  const passengerRows = [];
  for (let index = 0; index < spec.passengerCountExpected; index += 1) {
    const type = spec.kind === 'Privada' ? 'ADULTO' : (index === 0 ? 'ADULTO' : index === 1 ? 'NIÑO' : 'INFANTE');
    if (type === 'INFANTE' && plan.prices.INFANTE == null) throw new Error(`Falta precio de infante para tour ${spec.tourId}.`);
    const baseNumber = 990000000000 + spec.sequence * 100 + index;
    const phoneNumber = 3990020000 + spec.sequence * 10 + index;
    const expectedCommission = type === 'INFANTE' || !commissionable ? 0
      : Number(defaults[normalizePassengerType(type)] || 0);
    passengerRows.push({
      Nombre_Pasajero: `${MARKER}_PASAJERO_${String(spec.sequence).padStart(3, '0')}_${String(index + 1).padStart(2, '0')}`,
      DNI: String(baseNumber), Nacionalidad: 'Colombiana', Telefono_Pasajero: `+57${phoneNumber}`,
      Tipo_Pasajero: type, Edad: type === 'NIÑO' ? 10 : undefined,
      Id_Plan: Number(plan.Id_Plan), Precio_Tour: Number(plan.prices[type] || 0),
      Precio_Pasajero: Number(plan.prices[type] || 0), Comision: expectedCommission,
      Id_Punto: Number(schedule.Id_Punto), Confirmacion: spec.role === 'agency-commission-group'
        ? 1 : ((spec.sequence + index) % 2),
    });
  }
  const markerNote = `${MARKER} | ${args.stage} | ${spec.kind} | ${spec.finalDate}`;
  spec.createPayload = {
    cabeceraReserva: {
      Id_Tour: spec.tourId, Id_Horario: Number(schedule.Id_Horario), Fecha_Tour: TEMP_DATE,
      Tipo_Reserva: spec.kind, Id_Canal: spec.channelId,
      Id_Entidad_Reportante: spec.entity ? Number(spec.entity.Id_Entidad_Reportante) : null,
      Id_Moneda: 1, Idioma_Reserva: 'ESPAÑOL', Telefono_Reportante: spec.reporterPhone,
      Nombre_Reportante: spec.reporterName, Observaciones: markerNote, Id_Punto: Number(schedule.Id_Punto),
    },
    pasajeros: passengerRows,
    pagos: [{ Tipo: 'Pago Directo', Monto: 0, Observaciones: `Pago en el punto; etapa ${args.stage} sir2.` }],
  };
  return spec.createPayload;
}

async function createReservation(spec, actorId, inputs) {
  const payload = spec.createPayload || await createInputsForSpec(spec, inputs);
  const serviceResult = await timed(`service:createReservation:${spec.sequence}`, () =>
    reservas.crearReservaConPasajerosYPagos(payload, {}, actorId));
  if (!serviceResult?.Id_Reserva) throw new Error(`El servicio no devolvió Id_Reserva para secuencia ${spec.sequence}.`);
  const [[row]] = await db.query(`SELECT r.Id_Reserva,r.Estado,r.Tipo_Reserva,
      DATE_FORMAT(r.Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      DATE_FORMAT(r.Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      r.Id_Canal,r.Id_Entidad_Reportante,r.Observaciones,r.Creado_Por,
      h.Id_Tour FROM reservas r LEFT JOIN horarios h ON h.Id_Horario=r.Id_Horario
    WHERE r.Id_Reserva=? LIMIT 1`, [serviceResult.Id_Reserva]);
  if (!row || row.Fecha_Tour !== TEMP_DATE || Number(row.Id_Tour) !== spec.tourId
      || Number(row.Id_Canal) !== spec.channelId || !String(row.Observaciones || '').includes(MARKER)) {
    throw new Error(`La reserva ${serviceResult.Id_Reserva} no coincide con el payload/marker esperado.`);
  }
  if(Number(row.Creado_Por)!==Number(actorId))throw new Error(`La reserva ${row.Id_Reserva} quedó atribuida a ${row.Creado_Por}, actor esperado ${actorId}.`);
  if (row.Estado !== 'Confirmada') throw new Error(`Reserva ${row.Id_Reserva}: se esperaba Confirmada temporal, recibido ${row.Estado}.`);
  spec.Id_Reserva = String(row.Id_Reserva);
  spec.serviceStateAtCreate = row.Estado;
  spec.expectedCommissions = Object.fromEntries(payload.pasajeros.map(p => [p.DNI, Number(p.Comision)]));
  await programacionNovedades.syncForReservationChange({ reservationId: spec.Id_Reserva, fecha: TEMP_DATE });
  return row;
}

async function updateReservation(spec, actorId, inputs) {
  const [[header]] = await db.query(`SELECT r.Id_Reserva,r.Tipo_Reserva,r.Id_Horario,
      DATE_FORMAT(r.Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,r.Id_Canal,r.Id_Entidad_Reportante,
      r.Id_Moneda,r.Idioma_Reserva,r.Telefono_Reportante,r.Nombre_Reportante,r.Observaciones,
      h.Id_Tour,h.Id_Punto
    FROM reservas r LEFT JOIN horarios h ON h.Id_Horario=r.Id_Horario WHERE r.Id_Reserva=?`, [spec.Id_Reserva]);
  const [passengers] = await db.query(`SELECT Id_Pasajero,Nombre_Pasajero,DNI,Nacionalidad,
      Telefono_Pasajero,Tipo_Pasajero,Id_Plan,Precio_Tour,Precio_Pasajero,Comision,Id_Punto,Confirmacion
    FROM pasajeros WHERE Id_Reserva=? ORDER BY Id_Pasajero`, [spec.Id_Reserva]);
  const [payments] = await db.query(`SELECT Tipo,Monto,Observaciones,DATE_FORMAT(Fecha_Pago,'%Y-%m-%d %H:%i:%s') AS Fecha_Pago
    FROM pagos_reservas WHERE Id_Reserva=? ORDER BY Id_Pago`, [spec.Id_Reserva]);
  if (!header || !passengers.length || !payments.length) throw new Error(`No se pudo reconstruir el payload de edición para ${spec.Id_Reserva}.`);
  const cabeceraReserva = {
    Id_Tour: Number(header.Id_Tour), Id_Horario: Number(header.Id_Horario), Fecha_Tour: header.Fecha_Tour,
    Tipo_Reserva: header.Tipo_Reserva, Id_Canal: Number(header.Id_Canal),
    Id_Entidad_Reportante: header.Id_Entidad_Reportante == null ? null : Number(header.Id_Entidad_Reportante),
    Id_Moneda: Number(header.Id_Moneda), Idioma_Reserva: header.Idioma_Reserva,
    Telefono_Reportante: header.Telefono_Reportante, Nombre_Reportante: header.Nombre_Reportante,
    Observaciones: header.Observaciones, Id_Punto: Number(header.Id_Punto),
  };
  const pasajeroPayload = passengers.map(row => ({
    ...row, Id_Pasajero: Number(row.Id_Pasajero), Id_Plan: Number(row.Id_Plan),
    Precio_Tour: Number(row.Precio_Tour), Precio_Pasajero: Number(row.Precio_Pasajero),
    Comision: Number(row.Comision), Id_Punto: Number(row.Id_Punto), Confirmacion: Number(row.Confirmacion),
  }));
  if (spec.modify === 'passenger') pasajeroPayload[0].Nombre_Pasajero += ' Editado';
  if (spec.modify === 'reporter') {
    cabeceraReserva.Nombre_Reportante += '_DATOS_ACTUALIZADOS';
    cabeceraReserva.Telefono_Reportante = `+573990020${String(spec.sequence).padStart(3, '0')}`;
  }
  if (spec.modify === 'date') cabeceraReserva.Fecha_Tour = spec.updatedServiceDate;
  const payload = { cabeceraReserva, pasajeros: pasajeroPayload,
    pagos: payments.map(row => ({ Tipo: row.Tipo, Monto: Number(row.Monto), Observaciones: row.Observaciones || 'Pago en el punto; etapa piloto sir2.' })) };
  const userId = actorId;
  await timed(`service:updateReservation:${spec.sequence}:${spec.modify}`, () =>
    reservas.actualizarReservaConPasajerosYPagos(spec.Id_Reserva, payload, {}, userId));
  const expectedDate = spec.modify === 'date' ? spec.updatedServiceDate : TEMP_DATE;
  const [[after]] = await db.query(`SELECT Estado,Actualizado_Por,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour
    FROM reservas WHERE Id_Reserva=?`, [spec.Id_Reserva]);
  if (!after || after.Fecha_Tour !== expectedDate || after.Estado !== 'Confirmada') {
    throw new Error(`Edición de ${spec.Id_Reserva}: esperado Confirmada/${expectedDate}, recibido ${after?.Estado}/${after?.Fecha_Tour}.`);
  }
  if(Number(after.Actualizado_Por)!==Number(userId))throw new Error(`La edición de ${spec.Id_Reserva} quedó atribuida a ${after.Actualizado_Por}, actor esperado ${userId}.`);
  if(spec.requireDateHistory){
    const [[history]]=await db.query(`SELECT h.Id_Historial,h.Id_Usuario,d.Valor_Anterior,d.Valor_Nuevo
      FROM historial h JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
      WHERE LOWER(h.Tabla)='reservas' AND h.Id_Registro=? AND h.Accion='ACTUALIZAR_RESERVA'
        AND d.Columna='Fecha_Tour' AND d.Valor_Anterior=? AND d.Valor_Nuevo=? AND h.Id_Usuario=?
      ORDER BY h.Id_Historial DESC LIMIT 1`,[String(spec.Id_Reserva),spec.serviceDateBeforeMove,expectedDate,Number(userId)]);
    if(!history)throw new Error(`El servicio no registró Fecha_Tour ${spec.serviceDateBeforeMove}→${expectedDate} en historial para ${spec.Id_Reserva}.`);
    spec.serviceDateHistory={Id_Historial:Number(history.Id_Historial),from:String(history.Valor_Anterior),
      to:String(history.Valor_Nuevo),actorId:Number(history.Id_Usuario)};
  }
  await programacionNovedades.syncForReservationChange({ reservationId: spec.Id_Reserva, fecha: expectedDate });
  spec.serviceUpdate = { type: spec.modify, serviceDateAfter: expectedDate, actorId: Number(userId) };
}

async function cancelReservation(spec, actorId) {
  const result = await timed(`service:cancelReservation:${spec.sequence}`, () =>
    reservas.cancelarReservaSvc(spec.Id_Reserva, actorId));
  if (result?.Estado !== 'Cancelada') throw new Error(`Cancelación ${spec.Id_Reserva}: estado devuelto ${result?.Estado}.`);
  const [[row]] = await db.query('SELECT Estado,Actualizado_Por FROM reservas WHERE Id_Reserva=?', [spec.Id_Reserva]);
  if (row?.Estado !== 'Cancelada') throw new Error(`Cancelación ${spec.Id_Reserva}: la BD no quedó Cancelada.`);
  if(Number(row.Actualizado_Por)!==Number(actorId))throw new Error(`La cancelación ${spec.Id_Reserva} quedó atribuida a ${row.Actualizado_Por}, actor esperado ${actorId}.`);
  await programacionNovedades.syncForReservationChange({ reservationId: spec.Id_Reserva, fecha: TEMP_DATE });
  spec.serviceCancel = { state: row.Estado, actorId: Number(actorId) };
}

function buildTransferPayload(spec, inputs) {
  const people = 2;
  const range = inputs.ranges.find(row => Number(row.Minimo) <= people && (row.Maximo == null || Number(row.Maximo) >= people));
  const price = inputs.transferPrices.find(row => Number(row.Id_Rango) === Number(range?.Id_Rango) && Number(row.Id_Moneda) === 1);
  if (!range || !price) throw new Error('No se encontró rango/precio COP para el transfer piloto.');
  const servicePayload = {
    Id_Canal: spec.channelId,
    Id_Entidad_Reportante: spec.entity ? Number(spec.entity.Id_Entidad_Reportante) : null,
    Titular: spec.holder, DNI: String(989000000000 + spec.sequence),
    Tel_Contacto: `+573990030${String(spec.sequence).padStart(3, '0')}`,
    Cantidad_Personas: people, Servicio: 1, Salida: 'AEROPUERTO JOSE MARIA CORDOVA',
    Llegada: `${MARKER}_DESTINO_HOTEL_FICTICIO`, FechaTransfer: spec.finalDate,
    HoraRecogida: '10:30 AM', NombreReporta: spec.reporterName,
    TelefonoTransfer: `+573990040${String(spec.sequence).padStart(3, '0')}`,
    Moneda: 'COP', Pago: { Tipo: 'PagaEnPunto', Observaciones: `Pago en el punto; etapa ${args.stage} sir2.` },
    Observaciones: `${MARKER} | ${args.stage} | transfer | ${spec.finalDate}`,
  };
  return { servicePayload, range, price, people, expectedValue:Number(price.Precio) };
}

async function createTransfer(spec, actorId, inputs) {
  const { servicePayload } = spec.transferPlan || buildTransferPayload(spec, inputs);
  const created = await timed(`service:createTransfer:${spec.sequence}`, () =>
    transfers.crearTransferSvc(servicePayload, { userId: actorId }));
  if (!created?.Id_Transfer) throw new Error(`crearTransferSvc no devolvió Id_Transfer para ${spec.sequence}.`);
  const [[row]] = await db.query(`SELECT Id_Transfer,CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer,
      Id_Canal,Id_Entidad_Reportante,Id_Servicio,Id_Rango,Valor,Id_Moneda,Estado,
      DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      Observaciones,Creado_Por
    FROM transfers WHERE Id_Transfer=?`, [created.Id_Transfer]);
  if (!row || row.Codigo_Transfer !== created.Codigo_Transfer || Number(row.Creado_Por)!==Number(actorId)
      || !String(row.Observaciones || '').includes(MARKER)) {
    throw new Error(`Código/marker del transfer ${created.Id_Transfer} difiere del servicio.`);
  }
  const serviceDate=spec.serviceDateAtCreate||spec.finalDate;
  const expectedState = expectedTransferStateAt({finalDate:serviceDate},TODAY);
  if (row.Estado !== expectedState || row.Fecha_Transfer !== serviceDate) {
    throw new Error(`Transfer ${row.Codigo_Transfer}: esperado ${expectedState}/${serviceDate} al crear, recibido ${row.Estado}/${row.Fecha_Transfer}.`);
  }
  spec.Id_Transfer = Number(row.Id_Transfer);
  spec.Codigo_Transfer = row.Codigo_Transfer;
  spec.serviceStateAtCreate = row.Estado;
  spec.valor = Number(row.Valor);
  spec.actorId = Number(actorId);
  return row;
}

async function updateCreatedPastTransferToFinalDate(spec,actorId,inputs){
  const [[before]]=await db.query(`SELECT Id_Transfer,CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer,
      DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,Observaciones
    FROM transfers WHERE Id_Transfer=?`,[spec.Id_Transfer]);
  if(!before||before.Fecha_Transfer!==TEMP_DATE||before.Codigo_Transfer!==spec.Codigo_Transfer
      ||!String(before.Observaciones||'').includes(MARKER))
    throw new Error(`Transfer temporal ${spec.Id_Transfer} no coincide antes del movimiento: ${JSON.stringify(before)}.`);
  const payload={...buildTransferPayload(spec,inputs).servicePayload,FechaTransfer:spec.finalDate,
    Pago:{Tipo:'PagaEnPunto',Observaciones:`Pago en el punto; movimiento de fecha full ${MARKER}.`}};
  const updated=await timed(`service:movePastTransfer:${spec.sequence}`,()=>transfers.actualizarTransferSvc(spec.Id_Transfer,payload,actorId));
  const [[after]]=await db.query(`SELECT Id_Transfer,Estado,DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer,Observaciones,Actualizado_Por
    FROM transfers WHERE Id_Transfer=?`,[spec.Id_Transfer]);
  const expectedState=expectedTransferStateAt(spec,TODAY);
  if(!after||after.Fecha_Transfer!==spec.finalDate||after.Estado!==expectedState||after.Codigo_Transfer!==spec.Codigo_Transfer
      ||!String(after.Observaciones||'').includes(MARKER)||Number(after.Actualizado_Por)!==Number(actorId))
    throw new Error(`Transfer ${spec.Codigo_Transfer} no se movió por servicio a ${spec.finalDate}: ${JSON.stringify(after)}.`);
  return {Id_Transfer:Number(spec.Id_Transfer),Codigo_Transfer:spec.Codigo_Transfer,from:TEMP_DATE,to:spec.finalDate,
    stateAtCreate:spec.serviceStateAtCreate,stateAfter:after.Estado,actorId:Number(actorId),serviceResult:updated};
}

async function readAvailability(pool, date) {
  const [[row]] = await db.query(`SELECT Id_Disponibilidad,Id_Tour,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,Cupos_Totales,Cupos_Disponibles,
      DATE_FORMAT(Updated_At,'%Y-%m-%d %H:%i:%s.%f') AS Updated_At
    FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=? LIMIT 1`, [pool, date]);
  return row || null;
}

async function effectiveCapacity(conn, pool, date) {
  const [[row]] = await conn.query(`SELECT COALESCE(
      (SELECT CASE WHEN a.Operacion='USAR_BASE' THEN NULL ELSE a.Cupo END
         FROM aforos a WHERE a.Id_Tour=? AND a.Fecha_Aforo=? ORDER BY a.Id_Aforo DESC LIMIT 1),
      t.Cupo_Base) AS CupoTotal
    FROM tours t WHERE t.Id_Tour=?`, [pool, date, pool]);
  return Number(row?.CupoTotal || 0);
}

async function occupancyForPool(conn, pool, date) {
  const tourPredicate = Number(pool) === 5 ? 'h.Id_Tour IN (1,5)' : 'h.Id_Tour=?';
  const params = Number(pool) === 5 ? [date] : [pool, date];
  const [[row]] = await conn.query(`SELECT COALESCE(SUM(CASE
      WHEN UPPER(TRIM(COALESCE(p.Tipo_Pasajero,''))) IN ('ADULTO','NIÑO','NINO') THEN 1 ELSE 0 END),0) AS seats
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario
    JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE ${tourPredicate} AND r.Fecha_Tour=?
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva,'')))='GRUPAL'
      AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO')
      AND r.Eliminada_En IS NULL`, params);
  return Number(row.seats || 0);
}

async function allNewHistoryForReservation(id) {
  const [rows] = await db.query(`SELECT h.Id_Historial,h.Tabla,h.Id_Registro,h.Accion,h.Id_Usuario,
      DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s.%f') AS Fecha_Hora_Registro
    FROM historial h WHERE LOWER(h.Tabla)='reservas' AND h.Id_Registro=? ORDER BY h.Id_Historial`, [String(id)]);
  return rows;
}

async function reconcileReservationPool(pool, rowsForPool, baselineAvailabilityKeys) {
  const conn = await db.getConnection();
  const started = performance.now();
  const sources = [...new Set(rowsForPool.map(row => row.serviceDateBeforeMove))];
  const destinations = [...new Set(rowsForPool.filter(row => row.kind === 'Grupal').map(row => row.finalDate))];
  const allKeys = [...new Set([...sources, ...destinations])].map(date => ({ Id_Tour: pool, Fecha_Tour: date }));
  const availabilityBefore = [];
  for (const key of allKeys) availabilityBefore.push({ key, row: await readAvailability(pool, key.Fecha_Tour) });
  const historyBefore = [];
  for (const row of rowsForPool) historyBefore.push({ id: row.Id_Reserva, rows: await allNewHistoryForReservation(row.Id_Reserva) });
  manifest.controlledSql.availabilityBefore.push(...availabilityBefore);
  manifest.controlledSql.reservationHistoryBefore.push(...historyBefore);
  await writeManifest();
  try {
    await conn.beginTransaction();
    for (const row of rowsForPool) {
      const [moved] = await conn.query(`UPDATE reservas SET Fecha_Tour=?,Fecha_Registro=?
        WHERE Id_Reserva=? AND Fecha_Tour=?`, [row.finalDate, row.registrationDateTime, row.Id_Reserva, row.serviceDateBeforeMove]);
      if (Number(moved.affectedRows) !== 1) throw new Error(`Movimiento de ${row.Id_Reserva}: filas ${moved.affectedRows}, esperado 1.`);
      const histories = historyBefore.find(item => item.id === row.Id_Reserva)?.rows || [];
      for (let index = 0; index < histories.length; index += 1) {
        const eventDate = new Date(`${row.registrationDateTime.replace(' ', 'T')}Z`);
        eventDate.setUTCMinutes(eventDate.getUTCMinutes() + 5 + index);
        const eventTimestamp = eventDate.toISOString().slice(0,19).replace('T',' ');
        const [updated] = await conn.query('UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial=?', [eventTimestamp, histories[index].Id_Historial]);
        if (Number(updated.affectedRows) !== 1) throw new Error(`Historial ${histories[index].Id_Historial}: filas afectadas ${updated.affectedRows}.`);
        manifest.controlledSql.historyAfter.push({ Id_Historial: Number(histories[index].Id_Historial), Fecha_Hora_Registro: eventTimestamp });
      }
    }
    const destinationState = [];
    for (const date of destinations) {
      const total = await effectiveCapacity(conn, pool, date);
      const seats = await occupancyForPool(conn, pool, date);
      if (!total || seats > total) throw new Error(`Aforo destino pool ${pool}/${date}: ${seats} activos, capacidad ${total}.`);
      const [upsert] = await conn.query(`INSERT INTO disponibilidad (Id_Tour,Fecha_Tour,Cupos_Totales,Cupos_Disponibles)
        VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE Cupos_Totales=VALUES(Cupos_Totales),
          Cupos_Disponibles=VALUES(Cupos_Disponibles),Updated_At=CURRENT_TIMESTAMP(3)`, [pool,date,total,total-seats]);
      const [[check]] = await conn.query(`SELECT Cupos_Totales,Cupos_Disponibles FROM disponibilidad
        WHERE Id_Tour=? AND Fecha_Tour=? FOR UPDATE`, [pool,date]);
      if (!check || Number(check.Cupos_Totales) !== total || Number(check.Cupos_Disponibles) !== total-seats) {
        throw new Error(`Disponibilidad destino no reconcilia ${pool}/${date}: ${JSON.stringify(check)} vs ${total-seats}.`);
      }
      destinationState.push({ key:{Id_Tour:pool,Fecha_Tour:date}, Cupos_Totales:total,Cupos_Disponibles:total-seats,asientosActivos:seats, upsertAffected:Number(upsert.affectedRows) });
    }
    const sourceState = [];
    for (const date of sources) {
      const seats = await occupancyForPool(conn, pool, date);
      if (seats !== 0) throw new Error(`Quedan ${seats} asientos en la fecha temporal pool ${pool}/${date}.`);
      const baseline = baselineAvailabilityKeys.some(item => Number(item[0]) === Number(pool) && item[1] === date);
      if (baseline) {
        const total = await effectiveCapacity(conn, pool, date);
        const [updated] = await conn.query(`UPDATE disponibilidad SET Cupos_Totales=?,Cupos_Disponibles=?,Updated_At=CURRENT_TIMESTAMP(3)
          WHERE Id_Tour=? AND Fecha_Tour=?`, [total,total,pool,date]);
        if (Number(updated.affectedRows) !== 1) throw new Error(`No se restauró la disponibilidad baseline ${pool}/${date}.`);
        sourceState.push({ key:{Id_Tour:pool,Fecha_Tour:date}, restored:true, Cupos_Totales:total,Cupos_Disponibles:total });
      } else {
        const [deleted] = await conn.query('DELETE FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=?', [pool,date]);
        if (Number(deleted.affectedRows) > 1) throw new Error(`Se borraron ${deleted.affectedRows} filas temporales ${pool}/${date}.`);
        sourceState.push({ key:{Id_Tour:pool,Fecha_Tour:date}, restored:false, deleted:Number(deleted.affectedRows), seatsAfter:0 });
      }
    }
    for (const key of [...destinations, ...sources]) {
      const expected = destinations.includes(key)
        ? destinationState.find(item => item.key.Fecha_Tour === key)
        : null;
      if (expected) {
        const [[row]] = await conn.query('SELECT Cupos_Totales,Cupos_Disponibles FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=?', [pool,key]);
        if (!row || Number(row.Cupos_Disponibles) !== Number(expected.Cupos_Disponibles)) throw new Error(`Disponibilidad no coincide antes de COMMIT para ${pool}/${key}.`);
      } else if (!baselineAvailabilityKeys.some(item => Number(item[0]) === Number(pool) && item[1] === key)) {
        const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=?', [pool,key]);
        if (Number(row.n) !== 0) throw new Error(`La fecha temporal ${pool}/${key} no quedó eliminada antes de COMMIT.`);
      }
    }
    await conn.commit();
    manifest.controlledSql.poolTransactions.push({ pool, reservationIds: rowsForPool.map(row=>row.Id_Reserva), sourceState,destinationState,
      durationMs:Number((performance.now()-started).toFixed(2)), committed:true });
    await writeManifest();
  } catch (error) {
    await conn.rollback();
    manifest.controlledSql.poolTransactions.push({ pool,reservationIds:rowsForPool.map(row=>row.Id_Reserva),
      durationMs:Number((performance.now()-started).toFixed(2)),committed:false,error:errorJson(error) });
    await writeManifest();
    throw error;
  } finally { conn.release(); }
}

async function movePrivateReservations(specs) {
  const groups = new Map();
  for (const spec of specs.filter(item => item.kind === 'Privada')) {
    const key = String(spec.tourId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spec);
  }
  for (const [tourId, rows] of groups) {
    const conn = await db.getConnection();
    const started = performance.now();
    const before = [];
    try {
      for (const spec of rows) {
        const [[row]] = await db.query(`SELECT Id_Reserva,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
            DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro
          FROM reservas WHERE Id_Reserva=?`, [spec.Id_Reserva]);
        if (!row || row.Fecha_Tour !== TEMP_DATE) throw new Error(`Reserva privada ${spec.Id_Reserva}: fecha previa ${row?.Fecha_Tour}, esperada ${TEMP_DATE}.`);
        const history = await allNewHistoryForReservation(spec.Id_Reserva);
        before.push({ Id_Reserva: spec.Id_Reserva, row, history });
      }
      manifest.controlledSql.privateReservationsBefore.push(...before);
      await writeManifest();
      await conn.beginTransaction();
      for (const spec of rows) {
        const [updated] = await conn.query(`UPDATE reservas SET Fecha_Tour=?,Fecha_Registro=?
          WHERE Id_Reserva=? AND Fecha_Tour=?`, [spec.finalDate,spec.registrationDateTime,spec.Id_Reserva,TEMP_DATE]);
        if (Number(updated.affectedRows) !== 1) throw new Error(`Movimiento privado ${spec.Id_Reserva}: filas ${updated.affectedRows}, esperado 1.`);
        const entry = before.find(item => item.Id_Reserva === spec.Id_Reserva);
        for (let index=0;index<entry.history.length;index+=1) {
          const eventDate = new Date(`${spec.registrationDateTime.replace(' ','T')}Z`);
          eventDate.setUTCMinutes(eventDate.getUTCMinutes()+5+index);
          const timestamp = eventDate.toISOString().slice(0,19).replace('T',' ');
          const [changed] = await conn.query('UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial=?', [timestamp,entry.history[index].Id_Historial]);
          if (Number(changed.affectedRows)!==1) throw new Error(`Historial de reserva privada ${entry.history[index].Id_Historial}: filas ${changed.affectedRows}.`);
          manifest.controlledSql.historyAfter.push({Id_Historial:Number(entry.history[index].Id_Historial),Fecha_Hora_Registro:timestamp});
        }
        const [[verify]] = await conn.query(`SELECT DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
            DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro
          FROM reservas WHERE Id_Reserva=?`, [spec.Id_Reserva]);
        if (verify?.Fecha_Tour!==spec.finalDate||verify?.Fecha_Registro!==spec.registrationDateTime) {
          throw new Error(`Reserva privada ${spec.Id_Reserva} no coincide antes de COMMIT: ${JSON.stringify(verify)}.`);
        }
        spec.serviceDateBeforeMove=TEMP_DATE;
        spec.originalDate=TEMP_DATE;
        const operation=manifest.operations.reservations.find(item=>item.Id_Reserva===spec.Id_Reserva);
        if (operation) { operation.originalDate=TEMP_DATE; operation.finalDate=spec.finalDate; }
      }
      await conn.commit();
      manifest.controlledSql.privateTransactions.push({tourId:Number(tourId),reservationIds:rows.map(item=>item.Id_Reserva),
        durationMs:Number((performance.now()-started).toFixed(2)),committed:true,
        capacityImpact:'PRIVADA: no ocupa cupo grupal; no se alteró disponibilidad.',
        availabilityKeys:rows.map(item=>({original:item.originalAvailabilityKey,final:item.finalAvailabilityKey}))});
      await writeManifest();
    } catch(error) {
      try { await conn.rollback(); } catch {}
      manifest.controlledSql.privateTransactions.push({tourId:Number(tourId),reservationIds:rows.map(item=>item.Id_Reserva),
        durationMs:Number((performance.now()-started).toFixed(2)),committed:false,error:errorJson(error)});
      await writeManifest();
      throw error;
    } finally { conn.release(); }
  }
}

async function backdateTransfers(transferSpecs) {
  const before = [];
  for (const spec of transferSpecs) {
    const [[row]] = await db.query(`SELECT Id_Transfer,DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      DATE_FORMAT(Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro FROM transfers WHERE Id_Transfer=?`, [spec.Id_Transfer]);
    const [history] = await db.query(`SELECT Id_Historial,Accion,
        DATE_FORMAT(Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s.%f') AS Fecha_Hora_Registro
      FROM historial WHERE LOWER(Tabla)='transfers' AND Id_Registro=? ORDER BY Id_Historial`, [String(spec.Id_Transfer)]);
    before.push({ Id_Transfer: spec.Id_Transfer,row,history });
  }
  manifest.controlledSql.transfersBefore.push(...before);
  await writeManifest();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const spec of transferSpecs) {
      const [updated] = await conn.query('UPDATE transfers SET Fecha_Registro=? WHERE Id_Transfer=?', [spec.registrationDateTime,spec.Id_Transfer]);
      if (Number(updated.affectedRows) !== 1) throw new Error(`Fecha_Registro de transfer ${spec.Id_Transfer}: filas ${updated.affectedRows}.`);
      const entry = before.find(item => item.Id_Transfer === spec.Id_Transfer);
      for (let i=0;i<entry.history.length;i+=1) {
        const dt = new Date(`${spec.registrationDateTime.replace(' ','T')}Z`); dt.setUTCMinutes(dt.getUTCMinutes()+5+i);
        const timestamp = dt.toISOString().slice(0,19).replace('T',' ');
        const [changed] = await conn.query('UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial=?',[timestamp,entry.history[i].Id_Historial]);
        if (Number(changed.affectedRows)!==1) throw new Error(`Historial transfer ${entry.history[i].Id_Historial}: filas ${changed.affectedRows}.`);
        manifest.controlledSql.historyAfter.push({Id_Historial:Number(entry.history[i].Id_Historial),Fecha_Hora_Registro:timestamp});
      }
      manifest.controlledSql.transferRegisterAfter.push({Id_Transfer:spec.Id_Transfer,Fecha_Registro:spec.registrationDateTime,Fecha_Transfer:spec.finalDate});
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  await writeManifest();
}

async function backdateAutomaticReservationStateHistory(reservationSpecs) {
  const ids = reservationSpecs.map(item => String(item.Id_Reserva));
  const [rows] = await db.query(`SELECT Id_Historial,Id_Registro
    FROM historial WHERE LOWER(Tabla)='reservas' AND Accion='ACTUALIZAR_ESTADO_AUTOMATICO'
      AND Id_Registro IN (?) AND Id_Historial>? ORDER BY Id_Historial`,
    [ids,Number(manifest.baselineMaxIds?.historial||0)]);
  const byId = new Map(reservationSpecs.map(item=>[String(item.Id_Reserva),item]));
  const nextMinute = new Map();
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    for(const row of rows){
      const spec=byId.get(String(row.Id_Registro));
      if(!spec)throw new Error(`Historial automático ${row.Id_Historial} no pertenece al piloto.`);
      const minute=Number(nextMinute.get(String(row.Id_Registro))||30);
      const timestamp=`${spec.finalDate} 13:${String(minute).padStart(2,'0')}:00`;
      const [updated]=await conn.query('UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial=?',[timestamp,row.Id_Historial]);
      if(Number(updated.affectedRows)!==1)throw new Error(`Historial automático ${row.Id_Historial}: filas ${updated.affectedRows}, esperado 1.`);
      nextMinute.set(String(row.Id_Registro),minute+1);
      manifest.controlledSql.automaticStateHistoryAfter.push({Id_Historial:Number(row.Id_Historial),Id_Reserva:String(row.Id_Registro),Fecha_Hora_Registro:timestamp});
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  await writeManifest();
  return rows.length;
}

async function closeAgencyCommissionJourney(specs, actorId) {
  const target = specs.filter(row => row.role === 'agency-commission-group');
  const passengers = await confirmacion.obtenerPasajerosPorTour(2, '2026-10-23');
  const targetIds = new Set(target.map(row => row.Id_Reserva));
  const targetPassengers = passengers.filter(row => targetIds.has(String(row.Id_Reserva)));
  if (targetPassengers.length !== 6) throw new Error(`Grupo comisionable: pasajeros encontrados ${targetPassengers.length}, esperado 6.`);
  const result = await timed('service:closeCommissionJourney', () => confirmacion.actualizarConfirmacion({
    Id_Tour: 2, Fecha: '2026-10-23',
    // Preserve the mixed travel-confirmation sample; target agency group all travelled.
    pasajeros: passengers.map(row => ({ Id_Pasajero:Number(row.Id_Pasajero), Confirmacion:targetIds.has(String(row.Id_Reserva)) ? 1 : Number(row.Confirmacion || 0) })),
  }, actorId));
  const [[journey]] = await db.query(`SELECT Id_Confirmacion,Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      Total_Pasajeros,Total_Viajaron,Total_No_Viajaron,DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En
    FROM confirmaciones_jornada WHERE Id_Tour=2 AND Fecha_Tour='2026-10-23' LIMIT 1`);
  if (!journey) throw new Error('El servicio de confirmación no creó la fila de jornada antes de fijar Confirmada_En.');
  manifest.attendance = { serviceResult:result,journeyBeforeControlledTimestamp:journey,totalPassengersBefore:passengers.length };
  await writeManifest();
  const historyRows = await db.query(`SELECT Id_Historial FROM historial WHERE Tabla='pasajeros'
      AND Id_Registro='CONTROL_VIAJE' AND Accion='ACTUALIZAR_ASISTENCIA'
      AND Id_Historial > ? ORDER BY Id_Historial`, [Number(manifest.baselineMaxIds?.historial || 0)]).then(x=>x[0]);
  if(!historyRows.length)throw new Error('El servicio creó confirmaciones_jornada pero no dejó historial ACTUALIZAR_ASISTENCIA.');
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const confirmDate='2026-10-23 13:00:00';
    const [updated]=await conn.query('UPDATE confirmaciones_jornada SET Confirmada_En=? WHERE Id_Confirmacion=?',[confirmDate,journey.Id_Confirmacion]);
    if(Number(updated.affectedRows)!==1) throw new Error(`Confirmada_En: afectadas ${updated.affectedRows}, esperado 1.`);
    for(const row of historyRows) {
      const [res]=await conn.query('UPDATE historial SET Fecha_Hora_Registro=? WHERE Id_Historial=?',['2026-10-23 12:00:00',row.Id_Historial]);
      if(Number(res.affectedRows)!==1) throw new Error(`Historial de asistencia ${row.Id_Historial}: filas ${res.affectedRows}.`);
      manifest.controlledSql.historyAfter.push({Id_Historial:Number(row.Id_Historial),Fecha_Hora_Registro:'2026-10-23 12:00:00'});
    }
    const [[after]]=await conn.query(`SELECT DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En
      FROM confirmaciones_jornada WHERE Id_Confirmacion=?`,[journey.Id_Confirmacion]);
    if(after?.Confirmada_En!==confirmDate) throw new Error(`Confirmada_En quedó ${after?.Confirmada_En}, esperado ${confirmDate}.`);
    const [historyAfter]=await conn.query(`SELECT Id_Historial,DATE_FORMAT(Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Hora_Registro
      FROM historial WHERE Id_Historial IN (?) ORDER BY Id_Historial`,[historyRows.map(row=>row.Id_Historial)]);
    if(historyAfter.length!==historyRows.length||historyAfter.some(row=>row.Fecha_Hora_Registro!=='2026-10-23 12:00:00'))
      throw new Error(`Historial de cierre de jornada quedó incoherente: ${JSON.stringify(historyAfter)}.`);
    await conn.commit();
    manifest.attendance.confirmedAtAfterServiceRowCreated=after.Confirmada_En;
    manifest.attendance.historyRows=historyAfter.map(row=>({Id_Historial:Number(row.Id_Historial),Fecha_Hora_Registro:row.Fecha_Hora_Registro}));
  } catch(error){await conn.rollback();throw error;} finally {conn.release();}
  await writeManifest();
}

function ids(rows, key) { return (rows || []).map(row => String(row[key])).sort(); }
function sameSet(actual, expected) {
  const a=[...(actual||[])].map(String).sort(); const b=[...(expected||[])].map(String).sort();
  return a.length===b.length && a.every((value,index)=>value===b[index]);
}

async function independentIds(label, sql, params=[]) {
  const start=performance.now(); const [rows]=await db.query(sql,params);
  return {label,elapsedMs:Number((performance.now()-start).toFixed(2)),ids:rows.map(row=>String(row.id)).sort(),rows};
}

async function recordValidation(name, serviceTime, sqlResult, actualIds, extras={}) {
  const ok=sameSet(actualIds,sqlResult.ids);
  const validation={name,ok,serviceElapsedMs:serviceTime.elapsedMs,sqlElapsedMs:sqlResult.elapsedMs,
    expectedRows:sqlResult.ids.length,actualRows:actualIds.length,expectedIds:sqlResult.ids,actualIds:[...actualIds].map(String).sort(),...extras};
  manifest.validations.push(validation); await writeManifest();
  if(!ok) throw new Error(`${name}: servicio devolvió IDs distintos a SQL independiente. ${JSON.stringify(validation)}`);
  return validation;
}

function flattenCommissionReservations(result) {
  return (result || []).flatMap(channel => (channel.reportantes || []).flatMap(reportant => reportant.reservas || []));
}

async function validateCapacity(specs) {
  const grouped=new Map();
  for(const row of specs.filter(item=>item.kind==='Grupal')) {
    const key=`${row.capacityPoolId}|${row.finalDate}`;
    if(!grouped.has(key)) grouped.set(key,{pool:row.capacityPoolId,date:row.finalDate,ids:[]});
    grouped.get(key).ids.push(row.Id_Reserva);
  }
  const results=[];
  for(const item of grouped.values()) {
    const seats=await occupancyForPool(db,item.pool,item.date);
    const capacity=await effectiveCapacity(db,item.pool,item.date);
    const availability=await readAvailability(item.pool,item.date);
    const expected=capacity-seats;
    const ok=capacity>0 && seats<=capacity && Number(availability?.Cupos_Totales)===capacity
      && Number(availability?.Cupos_Disponibles)===expected;
    const result={pool:item.pool,date:item.date,seatCount:seats,capacity,availableExpected:expected,
      availability:availability?{Cupos_Totales:Number(availability.Cupos_Totales),Cupos_Disponibles:Number(availability.Cupos_Disponibles)}:null,
      reservationIds:item.ids,ok};
    results.push(result);
    if(!ok) throw new Error(`Cupos inconsistentes ${item.pool}/${item.date}: ${JSON.stringify(result)}.`);
  }
  for(const pool of new Set(specs.filter(item=>item.kind==='Grupal').map(item=>item.capacityPoolId))) {
    for(const date of [TEMP_DATE,SECOND_TEMP_DATE]) {
      const [[row]]=await db.query('SELECT COUNT(*) AS n FROM disponibilidad WHERE Id_Tour=? AND Fecha_Tour=?',[pool,date]);
      if(Number(row.n)!==0) throw new Error(`Quedó disponibilidad temporal ${pool}/${date}.`);
    }
  }
  return results;
}

async function validateAllAvailabilityRows(){
  const [rows]=await db.query(`SELECT Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,Cupos_Totales,Cupos_Disponibles
    FROM disponibilidad ORDER BY Id_Tour,Fecha_Tour`);
  const failures=[];const checked=[];
  for(const row of rows){
    const pool=Number(row.Id_Tour);const date=String(row.Fecha_Tour);
    const capacity=await effectiveCapacity(db,pool,date);const occupied=await occupancyForPool(db,pool,date);
    const available=capacity-occupied;const ok=capacity>0&&occupied<=capacity&&Number(row.Cupos_Totales)===capacity
      &&Number(row.Cupos_Disponibles)===available;
    const result={pool,date,capacity,occupied,availableExpected:available,
      cuposTotales:Number(row.Cupos_Totales),cuposDisponibles:Number(row.Cupos_Disponibles),ok};
    checked.push(result);if(!ok)failures.push(result);
  }
  if(failures.length)throw new Error(`Disponibilidad desincronizada en filas: ${JSON.stringify(failures.slice(0,20))}.`);
  return {rows:rows.length,checked:checked.length,failures:0,details:checked};
}

async function validateAllManifestCodes(){
  const created=manifest.createdIdsByTable||{};
  const reservationIds=(created.reservas||[]).map(row=>String(Array.isArray(row)?row[0]:row));
  const transferIds=(created.transfers||[]).map(row=>String(Array.isArray(row)?row[0]:row));
  const [reservations]=reservationIds.length?await db.query('SELECT Id_Reserva FROM reservas WHERE Id_Reserva IN (?)',[reservationIds]):[[]];
  const [transfersRows]=transferIds.length?await db.query(`SELECT Id_Transfer,CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer
    FROM transfers WHERE Id_Transfer IN (?)`,[transferIds]):[[]];
  const codes=transfersRows.map(row=>String(row.Codigo_Transfer));
  const ok=reservations.length===reservationIds.length&&new Set(reservationIds).size===reservationIds.length
    &&transfersRows.length===transferIds.length&&new Set(transferIds).size===transferIds.length
    &&new Set(codes).size===codes.length&&codes.every(code=>/^TRS\d{5}$/.test(code));
  const result={name:'códigos únicos de todas las filas del manifiesto',ok,reservations:reservations.length,
    expectedReservations:reservationIds.length,transfers:transfersRows.length,expectedTransfers:transferIds.length,
    transferCodes:codes};
  manifest.validations.push(result);await writeManifest();
  if(!ok)throw new Error(`Códigos del manifiesto incompletos o duplicados: ${JSON.stringify(result)}.`);
  return result;
}

async function validateFks(createdIdsByTable, pkMetadata) {
  const [constraints]=await db.query(`SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,ORDINAL_POSITION,
      REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
      AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`);
  const grouped=new Map();
  for(const row of constraints){
    const key=`${row.TABLE_NAME}|${row.CONSTRAINT_NAME}`;
    if(!grouped.has(key))grouped.set(key,{child:row.TABLE_NAME,constraint:row.CONSTRAINT_NAME,parent:row.REFERENCED_TABLE_NAME,parts:[]});
    grouped.get(key).parts.push({childCol:row.COLUMN_NAME,parentCol:row.REFERENCED_COLUMN_NAME});
  }
  const results=[];
  for(const fk of grouped.values()){
    const keys=createdIdsByTable[fk.child]; if(!keys?.length)continue;
    const pk=pkMetadata[fk.child];
    const targetWhere=keys.map(()=>`(${pk.map(col=>`c.${quoteId(col)}=?`).join(' AND ')})`).join(' OR ');
    const targetParams=keys.flatMap(row=>row);
    const notNull=fk.parts.map(part=>`c.${quoteId(part.childCol)} IS NOT NULL`).join(' AND ');
    const equality=fk.parts.map(part=>`p.${quoteId(part.parentCol)}=c.${quoteId(part.childCol)}`).join(' AND ');
    const [[count]]=await db.query(`SELECT COUNT(*) AS n FROM ${quoteId(fk.child)} c WHERE (${targetWhere})
      AND ${notNull} AND NOT EXISTS(SELECT 1 FROM ${quoteId(fk.parent)} p WHERE ${equality})`,targetParams);
    const orphanCount=Number(count.n); results.push({child:fk.child,constraint:fk.constraint,parent:fk.parent,orphanCount});
    if(orphanCount)throw new Error(`FK huérfana ${fk.child}.${fk.constraint} -> ${fk.parent}: ${orphanCount}.`);
  }
  return results;
}

async function validateUniqueCodes(reservationSpecs, transferSpecs) {
  const reservationIds=reservationSpecs.map(row=>row.Id_Reserva);
  const transferIds=transferSpecs.map(row=>row.Id_Transfer);
  const [reservationRows]=await db.query(`SELECT Id_Reserva FROM reservas WHERE Id_Reserva IN (?)`,[reservationIds]);
  const [transferRows]=await db.query(`SELECT Id_Transfer,CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer
    FROM transfers WHERE Id_Transfer IN (?)`,[transferIds]);
  const resIds=ids(reservationRows,'Id_Reserva'); const trIds=ids(transferRows,'Id_Transfer');
  const codes=transferRows.map(row=>String(row.Codigo_Transfer));
  const valid=reservationRows.length===reservationIds.length && new Set(resIds).size===resIds.length
    && transferRows.length===transferIds.length && new Set(trIds).size===trIds.length
    && new Set(codes).size===codes.length && codes.every(code=>/^TRS\d{5}$/.test(code))
    && transferSpecs.every(spec=>spec.Codigo_Transfer===`TRS${String(spec.Id_Transfer).padStart(5,'0')}`);
  const result={name:'códigos únicos',ok:valid,reservationIds:resIds,transferCodes:codes,
    expectedReservationCount:reservationIds.length,expectedTransferCount:transferIds.length};
  manifest.validations.push(result);await writeManifest();
  if(!valid)throw new Error(`Códigos duplicados o inválidos: ${JSON.stringify(result)}`);
  return result;
}

async function validateCommissionDefaults(reservationSpecs) {
  const reservationIds=reservationSpecs.map(row=>row.Id_Reserva);
  const [rows]=await db.query(`SELECT p.Id_Pasajero,p.Id_Reserva,p.Tipo_Pasajero,p.Comision,
      r.Id_Canal,h.Id_Tour,c.Tiene_Comision,tc.Valor AS Default_Comision
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva=p.Id_Reserva
      JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN canales_origen c ON c.Id_Canal=r.Id_Canal
      LEFT JOIN tour_comisiones tc ON tc.Id_Tour=h.Id_Tour AND tc.Id_Canal=r.Id_Canal
    WHERE p.Id_Reserva IN (?) ORDER BY p.Id_Pasajero`,[reservationIds]);
  const differences=[];
  for(const row of rows){
    const type=normalizePassengerType(row.Tipo_Pasajero);
    const expected=type==='INFANTE'||Number(row.Tiene_Comision)!==1?0:Number(row.Default_Comision||0);
    if(Math.abs(Number(row.Comision||0)-expected)>0.005)differences.push({Id_Pasajero:Number(row.Id_Pasajero),Id_Reserva:String(row.Id_Reserva),actual:Number(row.Comision||0),expected});
  }
  const result={name:'comisiones contra tour_comisiones',ok:rows.length>0&&differences.length===0,
    passengerRows:rows.length,differences,zeroCommissionChannels:[...new Set(rows.filter(row=>Number(row.Tiene_Comision)!==1).map(row=>Number(row.Id_Canal)))],
    infantRows:rows.filter(row=>normalizePassengerType(row.Tipo_Pasajero)==='INFANTE').length};
  manifest.validations.push(result);await writeManifest();
  if(!result.ok)throw new Error(`Comisiones no coinciden: ${JSON.stringify(result)}`);
  return result;
}

async function approvedFullReallocationLeadTime(row) {
  const planned=manifest.full?.existingDateAdjustments?.reservations?.find(item=>String(item.id)===String(row.Id_Reserva));
  const completed=manifest.full?.existingDateAdjustments?.results?.reservations?.find(item=>String(item.id)===String(row.Id_Reserva));
  if(!planned||!completed||planned.from!==completed.from||planned.to!==completed.to
    ||completed.to!==row.Fecha_Tour||completed.historyVia!=='reservas.actualizarReservaConPasajerosYPagos')return false;
  const previousLeadDays=Math.floor((Date.parse(`${completed.from}T00:00:00Z`)
    -Date.parse(`${row.Fecha_Registro.slice(0,10)}T00:00:00Z`))/86400000);
  if(previousLeadDays<1||previousLeadDays>30)return false;
  const [history]=await db.query(`SELECT h.Accion,h.Id_Usuario,d.Valor_Anterior,d.Valor_Nuevo
    FROM historial h JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
    WHERE h.Id_Historial=? AND LOWER(h.Tabla)='reservas' AND h.Id_Registro=? AND d.Columna='Fecha_Tour'`,
  [completed.history?.Id_Historial,String(row.Id_Reserva)]);
  return history.length===1&&history[0].Accion==='ACTUALIZAR_RESERVA'
    &&Number(history[0].Id_Usuario)===Number(completed.actorId)
    &&Number(completed.history?.actorId)===Number(completed.actorId)
    &&history[0].Valor_Anterior===completed.from&&history[0].Valor_Nuevo===completed.to;
}

async function approvedLateAutomaticState(row) {
  if(Number(row.AutomaticStateEvents)!==1||row.Estado!=='Completada')return false;
  const [events]=await db.query(`SELECT h.Id_Usuario,h.Accion,
      DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Hora_Registro,
      d.Valor_Anterior,d.Valor_Nuevo
    FROM historial h JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial AND d.Columna='Estado'
    WHERE LOWER(h.Tabla)='reservas' AND h.Id_Registro=? AND h.Accion='ACTUALIZAR_ESTADO_AUTOMATICO'`,
  [String(row.Id_Reserva)]);
  return events.length===1&&events[0].Id_Usuario===null
    &&events[0].Accion==='ACTUALIZAR_ESTADO_AUTOMATICO'
    &&events[0].Valor_Anterior==='Confirmada'&&events[0].Valor_Nuevo==='Completada'
    &&events[0].Fecha_Hora_Registro===row.AutomaticStateAt
    &&events[0].Fecha_Hora_Registro>`${row.Fecha_Tour} 23:59:59`;
}

async function validateHistoryAndDates(reservationSpecs, transferSpecs) {
  const reservations=reservationSpecs.map(item=>item.Id_Reserva);
  const transferIds=transferSpecs.map(item=>String(item.Id_Transfer));
  const [rows]=await db.query(`SELECT r.Id_Reserva,r.Estado,r.Tipo_Reserva,
      DATE_FORMAT(r.Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      DATE_FORMAT(r.Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      COUNT(h.Id_Historial) AS HistoryCount,
      MIN(DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s')) AS FirstHistory,
      MAX(DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s')) AS LastHistory,
      SUM(h.Accion='CREAR_RESERVA') AS CreatedEvents,
      SUM(h.Accion='ACTUALIZAR_RESERVA') AS UpdatedEvents,
      SUM(h.Accion='ACTUALIZAR_PASAJERO') AS PassengerEvents,
      SUM(h.Accion='CANCELAR_RESERVA') AS CancelEvents,
      MIN(CASE WHEN h.Accion<>'ACTUALIZAR_ESTADO_AUTOMATICO' THEN DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s') END) AS FirstOperationHistory,
      MAX(CASE WHEN h.Accion<>'ACTUALIZAR_ESTADO_AUTOMATICO' THEN DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s') END) AS LastOperationHistory,
      SUM(h.Accion='ACTUALIZAR_ESTADO_AUTOMATICO') AS AutomaticStateEvents,
      MAX(CASE WHEN h.Accion='ACTUALIZAR_ESTADO_AUTOMATICO' THEN DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s') END) AS AutomaticStateAt
    FROM reservas r LEFT JOIN historial h ON LOWER(h.Tabla)='reservas' AND h.Id_Registro=r.Id_Reserva
    WHERE r.Id_Reserva IN (?) GROUP BY r.Id_Reserva`,[reservations]);
  const [transferRows]=await db.query(`SELECT t.Id_Transfer,t.Estado,
      DATE_FORMAT(t.Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      DATE_FORMAT(t.Fecha_Registro,'%Y-%m-%d %H:%i:%s') AS Fecha_Registro,
      COUNT(h.Id_Historial) AS HistoryCount,SUM(h.Accion='CREAR_TRANSFER') AS CreatedEvents,
      MIN(DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s')) AS FirstHistory,
      MAX(DATE_FORMAT(h.Fecha_Hora_Registro,'%Y-%m-%d %H:%i:%s')) AS LastHistory
    FROM transfers t LEFT JOIN historial h ON LOWER(h.Tabla)='transfers' AND h.Id_Registro=CAST(t.Id_Transfer AS CHAR)
    WHERE t.Id_Transfer IN (?) GROUP BY t.Id_Transfer`,[transferIds]);
  const reservationMap=new Map(reservationSpecs.map(item=>[item.Id_Reserva,item]));
  const transferMap=new Map(transferSpecs.map(item=>[String(item.Id_Transfer),item]));
  const failures=[];const timeDependentStateDifferences=[];const referenceToday=manifestReferenceToday();
  for(const row of rows){
    const spec=reservationMap.get(String(row.Id_Reserva));
    const leadDays=Math.floor((Date.parse(`${row.Fecha_Tour}T00:00:00Z`)-Date.parse(`${row.Fecha_Registro.slice(0,10)}T00:00:00Z`))/86400000);
    const expectedState=expectedReservationStateAt(spec,TODAY);
    const expectedAtReference=expectedReservationStateAt(spec,referenceToday);
    const automaticStateExpected=!spec.cancel&&spec.finalDate<TODAY;
    const missingAutomaticState=automaticStateExpected&&Number(row.AutomaticStateEvents)<1;
    const approvedLeadTime=leadDays>30&&await approvedFullReallocationLeadTime(row);
    const automaticAtExpectedTime=String(row.AutomaticStateAt||'').startsWith(`${row.Fecha_Tour} 13:`);
    const approvedLateState=automaticStateExpected&&!missingAutomaticState&&!automaticAtExpectedTime
      &&await approvedLateAutomaticState(row);
    const stateMismatch=row.Estado!==expectedState;
    const expectedRolloverDrift=TODAY>referenceToday&&expectedAtReference!==expectedState
      &&row.Estado===expectedAtReference;
    if(expectedRolloverDrift){
      timeDependentStateDifferences.push({operation:'RESERVA',id:String(row.Id_Reserva),date:row.Fecha_Tour,
        stateAtManifestDate:expectedAtReference,stateExpectedToday:expectedState,stateActual:row.Estado,
        automaticStateEventPresent:Number(row.AutomaticStateEvents)>0,
        classification:'ESPERABLE_POR_CAMBIO_DE_FECHA; requiere refresco del estado automático.'});
    }
    if(Number(row.CreatedEvents)<1||leadDays<1||(leadDays>30&&!approvedLeadTime)||!(row.FirstOperationHistory<`${row.Fecha_Tour} 00:00:00`)
       ||!(row.LastOperationHistory<`${row.Fecha_Tour} 00:00:00`)
       ||(missingAutomaticState&&!expectedRolloverDrift)
       ||(automaticStateExpected&&!missingAutomaticState&&!automaticAtExpectedTime&&!approvedLateState)
       ||(stateMismatch&&!expectedRolloverDrift)) {
      failures.push({operation:'RESERVA',id:String(row.Id_Reserva),leadDays,state:row.Estado,expectedState,
        expectedAtManifestDate:expectedAtReference,row});
    }
    if(spec.modify==='passenger'&&Number(row.PassengerEvents)<1)failures.push({operation:'ACTUALIZACION_PASAJERO',id:String(row.Id_Reserva),passengerEvents:Number(row.PassengerEvents)});
    if(spec.modify==='reporter'||spec.modify==='date')if(Number(row.UpdatedEvents)<1)failures.push({operation:'ACTUALIZACION_DATOS_FECHA',id:String(row.Id_Reserva),updatedEvents:Number(row.UpdatedEvents)});
    if(spec.cancel&&Number(row.CancelEvents)<1)failures.push({operation:'CANCELACION',id:String(row.Id_Reserva),cancelEvents:Number(row.CancelEvents)});
  }
  for(const row of transferRows){
    const spec=transferMap.get(String(row.Id_Transfer));
    const leadDays=Math.floor((Date.parse(`${row.Fecha_Transfer}T00:00:00Z`)-Date.parse(`${row.Fecha_Registro.slice(0,10)}T00:00:00Z`))/86400000);
    const expectedState=expectedTransferStateAt(spec,TODAY);
    const expectedAtReference=expectedTransferStateAt(spec,referenceToday);
    const expectedRolloverDrift=TODAY>referenceToday&&expectedAtReference!==expectedState&&row.Estado===expectedAtReference;
    if(expectedRolloverDrift)timeDependentStateDifferences.push({operation:'TRANSFER',id:String(row.Id_Transfer),
      date:row.Fecha_Transfer,stateAtManifestDate:expectedAtReference,stateExpectedToday:expectedState,stateActual:row.Estado,
      classification:'ESPERABLE_POR_CAMBIO_DE_FECHA; requiere refresco del estado automático.'});
    if(Number(row.CreatedEvents)<1||leadDays<1||leadDays>30||!(row.FirstHistory<`${row.Fecha_Transfer} 00:00:00`)
      ||!(row.LastHistory<`${row.Fecha_Transfer} 00:00:00`)||(row.Estado!==expectedState&&!expectedRolloverDrift)) {
      failures.push({operation:'TRANSFER',id:String(row.Id_Transfer),leadDays,state:row.Estado,expectedState,
        expectedAtManifestDate:expectedAtReference,row});
    }
  }
  const result={name:'historial, modificaciones/cancelaciones y registro previo',ok:failures.length===0,
    reservations:rows.length,transfers:transferRows.length,modified:reservationSpecs.filter(item=>item.modify).length,
    cancelled:reservationSpecs.filter(item=>item.cancel).length,referenceToday,currentToday:TODAY,
    timeDependentStateDifferences,failures,
     detailHistorialHasTimestamp:false,detailHistorialExplanation:'detalle_historial no tiene columna temporal; la fecha del evento está en historial.Fecha_Hora_Registro.',
     autoStateEvents:rows.reduce((sum,row)=>sum+Number(row.AutomaticStateEvents||0),0)};
  manifest.validations.push(result);await writeManifest();
  if(!result.ok)throw new Error(`Historial/fechas incoherentes (no explicables por cambio de fecha): ${JSON.stringify(result)}`);
  return result;
}

async function inspectDateSensitiveMidExpectations(reservationSpecs,transferSpecs){
  const from='2026-10-24';const through='2026-10-26';const referenceToday=manifestReferenceToday();
  const affectedReservations=reservationSpecs.filter(row=>row.finalDate>=from&&row.finalDate<=through);
  const affectedTransfers=transferSpecs.filter(row=>row.finalDate>=from&&row.finalDate<=through);
  const reservationIds=affectedReservations.map(row=>String(row.Id_Reserva));
  const transferIds=affectedTransfers.map(row=>String(row.Id_Transfer));
  const [reservationRows]=reservationIds.length?await timed('dateSensitive:reservationStates',()=>db.query(`SELECT Id_Reserva,Estado,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour FROM reservas WHERE Id_Reserva IN (?)`,[reservationIds])):[[]];
  const [transferRows]=transferIds.length?await timed('dateSensitive:transferStates',()=>db.query(`SELECT Id_Transfer,Estado,
      DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer FROM transfers WHERE Id_Transfer IN (?)`,[transferIds])):[[]];
  const reservationsById=new Map(reservationRows.map(row=>[String(row.Id_Reserva),row]));
  const transfersById=new Map(transferRows.map(row=>[String(row.Id_Transfer),row]));
  const transitions=[];const realErrors=[];
  for(const spec of affectedReservations){
    const actual=reservationsById.get(String(spec.Id_Reserva));
    const atReference=expectedReservationStateAt(spec,referenceToday);const todayExpected=expectedReservationStateAt(spec,TODAY);
    const expectedRollover=TODAY>referenceToday&&atReference!==todayExpected&&actual?.Estado===atReference;
    const item={id:String(spec.Id_Reserva),date:spec.finalDate,expectedAtManifestDate:atReference,expectedToday:todayExpected,
      actual:actual?.Estado||null,classification:expectedRollover?'ESPERABLE_POR_CAMBIO_DE_FECHA':actual?.Estado===todayExpected?'COINCIDE':'ERROR_REAL'};
    transitions.push({type:'RESERVA',...item});if(!actual||item.classification==='ERROR_REAL')realErrors.push({type:'RESERVA',...item});
  }
  for(const spec of affectedTransfers){
    const actual=transfersById.get(String(spec.Id_Transfer));
    const atReference=expectedTransferStateAt(spec,referenceToday);const todayExpected=expectedTransferStateAt(spec,TODAY);
    const expectedRollover=TODAY>referenceToday&&atReference!==todayExpected&&actual?.Estado===atReference;
    const item={id:String(spec.Id_Transfer),date:spec.finalDate,expectedAtManifestDate:atReference,expectedToday:todayExpected,
      actual:actual?.Estado||null,classification:expectedRollover?'ESPERABLE_POR_CAMBIO_DE_FECHA':actual?.Estado===todayExpected?'COINCIDE':'ERROR_REAL'};
    transitions.push({type:'TRANSFER',...item});if(!actual||item.classification==='ERROR_REAL')realErrors.push({type:'TRANSFER',...item});
  }

  const dates=['2026-10-24','2026-10-25','2026-10-26'];
  const relevantTours=[...new Set([...affectedReservations.map(row=>Number(row.tourId)),
    ...affectedTransfers.map(()=>0)].filter(Boolean))];
  const journeyChecks=[];
  for(const date of dates)for(const tourId of relevantTours){
    const [[sql]]=await timed(`dateSensitive:journeySql:${date}:${tourId}`,()=>db.query(`SELECT COUNT(p.Id_Pasajero) AS passengers,
        COALESCE(SUM(p.Confirmacion=1),0) AS traveled,MAX(cj.Id_Confirmacion) AS Id_Confirmacion,
        DATE_FORMAT(MAX(cj.Confirmada_En),'%Y-%m-%d %H:%i:%s') AS Confirmada_En,
        MAX(cj.Total_Pasajeros) AS snapshotPassengers
      FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour=h.Id_Tour AND cj.Fecha_Tour=r.Fecha_Tour
      WHERE r.Fecha_Tour=? AND h.Id_Tour=?
        AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')`,[date,tourId]));
    const state=await timed(`dateSensitive:journeyService:${date}:${tourId}`,()=>confirmacion.obtenerEstadoConfirmacion(date,tourId));
    const serviceJourney=(state.jornadas||[]).find(row=>Number(row.Id_Tour)===tourId)||null;
    const passengers=await timed(`dateSensitive:controlTravel:${date}:${tourId}`,()=>confirmacion.obtenerPasajerosPorTour(tourId,date));
    const serviceConfirmed=Boolean(serviceJourney?.Confirmada);
    const serviceCount=Number(serviceJourney?.Total_Pasajeros||0);
    const openAsDesigned=Number(sql.passengers)===0||!serviceConfirmed;
    const ok=Number(passengers.length)===Number(sql.passengers)
      &&passengers.filter(row=>Number(row.Confirmacion)===1).length===Number(sql.traveled)
      &&serviceCount===Number(sql.passengers)&&openAsDesigned;
    const check={date,tourId,passengers:Number(sql.passengers),traveled:Number(sql.traveled),
      confirmationRow:sql.Id_Confirmacion==null?null:Number(sql.Id_Confirmacion),confirmedAt:sql.Confirmada_En,
      service:{found:Boolean(serviceJourney),confirmed:serviceConfirmed,totalPassengers:serviceCount,
        requiresConfirmation:Boolean(serviceJourney?.Requiere_Confirmacion)},controlTravelRows:passengers.length,
      designedState:Number(sql.passengers)===0?'NO_OPERACIONES':'ABIERTA',classification:ok?'COINCIDE':'ERROR_REAL'};
    journeyChecks.push(check);if(!ok)realErrors.push({type:'JORNADA_CONTROL_VIAJE',...check});
  }

  const [[clock]]=await timed('dateSensitive:databaseClock',()=>db.query(`SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS databaseToday,
    DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s') AS databaseNow`));
  const [rules]=await timed('dateSensitive:pendingRules',()=>db.query(`SELECT Codigo,Activa,Configuracion FROM reglas_pendientes
    WHERE Codigo IN ('RESERVA_ESTADO_PENDIENTE','TRANSFER_ESTADO_PENDIENTE') ORDER BY Codigo`));
  const pendingRules=rules.map(row=>{
    let config={};try{config=typeof row.Configuracion==='string'?JSON.parse(row.Configuracion):row.Configuracion||{};}catch{}
    const days=Math.min(Math.max(Number(config.diasAnticipacion)||30,1),365);
    return {code:row.Codigo,active:Boolean(row.Activa),diasAnticipacion:days,windowFrom:clock.databaseToday,
      windowThrough:addDays(clock.databaseToday,days),sqlPredicate:'Fecha_Tour BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL diasAnticipacion DAY)'};
  });
  const pendingReservationIds=reservationIds.length?reservationIds:[];const pendingTransferIds=transferIds.length?transferIds:[];
  const pendingClauses=[];const pendingParams=[];
  if(pendingReservationIds.length){pendingClauses.push("(Entidad_Tipo='RESERVA' AND Entidad_Id IN (?))");pendingParams.push(pendingReservationIds);}
  if(pendingTransferIds.length){pendingClauses.push("(Entidad_Tipo='TRANSFER' AND Entidad_Id IN (?))");pendingParams.push(pendingTransferIds);}
  const [pendingRows]=pendingClauses.length?await timed('dateSensitive:existingPendings',()=>db.query(`SELECT Id_Pendiente,Entidad_Tipo,Entidad_Id,Estado,
      DATE_FORMAT(Fecha_Operacion,'%Y-%m-%d %H:%i:%s') AS Fecha_Operacion,
      DATE_FORMAT(Siguiente_Recordatorio,'%Y-%m-%d %H:%i:%s') AS Siguiente_Recordatorio
    FROM pendientes_operativos WHERE ${pendingClauses.join(' OR ')} ORDER BY Id_Pendiente`,pendingParams)):[[]];
  return {serviceToday:TODAY,manifestReferenceToday:referenceToday,databaseClock:clock,
    affectedOperationStates:{reservationCount:affectedReservations.length,transferCount:affectedTransfers.length,transitions},
    journeysAndTravelControl:{dates,tours:relevantTours,checks:journeyChecks},
    pendingDetector:{rules:pendingRules,existingPendingRows:pendingRows,
      note:'El detector usa CURDATE() de MySQL; después del rollover 24–26 oct quedan fuera de la ventana. Los estados y pendientes existentes solo se inspeccionan; no se ejecuta ningún job.'},
    realErrors,ok:realErrors.length===0};
}

async function validateServiceFilters(reservationSpecs, transferSpecs, inputs) {
  const marker=MARKER;
  const validations=[];
  const resQ=await timed('filter:VerReservas',()=>reservas.filtrarReservas({q:marker,Id_Canal:11,page:1,limit:100}));
  const resData=resQ.data||resQ.items||[];
  const resSql=await independentIds('sql:VerReservas',`SELECT DISTINCT r.Id_Reserva AS id FROM reservas r
      WHERE r.Id_Canal=11 AND r.Nombre_Reportante LIKE ? ORDER BY id`,[`%${marker}%`]);
  validations.push(await recordValidation('Ver Reservas | Id_Canal=11 + búsqueda textual',
    {elapsedMs:TIMED.find(item=>item.label==='filter:VerReservas')?.elapsedMs||0},resSql,ids(resData,'Id_Reserva'),{filters:{q:marker,Id_Canal:11}}));

  const trQ=await timed('filter:VerTransfer',()=>transfers.filtrarTransfersSvc({q:marker,Id_Servicio:1,page:1,limit:100}));
  const trData=trQ.data||[];
  const trSql=await independentIds('sql:VerTransfer',`SELECT DISTINCT t.Id_Transfer AS id FROM transfers t
      WHERE t.Id_Servicio=1 AND t.Nombre_Titular LIKE ? ORDER BY id`,[`%${marker}%`]);
  validations.push(await recordValidation('Ver Transfer | búsqueda textual + servicio=1',
    {elapsedMs:TIMED.find(item=>item.label==='filter:VerTransfer')?.elapsedMs||0},trSql,ids(trData,'Id_Transfer'),{filters:{q:marker,Id_Servicio:1}}));

  const entity=inputs.nationalEntities[0];
  const dateFrom='2026-10-18'; const dateTo='2026-10-18';
  const originFilters={categoria:2,idEntidadReportante:Number(entity.Id_Entidad_Reportante),fechaRegistroDesde:dateFrom,fechaRegistroHasta:dateTo,page:1,pageSize:100};
  const originQ=await timed('filter:OrigenOperaciones',()=>mercadeo.buscarOrigenReservas(originFilters));
  const originActual=(originQ.items||[]).map(row=>row.tipo==='TRANSFER'?String(row.id_transfer):String(row.id_reserva));
  const originSql=await independentIds('sql:OrigenOperaciones',`SELECT id FROM (
      SELECT CAST(r.Id_Reserva AS CHAR) AS id FROM reservas r WHERE r.Id_Canal=2 AND r.Id_Entidad_Reportante=?
        AND r.Fecha_Registro>=? AND r.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)
      UNION ALL
      SELECT CAST(t.Id_Transfer AS CHAR) AS id FROM transfers t WHERE t.Id_Canal=2 AND t.Id_Entidad_Reportante=?
        AND t.Fecha_Registro>=? AND t.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)
    ) x ORDER BY id`,[entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo,entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo]);
  validations.push(await recordValidation('Origen de operaciones | canal 2 + entidad + registro 18-oct',
    {elapsedMs:TIMED.find(item=>item.label==='filter:OrigenOperaciones')?.elapsedMs||0},originSql,originActual,{filters:originFilters}));

  const mercResFilters={categoria:2,idEntidadReportante:Number(entity.Id_Entidad_Reportante),fechaRegistroDesde:dateFrom,fechaRegistroHasta:dateTo,page:1,pageSize:100};
  const mercRes=await timed('filter:MercadeoReservas',()=>mercadeo.buscarReservasMercadeo(mercResFilters));
  const mercResSql=await independentIds('sql:MercadeoReservas',`SELECT r.Id_Reserva AS id FROM reservas r WHERE r.Id_Canal=2
      AND r.Id_Entidad_Reportante=? AND r.Fecha_Registro>=? AND r.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY id`,
    [entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo]);
  validations.push(await recordValidation('Mercadeo reservas | canal 2 + entidad + registro',
    {elapsedMs:TIMED.find(item=>item.label==='filter:MercadeoReservas')?.elapsedMs||0},mercResSql,ids(mercRes.items,'Id_Reserva'),{filters:mercResFilters}));

  const mercTr=await timed('filter:MercadeoTransfers',()=>mercadeo.buscarTransfersMercadeo(mercResFilters));
  const mercTrSql=await independentIds('sql:MercadeoTransfers',`SELECT t.Id_Transfer AS id FROM transfers t WHERE t.Id_Canal=2
      AND t.Id_Entidad_Reportante=? AND t.Fecha_Registro>=? AND t.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY id`,
    [entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo]);
  validations.push(await recordValidation('Mercadeo transfers | canal 2 + entidad + registro',
    {elapsedMs:TIMED.find(item=>item.label==='filter:MercadeoTransfers')?.elapsedMs||0},mercTrSql,ids(mercTr.items,'Id_Transfer'),{filters:mercResFilters}));

  const activityFilters={buscar:entity.Nombre,actividad:'CON_RESERVAS',desde:dateFrom,hasta:dateTo,page:1,pageSize:10};
  const activity=await timed('filter:EntidadActividad',()=>entityActivity.listActivity(activityFilters));
  const activityRow=(activity.items||[]).find(row=>Number(row.Id_Entidad_Reportante)===Number(entity.Id_Entidad_Reportante));
  const [[activitySql]]=await db.query(`SELECT
      (SELECT COUNT(*) FROM reservas r WHERE r.Id_Entidad_Reportante=? AND r.Fecha_Registro>=? AND r.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)) AS reservas,
      (SELECT COUNT(*) FROM transfers t WHERE t.Id_Entidad_Reportante=? AND t.Fecha_Registro>=? AND t.Fecha_Registro<DATE_ADD(?,INTERVAL 1 DAY)) AS transfers`,
    [entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo,entity.Id_Entidad_Reportante,`${dateFrom} 00:00:00`,dateTo]);
  const activityExpected=Number(activitySql.reservas)+Number(activitySql.transfers);
  const activityActual=Number(activityRow?.Operaciones||0);
  const activityValidation={name:'Entidades reportantes | actividad',ok:!!activityRow&&activityActual===activityExpected,
    elapsedMs:TIMED.find(item=>item.label==='filter:EntidadActividad')?.elapsedMs||0,filters:activityFilters,
    expected:{reservas:Number(activitySql.reservas),transfers:Number(activitySql.transfers),operaciones:activityExpected},
    actual:activityRow?{reservas:Number(activityRow.Reservas),transfers:Number(activityRow.Transfers),operaciones:activityActual}:null};
  manifest.validations.push(activityValidation);await writeManifest();if(!activityValidation.ok)throw new Error(`Actividad de entidad diferente a SQL: ${JSON.stringify(activityValidation)}`);
  validations.push(activityValidation);

  const detailFilters={desde:dateFrom,hasta:dateTo};
  const detail=await timed('filter:EntidadDetalle',()=>entityActivity.detail(entity.Id_Entidad_Reportante,detailFilters));
  const detailActual=Number(detail.period?.Operaciones||0);
  const detailValidation={name:'Entidades reportantes | detalle con operaciones',ok:detailActual===activityExpected,
    elapsedMs:TIMED.find(item=>item.label==='filter:EntidadDetalle')?.elapsedMs||0,filters:detailFilters,
    expected:{entityId:Number(entity.Id_Entidad_Reportante),operaciones:activityExpected},
    actual:{entityId:Number(detail.entity?.Id_Entidad_Reportante),operaciones:detailActual}};
  manifest.validations.push(detailValidation);await writeManifest();if(!detailValidation.ok)throw new Error(`Detalle de entidad diferente a SQL: ${JSON.stringify(detailValidation)}`);
  validations.push(detailValidation);

  const reportName=`${MARKER}_REPORTANTE_GRUPO_A`;
  const commissionFilters={Fecha:'2026-10-23',Id_Canal:2,Nombre_Reportante:reportName,Estado:'PENDIENTE'};
  const commission=await timed('filter:Comisiones',()=>comisiones.listarComisiones(commissionFilters));
  const commissionActual=flattenCommissionReservations(commission).map(row=>String(row.Id_Reserva));
  const commissionSql=await independentIds('sql:Comisiones',`SELECT DISTINCT r.Id_Reserva AS id FROM reservas r
      JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN canales_origen c ON c.Id_Canal=r.Id_Canal
      JOIN entidades_reportantes e ON e.Id_Entidad_Reportante=r.Id_Entidad_Reportante
      JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva LEFT JOIN liquidaciones l ON l.Id_Reserva=r.Id_Reserva
    WHERE r.Fecha_Tour='2026-10-23' AND r.Id_Canal=2 AND r.Nombre_Reportante LIKE ?
      AND p.Confirmacion=1 AND p.Comision>0 AND UPPER(TRIM(p.Tipo_Pasajero))<>'INFANTE'
      AND r.Estado NOT IN ('Cancelada','Cancelado','ELIMINADA','ELIMINADO') AND c.Tiene_Comision=1
      AND e.Tipo='AGENCIA_NACIONAL' AND e.Activo=1 AND e.Estado_Validacion<>'RECHAZADA'
      AND COALESCE(l.Estado,'PENDIENTE')='PENDIENTE' ORDER BY id`,[`%${reportName}%`]);
  validations.push(await recordValidation('Comisiones | fecha + canal + reportante + estado',
    {elapsedMs:TIMED.find(item=>item.label==='filter:Comisiones')?.elapsedMs||0},commissionSql,commissionActual,{filters:commissionFilters}));

  const groupFilters={desde:'2026-10-23',hasta:'2026-10-23',Id_Entidad_Reportante:Number(entity.Id_Entidad_Reportante),Tipo:'AGENCIA_NACIONAL',Estado:'PENDIENTE',page:1,limit:20};
  const groups=await timed('filter:ComisionesGrupos',()=>comisionGrupos.listarGrupos(groupFilters));
  const group=groups.grupos.find(row=>Number(row.Id_Entidad_Reportante)===Number(entity.Id_Entidad_Reportante)
    && row.Fecha_Tour==='2026-10-23');
  const [[groupSql]]=await db.query(`SELECT COUNT(DISTINCT r.Id_Reserva) AS reservas,COALESCE(SUM(p.Comision),0) AS monto
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN canales_origen c ON c.Id_Canal=r.Id_Canal
      JOIN entidades_reportantes e ON e.Id_Entidad_Reportante=r.Id_Entidad_Reportante JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
      LEFT JOIN liquidaciones l ON l.Id_Reserva=r.Id_Reserva
    WHERE r.Fecha_Tour='2026-10-23' AND r.Id_Entidad_Reportante=? AND e.Tipo='AGENCIA_NACIONAL'
      AND e.Estado_Validacion<>'RECHAZADA' AND c.Tiene_Comision=1 AND c.Nombre_Canal='AGENCIA NACIONAL'
      AND p.Confirmacion=1 AND p.Comision>0 AND UPPER(TRIM(p.Tipo_Pasajero))<>'INFANTE'
      AND r.Estado NOT IN ('Cancelada','Cancelado','ELIMINADA','ELIMINADO')
      AND l.Id_Grupo_Comision IS NULL AND COALESCE(l.Estado,'PENDIENTE')='PENDIENTE'`,[entity.Id_Entidad_Reportante]);
  const groupValidation={name:'Comisiones grupos | período + entidad + tipo + estado',ok:!!group&&Number(group.Cantidad_Reservas_Pendientes)===Number(groupSql.reservas)
      && Number(group.Monto_Pendiente)===Number(groupSql.monto)&&Boolean(group.Puede_Pagar),
    elapsedMs:TIMED.find(item=>item.label==='filter:ComisionesGrupos')?.elapsedMs||0,filters:groupFilters,
    expected:{reservas:Number(groupSql.reservas),monto:Number(groupSql.monto),Puede_Pagar:true},
    actual:group?{reservas:Number(group.Cantidad_Reservas_Pendientes),monto:Number(group.Monto_Pendiente),Puede_Pagar:Boolean(group.Puede_Pagar),Jornadas_Cerradas:Boolean(group.Jornadas_Cerradas)}:null};
  manifest.validations.push(groupValidation);await writeManifest();if(!groupValidation.ok)throw new Error(`Grupo de comisión no coincide o no está pagable: ${JSON.stringify(groupValidation)}`);
  validations.push(groupValidation);

  const generalFilters={canales:[2],fechaTour:'2026-10-23'};
  const general=await timed('filter:ProgramacionListadoGeneral',()=>listadoGeneral.consultarListadoGeneral(generalFilters,'nuevo','reservas_grupales'));
  const generalSql=await independentIds('sql:ProgramacionListadoGeneral',`SELECT DISTINCT r.Id_Reserva AS id FROM reservas r
      JOIN horarios h ON h.Id_Horario=r.Id_Horario WHERE r.Id_Canal=2 AND r.Fecha_Tour='2026-10-23'
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva,'Grupal')))='GRUPAL' ORDER BY id`);
  validations.push(await recordValidation('Programación general | canal 2 + fecha 23-oct',
    {elapsedMs:TIMED.find(item=>item.label==='filter:ProgramacionListadoGeneral')?.elapsedMs||0},generalSql,ids(general.items,'Id_Reserva'),{filters:generalFilters}));

  const detailResult=await timed('filter:ListadoGeneralDetalle',()=>listadoGeneral.obtenerFilasListadoGeneral(generalFilters,'nuevo','reservas_grupales'));
  const detailRows=detailResult?.rows;
  if(!Array.isArray(detailRows))throw new Error(`Contrato inesperado de obtenerFilasListadoGeneral: esperaba { rows, filters }; recibió ${JSON.stringify({type:typeof detailResult,keys:Object.keys(detailResult||{}),rowsType:typeof detailRows})}.`);
  const detailedIds=[...new Set(detailRows.map(row=>String(row.Id_Reserva)))].sort();
  const detailListValidation={name:'Listado general | canal 2 + fecha 23-oct',ok:sameSet(detailedIds,generalSql.ids),
    elapsedMs:TIMED.find(item=>item.label==='filter:ListadoGeneralDetalle')?.elapsedMs||0,filters:generalFilters,
    expectedRows:generalSql.ids.length,actualRows:detailedIds.length,detailContract:{type:typeof detailResult,keys:Object.keys(detailResult),rows:detailRows.length,filters:detailResult.filters},
    expectedIds:generalSql.ids,actualIds:detailedIds};
  manifest.validations.push(detailListValidation);await writeManifest();if(!detailListValidation.ok)throw new Error(`Detalle del listado general diferente a SQL: ${JSON.stringify(detailListValidation)}`);
  validations.push(detailListValidation);

  const transfersDay=await timed('filter:ProgramacionTransfersDia',()=>programacion.obtenerTransfersProgramacion('2026-10-31'));
  const expectedTransferDay=transferSpecs.filter(item=>item.finalDate==='2026-10-31').map(item=>String(item.Id_Transfer)).sort();
  const actualTransferDay=(transfersDay.transfers||[]).map(row=>String(row.Id_Transfer)).sort();
  const sqlTransferDay=await independentIds('sql:ProgramacionTransfersDia',`SELECT Id_Transfer AS id FROM transfers WHERE Fecha_Transfer='2026-10-31' ORDER BY id`);
  validations.push(await recordValidation('Programación transfers del día | 31-oct',
    {elapsedMs:TIMED.find(item=>item.label==='filter:ProgramacionTransfersDia')?.elapsedMs||0},sqlTransferDay,actualTransferDay,
    {filters:{fecha:'2026-10-31'},expectedPilotIds:expectedTransferDay}));

  manifest.filterSummary={count:validations.length,allPassed:true}; await writeManifest();
  return validations;
}

function keyMap(rows) {
  return new Set((rows || []).map(keySig));
}

async function validateManifestStateReadOnly(inputManifestPath) {
  const resolvedManifestPath=path.resolve(inputManifestPath);
  const loaded=JSON.parse(fs.readFileSync(resolvedManifestPath,'utf8'));
  if(loaded.database!=='sir2'||loaded.runId!=='20261026_pilot02'||loaded.stage!=='pilot')
    throw new Error(`Manifiesto inválido para esta validación: database=${loaded.database}, stage=${loaded.stage}, runId=${loaded.runId}.`);
  const expectedReservations=Number(loaded.plan?.reservations||loaded.plan?.reservationSpecs?.length||0);
  const expectedTransfers=Number(loaded.plan?.transfers||loaded.plan?.transferSpecs?.length||0);
  if(!Array.isArray(loaded.plan?.reservationSpecs)||loaded.plan.reservationSpecs.length!==expectedReservations
      ||!Array.isArray(loaded.plan?.transferSpecs)||loaded.plan.transferSpecs.length!==expectedTransfers)
    throw new Error(`El manifiesto declara ${expectedReservations} reservas/${expectedTransfers} transfers pero sus arreglos no coinciden.`);
  manifest=loaded;
  args.runId=loaded.runId;
  MARKER=loaded.marker;
  MANIFEST_PATH=resolvedManifestPath;
  BASELINE_KEYS_PATH=path.resolve(loaded.baselineKeysPath||path.join(path.dirname(resolvedManifestPath),`sir2-step6-${loaded.runId}.baseline-keys.json`));
  LOG_PATH=path.join(BACKUP_DIR,`sir2-step6-${loaded.runId}${args.resumeFullValidation?'.full.resume':args.step?`.${args.stage}.${args.step}`:args.stage==='pilot'?'':`.${args.stage}`}.log`);
  if(!args.planOnly&&!args.validateOnly&&args.stage==='full'&&!args.step&&PREEXISTING_LOG_PATHS.has(path.resolve(LOG_PATH)))
    throw new Error(`Ya existe log full para runId=${loaded.runId}; no se reintenta.`);
  if(!args.planOnly&&!args.validateOnly&&args.stage==='full'&&args.step&&PREEXISTING_LOG_PATHS.has(path.resolve(LOG_PATH)))
    throw new Error(`Ya existe log para el paso ${args.step} de runId=${loaded.runId}; no se repite ni reintenta.`);

  const [[identity]]=await timed('validateOnly:identity',()=>db.query(`SELECT DATABASE() AS databaseName,DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS today`));
  if(identity.databaseName!=='sir2')throw new Error(`Conexión activa a ${identity.databaseName||'(ninguna)'}, se esperaba sir2.`);
  const counts=await timed('validateOnly:countsBefore',countSnapshot);
  const countDifferences=compareCounts(loaded.countsAfter,counts);
  const currentTotal=sumCounts(counts);
  if(counts.length!==78||currentTotal!==Number(loaded.countsTotalAfter)
      ||Number(loaded.countsTotalBefore)!==10176)
    throw new Error(`Conteo distinto al manifiesto: ${counts.length} tablas/${currentTotal}; manifiesto ${loaded.countsTotalAfter}.`);
  if(countDifferences.length)throw new Error(`Conteos actuales no coinciden con el manifiesto: ${JSON.stringify(countDifferences)}.`);
  const declaredDelta=(loaded.deltaByTable||[]).reduce((sum,row)=>sum+Number(row.delta||0),0);
  if(declaredDelta!==Number(loaded.countsTotalAfter)-Number(loaded.countsTotalBefore))
    throw new Error(`Delta declarado por el manifiesto no coincide: ${declaredDelta}.`);

  const baselinePath=path.resolve(loaded.baselineKeysPath||path.join(path.dirname(resolvedManifestPath),`sir2-step6-${loaded.runId}.baseline-keys.json`));
  const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
  if(baseline.database!=='sir2'||Object.keys(baseline.tables||{}).length!==78)
    throw new Error(`Snapshot de claves inválido: ${baselinePath}.`);
  const metadata=await timed('validateOnly:pkMetadata',primaryKeyMetadata);
  const currentKeys=await timed('validateOnly:currentPrimaryKeys',()=>capturePrimaryKeys(metadata));
  const actualAdded=diffPrimaryKeys(baseline,currentKeys);
  const reported=loaded.createdIdsByTable||{};
  const allTables=[...new Set([...Object.keys(baseline.tables||{}),...Object.keys(currentKeys.tables||{}),...Object.keys(reported)])].sort();
  const pkMismatches=[];
  for(const table of allTables){
    const base=keyMap(baseline.tables[table]);
    const actual=keyMap(currentKeys.tables[table]);
    const expected=new Set([...base,...(reported[table]||[]).map(keySig)]);
    const unknown=[...actual].filter(key=>!expected.has(key));
    const missing=[...expected].filter(key=>!actual.has(key));
    const addedFromBaseline=keyMap(actualAdded[table]);
    const expectedAdded=keyMap(reported[table]);
    const addedNotReported=[...addedFromBaseline].filter(key=>!expectedAdded.has(key));
    const reportedNotAdded=[...expectedAdded].filter(key=>!addedFromBaseline.has(key));
    if(unknown.length||missing.length||addedNotReported.length||reportedNotAdded.length)
      pkMismatches.push({table,unexpectedKeys:unknown.length,missingKeys:missing.length,addedNotInManifest:addedNotReported.length,manifestIdsMissing:reportedNotAdded.length,
        sampleUnexpected:unknown.slice(0,3),sampleMissing:missing.slice(0,3)});
  }
  if(pkMismatches.length)throw new Error(`Claves primarias fuera del manifiesto o faltantes: ${JSON.stringify(pkMismatches)}.`);
  const [[outbox]]=await timed('validateOnly:emailOutbox',()=>db.query('SELECT COUNT(*) AS n FROM email_outbox'));
  if(Number(outbox.n)!==0)throw new Error(`email_outbox no está vacío: ${outbox.n}.`);
  const server=await timed('validateOnly:serverOffline',assertServerOffline);
  return {identity,counts,tableCount:counts.length,totalRows:currentTotal,deltaByTable:loaded.deltaByTable||[],
    exactPrimaryKeyMatch:true,checkedTables:allTables.length,unexpectedOrMissingPrimaryKeys:0,emailOutbox:Number(outbox.n),server,
    baselineKeysPath:baselinePath,manifestPath:resolvedManifestPath,manifestState:loaded.state};
}

async function validatePeakAndReadOnlyReports(reservationSpecs,inputs) {
  const results=[];
  const excelFilters={canales:[2],fechaTour:'2026-10-23'};
  const excel=await timed('validation:ExcelListadoGeneral',()=>listadoGeneral.exportarListadoGeneral(excelFilters,'nuevo','reservas_grupales'));
  const [[excelSql]] = await timed('sql:ExcelListadoGeneral',()=>db.query(`SELECT COUNT(*) AS n
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Id_Canal=2 AND r.Fecha_Tour='2026-10-23'
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva,'Grupal')))='GRUPAL'`));
  const excelExpected=Number(excelSql.n);
  const excelValidation={name:'Listado general | exportación Excel',ok:Number(excel.rowCount)===excelExpected,
    serviceElapsedMs:TIMED.find(item=>item.label==='validation:ExcelListadoGeneral')?.elapsedMs||0,
    sqlElapsedMs:TIMED.find(item=>item.label==='sql:ExcelListadoGeneral')?.elapsedMs||0,
    filters:excelFilters,expectedRows:excelExpected,actualRows:Number(excel.rowCount),bytes:excel.buffer?.length||0,filename:excel.filename};
  manifest.validations.push(excelValidation);await writeManifest();
  if(!excelValidation.ok)throw new Error(`Exportación Excel no coincide con SQL: ${JSON.stringify(excelValidation)}.`);
  results.push(excelValidation);

  const insuranceFilters={Fecha:'2026-10-31',Id_Tour:2};
  const insurance=await timed('validation:Seguros',()=>seguros.listarSeguros(insuranceFilters));
  const [[insuredPassengersSql]]=await timed('sql:SegurosPasajeros',()=>db.query(`SELECT COUNT(DISTINCT p.Id_Pasajero) AS n
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Fecha_Tour=? AND h.Id_Tour=? AND UPPER(TRIM(COALESCE(r.Tipo_Reserva,'')))='GRUPAL'
      AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')`,
    [insuranceFilters.Fecha,insuranceFilters.Id_Tour]));
  const [[insuranceSql]]=await timed('sql:Seguros',()=>db.query(`SELECT COUNT(DISTINCT pb.Id_Bus_Prog) AS n
    FROM programaciones p JOIN programacion_tours pt ON pt.Id_Programacion=p.Id_Programacion
    JOIN programacion_buses pb ON pb.Id_Programacion=p.Id_Programacion
    WHERE p.Fecha_Tour='2026-10-31' AND pt.Id_Tour=2 AND p.Estado='activa'`));
  const insuranceExpected=Number(insuranceSql.n);
  const insuranceValidation={name:'Seguros | 31-oct tour 2',ok:Number(insuredPassengersSql.n)>0
      &&Array.isArray(insurance)&&insurance.length===insuranceExpected,
    elapsedMs:TIMED.find(item=>item.label==='validation:Seguros')?.elapsedMs||0,filters:insuranceFilters,
    passengerRows:Number(insuredPassengersSql.n),expectedRows:insuranceExpected,actualRows:Array.isArray(insurance)?insurance.length:null};
  manifest.validations.push(insuranceValidation);await writeManifest();
  if(!insuranceValidation.ok)throw new Error(`Seguros no coincide con sus buses guardados: ${JSON.stringify(insuranceValidation)}.`);
  results.push(insuranceValidation);

  const tourIds=[1,2,3,5,8,10];
  const listFilters={fecha:'2026-10-31',idsTours:tourIds};
  const busList=await timed('validation:ListadoBusesGuardado',()=>programacion.obtenerListadoFinal(listFilters));
  const [[savedProgram]]=await timed('sql:ListadoBusesGuardado',()=>db.query(`SELECT p.Id_Programacion
    FROM programaciones p JOIN programacion_tours pt ON pt.Id_Programacion=p.Id_Programacion
    WHERE p.Fecha_Tour='2026-10-31' AND p.Estado='activa' AND p.Tipo_Programacion='grupal'
      AND pt.Id_Tour IN (?) ORDER BY p.Confirmado_En DESC,p.Id_Programacion DESC LIMIT 1`,[tourIds]));
  let expectedSavedBuses=0;
  if(savedProgram){const [[row]]=await db.query('SELECT COUNT(*) AS n FROM programacion_buses WHERE Id_Programacion=?',[savedProgram.Id_Programacion]);expectedSavedBuses=Number(row.n);}
  const busListValidation={name:'Programación | listado de buses guardado 31-oct',ok:Boolean(busList.exists)===Boolean(savedProgram)
      &&(busList.buses||[]).length===expectedSavedBuses,
    serviceElapsedMs:TIMED.find(item=>item.label==='validation:ListadoBusesGuardado')?.elapsedMs||0,
    sqlElapsedMs:TIMED.find(item=>item.label==='sql:ListadoBusesGuardado')?.elapsedMs||0,
    filters:listFilters,expected:{exists:Boolean(savedProgram),buses:expectedSavedBuses},
    actual:{exists:Boolean(busList.exists),buses:(busList.buses||[]).length,idProgramacion:busList.idProgramacion||null}};
  manifest.validations.push(busListValidation);await writeManifest();
  if(!busListValidation.ok)throw new Error(`Listado de buses guardado no coincide con SQL: ${JSON.stringify(busListValidation)}.`);
  results.push(busListValidation);

  const routeDate='2026-10-31';
  const routePlan=await timed('validation:AsignacionRutasDiaPico',()=>programacion.generarPlanLogistico(routeDate,tourIds));
  const activeStates=['ACTIVA','ACTIVO','PENDIENTE','PENDIENTEDATOS','CONFIRMADA','COMPLETADA'];
  const routeSql=await timed('sql:AsignacionRutasDiaPico',()=>independentIds('sql:routePeak',`SELECT DISTINCT r.Id_Reserva AS id
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario
    WHERE r.Fecha_Tour=? AND h.Id_Tour IN (?)
      AND UPPER(TRIM(COALESCE(r.Estado,''))) IN (${activeStates.map(()=>'?').join(',')})
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva,'')))='GRUPAL' ORDER BY id`,[routeDate,tourIds,...activeStates]));
  const assignedIds=(routePlan.buses||[]).flatMap(bus=>(bus.reservas||[]).map(row=>String(row.Id_Reserva)));
  const unassignedIds=(routePlan.reservasSinAsignar||[]).map(row=>String(row.Id_Reserva));
  const coveredIds=[...assignedIds,...unassignedIds];
  const duplicateIds=coveredIds.filter((id,index)=>coveredIds.indexOf(id)!==index);
  const routeValidation={name:'Programación | asignación de rutas 31-oct',ok:sameSet(coveredIds,routeSql.ids)&&duplicateIds.length===0,
    serviceElapsedMs:TIMED.find(item=>item.label==='validation:AsignacionRutasDiaPico')?.elapsedMs||0,
    sqlElapsedMs:TIMED.find(item=>item.label==='sql:AsignacionRutasDiaPico')?.elapsedMs||0,
    filters:{fecha:routeDate,tours:tourIds},expectedRows:routeSql.ids.length,assignedRows:assignedIds.length,
    unassignedRows:unassignedIds.length,duplicateIds,expectedIds:routeSql.ids,actualIds:coveredIds.sort(),
    buses:(routePlan.buses||[]).map(bus=>({bus:bus.id||null,occupied:Number(bus.ocupados||0),capacity:Number(bus.capacidad||0),reservations:(bus.reservas||[]).length,
      routes:[...new Set((bus.paradas||[]).map(stop=>String(stop.ruta||'')).filter(Boolean))]})),alerts:routePlan.alertas||[]};
  manifest.validations.push(routeValidation);await writeManifest();
  if(!routeValidation.ok)throw new Error(`Asignación de rutas del día pico no cubre SQL exactamente: ${JSON.stringify(routeValidation)}.`);
  results.push(routeValidation);

  const closedDate='2026-10-23';
  const openDate='2026-10-31';
  const closed=await timed('validation:JornadaConfirmada',()=>confirmacion.obtenerEstadoConfirmacion(closedDate,2));
  const open=await timed('validation:JornadaAbierta',()=>confirmacion.obtenerEstadoConfirmacion(openDate,2));
  const closedJourney=(closed.jornadas||[]).find(row=>Number(row.Id_Tour)===2);
  const openJourney=(open.jornadas||[]).find(row=>Number(row.Id_Tour)===2);
  const [[closedSql]]=await timed('sql:JornadaConfirmada',()=>db.query(`SELECT COUNT(p.Id_Pasajero) AS pasajeros,
      SUM(CASE WHEN p.Confirmacion=1 THEN 1 ELSE 0 END) AS viajaron,
      DATE_FORMAT(MAX(cj.Confirmada_En),'%Y-%m-%d %H:%i:%s') AS Confirmada_En
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour=h.Id_Tour AND cj.Fecha_Tour=r.Fecha_Tour
    WHERE r.Fecha_Tour=? AND h.Id_Tour=2 AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')`,[closedDate]));
  const [[openSql]]=await timed('sql:JornadaAbierta',()=>db.query(`SELECT COUNT(p.Id_Pasajero) AS pasajeros,
      SUM(CASE WHEN p.Confirmacion=1 THEN 1 ELSE 0 END) AS viajaron,
      COUNT(cj.Id_Confirmacion) AS confirmaciones
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour=h.Id_Tour AND cj.Fecha_Tour=r.Fecha_Tour
    WHERE r.Fecha_Tour=? AND h.Id_Tour=2 AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')`,[openDate]));
  const journeyValidation={name:'Confirmación | jornada cerrada vs abierta',ok:Boolean(closedJourney?.Confirmada)
      &&Boolean(openJourney?.Requiere_Confirmacion)&&!Boolean(openJourney?.Confirmada)
      &&Number(closedJourney?.Total_Pasajeros)===Number(closedSql.pasajeros)
      &&Number(openJourney?.Total_Pasajeros)===Number(openSql.pasajeros)
      &&Number(openSql.confirmaciones)===0,
    serviceElapsedMs:Number((TIMED.find(item=>item.label==='validation:JornadaConfirmada')?.elapsedMs||0)
      +(TIMED.find(item=>item.label==='validation:JornadaAbierta')?.elapsedMs||0)),
    sqlElapsedMs:Number((TIMED.find(item=>item.label==='sql:JornadaConfirmada')?.elapsedMs||0)
      +(TIMED.find(item=>item.label==='sql:JornadaAbierta')?.elapsedMs||0)),
    expected:{closed:{date:closedDate,tour:2,passengers:Number(closedSql.pasajeros),confirmed:true},
      open:{date:openDate,tour:2,passengers:Number(openSql.pasajeros),confirmed:false,requiresConfirmation:true}},
    actual:{closed:closedJourney||null,open:openJourney||null}};
  manifest.validations.push(journeyValidation);await writeManifest();
  if(!journeyValidation.ok)throw new Error(`Estado de jornada cerrada/abierta no coincide: ${JSON.stringify(journeyValidation)}.`);
  results.push(journeyValidation);

  const travelPassengers=await timed('validation:ControlDeViaje',()=>confirmacion.obtenerPasajerosPorTour(2,closedDate));
  const [[travelSql]]=await timed('sql:ControlDeViaje',()=>db.query(`SELECT COUNT(p.Id_Pasajero) AS pasajeros,
      SUM(CASE WHEN p.Confirmacion=1 THEN 1 ELSE 0 END) AS confirmados
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Fecha_Tour=? AND h.Id_Tour=2 AND UPPER(TRIM(COALESCE(r.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')`,[closedDate]));
  const travelValidation={name:'Control de viaje | pasajeros de jornada confirmada',ok:travelPassengers.length===Number(travelSql.pasajeros)
      &&travelPassengers.filter(row=>Number(row.Confirmacion)===1).length===Number(travelSql.confirmados),
    serviceElapsedMs:TIMED.find(item=>item.label==='validation:ControlDeViaje')?.elapsedMs||0,
    sqlElapsedMs:TIMED.find(item=>item.label==='sql:ControlDeViaje')?.elapsedMs||0,
    filters:{Fecha:closedDate,Id_Tour:2},expected:{pasajeros:Number(travelSql.pasajeros),confirmados:Number(travelSql.confirmados)},
    actual:{pasajeros:travelPassengers.length,confirmados:travelPassengers.filter(row=>Number(row.Confirmacion)===1).length}};
  manifest.validations.push(travelValidation);await writeManifest();
  if(!travelValidation.ok)throw new Error(`Control de viaje no coincide con SQL: ${JSON.stringify(travelValidation)}.`);
  results.push(travelValidation);
  return results;
}

async function runValidateOnly() {
  instrumentDatabaseQueries();
  const validationTimedStart=TIMED.length;
  const validationQueryStart=QUERY_TIMINGS.length;
  const initial=await timed('validation:manifestState',()=>validateManifestStateReadOnly(args.manifestPath));
  const metadata=await timed('validation:primaryKeyMetadata',primaryKeyMetadata);
  const snapshotKeys=await timed('validation:validationStartKeys',()=>capturePrimaryKeys(metadata));
  const validationStartCounts=await timed('validation:validationStartCounts',countSnapshot);
  const reservationSpecs=manifest.plan.reservationSpecs;
  const transferSpecs=manifest.plan.transferSpecs;
  const inputs=await timed('validation:catalogs',readLoadInputs);
  const startIndex=manifest.validations.length;
  const dateSensitive=await timed('validation:dateSensitiveMidExpectations',()=>inspectDateSensitiveMidExpectations(reservationSpecs,transferSpecs));
  if(!dateSensitive.ok){
    process.exitCode=2;
    return {status:'DATE_SENSITIVE_MID_BLOCKED_READ_ONLY',readOnly:true,stopBeforeOtherValidations:true,
      manifestPath:initial.manifestPath,todayUsed:TODAY,dateSensitiveExpectations:dateSensitive,
      counts:{tables:initial.tableCount,total:initial.totalRows},emailOutbox:initial.emailOutbox,server:initial.server,
      timingsMs:TIMED.map(row=>({label:row.label,elapsedMs:row.elapsedMs,ok:row.ok}))};
  }
  manifest.validations.push({name:'expectativas sensibles al cambio de fecha 24–26 oct',ok:true,
    expectedDifferences:dateSensitive.affectedOperationStates.transitions.filter(row=>row.classification==='ESPERABLE_POR_CAMBIO_DE_FECHA').length,
    realErrors:0});

  const capacity=await timed('validation:capacity',()=>validateCapacity(reservationSpecs));
  manifest.validations.push({name:'integridad de cupos y disponibilidad',ok:true,
    elapsedMs:TIMED.find(row=>row.label==='validation:capacity')?.elapsedMs,groups:capacity});
  const allAvailability=await timed('validation:allAvailabilityRows',validateAllAvailabilityRows);
  manifest.validations.push({name:'integridad de todas las filas de disponibilidad',ok:true,
    elapsedMs:TIMED.find(row=>row.label==='validation:allAvailabilityRows')?.elapsedMs,...allAvailability});
  const foreignKeys=await timed('validation:foreignKeys',()=>validateFks(manifest.createdIdsByTable,metadata));
  manifest.foreignKeyChecks=foreignKeys;
  manifest.validations.push({name:'FKs y huérfanos de filas creadas',ok:true,checkedConstraints:foreignKeys.length,orphanRows:0});
  await timed('validation:codes',()=>validateUniqueCodes(reservationSpecs,transferSpecs));
  await timed('validation:allManifestCodes',validateAllManifestCodes);
  await timed('validation:commissions',()=>validateCommissionDefaults(reservationSpecs));
  await timed('validation:historyDates',()=>validateHistoryAndDates(reservationSpecs,transferSpecs));
  const filters=await timed('validation:serviceFilters',()=>validateServiceFilters(reservationSpecs,transferSpecs,inputs));
  const readOnlyReports=await timed('validation:readOnlyReports',()=>validatePeakAndReadOnlyReports(reservationSpecs,inputs));
  const slowQueryExplain=await timed('validation:slowQueryExplain',()=>explainSlowReadQueries(validationTimedStart));

  const [[outboxAfter]]=await timed('validation:emailOutboxAfter',()=>db.query('SELECT COUNT(*) AS n FROM email_outbox'));
  if(Number(outboxAfter.n)!==0)throw new Error(`email_outbox cambió o no está vacío al final: ${outboxAfter.n}.`);
  const endCounts=await timed('validation:countsAfter',countSnapshot);
  const countChanges=compareCounts(validationStartCounts,endCounts);
  if(countChanges.length||sumCounts(endCounts)!==sumCounts(validationStartCounts))
    throw new Error(`El modo --validate-only detectó cambios en conteos: ${JSON.stringify(countChanges)}.`);
  const endKeys=await timed('validation:keysAfter',()=>capturePrimaryKeys(metadata));
  const keyChanges=[];
  for(const table of Object.keys(snapshotKeys.tables)){
    const start=keyMap(snapshotKeys.tables[table]);const end=keyMap(endKeys.tables[table]);
    const added=[...end].filter(key=>!start.has(key));const removed=[...start].filter(key=>!end.has(key));
    if(added.length||removed.length)keyChanges.push({table,added:added.length,removed:removed.length});
  }
  if(keyChanges.length)throw new Error(`Claves cambiaron durante --validate-only: ${JSON.stringify(keyChanges)}.`);
  const validations=manifest.validations.slice(startIndex);
  if(validations.some(item=>item.ok===false))throw new Error(`Una o más validaciones fallaron: ${JSON.stringify(validations.filter(item=>item.ok===false))}.`);
  const topSlowQueries=QUERY_TIMINGS.slice(validationQueryStart).sort((a,b)=>b.elapsedMs-a.elapsedMs).slice(0,10)
    .map(row=>({elapsedMs:row.elapsedMs,kind:row.kind,sql:row.sql.trim(),parameterCount:Array.isArray(row.params)?row.params.length:null}));
  return {status:'VALIDATE_ONLY_OK',readOnly:true,manifestState:manifest.state,manifestPath:initial.manifestPath,
    database:initial.identity.databaseName,today:initial.identity.today,counts:{tables:endCounts.length,total:sumCounts(endCounts),emailOutbox:Number(outboxAfter.n)},
    exactPilot02ManifestMatch:{createdIdTables:Object.keys(manifest.createdIdsByTable||{}).length,checkedTables:initial.checkedTables,unexpectedRows:0,missingRows:0},
    validations,filterChecks:filters,readOnlyReports,dateSensitiveExpectations:dateSensitive,slowQueryExplain,topSlowQueries,server:initial.server,
    timingsMs:TIMED.map(row=>({label:row.label,elapsedMs:row.elapsedMs,ok:row.ok}))};
}

async function runPendingJobOnce() {
  const [[outboxBefore]] = await db.query('SELECT COUNT(*) AS n FROM email_outbox');
  if (Number(outboxBefore.n) !== 0) {
    manifest.pendingJob={state:'SKIPPED_EMAIL_OUTBOX_NOT_EMPTY',emailOutboxRows:Number(outboxBefore.n)};
    manifest.state='PILOT_STOPPED_BEFORE_JOB_EMAIL_OUTBOX_NONEMPTY'; await writeManifest();
    throw new Error(`email_outbox tiene ${outboxBefore.n} filas antes del job; el job no se ejecutó.`);
  }
  const domainState=require('../services/Pendientes/domain-state-detector.service');
  const reminder=require('../services/Recordatorios/recordatorios-trigger.service');
  const pending=require('../services/Pendientes/pendientes-trigger.service');
  const transferLists=require('../services/Programacion/programacion-transfers-novedades.service');
  const tasks=[];
  const taskPromises=[];
  function wrap(module,key,label){
    if(typeof module[key]!=='function')throw new Error(`No se puede medir tarea ${label}: export ${key} no disponible.`);
    const original=module[key];
    module[key]=function(...callArgs){
      const started=performance.now();const startedAt=new Date().toISOString();logLine('PENDING_TASK_START',{task:label,startedAt});
      let value;try{value=original.apply(this,callArgs);}catch(error){value=Promise.reject(error);}
      const tracked=Promise.resolve(value).then(result=>{
        const elapsedMs=Number((performance.now()-started).toFixed(2));
        const item={task:label,status:'DONE',elapsedMs,startedAt,finishedAt:new Date().toISOString()};
        tasks.push(item);logLine('PENDING_TASK_DONE',item);return result;
      },error=>{
        const elapsedMs=Number((performance.now()-started).toFixed(2));
        const item={task:label,status:'FAILED',elapsedMs,startedAt,finishedAt:new Date().toISOString(),error:errorJson(error)};
        tasks.push(item);logLine('PENDING_TASK_FAILED',item);throw error;
      });
      taskPromises.push(tracked);
      return tracked;
    };
  }
  // Patch dependencies before the job destructures them.
  wrap(domainState,'syncDomainStatePendings','syncDomainStatePendings');
  wrap(reminder,'processDueReminders','processDueReminders');
  wrap(pending,'processDuePendings','processDuePendings');
  wrap(transferLists,'syncSavedLists','syncSavedLists');
  const job=require('../jobs/pendientes.job');
  if(typeof job.ejecutarPendientes!=='function')throw new Error('No se exporta ejecutarPendientes().');
  const startedAt=new Date().toISOString();const started=performance.now();
  manifest.pendingJob={state:'STARTED',startedAt,timeoutMs:120000,tasks:[]};manifest.state='PENDIENTES_JOB_START';await writeManifest();
  logLine('PENDIENTES_JOB_START',{startedAt,timeoutMs:120000,invocations:1});
  let timeoutId;
  const timeout=new Promise(resolve=>{timeoutId=setTimeout(()=>resolve({timedOut:true}),120000);});
  // Exactly one call. The watchdog exits the process instead of waiting for
  // an unresponsive task after the 120 second contract expires.
  const execution=(async()=>{
    const result=await job.ejecutarPendientes();
    await Promise.allSettled(taskPromises);
    return {result:result??null};
  })();
  const raced=await Promise.race([execution,timeout]);
  clearTimeout(timeoutId);
  if(raced?.timedOut){
    const info={state:'TIMEOUT',startedAt,timeoutMs:120000,elapsedMs:120000,tasks};
    manifest.pendingJob=info;manifest.state='PENDIENTES_JOB_TIMEOUT';await writeManifest();
    logLine('PENDIENTES_JOB_TIMEOUT',info);process.stdout.write(JSON.stringify({status:manifest.state,manifestPath:MANIFEST_PATH,logPath:LOG_PATH})+'\n');
    process.exit(124);
  }
  const finishedAt=new Date().toISOString();
  const outcome={state:'DONE',startedAt,finishedAt,elapsedMs:Number((performance.now()-started).toFixed(2)),result:raced.result,tasks};
  manifest.pendingJob=outcome;manifest.state='PENDIENTES_JOB_DONE';await writeManifest();
  logLine('PENDIENTES_JOB_DONE',outcome);
  if(tasks.length!==4||tasks.some(item=>item.status!=='DONE')){
    throw new Error(`PendientesJob terminó con tareas incompletas o fallidas: ${JSON.stringify({expectedTasks:4,tasks})}`);
  }
  const [[outboxAfter]] = await db.query('SELECT COUNT(*) AS n FROM email_outbox');
  manifest.pendingJob.emailOutboxAfter=Number(outboxAfter.n);await writeManifest();
  if(Number(outboxAfter.n)!==0)throw new Error(`email_outbox cambió durante el job: ${outboxAfter.n} filas.`);
  return outcome;
}

async function captureChanges(metadata, beforeKeys, countsBefore) {
  const afterKeys=await capturePrimaryKeys(metadata);
  const createdIdsByTable=diffPrimaryKeys(beforeKeys,afterKeys);
  const countsAfter=await countSnapshot();
  const baselineAvailabilityKeys=(beforeKeys.tables.disponibilidad||[]).map(key=>key.map(String));
  manifest.createdIdsByTable=createdIdsByTable;
  manifest.countsAfter=countsAfter;
  manifest.countsTotalAfter=sumCounts(countsAfter);
  manifest.deltaByTable=compareCounts(countsBefore,countsAfter);
  manifest.primaryKeyDiffTables=Object.keys(createdIdsByTable).sort();
  manifest.createdPrimaryKeyCount=Object.values(createdIdsByTable).reduce((sum,rows)=>sum+rows.length,0);
  manifest.baselineAvailabilityKeys=baselineAvailabilityKeys;
  manifest.timings=TIMED;
  await writeManifest();
  return {afterKeys,createdIdsByTable,countsAfter};
}

async function finalizeManifest(metadata,beforeKeys,countsBefore,state,error=null){
  try{await captureChanges(metadata,beforeKeys,countsBefore);}catch(captureError){
    manifest.captureFailure=errorJson(captureError);logLine('CAPTURE_FAILURE',{error:errorJson(captureError)});
  }
  manifest.state=state;
  if(error)manifest.error=errorJson(error);
  manifest.timings=TIMED;
  manifest.completedAt=new Date().toISOString();
  await writeManifest();
}

function timeAverage(prefix){
  const values=TIMED.filter(item=>item.ok&&item.label.startsWith(prefix)).map(item=>item.elapsedMs);
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
}

function timeTotal(prefix){
  return TIMED.filter(item=>item.ok&&item.label.startsWith(prefix)).reduce((sum,item)=>sum+item.elapsedMs,0);
}

function estimates(){
  const createReservationMs=timeAverage('service:reservationWrapper:');
  const createTransferMs=timeAverage('service:transferWrapper:');
  const editMs=timeAverage('service:reservationUpdateWrapper:');
  const cancelMs=timeAverage('service:reservationCancelWrapper:');
  const groupMoveMs=timeTotal('control:reconcilePool:')/Math.max(1,manifest.operations.reservations.filter(row=>row.type==='Grupal').length);
  const privateMoveMs=timeTotal('control:movePrivate:')/Math.max(1,manifest.operations.reservations.filter(row=>row.type==='Privada').length);
  const transferBackdateMs=timeAverage('control:backdateTransfers:');
  const postMoveSyncMs=timeAverage('service:syncProgramacionAfterMove:');
  const jobMs=Number(manifest.pendingJob?.elapsedMs||0);
  const validationMs=timeTotal('validation:');
  const fixedServiceMs=timeTotal('service:normalizePastReservations')+timeTotal('service:closeCommissionJourney')
    +timeTotal('sql:backdateAutomaticStateHistory');
  const estimate=(reservations,transfersCount,edits,cancels)=>{
    const privateCount=Math.round(reservations*0.05);const groupCount=reservations-privateCount;
    const ms=reservations*(createReservationMs+postMoveSyncMs)+transfersCount*(createTransferMs+transferBackdateMs)
      +edits*editMs+cancels*cancelMs+groupCount*groupMoveMs+privateCount*privateMoveMs+jobMs+validationMs+fixedServiceMs;
    return {reservations,transfers:transfersCount,serviceEdits:edits,serviceCancellations:cancels,
      movementAssumption:{groupReservations:groupCount,privateReservations:privateCount,groupReconcileMsPerReservation:Number(groupMoveMs.toFixed(2)),
        privateMoveMsPerReservation:Number(privateMoveMs.toFixed(2)),transferBackdateMsPerTransfer:Number(transferBackdateMs.toFixed(2)),
        postMoveProgramSyncMsPerReservation:Number(postMoveSyncMs.toFixed(2))},
      estimatedSeconds:Number((ms/1000).toFixed(1)),componentsSeconds:{reservations:Number((reservations*createReservationMs/1000).toFixed(1)),
        transfers:Number((transfersCount*createTransferMs/1000).toFixed(1)),movementAndSync:Number((reservations*(0.95*groupMoveMs+0.05*privateMoveMs+postMoveSyncMs)/1000+transfersCount*transferBackdateMs/1000).toFixed(1)),
        edits:Number((edits*editMs/1000).toFixed(1)),cancellations:Number((cancels*cancelMs/1000).toFixed(1)),
        pendingJob:Number((jobMs/1000).toFixed(1)),pilotValidations:Number((validationMs/1000).toFixed(1)),fixedService:Number((fixedServiceMs/1000).toFixed(1))}};
  };
  return {basis:{avgReservationCreateMs:Number(createReservationMs.toFixed(2)),avgTransferCreateMs:Number(createTransferMs.toFixed(2)),
      avgServiceEditMs:Number(editMs.toFixed(2)),avgServiceCancelMs:Number(cancelMs.toFixed(2)),pilotPendingJobMs:jobMs,
      avgGroupReconcileMsPerReservation:Number(groupMoveMs.toFixed(2)),avgPrivateMoveMsPerReservation:Number(privateMoveMs.toFixed(2)),
      avgTransferBackdateMs:Number(transferBackdateMs.toFixed(2)),avgPostMoveSyncMs:Number(postMoveSyncMs.toFixed(2)),
      note:'Extrapolación lineal de las etapas incrementales aprobadas; mid/full no ejecutadas. Añade el job, validación y servicios fijos medidos en el piloto; la validación a mayor volumen puede tardar más.'},
    // Incremental after pilot: cumulative targets are 300/30 and 1000/100.
    mid:estimate(240,24,24,7),full:estimate(700,70,70,21)};
}

async function buildMidPlan() {
  const currentState=await timed('midPlan:manifestState',()=>validateManifestStateReadOnly(args.manifestPath));
  if(manifest.mid||manifest.stageRuns?.mid||String(manifest.state||'').startsWith('MID_'))
    throw new Error('El manifiesto ya contiene una etapa mid iniciada; no se repite ni se reintenta.');
  const inputs=await timed('midPlan:catalogs',readLoadInputs);
  const pilotSpecs=manifest.plan.reservationSpecs.slice(0,60);
  const pilotTransfers=manifest.plan.transferSpecs.slice(0,6);
  const rng=seedRandom(`${manifest.seed}-mid-v1`);
  const reservationSpecs=buildMidReservationSpecs(inputs,pilotSpecs);
  const transferSpecs=buildMidTransferSpecs(inputs,pilotTransfers);
  const modifications=assignChanges(reservationSpecs,inputs,{edits:24,cancellations:7});
  const dateAssignment=await timed('midPlan:finalDatesAndCapacity',()=>assignMidReservationDates(inputs,reservationSpecs));
  for(const spec of reservationSpecs)await timed(`midPlan:buildReservationInput:${spec.sequence}`,()=>createInputsForSpec(spec,inputs));
  for(const spec of transferSpecs)spec.transferPlan=buildTransferPayload(spec,inputs);
  const [actors]=await db.query(`SELECT u.Id_Usuario FROM usuarios u JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE u.Activo=1 AND LOWER(TRIM(r.Nombre_Rol))='asesor' ORDER BY u.Id_Usuario`);
  if(!actors.length)throw new Error('No hay asesores activos válidos para atribuir la etapa mid.');
  const actorPlan=assignPlannedActors(actors.map(row=>Number(row.Id_Usuario)),reservationSpecs,transferSpecs);
  const plan=validatePlan(inputs,reservationSpecs,transferSpecs);
  const inputCounts=validatePlannedInputs(inputs,reservationSpecs,transferSpecs,modifications);
  const capacityByPoolAndDate=await timed('midPlan:capacityBatches',()=>buildMidCapacityPlan(inputs,reservationSpecs));
  plan.operationSummary=groupSummary([...reservationSpecs,
    ...transferSpecs.map(row=>({...row,kind:'Transfer',tourId:'TRANSFER'}))],inputs,
  item=>item.kind==='Transfer'?(item.finalDate<TODAY?'Completado':'Confirmado'):expectedReservationState(item));
  plan.capacityByPoolAndDate=capacityByPoolAndDate;
  return {currentState,inputs,reservationSpecs,transferSpecs,modifications,plan,inputCounts,actorPlan,
    silletero:buildSilleteroReadout(inputs),dateAssignment,
    countsAfterPlan:await timed('midPlan:countsAfter',countSnapshot)};
}

const FULL_RESERVATION_TARGETS={
  group:{past:537,oct24_25:5,oct26:4,oct31:250,nov1:35,nov2:40,nov3_16:79},
  private:{past:27,oct24_25:1,oct31:6,nov1:2,nov2:2,nov3_16:12},
};
const FULL_TRANSFER_TARGETS={past:55,oct24_25:5,oct31:20,nov1:8,nov2:8,nov3_16:4};
const FULL_CHANNEL_TARGETS=new Map([[2,470],[3,110],[10,80],[8,70],[9,70],[6,50],[5,30],[7,30],[11,30],[4,60]]);
const FULL_TOURS=[1,2,3,5,8,10];

function fullDateBucket(date){
  if(date>='2026-07-27'&&date<='2026-10-23')return 'past';
  if(date>='2026-10-24'&&date<='2026-10-25')return 'oct24_25';
  if(date==='2026-10-26')return 'oct26';
  if(date==='2026-10-31')return 'oct31';
  if(date==='2026-11-01')return 'nov1';
  if(date==='2026-11-02')return 'nov2';
  if(date>='2026-11-03'&&date<='2026-11-16')return 'nov3_16';
  return 'outside';
}

function rangeForFullBucket(bucket){
  const ranges={past:['2026-07-27','2026-10-23'],oct24_25:['2026-10-24','2026-10-25'],
    oct26:['2026-10-26','2026-10-26'],oct31:['2026-10-31','2026-10-31'],
    nov1:['2026-11-01','2026-11-01'],nov2:['2026-11-02','2026-11-02'],
    nov3_16:['2026-11-03','2026-11-16']};
  if(!ranges[bucket])throw new Error(`Ventana full desconocida: ${bucket}.`);
  return ranges[bucket];
}

function allocateWeighted(total,weights){
  const entries=[...weights.entries()].filter(([,weight])=>Number(weight)>0);
  const sum=entries.reduce((value,[,weight])=>value+Number(weight),0);
  if(total<0||!sum)throw new Error(`No se puede distribuir ${total} con pesos vacíos.`);
  const allocation=new Map(entries.map(([key,weight])=>[key,Math.floor(total*Number(weight)/sum)]));
  let remaining=total-[...allocation.values()].reduce((a,b)=>a+b,0);
  const remainders=entries.map(([key,weight])=>({key,remainder:total*Number(weight)/sum-Math.floor(total*Number(weight)/sum)}))
    .sort((a,b)=>b.remainder-a.remainder||Number(a.key)-Number(b.key));
  for(let index=0;index<remaining;index+=1){const key=remainders[index%remainders.length].key;allocation.set(key,allocation.get(key)+1);}
  return allocation;
}

function summarizedCounts(rows,keyFor){
  const map=new Map();for(const row of rows){const key=String(keyFor(row));map.set(key,Number(map.get(key)||0)+1);}
  return Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)));
}

function assertFullTotals(reservations,transfers){
  const group=reservations.filter(row=>row.kind==='Grupal');
  const privates=reservations.filter(row=>row.kind==='Privada');
  if(reservations.length!==1000||group.length!==950||privates.length!==50||transfers.length!==100)
    throw new Error(`Totales full no coinciden: ${reservations.length} reservas (${group.length} grupales/${privates.length} privadas), ${transfers.length} transfers; esperado 1000/950/50/100.`);
  if(reservations.some(row=>Number(row.tourId)===6))throw new Error('El plan full contiene Silletero; debe redistribuir sus 13 operaciones.');
  const bucketCounts={};
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private'])){
    const target=FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private'][bucket];
    const actual=reservations.filter(row=>row.kind===kind&&fullDateBucket(row.finalDate)===bucket).length;
    bucketCounts[`${kind}:${bucket}`]={actual,target};
    if(actual!==target)throw new Error(`Distribución full ${kind}/${bucket}: ${actual}, esperado ${target}.`);
  }
  for(const [id,target] of FULL_CHANNEL_TARGETS){
    const actual=reservations.filter(row=>Number(row.channelId)===id).length;
    if(actual!==target)throw new Error(`Canal ${id}: ${actual}, esperado ${target} en 1.000 reservas.`);
  }
  const transferBuckets={};
  for(const [bucket,target] of Object.entries(FULL_TRANSFER_TARGETS)){
    const actual=transfers.filter(row=>fullDateBucket(row.finalDate)===bucket).length;
    transferBuckets[bucket]={actual,target};
    if(actual!==target)throw new Error(`Distribución full de transfers ${bucket}: ${actual}, esperado ${target}.`);
  }
  return {bucketCounts,transferBuckets,channelCounts:Object.fromEntries([...FULL_CHANNEL_TARGETS])};
}

async function assignFullReservationDates(inputs,specs,existingReservationMoves=[]){
  const dateSet=new Set();for(const spec of specs){const [from,to]=rangeForFullBucket(spec.targetBucket);for(let d=from;d<=to;d=addDays(d,1))dateSet.add(d);}
  for(const move of existingReservationMoves.filter(row=>row.type==='Grupal'))dateSet.add(move.to);
  const dates=[...dateSet].sort();const pools=[...new Set(FULL_TOURS.map(normalizeTourForCapacity))];
  const occupancy=new Map();const capacity=new Map();const plannedSeats=new Map();const assignedByTour=new Map();const privateByTour=new Map();const privateByDate=new Map();
  const keys=[];for(const date of dates)for(const pool of pools)keys.push({date,pool,key:`${pool}|${date}`});
  await Promise.all(keys.map(async item=>{
    occupancy.set(item.key,await occupancyForPool(db,item.pool,item.date));
    capacity.set(item.key,await effectiveCapacity(db,item.pool,item.date));
  }));
  for(const move of existingReservationMoves.filter(row=>row.type==='Grupal')){
    const pool=normalizeTourForCapacity(move.tourId);const key=`${pool}|${move.to}`;
    plannedSeats.set(key,Number(plannedSeats.get(key)||0)+Number(move.seatedCount||0));
  }
  const tourWeights=new Map(FULL_TOURS.map(id=>[id,Math.max(1,Number(manifest.operations.reservations.filter(row=>Number(row.tourId)===id).length))]));
  for(const spec of specs){
    const [from,to]=rangeForFullBucket(spec.targetBucket);
    const candidateDates=[];for(let date=from;date<=to;date=addDays(date,1))candidateDates.push(date);
    let best=null;
    for(const tourId of (spec.fixedTourId?[Number(spec.fixedTourId)]:FULL_TOURS)){
      if(!inputs.tours.has(Number(tourId)))continue;
      for(const date of candidateDates){
        if(!isOperatingDay(inputs,tourId,date))continue;
        const pool=normalizeTourForCapacity(tourId);const key=`${pool}|${date}`;
        const used=Number(occupancy.get(key)||0)+Number(plannedSeats.get(key)||0);
        const cap=Number(capacity.get(key)||0);
        if(spec.kind==='Grupal'&&(!cap||used+2>cap))continue;
        const tourLoad=Number(assignedByTour.get(tourId)||privateByTour.get(tourId)||0);
        const weight=Number(tourWeights.get(tourId)||1);
        const dateLoad=Number(privateByDate.get(date)||0);
        const score=tourLoad/weight+(spec.kind==='Grupal'?(used/cap)*0.12:dateLoad*0.03);
        if(!best||score<best.score||(score===best.score&&date<best.date))best={tourId,date,pool,key,score,used,cap};
      }
    }
    if(!best)throw new Error(`Full: sin fecha operativa/cupo para ${spec.kind}, ventana ${spec.targetBucket}, secuencia ${spec.sequence}${spec.fixedTourId?`, tour fijo ${spec.fixedTourId}`:''}.`);
    spec.tourId=Number(best.tourId);spec.finalDate=best.date;spec.capacityPoolId=normalizeTourForCapacity(spec.tourId);
    spec.originalDate=TEMP_DATE;spec.serviceDateBeforeMove=TEMP_DATE;spec.temporaryCreateDate=TEMP_DATE;
    spec.originalAvailabilityKey={Id_Tour:spec.capacityPoolId,Fecha_Tour:TEMP_DATE};
    spec.finalAvailabilityKey={Id_Tour:spec.capacityPoolId,Fecha_Tour:spec.finalDate};
    spec.leadDays=1+((spec.sequence*17+spec.tourId*3)%30);
    spec.registrationDate=addDays(spec.finalDate,-spec.leadDays);
    spec.registrationDateTime=`${spec.registrationDate} 12:00:00`;
    if(spec.kind==='Grupal'){
      plannedSeats.set(best.key,Number(plannedSeats.get(best.key)||0)+2);
      assignedByTour.set(spec.tourId,Number(assignedByTour.get(spec.tourId)||0)+1);
    }else{
      privateByTour.set(spec.tourId,Number(privateByTour.get(spec.tourId)||0)+1);
      privateByDate.set(spec.finalDate,Number(privateByDate.get(spec.finalDate)||0)+1);
    }
  }
  return {plannedSeatsByPoolDate:Object.fromEntries(plannedSeats),tourWeights:Object.fromEntries(tourWeights)};
}

async function readExistingReservationMoveDetails(operations){
  const ids=operations.map(row=>String(row.Id_Reserva));
  if(!ids.length)return new Map();
  const [rows]=await db.query(`SELECT r.Id_Reserva,r.Tipo_Reserva,r.Observaciones,
      DATE_FORMAT(r.Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,h.Id_Tour,
      COUNT(DISTINCT p.Id_Pasajero) AS PassengerCount,
      SUM(CASE WHEN UPPER(TRIM(COALESCE(p.Tipo_Pasajero,''))) IN ('ADULTO','NIÑO','NINO') THEN 1 ELSE 0 END) AS SeatedCount
    FROM reservas r JOIN horarios h ON h.Id_Horario=r.Id_Horario
    LEFT JOIN pasajeros p ON p.Id_Reserva=r.Id_Reserva
    WHERE r.Id_Reserva IN (?) GROUP BY r.Id_Reserva,r.Tipo_Reserva,r.Fecha_Tour,h.Id_Tour`,[ids]);
  const details=new Map(rows.map(row=>[String(row.Id_Reserva),{
    id:String(row.Id_Reserva),type:String(row.Tipo_Reserva||'').trim().toUpperCase()==='GRUPAL'?'Grupal':'Privada',
    from:String(row.Fecha_Tour),tourId:Number(row.Id_Tour),passengerCount:Number(row.PassengerCount||0),
    seatedCount:Number(row.SeatedCount||0),createdByRun:String(row.Observaciones||'').includes(MARKER),
  }]));
  for(const operation of operations){
    const detail=details.get(String(operation.Id_Reserva));
    if(!detail||detail.from!==operation.finalDate||detail.tourId!==Number(operation.tourId)
        ||detail.type!==operation.type||detail.passengerCount<1||!detail.createdByRun)
      throw new Error(`Reserva existente ${operation.Id_Reserva} difiere del manifiesto o no tiene pasajeros: ${JSON.stringify({operation,detail})}.`);
    if(detail.type==='Privada'&&(detail.passengerCount<15||detail.passengerCount>35))
      throw new Error(`Reserva privada ${operation.Id_Reserva} tiene ${detail.passengerCount} pasajeros; el rango permitido es 15–35.`);
    if(detail.type==='Grupal'&&detail.seatedCount<1)
      throw new Error(`Reserva grupal ${operation.Id_Reserva} no tiene pasajeros que consuman cupo.`);
  }
  return details;
}

async function planExistingReservationMoves(inputs,operations,details){
  const targets={Grupal:FULL_RESERVATION_TARGETS.group,Privada:FULL_RESERVATION_TARGETS.private};
  const orderedBuckets=['oct31','nov2','nov3_16'];
  const adjustedOperations=operations.map(row=>({...row}));
  const counts={Grupal:{},Privada:{}};
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(targets[kind]))
    counts[kind][bucket]=adjustedOperations.filter(row=>(row.type==='Grupal'?'Grupal':'Privada')===kind
      &&fullDateBucket(row.finalDate)===bucket).length;
  const moves=[];const plannedSeatsByPoolDate=new Map();const occupancy=new Map();const capacities=new Map();
  const chooseTarget=async(operation,detail,sourceBucket,reason)=>{
    const kind=detail.type;
    for(const bucket of orderedBuckets){
      if(Number(targets[kind][bucket]||0)-Number(counts[kind][bucket]||0)<=0)continue;
      const [from,to]=rangeForFullBucket(bucket);const dates=[];
      for(let date=from;date<=to;date=addDays(date,1))if(isOperatingDay(inputs,detail.tourId,date))dates.push(date);
      if(kind==='Grupal'){
        const pool=normalizeTourForCapacity(detail.tourId);
        for(const date of dates){
          const key=`${pool}|${date}`;
          if(!occupancy.has(key))occupancy.set(key,await occupancyForPool(db,pool,date));
          if(!capacities.has(key))capacities.set(key,await effectiveCapacity(db,pool,date));
        }
        dates.sort((left,right)=>{
          const leftKey=`${pool}|${left}`;const rightKey=`${pool}|${right}`;
          const leftCapacity=Number(capacities.get(leftKey)||0);const rightCapacity=Number(capacities.get(rightKey)||0);
          const leftLoad=(Number(occupancy.get(leftKey)||0)+Number(plannedSeatsByPoolDate.get(leftKey)||0))/Math.max(1,leftCapacity);
          const rightLoad=(Number(occupancy.get(rightKey)||0)+Number(plannedSeatsByPoolDate.get(rightKey)||0))/Math.max(1,rightCapacity);
          return leftLoad-rightLoad||left.localeCompare(right);
        });
      }
      for(const date of dates){
        const pool=normalizeTourForCapacity(detail.tourId);const key=`${pool}|${date}`;
        if(kind==='Grupal'){
          if(!occupancy.has(key))occupancy.set(key,await occupancyForPool(db,pool,date));
          if(!capacities.has(key))capacities.set(key,await effectiveCapacity(db,pool,date));
          const seats=Number(detail.seatedCount||0);const used=Number(occupancy.get(key)||0)+Number(plannedSeatsByPoolDate.get(key)||0);
          if(!capacities.get(key)||used+seats>Number(capacities.get(key)))continue;
          plannedSeatsByPoolDate.set(key,Number(plannedSeatsByPoolDate.get(key)||0)+seats);
        }
        const move={id:String(operation.Id_Reserva),type:kind,tourId:detail.tourId,passengerCount:detail.passengerCount,
          seatedCount:detail.seatedCount,from:operation.finalDate,to:date,fromBucket:sourceBucket,runId:manifest.runId,
          targetBucket:bucket,reason};
        operation.finalDate=date;counts[kind][bucket]=Number(counts[kind][bucket]||0)+1;
        if(sourceBucket!=='outside')counts[kind][sourceBucket]=Number(counts[kind][sourceBucket]||0)-1;
        moves.push(move);return move;
      }
    }
    throw new Error(`No hay bucket con déficit, día operativo y cupo para reubicar ${detail.type} ${operation.Id_Reserva} desde ${operation.finalDate}.`);
  };
  const outside=adjustedOperations.filter(row=>fullDateBucket(row.finalDate)==='outside');
  if(outside.length!==14||outside.filter(row=>row.type==='Grupal').length!==13||outside.filter(row=>row.type==='Privada').length!==1)
    throw new Error(`El manifiesto debe tener 14 operaciones fuera de buckets (13 grupales/1 privada); recibió ${outside.length}/${outside.filter(row=>row.type==='Grupal').length}/${outside.filter(row=>row.type==='Privada').length}.`);
  for(const operation of outside.filter(row=>row.type==='Grupal'))
    await chooseTarget(operation,details.get(String(operation.Id_Reserva)),'outside','out-of-bucket-reallocation');
  for(const operation of outside.filter(row=>row.type==='Privada'))
    await chooseTarget(operation,details.get(String(operation.Id_Reserva)),'outside','out-of-bucket-reallocation');
  const privateNov1=adjustedOperations.filter(row=>row.type==='Privada'&&row.finalDate==='2026-11-01');
  while(privateNov1.filter(row=>row.finalDate==='2026-11-01').length>Number(FULL_RESERVATION_TARGETS.private.nov1)){
    const source=privateNov1.find(row=>row.finalDate==='2026-11-01'
      &&orderedBuckets.some(bucket=>Number(FULL_RESERVATION_TARGETS.private[bucket]||0)-Number(counts.Privada[bucket]||0)>0
        &&(()=>{const [from,to]=rangeForFullBucket(bucket);for(let date=from;date<=to;date=addDays(date,1))if(isOperatingDay(inputs,Number(row.tourId),date))return true;return false;})()));
    if(!source)throw new Error('No se pueden reubicar las privadas sobrantes del 1-nov sin romper operación del tour.');
    const detail=details.get(String(source.Id_Reserva));
    await chooseTarget(source,detail,'nov1','approved-private-bucket-rebalance');
  }
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(targets[kind]))
    if(counts[kind][bucket]>targets[kind][bucket])throw new Error(`La reubicación deja ${counts[kind][bucket]}/${targets[kind][bucket]} en ${kind}/${bucket}.`);
  return {adjustedOperations,moves,plannedSeatsByPoolDate:Object.fromEntries(plannedSeatsByPoolDate)};
}

async function buildFullPlan(){
  const currentState=await timed('fullPlan:manifestState',()=>validateManifestStateReadOnly(args.manifestPath));
  const allowedManifestStates=['MID_DONE','PREFLIGHT_FAILED_NO_DB_WRITE'];
  if(!allowedManifestStates.includes(manifest.state)||manifest.mid?.state!=='MID_DONE'||manifest.full||manifest.stageRuns?.full||manifest.plan.reservationSpecs.length!==300
      ||manifest.plan.transferSpecs.length!==30||manifest.operations.reservations.length!==300||manifest.operations.transfers.length!==30)
    throw new Error(`Full solo admite MID_DONE sin etapa full previa; estado=${manifest.state}, reservas=${manifest.operations.reservations.length}, transfers=${manifest.operations.transfers.length}.`);
  if(args.runId!==manifest.runId)throw new Error(`runId ${args.runId} no coincide con el manifiesto ${manifest.runId}.`);
  MARKER=manifest.marker;
  const inputs=await timed('fullPlan:catalogs',readLoadInputs);
  for(const [id,total] of FULL_CHANNEL_TARGETS){
    const row=inputs.channelMap.get(id);if(!row)throw new Error(`Canal objetivo ${id} no existe en canales_origen.`);
    if(id===1||![0,1].includes(Number(row.Tiene_Comision)))throw new Error(`Canal ${id} tiene Tiene_Comision inválido.`);
    const normalized=String(row.Nombre_Canal||'').trim().toUpperCase().replace(/_/g,' ');
    if(id===11&&(normalized!=='TIKTOK'||Number(row.Tiene_Comision)!==0))
      throw new Error(`El canal 11 debe ser TIKTOK sin comisión; se recibió ${normalized}/${row.Tiene_Comision}.`);
  }
  const outOfBucketReservations=manifest.operations.reservations.filter(row=>fullDateBucket(row.finalDate)==='outside');
  const privateNov1Candidates=manifest.operations.reservations.filter(row=>row.type==='Privada'&&row.finalDate==='2026-11-01');
  const moveDetails=await readExistingReservationMoveDetails([...outOfBucketReservations,...privateNov1Candidates]);
  const reservationReallocation=await planExistingReservationMoves(inputs,manifest.operations.reservations,moveDetails);
  const transferCandidates=manifest.operations.transfers.filter(row=>fullDateBucket(row.finalDate)==='nov3_16')
    .sort((a,b)=>String(a.Id_Transfer).localeCompare(String(b.Id_Transfer)));
  if(!transferCandidates.length)throw new Error('No hay transfer de 3-16 nov para cuadrar la distribución aprobada.');
  const existingDateAdjustments={reservations:reservationReallocation.moves,
    transfers:[{id:Number(transferCandidates[0].Id_Transfer),code:transferCandidates[0].Codigo_Transfer,from:transferCandidates[0].finalDate,to:'2026-11-02'}]};
  const adjustedOperations=reservationReallocation.adjustedOperations;
  const adjustedTransferOperations=manifest.operations.transfers.map(row=>({...row}));
  for(const move of existingDateAdjustments.transfers){const row=adjustedTransferOperations.find(item=>Number(item.Id_Transfer)===move.id);row.finalDate=move.to;}
  const operationType=row=>row.type==='Grupal'?'Grupal':'Privada';
  const existingCounts={};
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private']))
    existingCounts[`${kind}:${bucket}`]=adjustedOperations.filter(row=>operationType(row)===kind&&fullDateBucket(row.finalDate)===bucket).length;
  const deltaByBucket={};
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private'])){
    const target=FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private'][bucket];
    deltaByBucket[`${kind}:${bucket}`]=target-existingCounts[`${kind}:${bucket}`];
    if(deltaByBucket[`${kind}:${bucket}`]<0)throw new Error(`El manifiesto ya supera la meta ${kind}/${bucket}: ${existingCounts[`${kind}:${bucket}`]}>${target}.`);
  }
  const totalGroupDelta=Object.entries(deltaByBucket).filter(([key])=>key.startsWith('Grupal:')).reduce((sum,[,value])=>sum+value,0);
  const totalPrivateDelta=Object.entries(deltaByBucket).filter(([key])=>key.startsWith('Privada:')).reduce((sum,[,value])=>sum+value,0);
  if(totalGroupDelta!==668||totalPrivateDelta!==32)throw new Error(`Delta por fechas da ${totalGroupDelta} grupales/${totalPrivateDelta} privadas; esperado 668/32.`);
  const tourWeights=new Map(FULL_TOURS.map(id=>[id,Math.max(1,adjustedOperations.filter(row=>Number(row.tourId)===id).length)]));
  const silleteroGroup=allocateWeighted(10,tourWeights);const silleteroPrivate=allocateWeighted(3,tourWeights);
  const specs=[];const reallocation=[];
  for(const [tourId,count] of silleteroGroup)for(let i=0;i<count;i+=1)reallocation.push({kind:'Grupal',fixedTourId:Number(tourId),silleteroReallocated:true,targetBucket:'past'});
  for(const [tourId,count] of silleteroPrivate)for(let i=0;i<count;i+=1)reallocation.push({kind:'Privada',fixedTourId:Number(tourId),silleteroReallocated:true,targetBucket:'past'});
  const groupPastReallocation=reallocation.filter(row=>row.kind==='Grupal').length;
  const privatePastReallocation=reallocation.filter(row=>row.kind==='Privada').length;
  if(groupPastReallocation!==10||privatePastReallocation!==3)
    throw new Error(`La rama Silletero debe reubicar 10 grupales/3 privadas; recibió ${groupPastReallocation}/${privatePastReallocation}.`);
  for(const row of reallocation)specs.push({...row,sequence:300+specs.length+1,role:null,cancel:false,modify:null});
  for(const [kind,bucket,delta] of [['Grupal','past',deltaByBucket['Grupal:past']-groupPastReallocation],
    ['Privada','past',deltaByBucket['Privada:past']-privatePastReallocation]]){
    if(delta<0)throw new Error(`La redistribución Silletero excede el delta ${kind}/${bucket}.`);
    for(let i=0;i<delta;i+=1)specs.push({sequence:300+specs.length+1,kind,targetBucket:bucket,role:null,cancel:false,modify:null});
  }
  for(const kind of ['Grupal','Privada'])for(const bucket of Object.keys(FULL_RESERVATION_TARGETS[kind==='Grupal'?'group':'private'])){
    if(bucket==='past')continue;
    const delta=deltaByBucket[`${kind}:${bucket}`];
    for(let i=0;i<delta;i+=1)specs.push({sequence:300+specs.length+1,kind,targetBucket:bucket,role:null,cancel:false,modify:null});
  }
  if(specs.length!==700||specs.filter(row=>row.kind==='Grupal').length!==668||specs.filter(row=>row.kind==='Privada').length!==32)
    throw new Error(`Especificaciones full incompletas: ${specs.length}/${specs.filter(row=>row.kind==='Grupal').length}/${specs.filter(row=>row.kind==='Privada').length}.`);
  await timed('fullPlan:datesAndCapacity',()=>assignFullReservationDates(inputs,specs,existingDateAdjustments.reservations));
  const channelRemaining=new Map();
  for(const [id,target] of FULL_CHANNEL_TARGETS){
    const existing=manifest.operations.reservations.filter(row=>Number(row.channelId)===id).length;
    channelRemaining.set(id,target-existing);
    if(target<existing)throw new Error(`Canal ${id} ya supera su cuota final: ${existing}/${target}.`);
  }
  const channelPool=[];for(const [id,count] of channelRemaining)for(let i=0;i<count;i+=1)channelPool.push(id);
  if(channelPool.length!==700)throw new Error(`Cuotas restantes de canal suman ${channelPool.length}, esperado 700.`);
  shuffle(channelPool,seedRandom(`${manifest.seed}-full-channels-v1`));
  const national=inputs.nationalEntities.filter(row=>row.Tipo==='AGENCIA_NACIONAL');
  const international=inputs.internationalEntities.filter(row=>row.Tipo==='AGENCIA_INTERNACIONAL');
  for(const spec of specs){
    spec.channelId=channelPool.shift();const channel=inputs.channelMap.get(Number(spec.channelId));
    if(!channel)throw new Error(`No se encontró canal ${spec.channelId} en el plan full.`);
    const name=String(channel.Nombre_Canal).trim().toUpperCase();
    spec.entity=name==='AGENCIA NACIONAL'?national[(spec.sequence-301)%national.length]
      :name==='AGENCIA INTERNACIONAL'?international[(spec.sequence-301)%international.length]:null;
    spec.reporterName=name==='FREELANCE'?`${MARKER}_FREELANCE_COMPARTIDO`:`${MARKER}_REPORTANTE_${String(spec.sequence).padStart(4,'0')}`;
    spec.reporterPhone=`+57399005${String(spec.sequence).padStart(4,'0')}`;
  }
  const modifications=assignFullChanges(specs,inputs);
  for(const spec of specs)await timed(`fullPlan:buildReservationInput:${spec.sequence}`,()=>createInputsForSpec(spec,inputs));
  const transferBucketCounts={};
  for(const [bucket,target] of Object.entries(FULL_TRANSFER_TARGETS)){
    const current=adjustedTransferOperations.filter(row=>fullDateBucket(row.finalDate)===bucket).length;
    transferBucketCounts[bucket]=target-current;if(transferBucketCounts[bucket]<0)throw new Error(`Transfers ya superan meta ${bucket}: ${current}/${target}.`);
  }
  const transferSpecs=[];const transferChannels=[2,3,10,8,9,6,5,7,11,4];
  for(const [bucket,count] of Object.entries(transferBucketCounts)){
    const [from,to]=rangeForFullBucket(bucket);
    for(let index=0;index<count;index+=1){
      const sequence=30+transferSpecs.length+1;const date=from===to?from:addDays(from,index%(Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1));
      const channelId=transferChannels[(sequence-31)%transferChannels.length];const channelName=String(inputs.channelMap.get(channelId)?.Nombre_Canal||'').trim().toUpperCase();
      const entities=channelName==='AGENCIA NACIONAL'?national:channelName==='AGENCIA INTERNACIONAL'?international:[];
      const entity=entities.length?entities[(sequence-31)%entities.length]:null;const leadDays=1+((sequence*7+4)%30);
      const registrationDate=addDays(date,-leadDays);
      transferSpecs.push({sequence,channelId,entity,finalDate:date,leadDays,registrationDate,
        registrationDateTime:`${registrationDate} 12:00:00`,holder:`${MARKER}_TITULAR_${String(sequence).padStart(4,'0')}`,
        reporterName:`${MARKER}_TRANSFER_REPORTANTE_${String(sequence).padStart(4,'0')}`});
    }
  }
  if(transferSpecs.length!==70)throw new Error(`Plan full: ${transferSpecs.length} transfers adicionales, esperado 70.`);
  for(const spec of transferSpecs)spec.transferPlan=buildTransferPayload(spec,inputs);
  const [actors]=await db.query(`SELECT u.Id_Usuario FROM usuarios u JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE u.Activo=1 AND LOWER(TRIM(r.Nombre_Rol))='asesor' ORDER BY u.Id_Usuario`);
  if(!actors.length)throw new Error('No hay asesores activos válidos para etapa full.');
  const actorPlan=assignPlannedActors(actors.map(row=>Number(row.Id_Usuario)),specs,transferSpecs);
  const plan=validatePlan(inputs,specs,transferSpecs);const inputCounts=validatePlannedInputs(inputs,specs,transferSpecs,modifications);
  plan.capacityByPoolAndDate=await timed('fullPlan:capacityLots',()=>buildMidCapacityPlan(inputs,specs,existingDateAdjustments.reservations));
  const cumulativeReservations=adjustedOperations.map(row=>{
    const spec=manifest.plan.reservationSpecs.find(item=>String(item.Id_Reserva)===String(row.Id_Reserva));
    return {...spec,kind:operationType(row),tourId:Number(row.tourId),channelId:Number(row.channelId),entity:spec?.entity||null,
      finalDate:row.finalDate,modify:spec?.modify||null,cancel:Boolean(spec?.cancel)};
  }).concat(specs);
  const cumulativeTransfers=adjustedTransferOperations.map(row=>({...row,kind:'Transfer',tourId:'TRANSFER'}))
    .concat(transferSpecs.map(row=>({...row,kind:'Transfer',tourId:'TRANSFER'})));
  const distribution=assertFullTotals(cumulativeReservations,cumulativeTransfers);
  const operationSummary=groupSummary([...cumulativeReservations,...cumulativeTransfers],inputs,
    item=>item.kind==='Transfer'?(item.finalDate<TODAY?'Completado':'Confirmado'):expectedReservationState(item));
  plan.operationSummary=operationSummary;
  const adjustmentsForClosedDays=await db.query(`SELECT Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour
    FROM confirmaciones_jornada WHERE Fecha_Tour IN ('2026-10-24','2026-10-25','2026-10-26')`);
  if(adjustmentsForClosedDays[0].length)throw new Error(`Hay jornadas ya registradas en 24-26 oct: ${JSON.stringify(adjustmentsForClosedDays[0])}.`);
  return {currentState,inputs,specs,transferSpecs,modifications,plan,inputCounts,actorPlan,
    currentReservations:cumulativeReservations,currentTransfers:cumulativeTransfers,existingDateAdjustments,distribution,
    reservationReallocation:{count:reservationReallocation.moves.filter(row=>row.reason==='out-of-bucket-reallocation').length,
      group:reservationReallocation.moves.filter(row=>row.reason==='out-of-bucket-reallocation'&&row.type==='Grupal').length,
      private:reservationReallocation.moves.filter(row=>row.reason==='out-of-bucket-reallocation'&&row.type==='Privada').length,
      moved:reservationReallocation.moves,plannedSeatsByPoolDate:reservationReallocation.plannedSeatsByPoolDate,
      sharedCapacityPools:{5:[1,5]}},
    silleteroReallocation:{source:{group:10,private:3},byTour:{group:Object.fromEntries(silleteroGroup),private:Object.fromEntries(silleteroPrivate)},
      toursExcluded:[6],reason:'Las 13 reservas previstas para Silletero se distribuyen proporcionalmente entre los tours activos del plan.'},
    countsAfterPlan:await timed('fullPlan:countsAfter',countSnapshot)};
}

function summarizeMidDistribution(operationSummary) {
  const summarize=key=>{
    const totals=new Map();
    for(const row of operationSummary){const value=String(row[key]);totals.set(value,Number(totals.get(value)||0)+Number(row.count||0));}
    return [...totals.entries()].map(([value,count])=>({value,count})).sort((a,b)=>a.value.localeCompare(b.value));
  };
  return {byTour:summarize('tour'),byDate:summarize('date'),byChannel:summarize('channel'),
    byEntityType:summarize('entityType'),byExpectedFinalState:summarize('expectedFinalState')};
}

function summarizeMidTemporaryCapacity(capacityPlan) {
  const byPool=new Map();
  for(const lot of capacityPlan.creationLots){
    const current=byPool.get(Number(lot.poolId))||{poolId:Number(lot.poolId),temporaryDate:capacityPlan.temporaryDate,
      capacity:Number(lot.capacity),existingSeats:Number(lot.existingSeats||0),totalSequentialSeats:0,
      maxLotSeats:0,maxLotReservations:0,lots:[]};
    const lotSeats=Number(lot.seats||0);
    current.totalSequentialSeats+=lotSeats;
    current.maxLotSeats=Math.max(current.maxLotSeats,lotSeats);
    current.maxLotReservations=Math.max(current.maxLotReservations,Number(lot.reservationCount||0));
    current.lots.push({lot:Number(lot.lot),reservationCount:Number(lot.reservationCount||0),seats:lotSeats,
      availableAfter: Number(lot.capacity)-Number(lot.existingSeats||0)-lotSeats});
    byPool.set(Number(lot.poolId),current);
  }
  return {creationByPool:[...byPool.values()].map(row=>({...row,
    availableAfterMaxLot:row.capacity-row.existingSeats-row.maxLotSeats})),
    editTemporaryDate:capacityPlan.secondTemporaryDate,editTemporaryByPool:capacityPlan.editTemporaryCapacity,
    finalByPoolAndDate:capacityPlan.finalCapacity.map(({poolId,date,plannedSeats,existingSeats,capacity,availableAfter,ok})=>
      ({poolId,date,plannedSeats,existingSeats,capacity,availableAfter,ok}))};
}

async function planMidReadOnly() {
  const built=await buildMidPlan();
  const countDelta=compareCounts(built.currentState.counts,built.countsAfterPlan);
  if(countDelta.length||sumCounts(built.countsAfterPlan)!==built.currentState.totalRows||built.countsAfterPlan.length!==78)
    throw new Error(`--plan-only detectó cambios al preparar mid: ${JSON.stringify({countDelta,tables:built.countsAfterPlan.length,total:sumCounts(built.countsAfterPlan)})}.`);
  console.log(JSON.stringify({status:'MID_PLAN_ONLY_OK',readOnly:true,database:'sir2',runId:manifest.runId,marker:manifest.marker,
    manifestPath:built.currentState.manifestPath,countsBefore:{tables:built.currentState.tableCount,total:built.currentState.totalRows},
    countsAfter:{tables:built.countsAfterPlan.length,total:sumCounts(built.countsAfterPlan),deltaByTable:countDelta},
    inputCounts:built.inputCounts,distribution:summarizeMidDistribution(built.plan.operationSummary),
    commissionDefaults:commissionSummary(built.reservationSpecs,built.inputs),edits:built.reservationSpecs.filter(row=>row.modify)
      .map(row=>({sequence:row.sequence,type:row.modify,tour:built.inputs.tours.get(row.tourId)?.Nombre_Tour,finalDate:row.finalDate,updatedDate:row.updatedServiceDate||null})),
    cancellations:built.reservationSpecs.filter(row=>row.cancel).map(row=>({sequence:row.sequence,tour:built.inputs.tours.get(row.tourId)?.Nombre_Tour,date:row.finalDate})),
    capacityByPoolAndDate:summarizeMidTemporaryCapacity(built.plan.capacityByPoolAndDate),actorSummary:actorSummary(built.actorPlan),
    silletero:built.silletero,silleteroReallocation:built.dateAssignment.silletero,
    timingsMs:{total:Number(TIMED.reduce((sum,row)=>sum+row.elapsedMs,0).toFixed(2)),
      buildAllReservationInputs:Number(TIMED.filter(row=>row.label.startsWith('midPlan:buildReservationInput:')).reduce((sum,row)=>sum+row.elapsedMs,0).toFixed(2)),
      other:TIMED.filter(row=>!row.label.startsWith('midPlan:buildReservationInput:')).map(row=>({label:row.label,elapsedMs:row.elapsedMs,ok:row.ok}))}},null,2));
  return built;
}

function summarizeFullPlan(built){
  const reservations=built.currentReservations;const transfers=built.currentTransfers;
  const labels={
    byTour:summarizedCounts(reservations,row=>built.inputs.tours.get(Number(row.tourId))?.Nombre_Tour||row.tourId),
    byDate:summarizedCounts(reservations,row=>row.finalDate),
    byDateAndType:summarizedCounts(reservations,row=>`${row.finalDate}|${row.kind}`),
    byChannel:summarizedCounts(reservations,row=>built.inputs.channelMap.get(Number(row.channelId))?.Nombre_Canal||row.channelId),
    byEntity:summarizedCounts(reservations,row=>row.entity
      ? `${row.entity.Id_Entidad_Reportante}:${row.entity.Nombre}:${row.entity.Tipo}`:'SIN_ENTIDAD'),
    transfersByDate:summarizedCounts(transfers,row=>row.finalDate),
    transfersByChannel:summarizedCounts(transfers,row=>built.inputs.channelMap.get(Number(row.channelId))?.Nombre_Canal||row.channelId),
  };
  return labels;
}

function summarizeFullDateBuckets(built){
  const approved=[
    {bucket:'oct24_25',dates:['2026-10-24','2026-10-25'],target:{group:5,private:1,transfers:5}},
    {bucket:'oct26',dates:['2026-10-26'],target:{group:4,private:0,transfers:0}},
  ];
  const countReservations=(rows,dates,kind)=>rows.filter(row=>dates.includes(row.finalDate)&&row.kind===kind).length;
  const countTransfers=(rows,dates)=>rows.filter(row=>dates.includes(row.finalDate)).length;
  const byCalendarDate=[...new Set(approved.flatMap(row=>row.dates))].map(date=>({date,
    accumulated:{group:countReservations(manifest.operations.reservations,[date],'Grupal'),
      private:countReservations(manifest.operations.reservations,[date],'Privada'),
      transfers:countTransfers(manifest.operations.transfers,[date])},
    plannedAdditions:{group:countReservations(built.specs,[date],'Grupal'),private:countReservations(built.specs,[date],'Privada'),
      transfers:countTransfers(built.transferSpecs,[date])},
    final:{group:countReservations(built.currentReservations,[date],'Grupal'),private:countReservations(built.currentReservations,[date],'Privada'),
      transfers:countTransfers(built.currentTransfers,[date])},pastNow:date<TODAY,
    newReservationsNeedTemporaryCreateAndControlledMove:date<TODAY,
    newTransfersNeedTemporaryCreateAndServiceMove:date<TODAY}));
  const buckets=approved.map(row=>{
    const accumulated={group:countReservations(manifest.operations.reservations,row.dates,'Grupal'),
      private:countReservations(manifest.operations.reservations,row.dates,'Privada'),
      transfers:countTransfers(manifest.operations.transfers,row.dates)};
    const plannedAdditions={group:countReservations(built.specs,row.dates,'Grupal'),
      private:countReservations(built.specs,row.dates,'Privada'),transfers:countTransfers(built.transferSpecs,row.dates)};
    const final={group:countReservations(built.currentReservations,row.dates,'Grupal'),
      private:countReservations(built.currentReservations,row.dates,'Privada'),transfers:countTransfers(built.currentTransfers,row.dates)};
    return {...row,accumulated,plannedAdditions,final,pastNow:row.dates.some(date=>date<TODAY),
      newReservationsNeedTemporaryCreateAndControlledMove:row.dates.some(date=>date<TODAY)&&plannedAdditions.group+plannedAdditions.private>0,
      newTransfersNeedTemporaryCreateAndServiceMove:row.dates.some(date=>date<TODAY)&&plannedAdditions.transfers>0};
  });
  return {todayUsed:TODAY,noNewOperationsOnToday:true,temporaryDate:TEMP_DATE,buckets,byCalendarDate};
}

async function planFullReadOnly(){
  const built=await buildFullPlan();
  const countDelta=compareCounts(built.currentState.counts,built.countsAfterPlan);
  if(countDelta.length||sumCounts(built.countsAfterPlan)!==built.currentState.totalRows||built.countsAfterPlan.length!==78)
    throw new Error(`--plan-only full detectó cambios: ${JSON.stringify({countDelta,tables:built.countsAfterPlan.length,total:sumCounts(built.countsAfterPlan)})}.`);
  const maxLots=summarizeMidTemporaryCapacity(built.plan.capacityByPoolAndDate);
  if(built.specs.some(row=>row.finalDate===TODAY)||built.transferSpecs.some(row=>row.finalDate===TODAY))
    throw new Error(`--plan-only full intentó crear operaciones en hoy ${TODAY}.`);
  const overCapacity=built.plan.capacityByPoolAndDate.creationLots.filter(lot=>Number(lot.seats)>Number(lot.capacity)-Number(lot.existingSeats||0))
    .concat(built.plan.capacityByPoolAndDate.finalCapacity.filter(row=>!row.ok||Number(row.availableAfter)<0),
      built.plan.capacityByPoolAndDate.editTemporaryCapacity.filter(row=>!row.ok||Number(row.availableAfter)<0));
  if(overCapacity.length)throw new Error(`--plan-only full tiene lotes/cupos sobrepasados: ${JSON.stringify(overCapacity.slice(0,10))}.`);
  console.log(JSON.stringify({status:'FULL_PLAN_ONLY_OK',readOnly:true,database:'sir2',runId:manifest.runId,marker:manifest.marker,
    serviceDateHorizon:{from:TODAY,through:addDays(TODAY,29),days:30},
    manifestPath:built.currentState.manifestPath,countsBefore:{tables:built.currentState.tableCount,total:built.currentState.totalRows},
    countsAfter:{tables:built.countsAfterPlan.length,total:sumCounts(built.countsAfterPlan),deltaByTable:countDelta},
    incremental:{reservations:built.specs.length,group:built.specs.filter(row=>row.kind==='Grupal').length,
      private:built.specs.filter(row=>row.kind==='Privada').length,transfers:built.transferSpecs.length,
      modifications:built.modifications.edits.length,cancellations:built.modifications.cancellations.length},
    cumulative:{reservations:built.currentReservations.length,group:built.currentReservations.filter(row=>row.kind==='Grupal').length,
      private:built.currentReservations.filter(row=>row.kind==='Privada').length,transfers:built.currentTransfers.length,
      exactTargets:built.distribution},
    distribution:summarizeFullPlan(built),dateBucketComparison:summarizeFullDateBuckets(built),
    reservationReallocation:built.reservationReallocation,silleteroReallocation:built.silleteroReallocation,
    existingDateAdjustments:built.existingDateAdjustments,operationInputCounts:built.inputCounts,
    operationSummary:built.plan.operationSummary,
    commissionDefaults:commissionSummary(built.specs,built.inputs),temporaryCapacity:maxLots,
    actorSummary:actorSummary(built.actorPlan),timingsMs:{total:Number(TIMED.reduce((sum,row)=>sum+row.elapsedMs,0).toFixed(2)),
      details:TIMED.map(row=>({label:row.label,elapsedMs:row.elapsedMs,ok:row.ok}))}},null,2));
  return built;
}

function estimateFullFromMid(midTimings,midCounts) {
  const avg=(prefix,denominator)=>{
    const values=midTimings.filter(item=>item.ok&&item.label.startsWith(prefix)).map(item=>item.elapsedMs);
    return values.length?values.reduce((sum,value)=>sum+value,0)/Math.max(1,denominator):0;
  };
  const groupCount=Number(midCounts.groupReservations||228);const privateCount=Number(midCounts.privateReservations||12);
  const createReservation=avg('service:reservationWrapper:',240);
  const createTransfer=avg('service:transferWrapper:',24);
  const edit=avg('service:reservationUpdateWrapper:',24);
  const cancel=avg('service:reservationCancelWrapper:',7);
  const groupMove=avg('control:reconcilePool:',groupCount);
  const privateMove=avg('control:movePrivate:',privateCount);
  const sync=avg('service:syncProgramacionAfterMove:',240);
  const transferBackdate=avg('control:backdateTransfers:',24);
  const job=midTimings.find(item=>item.label==='pendingJob')?.elapsedMs||0;
  const validation=midTimings.filter(item=>item.label.startsWith('validation:')).reduce((sum,item)=>sum+item.elapsedMs,0);
  const fullRemaining=700*createReservation+70*createTransfer+70*edit+20*cancel+668*(groupMove+sync)+32*(privateMove+sync)+70*transferBackdate+job+validation;
  return {remainingToFull:{reservations:700,transfers:70,privateReservations:32,groupReservations:668,estimatedSeconds:Number((fullRemaining/1000).toFixed(1)),
    basis:{avgReservationCreateMs:Number(createReservation.toFixed(2)),avgTransferCreateMs:Number(createTransfer.toFixed(2)),
      avgEditMs:Number(edit.toFixed(2)),avgCancelMs:Number(cancel.toFixed(2)),avgGroupReconcilePerReservationMs:Number(groupMove.toFixed(2)),
      avgPrivateMovePerReservationMs:Number(privateMove.toFixed(2)),avgPostMoveSyncMs:Number(sync.toFixed(2)),
      avgTransferBackdateMs:Number(transferBackdate.toFixed(2)),midPendingJobMs:Number(job.toFixed(2)),midValidationMs:Number(validation.toFixed(2)),
      note:'Extrapolación lineal basada en las métricas del mid; no incluye el respaldo final y no modela degradación no lineal de consultas.'}}};
}

async function runMidStage() {
  const midStarted=performance.now();
  let metadata=null;let beforeKeys=null;let countsBefore=null;let midStartIndex=TIMED.length;
  try{
    const built=await buildMidPlan();
    metadata=await timed('mid:snapshotMetadata',primaryKeyMetadata);
    beforeKeys=JSON.parse(fs.readFileSync(path.resolve(manifest.baselineKeysPath),'utf8'));
    countsBefore=manifest.countsBefore;
    const nowKeys=await timed('mid:prewriteKeys',()=>capturePrimaryKeys(metadata));
    const baselineIds=diffPrimaryKeys(beforeKeys,nowKeys);
    const priorIds=manifest.createdIdsByTable||{};
    const pkDeltaErrors=[];
    for(const table of new Set([...Object.keys(baselineIds),...Object.keys(priorIds)])){
      if(!sameSet((baselineIds[table]||[]).map(keySig),(priorIds[table]||[]).map(keySig)))
        pkDeltaErrors.push({table,actual:(baselineIds[table]||[]).length,manifest:(priorIds[table]||[]).length});
    }
    if(pkDeltaErrors.length)throw new Error(`El manifiesto no coincide justo antes de mid: ${JSON.stringify(pkDeltaErrors)}.`);
    const [[outboxBefore]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxBefore.n)!==0)throw new Error(`email_outbox contiene ${outboxBefore.n} filas antes de mid.`);
    await assertServerOffline();
    midStartIndex=TIMED.length;
    instrumentDatabaseQueries();

    const priorPendingJob=manifest.pendingJob;
    manifest.pilotPendingJob=priorPendingJob;
    manifest.mid={state:'MID_START',startedAt:new Date().toISOString(),runId:manifest.runId,
      additionalReservations:240,additionalTransfers:24,additionalGroups:228,additionalPrivate:12,
      modifications:built.modifications.edits.length,cancellations:built.modifications.cancellations.length,
      countsBefore:built.currentState.counts,countsBeforeTotal:built.currentState.totalRows,
      silletero:built.silletero,silleteroReallocation:built.dateAssignment.silletero,
      plan:{operationSummary:built.plan.operationSummary,capacityByPoolAndDate:built.plan.capacityByPoolAndDate,
        inputCounts:built.inputCounts,actorSummary:actorSummary(built.actorPlan)}};
    manifest.stageLogs={...(manifest.stageLogs||{}),pilot:manifest.logPath||LOG_PATH,mid:LOG_PATH};
    manifest.state='MID_START';manifest.currentPhase='MID_START';
    manifest.plan.reservationSpecs=[...manifest.plan.reservationSpecs,...built.reservationSpecs];
    manifest.plan.transferSpecs=[...manifest.plan.transferSpecs,...built.transferSpecs];
    manifest.plan.reservations=300;manifest.plan.groupReservations=282;manifest.plan.privateReservations=18;manifest.plan.transfers=30;
    manifest.plan.mid={additionalReservations:240,groupReservations:228,privateReservations:12,transfers:24,
      modifications:built.modifications.edits,cancellations:built.modifications.cancellations,
      operationSummary:built.plan.operationSummary,capacityByPoolAndDate:built.plan.capacityByPoolAndDate};
    manifest.mid.reservationSequences=built.reservationSpecs.map(row=>row.sequence);
    manifest.mid.transferSequences=built.transferSpecs.map(row=>row.sequence);
    await writeManifest();logLine('MID_START',{runId:manifest.runId,countsBeforeTotal:built.currentState.totalRows,
      additionalReservations:240,additionalTransfers:24,logPath:LOG_PATH});

    const baselineAvailabilityKeys=manifest.baselineAvailabilityKeys||beforeKeys.tables.disponibilidad||[];
    const specBySequence=new Map(built.reservationSpecs.map(row=>[Number(row.sequence),row]));
    const pools=[...new Set(built.reservationSpecs.filter(row=>row.kind==='Grupal').map(row=>row.capacityPoolId))].sort((a,b)=>a-b);
    const lots=built.plan.capacityByPoolAndDate.creationLots;
    for(const pool of pools){
      const poolLots=lots.filter(lot=>Number(lot.poolId)===Number(pool));
      for(const lot of poolLots){
        const groupLot=lot.reservations.map(sequence=>specBySequence.get(Number(sequence)));
        await setManifestState(`MID_CREATING_RESERVATION_LOT_POOL_${pool}_${lot.lot}`,{reservationSequences:lot.reservations,seats:lot.seats,capacity:lot.capacity});
        for(const spec of groupLot){
          const row=await timed(`service:reservationWrapper:${spec.sequence}`,()=>createReservation(spec,spec.createActorId,built.inputs));
          manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,
            type:spec.kind,channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
            originalDate:spec.serviceDateBeforeMove,finalDate:spec.finalDate,serviceDateAtCreate:TEMP_DATE,
            registrationDate:spec.registrationDate,fechaRegistroBeforeBackdate:row.Fecha_Registro,
            registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,capacityPoolId:spec.capacityPoolId,
            originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
            consumesGroupCapacity:true,actorId:Number(row.Creado_Por),role:null,modify:spec.modify||null,cancel:spec.cancel});
          await writeManifest();
        }
        for(const spec of groupLot.filter(row=>row.modify))await timed(`service:reservationUpdateWrapper:${spec.sequence}`,
          ()=>updateReservation(spec,spec.updateActorId,built.inputs));
        for(const spec of groupLot.filter(row=>row.cancel))await timed(`service:reservationCancelWrapper:${spec.sequence}`,
          ()=>cancelReservation(spec,spec.cancelActorId));
        for(const spec of groupLot){
          const operation=manifest.operations.reservations.find(row=>row.Id_Reserva===spec.Id_Reserva);
          if(operation){operation.serviceDateBeforeMove=spec.serviceDateBeforeMove;operation.originalDate=spec.serviceDateBeforeMove;
            operation.originalAvailabilityKey=spec.originalAvailabilityKey;operation.serviceUpdate=spec.serviceUpdate||null;operation.serviceCancel=spec.serviceCancel||null;}
        }
        await writeManifest();
        const rows=groupLot.map(row=>({Id_Reserva:row.Id_Reserva,kind:row.kind,finalDate:row.finalDate,
          registrationDateTime:row.registrationDateTime,serviceDateBeforeMove:row.serviceDateBeforeMove,modify:row.modify,cancel:row.cancel}));
        await setManifestState(`MID_RECONCILING_RESERVATION_LOT_POOL_${pool}_${lot.lot}`,{reservationIds:groupLot.map(row=>row.Id_Reserva)});
        await timed(`control:reconcilePool:${pool}:lot${lot.lot}`,()=>reconcileReservationPool(pool,rows,baselineAvailabilityKeys));
        for(const spec of groupLot)await timed(`service:syncProgramacionAfterMove:${spec.sequence}`,
          ()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:spec.finalDate}));
        logLine('MID_RESERVATION_LOT_DONE',{pool,lot:lot.lot,reservationIds:groupLot.map(row=>row.Id_Reserva),seats:lot.seats});
      }
      const privateLot=built.reservationSpecs.filter(row=>row.kind==='Privada'&&row.capacityPoolId===pool);
      if(privateLot.length){
        await setManifestState(`MID_CREATING_PRIVATE_RESERVATIONS_POOL_${pool}`,{sequences:privateLot.map(row=>row.sequence)});
        for(const spec of privateLot){
          const row=await timed(`service:reservationWrapper:${spec.sequence}`,()=>createReservation(spec,spec.createActorId,built.inputs));
          manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,
            type:spec.kind,channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
            originalDate:TEMP_DATE,finalDate:spec.finalDate,serviceDateAtCreate:TEMP_DATE,registrationDate:spec.registrationDate,
            fechaRegistroBeforeBackdate:row.Fecha_Registro,registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,
            capacityPoolId:spec.capacityPoolId,originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
            consumesGroupCapacity:false,actorId:Number(row.Creado_Por),role:null,modify:null,cancel:false});
          await writeManifest();
        }
        await timed(`control:movePrivate:${pool}`,()=>movePrivateReservations(privateLot));
        for(const spec of privateLot)await timed(`service:syncProgramacionAfterMove:${spec.sequence}`,
          ()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:spec.finalDate}));
      }
    }

    await setManifestState('MID_CREATING_TRANSFERS',{count:built.transferSpecs.length});
    for(const spec of built.transferSpecs){
      const row=await timed(`service:transferWrapper:${spec.sequence}`,()=>createTransfer(spec,spec.actorId,built.inputs));
      manifest.operations.transfers.push({Id_Transfer:spec.Id_Transfer,Codigo_Transfer:spec.Codigo_Transfer,
        channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
        originalDate:spec.finalDate,finalDate:spec.finalDate,serviceDateAtCreate:spec.finalDate,registrationDate:spec.registrationDate,
        fechaRegistroBeforeBackdate:row.Fecha_Registro,registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,
        estadoAtCreate:spec.serviceStateAtCreate,valor:spec.valor,actorId:spec.actorId});
      await writeManifest();
    }
    await setManifestState('MID_BACKDATING_TRANSFERS',{count:built.transferSpecs.length});
    await timed('control:backdateTransfers:mid',()=>backdateTransfers(built.transferSpecs));
    await setManifestState('MID_NORMALIZING_RESERVATION_STATES');
    manifest.mid.stateNormalization=await timed('service:normalizePastReservations:mid',()=>reservas.actualizarEstadosReservasVencidas());
    manifest.mid.stateNormalizationHistoryRows=await timed('sql:backdateAutomaticStateHistory:mid',()=>backdateAutomaticReservationStateHistory(built.reservationSpecs));
    await writeManifest();

    const initialCapture=await captureChanges(metadata,beforeKeys,countsBefore);
    const cumulativeReservations=manifest.plan.reservationSpecs;
    const cumulativeTransfers=manifest.plan.transferSpecs;
    await setManifestState('MID_VALIDATING');
    const capacityResults=await timed('validation:capacity:mid',()=>validateCapacity(cumulativeReservations));
    manifest.validations.push({name:'mid: integridad de cupos/disponibilidad acumulada',ok:true,
      elapsedMs:TIMED.find(row=>row.label==='validation:capacity:mid')?.elapsedMs,groups:capacityResults});
    const foreignKeys=await timed('validation:foreignKeys:mid',()=>validateFks(initialCapture.createdIdsByTable,metadata));
    manifest.mid.foreignKeyChecks={checkedConstraints:foreignKeys.length,orphanRows:0};
    await timed('validation:codes:mid',()=>validateUniqueCodes(cumulativeReservations,cumulativeTransfers));
    await timed('validation:commissions:mid',()=>validateCommissionDefaults(cumulativeReservations));
    await timed('validation:historyDates:mid',()=>validateHistoryAndDates(cumulativeReservations,cumulativeTransfers));
    await timed('validation:serviceFilters:mid',()=>validateServiceFilters(cumulativeReservations,cumulativeTransfers,built.inputs));
    await timed('validation:readOnlyReports:mid',()=>validatePeakAndReadOnlyReports(cumulativeReservations,built.inputs));
    const [[payments]]=await db.query(`SELECT COUNT(*) AS reservationPayments FROM pagos_reservas
      WHERE Id_Reserva IN (?)`,[cumulativeReservations.map(row=>row.Id_Reserva)]);
    const [[transferPayments]]=await db.query(`SELECT COUNT(*) AS transferPayments FROM pagos_transfers
      WHERE Id_Transfer IN (?)`,[cumulativeTransfers.map(row=>row.Id_Transfer)]);
    if(Number(payments.reservationPayments)!==300||Number(transferPayments.transferPayments)!==0)
      throw new Error(`Pagos acumulados inesperados: ${JSON.stringify({reservationPayments:payments.reservationPayments,transferPayments:transferPayments.transferPayments})}.`);
    if(manifest.operations.reservations.length!==300||manifest.operations.transfers.length!==30)
      throw new Error(`IDs acumulados incompletos: ${manifest.operations.reservations.length} reservas/${manifest.operations.transfers.length} transfers.`);
    const [[queueBeforeJob]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(queueBeforeJob.n)!==0)throw new Error(`email_outbox tiene ${queueBeforeJob.n} filas antes del job de mid.`);
    manifest.mid.slowQueryExplain=await timed('validation:slowQueryExplain:mid',()=>explainSlowReadQueries(midStartIndex));

    manifest.pilotPendingJob=manifest.pilotPendingJob||manifest.pendingJob;
    manifest.mid.pendingJob=await timed('pendingJob',runPendingJobOnce);
    const [[outboxAfterJob]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxAfterJob.n)!==0)throw new Error(`email_outbox cambió durante pendientesJob: ${outboxAfterJob.n}.`);
    const afterJobCapture=await captureChanges(metadata,beforeKeys,countsBefore);
    const [postJobReservations]=await db.query(`SELECT Id_Reserva,Estado FROM reservas WHERE Id_Reserva IN (?)`,
      [cumulativeReservations.map(row=>row.Id_Reserva)]);
    const [postJobTransfers]=await db.query(`SELECT Id_Transfer,Estado FROM transfers WHERE Id_Transfer IN (?)`,
      [cumulativeTransfers.map(row=>row.Id_Transfer)]);
    const expectedReservationStates=new Map(cumulativeReservations.map(row=>[String(row.Id_Reserva),expectedReservationState(row)]));
    const expectedTransferStates=new Map(cumulativeTransfers.map(row=>[String(row.Id_Transfer),row.finalDate<TODAY?'Completado':'Confirmado']));
    const stateDifferences=[
      ...postJobReservations.filter(row=>row.Estado!==expectedReservationStates.get(String(row.Id_Reserva)))
        .map(row=>({type:'reserva',id:String(row.Id_Reserva),actual:row.Estado,expected:expectedReservationStates.get(String(row.Id_Reserva))})),
      ...postJobTransfers.filter(row=>row.Estado!==expectedTransferStates.get(String(row.Id_Transfer)))
        .map(row=>({type:'transfer',id:String(row.Id_Transfer),actual:row.Estado,expected:expectedTransferStates.get(String(row.Id_Transfer))})),
    ];
    manifest.mid.postJobStates={reservationsChecked:postJobReservations.length,transfersChecked:postJobTransfers.length,
      stateDifferences};
    await writeManifest();
    if(postJobReservations.length!==300||postJobTransfers.length!==30||stateDifferences.length)
      throw new Error(`PendientesJob cambió estados o faltan operaciones: ${JSON.stringify(manifest.mid.postJobStates)}.`);
    const postJobFks=await timed('validation:foreignKeys:afterPendingJob',()=>validateFks(afterJobCapture.createdIdsByTable,metadata));
    manifest.mid.foreignKeyChecksAfterJob={checkedConstraints:postJobFks.length,orphanRows:0};
    const finalCounts=afterJobCapture.countsAfter;
    if(Number(finalCounts.find(row=>row.table==='reservas')?.rows)!==300
      ||Number(finalCounts.find(row=>row.table==='transfers')?.rows)!==30)
      throw new Error(`Conteos finales de reservas/transfers inesperados: ${JSON.stringify({reservas:finalCounts.find(row=>row.table==='reservas')?.rows,transfers:finalCounts.find(row=>row.table==='transfers')?.rows})}.`);
    manifest.mid.createdReservationIds=built.reservationSpecs.map(row=>row.Id_Reserva);
    manifest.mid.createdTransfers=built.transferSpecs.map(row=>({Id_Transfer:row.Id_Transfer,Codigo_Transfer:row.Codigo_Transfer}));
    manifest.mid.emailOutboxAfter=Number(outboxAfterJob.n);
    manifest.mid.state='MID_DONE';manifest.mid.finishedAt=new Date().toISOString();
    manifest.mid.elapsedMs=Number((performance.now()-midStarted).toFixed(2));
    manifest.mid.timings=TIMED.slice(midStartIndex);
    manifest.mid.queryTimingSummary={queries:QUERY_TIMINGS.length,over100ms:QUERY_TIMINGS.filter(row=>row.elapsedMs>100).length};
    manifest.mid.estimateForFull=estimateFullFromMid(manifest.mid.timings,{groupReservations:228,privateReservations:12});
    manifest.state='MID_DONE';manifest.currentPhase='MID_DONE';
    await finalizeManifest(metadata,beforeKeys,countsBefore,'MID_DONE');
    logLine('MID_DONE',{manifestPath:MANIFEST_PATH,logPath:LOG_PATH,countsTotalAfter:manifest.countsTotalAfter,
      deltaByTable:manifest.deltaByTable,elapsedMs:manifest.mid.elapsedMs});
    console.log(JSON.stringify({status:manifest.state,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsBefore:manifest.countsTotalBefore,countsAfter:manifest.countsTotalAfter,deltaByTable:manifest.deltaByTable,
      mid:{...manifest.mid,plan:undefined,reservationSequences:undefined,transferSequences:undefined},
      validations:manifest.validations.slice(-30),pendingJob:manifest.mid.pendingJob,slowQueryExplain:manifest.mid.slowQueryExplain,
      estimateForFull:manifest.mid.estimateForFull},null,2));
  }catch(error){
    const serialized=errorJson(error);
    if(manifest){
      manifest.mid={...(manifest.mid||{}),state:'MID_FAILED_NO_CLEANUP',failedDuring:manifest.state,error:serialized};
      if(metadata&&beforeKeys&&countsBefore)await finalizeManifest(metadata,beforeKeys,countsBefore,'MID_FAILED_NO_CLEANUP',error);
      else{manifest.state='MID_FAILED_NO_CLEANUP';manifest.error=serialized;manifest.completedAt=new Date().toISOString();await writeManifest();}
    }
    logLine('MID_STOPPED_NO_CLEANUP',{error:serialized,manifestPath:MANIFEST_PATH,logPath:LOG_PATH});
    console.error(JSON.stringify({status:'MID_FAILED_NO_CLEANUP',error:serialized,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsAfter:manifest?.countsAfter,deltaByTable:manifest?.deltaByTable},null,2));
    process.exitCode=1;
  }finally{try{await db.end();}catch{}}
}

async function updateExistingTransferForFull(move,actorId){
  const [[row]]=await db.query(`SELECT Id_Transfer,Id_Canal,Id_Entidad_Reportante,Nombre_Titular,DNI,Telefono_Titular,
      Cantidad_Personas,Id_Servicio,Punto_Salida,Punto_Destino,DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,
      Hora_Recogida,Nombre_Reportante,Telefono_Reportante,Valor,Id_Moneda,Vuelo,TipoVuelo,Observaciones,
      CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer
    FROM transfers WHERE Id_Transfer=?`,[move.id]);
  if(!row||row.Codigo_Transfer!==move.code||row.Fecha_Transfer!==move.from||!String(row.Observaciones||'').includes(MARKER))
    throw new Error(`Transfer existente ${move.id} no coincide antes del ajuste full: ${JSON.stringify(row)}.`);
  const payload={Id_Canal:Number(row.Id_Canal),Id_Entidad_Reportante:row.Id_Entidad_Reportante==null?null:Number(row.Id_Entidad_Reportante),
    Titular:row.Nombre_Titular,DNI:row.DNI,Tel_Contacto:row.Telefono_Titular,Cantidad_Personas:Number(row.Cantidad_Personas),
    Servicio:Number(row.Id_Servicio),Salida:row.Punto_Salida,Llegada:row.Punto_Destino,FechaTransfer:move.to,
    HoraRecogida:row.Hora_Recogida,NombreReporta:row.Nombre_Reportante,TelefonoTransfer:row.Telefono_Reportante,
    Valor:row.Valor==null?undefined:Number(row.Valor),Id_Moneda:Number(row.Id_Moneda),Vuelo:row.Vuelo,TipoVuelo:row.TipoVuelo,
    Observaciones:row.Observaciones,Pago:{Tipo:'PagaEnPunto',Observaciones:'Pago en el punto; ajuste de fecha full.'}};
  const result=await timed(`service:updateExistingTransfer:${move.id}`,()=>transfers.actualizarTransferSvc(move.id,payload,actorId));
  const [[after]]=await db.query(`SELECT DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,Estado,
      CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer,Observaciones,Actualizado_Por FROM transfers WHERE Id_Transfer=?`,[move.id]);
  if(!after||after.Fecha_Transfer!==move.to||after.Codigo_Transfer!==move.code||!String(after.Observaciones||'').includes(MARKER))
    throw new Error(`El servicio no movió el transfer ${move.id} según el plan full: ${JSON.stringify(after)}.`);
  const operation=manifest.operations.transfers.find(item=>Number(item.Id_Transfer)===Number(move.id));
  const spec=manifest.plan.transferSpecs.find(item=>Number(item.Id_Transfer)===Number(move.id));
  if(operation)operation.finalDate=move.to;if(spec)spec.finalDate=move.to;
  return {id:Number(move.id),code:move.code,from:move.from,to:move.to,actorId:Number(actorId),result,after};
}

async function runFullStage(){
  const fullStarted=performance.now();let metadata=null;let beforeKeys=null;let countsBefore=null;let fullStartIndex=TIMED.length;
  try{
    const built=await buildFullPlan();metadata=await timed('full:snapshotMetadata',primaryKeyMetadata);
    beforeKeys=JSON.parse(fs.readFileSync(path.resolve(manifest.baselineKeysPath),'utf8'));countsBefore=manifest.countsBefore;
    const nowKeys=await timed('full:prewriteKeys',()=>capturePrimaryKeys(metadata));const baselineIds=diffPrimaryKeys(beforeKeys,nowKeys);
    const priorIds=manifest.createdIdsByTable||{};const pkDeltaErrors=[];
    for(const table of new Set([...Object.keys(baselineIds),...Object.keys(priorIds)]))
      if(!sameSet((baselineIds[table]||[]).map(keySig),(priorIds[table]||[]).map(keySig)))
        pkDeltaErrors.push({table,actual:(baselineIds[table]||[]).length,manifest:(priorIds[table]||[]).length});
    if(pkDeltaErrors.length)throw new Error(`El manifiesto no coincide justo antes de full: ${JSON.stringify(pkDeltaErrors)}.`);
    const [[outboxBefore]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxBefore.n)!==0)throw new Error(`email_outbox contiene ${outboxBefore.n} filas antes de full.`);
    await assertServerOffline();fullStartIndex=TIMED.length;instrumentDatabaseQueries();
    manifest.pilotPendingJob=manifest.pilotPendingJob||manifest.pendingJob;manifest.mid.pendingJob=manifest.mid.pendingJob||manifest.pendingJob;
    manifest.full={state:'FULL_START',startedAt:new Date().toISOString(),runId:manifest.runId,
      additionalReservations:700,additionalTransfers:70,additionalGroups:668,additionalPrivate:32,
      todayUsed:TODAY,transferDateMoves:[],
      modifications:built.modifications.edits.length,cancellations:built.modifications.cancellations.length,
      existingDateAdjustments:built.existingDateAdjustments,silleteroReallocation:built.silleteroReallocation,
      countsBefore:built.currentState.counts,countsBeforeTotal:built.currentState.totalRows,
      plan:{operationSummary:built.plan.operationSummary,capacityByPoolAndDate:built.plan.capacityByPoolAndDate,
        inputCounts:built.inputCounts,actorSummary:actorSummary(built.actorPlan)}};
    manifest.stageLogs={...(manifest.stageLogs||{}),full:LOG_PATH};manifest.state='FULL_START';manifest.currentPhase='FULL_START';
    manifest.plan.reservationSpecs=manifest.plan.reservationSpecs.map(row=>{
      const updated= built.currentReservations.find(item=>String(item.Id_Reserva)===String(row.Id_Reserva));
      return updated?{...row,finalDate:updated.finalDate}:row;
    }).concat(built.specs);
    manifest.plan.transferSpecs=manifest.plan.transferSpecs.map(row=>{
      const updated=built.currentTransfers.find(item=>Number(item.Id_Transfer)===Number(row.Id_Transfer));
      return updated?{...row,finalDate:updated.finalDate}:row;
    }).concat(built.transferSpecs);
    manifest.plan.reservations=1000;manifest.plan.groupReservations=950;manifest.plan.privateReservations=50;manifest.plan.transfers=100;
    manifest.plan.full={additionalReservations:700,groupReservations:668,privateReservations:32,transfers:70,
      modifications:built.modifications.edits,cancellations:built.modifications.cancellations,
      operationSummary:built.plan.operationSummary,capacityByPoolAndDate:built.plan.capacityByPoolAndDate,
      distribution:built.distribution,silleteroReallocation:built.silleteroReallocation,
      existingDateAdjustments:built.existingDateAdjustments};
    manifest.full.reservationSequences=built.specs.map(row=>row.sequence);manifest.full.transferSequences=built.transferSpecs.map(row=>row.sequence);
    await writeManifest();logLine('FULL_START',{runId:manifest.runId,countsBeforeTotal:built.currentState.totalRows,
      additionalReservations:700,additionalTransfers:70,logPath:LOG_PATH});

    const actorForExisting=Number(built.actorPlan.commissionJourneyActorId);
    manifest.full.existingDateAdjustments.results={reservations:[],transfers:[]};await writeManifest();
    for(const move of built.existingDateAdjustments.reservations){
      const spec=manifest.plan.reservationSpecs.find(item=>String(item.Id_Reserva)===move.id);
      if(!spec)throw new Error(`No existe la reserva ${move.id} del ajuste de fecha.`);
      const adjustment={...spec,sequence:spec.sequence,Id_Reserva:move.id,kind:move.type,modify:'date',
        updatedServiceDate:move.to,serviceDateBeforeMove:move.from,originalDate:move.from,
        requireDateHistory:true,updateActorId:actorForExisting};
      await timed(`service:updateExistingReservation:${move.id}`,()=>updateReservation(adjustment,actorForExisting,built.inputs));
      const operation=manifest.operations.reservations.find(item=>String(item.Id_Reserva)===move.id);
      if(operation){operation.finalDate=move.to;operation.serviceUpdate=adjustment.serviceUpdate;
        operation.serviceDateHistory=adjustment.serviceDateHistory;}
      manifest.full.existingDateAdjustments.results.reservations.push({...move,actorId:actorForExisting,
        historyVia:'reservas.actualizarReservaConPasajerosYPagos',history:adjustment.serviceDateHistory});
      await writeManifest();
    }
    for(const move of built.existingDateAdjustments.transfers){
      const result=await updateExistingTransferForFull(move,actorForExisting);
      manifest.full.existingDateAdjustments.results.transfers.push(result);await writeManifest();
    }
    const baselineAvailabilityKeys=manifest.baselineAvailabilityKeys||beforeKeys.tables.disponibilidad||[];
    const specBySequence=new Map(built.specs.map(row=>[Number(row.sequence),row]));
    const pools=[...new Set(built.specs.filter(row=>row.kind==='Grupal').map(row=>row.capacityPoolId))].sort((a,b)=>a-b);
    const lots=built.plan.capacityByPoolAndDate.creationLots;
    for(const pool of pools){
      for(const lot of lots.filter(row=>Number(row.poolId)===Number(pool))){
        const groupLot=lot.reservations.map(sequence=>specBySequence.get(Number(sequence)));
        await setManifestState(`FULL_CREATING_RESERVATION_LOT_POOL_${pool}_${lot.lot}`,{reservationSequences:lot.reservations,seats:lot.seats,capacity:lot.capacity});
        for(const spec of groupLot){
          const row=await timed(`service:reservationWrapper:${spec.sequence}`,()=>createReservation(spec,spec.createActorId,built.inputs));
          manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,
            type:spec.kind,channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
            originalDate:TEMP_DATE,finalDate:spec.finalDate,serviceDateAtCreate:TEMP_DATE,registrationDate:spec.registrationDate,
            fechaRegistroBeforeBackdate:row.Fecha_Registro,registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,
            capacityPoolId:spec.capacityPoolId,originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
            consumesGroupCapacity:true,actorId:Number(row.Creado_Por),role:spec.role||null,modify:spec.modify||null,cancel:spec.cancel,
            silleteroReallocated:Boolean(spec.silleteroReallocated)});
          await writeManifest();
        }
        for(const spec of groupLot.filter(row=>row.modify))await timed(`service:reservationUpdateWrapper:${spec.sequence}`,
          ()=>updateReservation(spec,spec.updateActorId,built.inputs));
        for(const spec of groupLot.filter(row=>row.cancel))await timed(`service:reservationCancelWrapper:${spec.sequence}`,
          ()=>cancelReservation(spec,spec.cancelActorId));
        for(const spec of groupLot){const operation=manifest.operations.reservations.find(row=>row.Id_Reserva===spec.Id_Reserva);
          if(operation){operation.serviceDateBeforeMove=spec.serviceDateBeforeMove||TEMP_DATE;operation.originalDate=spec.serviceDateBeforeMove||TEMP_DATE;
            operation.originalAvailabilityKey=spec.originalAvailabilityKey;operation.serviceUpdate=spec.serviceUpdate||null;operation.serviceCancel=spec.serviceCancel||null;}}
        await writeManifest();const rows=groupLot.map(row=>({Id_Reserva:row.Id_Reserva,kind:row.kind,finalDate:row.finalDate,
          registrationDateTime:row.registrationDateTime,serviceDateBeforeMove:row.serviceDateBeforeMove||TEMP_DATE,modify:row.modify,cancel:row.cancel}));
        await setManifestState(`FULL_RECONCILING_RESERVATION_LOT_POOL_${pool}_${lot.lot}`,{reservationIds:groupLot.map(row=>row.Id_Reserva)});
        await timed(`control:reconcilePool:${pool}:lot${lot.lot}`,()=>reconcileReservationPool(pool,rows,baselineAvailabilityKeys));
        for(const spec of groupLot)await timed(`service:syncProgramacionAfterMove:${spec.sequence}`,
          ()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:spec.finalDate}));
        logLine('FULL_RESERVATION_LOT_DONE',{pool,lot:lot.lot,reservationIds:groupLot.map(row=>row.Id_Reserva),seats:lot.seats});
      }
      const privateLot=built.specs.filter(row=>row.kind==='Privada'&&row.capacityPoolId===pool);
      if(privateLot.length){
        await setManifestState(`FULL_CREATING_PRIVATE_POOL_${pool}`,{sequences:privateLot.map(row=>row.sequence)});
        for(const spec of privateLot){
          const row=await timed(`service:reservationWrapper:${spec.sequence}`,()=>createReservation(spec,spec.createActorId,built.inputs));
          manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,
            type:spec.kind,channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
            originalDate:TEMP_DATE,finalDate:spec.finalDate,serviceDateAtCreate:TEMP_DATE,registrationDate:spec.registrationDate,
            fechaRegistroBeforeBackdate:row.Fecha_Registro,registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,
            capacityPoolId:spec.capacityPoolId,originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
            consumesGroupCapacity:false,actorId:Number(row.Creado_Por),role:null,modify:null,cancel:false,
            silleteroReallocated:Boolean(spec.silleteroReallocated)});await writeManifest();
        }
        await timed(`control:movePrivate:${pool}`,()=>movePrivateReservations(privateLot));
        for(const spec of privateLot)await timed(`service:syncProgramacionAfterMove:${spec.sequence}`,
          ()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:spec.finalDate}));
      }
    }
    await setManifestState('FULL_CREATING_TRANSFERS',{count:built.transferSpecs.length});
    for(const spec of built.transferSpecs){
      const requiresPastMove=spec.finalDate<TODAY;
      const serviceSpec=requiresPastMove?{...spec,serviceDateAtCreate:TEMP_DATE,
        transferPlan:buildTransferPayload({...spec,finalDate:TEMP_DATE},built.inputs)}
        :{...spec,serviceDateAtCreate:spec.finalDate};
      const row=await timed(`service:transferWrapper:${spec.sequence}`,()=>createTransfer(serviceSpec,spec.actorId,built.inputs));
      Object.assign(spec,{Id_Transfer:serviceSpec.Id_Transfer,Codigo_Transfer:serviceSpec.Codigo_Transfer,
        serviceStateAtCreate:serviceSpec.serviceStateAtCreate,valor:serviceSpec.valor,actorId:serviceSpec.actorId,
        serviceDateAtCreate:serviceSpec.serviceDateAtCreate});
      manifest.operations.transfers.push({Id_Transfer:spec.Id_Transfer,Codigo_Transfer:spec.Codigo_Transfer,channelId:spec.channelId,
        entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,originalDate:serviceSpec.serviceDateAtCreate,finalDate:spec.finalDate,
        serviceDateAtCreate:serviceSpec.serviceDateAtCreate,registrationDate:spec.registrationDate,fechaRegistroBeforeBackdate:row.Fecha_Registro,
        registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,estadoAtCreate:spec.serviceStateAtCreate,
        valor:spec.valor,actorId:spec.actorId});await writeManifest();
      if(requiresPastMove){
        const move=await timed(`service:movePastTransfer:${spec.sequence}`,()=>updateCreatedPastTransferToFinalDate(spec,spec.actorId,built.inputs));
        const operation=manifest.operations.transfers.find(item=>Number(item.Id_Transfer)===Number(spec.Id_Transfer));
        if(operation)operation.serviceDateMove=move;
        manifest.full.transferDateMoves.push(move);await writeManifest();
      }
    }
    await setManifestState('FULL_BACKDATING_TRANSFERS',{count:built.transferSpecs.length});
    await timed('control:backdateTransfers:full',()=>backdateTransfers(built.transferSpecs));
    await setManifestState('FULL_NORMALIZING_RESERVATION_STATES');
    manifest.full.stateNormalization=await timed('service:normalizePastReservations:full',()=>reservas.actualizarEstadosReservasVencidas());
    manifest.full.stateNormalizationHistoryRows=await timed('sql:backdateAutomaticStateHistory:full',()=>backdateAutomaticReservationStateHistory(built.specs));
    await writeManifest();

    let captured=await captureChanges(metadata,beforeKeys,countsBefore);const cumulativeReservations=manifest.plan.reservationSpecs;
    const cumulativeTransfers=manifest.plan.transferSpecs;await setManifestState('FULL_VALIDATING');
    const capacityResults=await timed('validation:capacity:full',()=>validateCapacity(cumulativeReservations));
    manifest.validations.push({name:'full: integridad de cupos/disponibilidad acumulada',ok:true,
      elapsedMs:TIMED.find(row=>row.label==='validation:capacity:full')?.elapsedMs,groups:capacityResults});
    const foreignKeys=await timed('validation:foreignKeys:full',()=>validateFks(captured.createdIdsByTable,metadata));
    manifest.full.foreignKeyChecks={checkedConstraints:foreignKeys.length,orphanRows:0};
    await timed('validation:codes:full',()=>validateUniqueCodes(cumulativeReservations,cumulativeTransfers));
    await timed('validation:commissions:full',()=>validateCommissionDefaults(cumulativeReservations));
    await timed('validation:historyDates:full',()=>validateHistoryAndDates(cumulativeReservations,cumulativeTransfers));
    await timed('validation:serviceFilters:full',()=>validateServiceFilters(cumulativeReservations,cumulativeTransfers,built.inputs));
    await timed('validation:readOnlyReports:full',()=>validatePeakAndReadOnlyReports(cumulativeReservations,built.inputs));
    const [[payments]]=await db.query(`SELECT COUNT(*) AS reservationPayments FROM pagos_reservas WHERE Id_Reserva IN (?)`,[cumulativeReservations.map(row=>row.Id_Reserva)]);
    const [[transferPayments]]=await db.query(`SELECT COUNT(*) AS transferPayments FROM pagos_transfers WHERE Id_Transfer IN (?)`,[cumulativeTransfers.map(row=>row.Id_Transfer)]);
    if(Number(payments.reservationPayments)!==1000||Number(transferPayments.transferPayments)!==0)
      throw new Error(`Pagos acumulados inesperados: ${JSON.stringify({reservationPayments:payments.reservationPayments,transferPayments:transferPayments.transferPayments})}.`);
    if(manifest.operations.reservations.length!==1000||manifest.operations.transfers.length!==100)
      throw new Error(`IDs acumulados incompletos: ${manifest.operations.reservations.length} reservas/${manifest.operations.transfers.length} transfers.`);
    const [[outboxBeforeJob]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxBeforeJob.n)!==0)throw new Error(`email_outbox tiene ${outboxBeforeJob.n} filas antes del job full.`);
    manifest.full.slowQueryExplain=await timed('validation:slowQueryExplain:full',()=>explainSlowReadQueries(fullStartIndex));
    manifest.mid.pendingJob=manifest.mid.pendingJob||manifest.pendingJob;
    manifest.full.pendingJob=await timed('pendingJob:full',runPendingJobOnce);
    const [[outboxAfterJob]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxAfterJob.n)!==0)throw new Error(`email_outbox cambió durante el job full: ${outboxAfterJob.n}.`);
    captured=await captureChanges(metadata,beforeKeys,countsBefore);
    const [postReservations]=await db.query('SELECT Id_Reserva,Estado FROM reservas WHERE Id_Reserva IN (?)',[cumulativeReservations.map(row=>row.Id_Reserva)]);
    const [postTransfers]=await db.query('SELECT Id_Transfer,Estado FROM transfers WHERE Id_Transfer IN (?)',[cumulativeTransfers.map(row=>row.Id_Transfer)]);
    const expectedRes=new Map(cumulativeReservations.map(row=>[String(row.Id_Reserva),expectedReservationState(row)]));
    const expectedXfer=new Map(cumulativeTransfers.map(row=>[String(row.Id_Transfer),row.finalDate<TODAY?'Completado':'Confirmado']));
    const stateDifferences=[...postReservations.filter(row=>row.Estado!==expectedRes.get(String(row.Id_Reserva)))
      .map(row=>({type:'reserva',id:String(row.Id_Reserva),actual:row.Estado,expected:expectedRes.get(String(row.Id_Reserva))})),
      ...postTransfers.filter(row=>row.Estado!==expectedXfer.get(String(row.Id_Transfer)))
        .map(row=>({type:'transfer',id:String(row.Id_Transfer),actual:row.Estado,expected:expectedXfer.get(String(row.Id_Transfer))}))];
    manifest.full.postJobStates={reservationsChecked:postReservations.length,transfersChecked:postTransfers.length,stateDifferences};
    await writeManifest();
    if(postReservations.length!==1000||postTransfers.length!==100||stateDifferences.length)
      throw new Error(`PendientesJob cambió estados o faltan filas: ${JSON.stringify(manifest.full.postJobStates)}.`);
    const postFks=await timed('validation:foreignKeys:afterFullJob',()=>validateFks(captured.createdIdsByTable,metadata));
    manifest.full.foreignKeyChecksAfterJob={checkedConstraints:postFks.length,orphanRows:0};
    const finalCounts=captured.countsAfter;
    if(Number(finalCounts.find(row=>row.table==='reservas')?.rows)!==1000||Number(finalCounts.find(row=>row.table==='transfers')?.rows)!==100)
      throw new Error(`Conteos finales inesperados: reservas=${finalCounts.find(row=>row.table==='reservas')?.rows}, transfers=${finalCounts.find(row=>row.table==='transfers')?.rows}.`);
    manifest.full.createdReservationIds=built.specs.map(row=>row.Id_Reserva);
    manifest.full.createdTransfers=built.transferSpecs.map(row=>({Id_Transfer:row.Id_Transfer,Codigo_Transfer:row.Codigo_Transfer}));
    manifest.full.emailOutboxAfter=Number(outboxAfterJob.n);manifest.full.state='FULL_DONE';manifest.full.finishedAt=new Date().toISOString();
    manifest.full.elapsedMs=Number((performance.now()-fullStarted).toFixed(2));manifest.full.timings=TIMED.slice(fullStartIndex);
    manifest.full.queryTimingSummary={queries:QUERY_TIMINGS.length,over100ms:QUERY_TIMINGS.filter(row=>row.elapsedMs>100).length};
    manifest.full.topSlowQueries=QUERY_TIMINGS.slice().sort((a,b)=>b.elapsedMs-a.elapsedMs).slice(0,10)
      .map(row=>({elapsedMs:row.elapsedMs,kind:row.kind,sql:row.sql.trim(),parameterCount:Array.isArray(row.params)?row.params.length:null}));
    manifest.state='FULL_DONE';manifest.currentPhase='FULL_DONE';
    await finalizeManifest(metadata,beforeKeys,countsBefore,'FULL_DONE');
    logLine('FULL_DONE',{manifestPath:MANIFEST_PATH,logPath:LOG_PATH,countsTotalAfter:manifest.countsTotalAfter,
      deltaByTable:manifest.deltaByTable,elapsedMs:manifest.full.elapsedMs});
    console.log(JSON.stringify({status:manifest.state,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsBefore:manifest.countsTotalBefore,countsAfter:manifest.countsTotalAfter,deltaByTable:manifest.deltaByTable,
      full:{...manifest.full,plan:undefined,reservationSequences:undefined,transferSequences:undefined},
      validations:manifest.validations.slice(-30),pendingJob:manifest.full.pendingJob,slowQueryExplain:manifest.full.slowQueryExplain,
      topSlowQueries:manifest.full.topSlowQueries},null,2));
  }catch(error){
    const serialized=errorJson(error);
    if(manifest){manifest.full={...(manifest.full||{}),state:'FULL_FAILED_NO_CLEANUP',failedDuring:manifest.state,error:serialized};
      if(metadata&&beforeKeys&&countsBefore)await finalizeManifest(metadata,beforeKeys,countsBefore,'FULL_FAILED_NO_CLEANUP',error);
      else{manifest.state='FULL_FAILED_NO_CLEANUP';manifest.error=serialized;manifest.completedAt=new Date().toISOString();await writeManifest();}}
    logLine('FULL_STOPPED_NO_CLEANUP',{error:serialized,manifestPath:MANIFEST_PATH,logPath:LOG_PATH});
    console.error(JSON.stringify({status:'FULL_FAILED_NO_CLEANUP',error:serialized,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsAfter:manifest?.countsAfter,deltaByTable:manifest?.deltaByTable},null,2));process.exitCode=1;
  }finally{try{await db.end();}catch{}}
}

async function preflightFullValidationResume() {
  const state=await validateManifestStateReadOnly(args.manifestPath);
  if(manifest.state!=='FULL_FAILED_NO_CLEANUP'||manifest.currentPhase!=='FULL_VALIDATING'
    ||manifest.full?.state!=='FULL_FAILED_NO_CLEANUP'||manifest.full?.failedDuring!=='FULL_VALIDATING'
    ||manifest.full?.pendingJob||manifest.full?.resume||manifest.plan?.reservationSpecs?.length!==1000
    ||manifest.plan?.transferSpecs?.length!==100||manifest.operations?.reservations?.length!==1000
    ||manifest.operations?.transfers?.length!==100)
    throw new Error('Reanudación full rechazada: estado, job o tamaño del manifiesto inesperado.');
  if(state.tableCount!==78||state.totalRows!==24719||manifest.countsTotalAfter!==24719)
    throw new Error(`Reanudación full rechazada: ${state.tableCount} tablas/${state.totalRows} filas.`);
  const [[counts]]=await db.query(`SELECT
    (SELECT COUNT(*) FROM reservas) AS reservations,
    (SELECT COUNT(*) FROM transfers) AS transfers,
    (SELECT COUNT(*) FROM usuarios) AS users,
    (SELECT COUNT(*) FROM email_outbox) AS outbox`);
  if(Number(counts.reservations)!==1000||Number(counts.transfers)!==100
    ||Number(counts.users)!==23||Number(counts.outbox)!==0)
    throw new Error(`Reanudación full rechazada: conteos críticos ${JSON.stringify(counts)}.`);
  const [reservationRows]=await db.query('SELECT Id_Reserva FROM reservas');
  const [transferRows]=await db.query('SELECT Id_Transfer FROM transfers');
  const exact=(actual,planned)=>actual.length===planned.length&&sameSet(actual,planned);
  if(!exact(reservationRows.map(row=>String(row.Id_Reserva)),manifest.operations.reservations.map(row=>String(row.Id_Reserva)))
    ||!exact(reservationRows.map(row=>String(row.Id_Reserva)),manifest.plan.reservationSpecs.map(row=>String(row.Id_Reserva)))
    ||!exact(transferRows.map(row=>String(row.Id_Transfer)),manifest.operations.transfers.map(row=>String(row.Id_Transfer)))
    ||!exact(transferRows.map(row=>String(row.Id_Transfer)),manifest.plan.transferSpecs.map(row=>String(row.Id_Transfer))))
    throw new Error('Reanudación full rechazada: IDs de reservas/transfers distintos del manifiesto.');
  return state;
}

async function resumeFullValidation() {
  const started=performance.now();const startIndex=TIMED.length;
  const metadata=await primaryKeyMetadata();
  const beforeKeys=JSON.parse(fs.readFileSync(path.resolve(manifest.baselineKeysPath),'utf8'));
  const countsBefore=manifest.countsBefore;
  const reservationSpecs=manifest.plan.reservationSpecs;
  const transferSpecs=manifest.plan.transferSpecs;
  try {
    instrumentDatabaseQueries();
    manifest.full.resume={state:'VALIDATING',startedAt:new Date().toISOString(),logPath:LOG_PATH};
    manifest.state='FULL_VALIDATING_RESUME';manifest.currentPhase=manifest.state;
    await writeManifest();logLine('FULL_VALIDATING_RESUME',{reservations:reservationSpecs.length,transfers:transferSpecs.length});
    const captured=await captureChanges(metadata,beforeKeys,countsBefore);
    const capacity=await timed('validation:capacity:fullResume',()=>validateCapacity(reservationSpecs));
    manifest.validations.push({name:'full resume: integridad de cupos/disponibilidad acumulada',ok:true,groups:capacity});
    await timed('validation:foreignKeys:fullResume',()=>validateFks(captured.createdIdsByTable,metadata));
    await timed('validation:codes:fullResume',()=>validateUniqueCodes(reservationSpecs,transferSpecs));
    await timed('validation:commissions:fullResume',()=>validateCommissionDefaults(reservationSpecs));
    await timed('validation:historyDates:fullResume',()=>validateHistoryAndDates(reservationSpecs,transferSpecs));
    const inputs=await timed('validation:catalogs:fullResume',readLoadInputs);
    await timed('validation:serviceFilters:fullResume',()=>validateServiceFilters(reservationSpecs,transferSpecs,inputs));
    await timed('validation:readOnlyReports:fullResume',()=>validatePeakAndReadOnlyReports(reservationSpecs,inputs));
    const [[payments]]=await db.query('SELECT COUNT(*) AS n FROM pagos_reservas WHERE Id_Reserva IN (?)',[reservationSpecs.map(row=>row.Id_Reserva)]);
    const [[transferPayments]]=await db.query('SELECT COUNT(*) AS n FROM pagos_transfers WHERE Id_Transfer IN (?)',[transferSpecs.map(row=>row.Id_Transfer)]);
    if(Number(payments.n)!==1000||Number(transferPayments.n)!==0)
      throw new Error(`Pagos acumulados inesperados: ${payments.n}/${transferPayments.n}.`);
    const [[outboxBefore]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxBefore.n)!==0)throw new Error(`email_outbox contiene ${outboxBefore.n} filas antes del job.`);
    manifest.full.slowQueryExplain=await timed('validation:slowQueryExplain:fullResume',()=>explainSlowReadQueries(startIndex));
    manifest.full.resume.state='PENDING_JOB';manifest.state='FULL_RESUME_PENDING_JOB';manifest.currentPhase=manifest.state;
    await writeManifest();
    manifest.full.pendingJob=await timed('pendingJob:fullResume',runPendingJobOnce);
    const [[outboxAfter]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxAfter.n)!==0)throw new Error(`email_outbox cambió durante el job: ${outboxAfter.n}.`);
    const after=await captureChanges(metadata,beforeKeys,countsBefore);
    const [postReservations]=await db.query('SELECT Id_Reserva,Estado FROM reservas WHERE Id_Reserva IN (?)',[reservationSpecs.map(row=>row.Id_Reserva)]);
    const [postTransfers]=await db.query('SELECT Id_Transfer,Estado FROM transfers WHERE Id_Transfer IN (?)',[transferSpecs.map(row=>row.Id_Transfer)]);
    const expectedRes=new Map(reservationSpecs.map(row=>[String(row.Id_Reserva),expectedReservationState(row)]));
    const expectedXfer=new Map(transferSpecs.map(row=>[String(row.Id_Transfer),row.finalDate<TODAY?'Completado':'Confirmado']));
    const stateDifferences=[...postReservations.filter(row=>row.Estado!==expectedRes.get(String(row.Id_Reserva)))
      .map(row=>({type:'reserva',id:String(row.Id_Reserva),actual:row.Estado,expected:expectedRes.get(String(row.Id_Reserva))})),
      ...postTransfers.filter(row=>row.Estado!==expectedXfer.get(String(row.Id_Transfer)))
        .map(row=>({type:'transfer',id:String(row.Id_Transfer),actual:row.Estado,expected:expectedXfer.get(String(row.Id_Transfer))}))];
    manifest.full.postJobStates={reservationsChecked:postReservations.length,transfersChecked:postTransfers.length,stateDifferences};
    await writeManifest();
    if(postReservations.length!==1000||postTransfers.length!==100||stateDifferences.length)
      throw new Error(`PendientesJob cambió estados o faltan filas: ${JSON.stringify(manifest.full.postJobStates)}.`);
    const postFks=await timed('validation:foreignKeys:afterFullResumeJob',()=>validateFks(after.createdIdsByTable,metadata));
    manifest.full.foreignKeyChecksAfterJob={checkedConstraints:postFks.length,orphanRows:0};
    if(Number(after.countsAfter.find(row=>row.table==='reservas')?.rows)!==1000
      ||Number(after.countsAfter.find(row=>row.table==='transfers')?.rows)!==100)
      throw new Error('Conteos de reservas/transfers inesperados tras el job.');
    const fullReservationSequences=new Set(manifest.full.reservationSequences);
    const fullTransferSequences=new Set(manifest.full.transferSequences);
    manifest.full.createdReservationIds=reservationSpecs.filter(row=>fullReservationSequences.has(row.sequence)).map(row=>row.Id_Reserva);
    manifest.full.createdTransfers=transferSpecs.filter(row=>fullTransferSequences.has(row.sequence))
      .map(row=>({Id_Transfer:row.Id_Transfer,Codigo_Transfer:row.Codigo_Transfer}));
    if(manifest.full.createdReservationIds.length!==700||manifest.full.createdTransfers.length!==70)
      throw new Error('El manifiesto no identifica exactamente las 700 reservas y 70 transfers del full.');
    manifest.full.emailOutboxAfter=Number(outboxAfter.n);
    manifest.full.state='FULL_DONE';manifest.full.finishedAt=new Date().toISOString();
    manifest.full.resume={...manifest.full.resume,state:'DONE',finishedAt:manifest.full.finishedAt,
      elapsedMs:Number((performance.now()-started).toFixed(2))};
    manifest.full.timings=TIMED.slice(startIndex);
    delete manifest.full.failedDuring;delete manifest.full.error;delete manifest.error;
    manifest.state='FULL_DONE';manifest.currentPhase='FULL_DONE';
    await finalizeManifest(metadata,beforeKeys,countsBefore,'FULL_DONE');
    logLine('FULL_DONE',{resumed:true,countsTotalAfter:manifest.countsTotalAfter});
    console.log(JSON.stringify({status:'FULL_DONE',resumed:true,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsAfter:manifest.countsTotalAfter,reservations:postReservations.length,transfers:postTransfers.length,pendingJob:manifest.full.pendingJob},null,2));
  } catch(error) {
    const serialized=errorJson(error);
    manifest.full.state='FULL_FAILED_NO_CLEANUP';manifest.full.failedDuring=manifest.state;
    manifest.full.error=serialized;manifest.full.resume={...(manifest.full.resume||{}),state:'FAILED',error:serialized};
    await finalizeManifest(metadata,beforeKeys,countsBefore,'FULL_FAILED_NO_CLEANUP',error);
    logLine('FULL_RESUME_STOPPED_NO_CLEANUP',{failedDuring:manifest.full.failedDuring,error:serialized});
    console.error(JSON.stringify({status:'FULL_FAILED_NO_CLEANUP',failedDuring:manifest.full.failedDuring,error:serialized,
      manifestPath:MANIFEST_PATH,logPath:LOG_PATH,countsAfter:manifest.countsTotalAfter},null,2));
    process.exitCode=1;
  }
}

async function createPendingReservationForStep(sequence,date,state,actorId,inputs){
  const tourId=2;const channelId=7;const schedule=inputs.schedules[tourId];const plan=inputs.planPrices[tourId];
  const missingData=state==='Pendiente de datos';const pasajeros=[];
  for(let index=0;index<2;index+=1){
    const missing=missingData&&index===0;const type=index===0?'ADULTO':'NIÑO';
    pasajeros.push({Nombre_Pasajero:missing?'':`${MARKER}_PENDIENTE_PAX_${sequence}_${index+1}`,
      DNI:missing?null:String(990500000000+sequence*10+index),Nacionalidad:'Colombiana',
      Telefono_Pasajero:`+57399060${String(sequence).padStart(4,'0')}${index}`,Tipo_Pasajero:type,
      Edad:type==='NIÑO'?10:undefined,Id_Plan:Number(plan.Id_Plan),Precio_Tour:Number(plan.prices[type]||0),
      Precio_Pasajero:Number(plan.prices[type]||0),Comision:0,Id_Punto:Number(schedule.Id_Punto),Confirmacion:0});
  }
  const payload={cabeceraReserva:{Id_Tour:tourId,Id_Horario:Number(schedule.Id_Horario),Fecha_Tour:date,Tipo_Reserva:'Grupal',
      Id_Canal:channelId,Id_Entidad_Reportante:null,Id_Moneda:1,Idioma_Reserva:'ESPAÑOL',
      Telefono_Reportante:`+57399061${String(sequence).padStart(4,'0')}`,Nombre_Reportante:`${MARKER}_PENDIENTE_REPORTANTE_${sequence}`,
      Observaciones:`${MARKER} | pendientes-bloque | ${state}`,Id_Punto:Number(schedule.Id_Punto)},
    pasajeros, pagos:missingData?[{Tipo:'Pago Directo',Monto:0,Observaciones:`Compromiso en punto ${MARKER}`}]:[]};
  const created=await timed(`step:pendingReservation:${sequence}`,()=>reservas.crearReservaConPasajerosYPagos(payload,{},actorId));
  if(!created?.Id_Reserva)throw new Error(`El servicio no devolvió Id_Reserva para pendiente ${sequence}.`);
  const [[row]]=await db.query(`SELECT Id_Reserva,Estado,Id_Canal,Id_Entidad_Reportante,Observaciones,
      DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,Creado_Por FROM reservas WHERE Id_Reserva=?`,[created.Id_Reserva]);
  if(!row||row.Estado!==state||row.Fecha_Tour!==date||!String(row.Observaciones||'').includes(MARKER))
    throw new Error(`Reserva pendiente ${created.Id_Reserva}: esperado ${state}/${date}, recibido ${JSON.stringify(row)}.`);
  await programacionNovedades.syncForReservationChange({reservationId:String(row.Id_Reserva),fecha:date});
  return {spec:{sequence,Id_Reserva:String(row.Id_Reserva),tourId,kind:'Grupal',finalDate:date,channelId,entity:null,
      passengerCountExpected:2,seatedCountExpected:2,createPayload:payload,role:null,cancel:false,modify:null,
      capacityPoolId:normalizeTourForCapacity(tourId),leadDays:1,registrationDate:TODAY,registrationDateTime:`${TODAY} 12:00:00`,
      expectedPendingState:state},row};
}

async function createPendingTransferForStep(sequence,date,state,actorId,inputs){
  const spec={sequence,channelId:7,entity:null,finalDate:date,holder:`${MARKER}_PENDIENTE_TRANSFER_${sequence}`};
  const plan=buildTransferPayload(spec,inputs);const payload={...plan.servicePayload};
  if(state==='Pendiente de datos'){
    payload.Llegada=null;payload.Pago={Tipo:'PagaEnPunto',Observaciones:`Compromiso en punto ${MARKER}`};
  }else payload.Pago={};
  payload.Observaciones=`${MARKER} | pendientes-bloque | ${state}`;
  const created=await timed(`step:pendingTransfer:${sequence}`,()=>transfers.crearTransferSvc(payload,{userId:actorId}));
  if(!created?.Id_Transfer)throw new Error(`El servicio no devolvió Id_Transfer para pendiente ${sequence}.`);
  const [[row]]=await db.query(`SELECT Id_Transfer,CONCAT('TRS',LPAD(Id_Transfer,5,'0')) AS Codigo_Transfer,Estado,
      Id_Canal,Id_Entidad_Reportante,Observaciones,DATE_FORMAT(Fecha_Transfer,'%Y-%m-%d') AS Fecha_Transfer,Creado_Por
    FROM transfers WHERE Id_Transfer=?`,[created.Id_Transfer]);
  if(!row||row.Estado!==state||row.Fecha_Transfer!==date||!String(row.Observaciones||'').includes(MARKER)
      ||row.Codigo_Transfer!==created.Codigo_Transfer)
    throw new Error(`Transfer pendiente ${created.Id_Transfer}: esperado ${state}/${date}, recibido ${JSON.stringify(row)}.`);
  return {spec:{sequence,Id_Transfer:Number(row.Id_Transfer),Codigo_Transfer:row.Codigo_Transfer,channelId:7,entity:null,
      finalDate:date,kind:'Transfer',transferPlan:plan,expectedPendingState:state},row};
}

async function runPendingBlockStep(stepRecord,actorIds,inputs){
  const serviceHorizon=serviceDateHorizon();
  const targetDate=serviceHorizon.filter(date=>isOperatingDay(inputs,2,date));
  if(!targetDate.length)throw new Error('No existe día operativo del tour 2 en los próximos 30 días para el bloque pendiente.');
  const date=targetDate[0];const createdReservations=[];const createdTransfers=[];let sequence=3001;
  for(const state of ['Pendiente de datos','Pendiente de pago'])for(let index=0;index<4;index+=1){
    const result=await createPendingReservationForStep(sequence++,date,state,actorIds[(sequence+index)%actorIds.length],inputs);
    createdReservations.push({...result.spec,state:result.row.Estado});
  }
  for(const state of ['Pendiente de datos','Pendiente de pago']){
    const count=state==='Pendiente de datos'?4:3;
    for(let index=0;index<count;index+=1){
      const result=await createPendingTransferForStep(sequence++,date,state,actorIds[sequence%actorIds.length],inputs);
      createdTransfers.push({...result.spec,state:result.row.Estado});
    }
  }
  if(createdReservations.length+createdTransfers.length!==15)throw new Error('El bloque pendiente no creó 15 operaciones.');
  stepRecord.serviceDateHorizon={from:serviceHorizon[0],through:serviceHorizon.at(-1),days:serviceHorizon.length};
  stepRecord.operations={reservations:createdReservations,transfers:createdTransfers,date};await writeManifest();
  const pendingJob=await timed('step:pendingJob',runPendingJobOnce);
  const [[outbox]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
  if(Number(outbox.n)!==0)throw new Error(`email_outbox tiene ${outbox.n} filas tras el job del bloque pendiente.`);
  stepRecord.pendingJob=pendingJob;stepRecord.emailOutboxAfter=Number(outbox.n);
  const [newEvents]=await db.query('SELECT * FROM pendientes_eventos WHERE Id_Evento>? ORDER BY Id_Evento',
    [Number(stepRecord.beforeMax?.pendientes_eventos||0)]);
  const [newPending]=await db.query('SELECT * FROM pendientes_operativos WHERE Id_Pendiente>? ORDER BY Id_Pendiente',
    [Number(stepRecord.beforeMax?.pendientes_operativos||0)]);
  const [newNotifications]=await db.query('SELECT * FROM notificaciones WHERE Id_Notificacion>? ORDER BY Id_Notificacion',
    [Number(stepRecord.beforeMax?.notificaciones||0)]);
  stepRecord.effects={pendientesEventos:newEvents,pendientesOperativos:newPending,notificaciones:newNotifications};
  return {reservations:createdReservations.length,transfers:createdTransfers.length,pendingJob,emailOutbox:Number(outbox.n)};
}

async function stepMaxPrimaryKeys(metadata){
  const result={};
  for(const table of ['pendientes_eventos','pendientes_operativos','notificaciones','historial','detalle_historial',
    'comisiones_grupos_pago','comisiones_grupos_pago_reservas','liquidaciones','programaciones']){
    const column=metadata[table]?.[0];if(!column)continue;
    const [[row]]=await db.query(`SELECT COALESCE(MAX(${quoteId(column)}),0) AS n FROM ${quoteId(table)}`);
    result[table]=Number(row.n);
  }
  return result;
}

function paymentPayloadForTest(){
  return {Monto_Pendiente_Esperado:0,Cantidad_Reservas_Pendientes_Esperada:0,
    Fecha_Pago:TODAY,Forma_Pago:'EFECTIVO',Cuenta_Bancaria:null,
    Nombre_Receptor:'RECEPTOR FICTICIO DE PRUEBA',DNI_Receptor:'TEST-20261026'};
}

function commissionGroupFilters(entityId,date){
  return {desde:date,hasta:date,idEntidad:entityId,tipo:'AGENCIA_NACIONAL',estado:'PENDIENTE',page:1,limit:100};
}

async function listPayableCommissionGroup(entityId,date){
  const response=await timed('step:commissionGroupList',()=>comisionGrupos.listarGrupos(commissionGroupFilters(entityId,date)));
  const group=(response?.grupos||[]).find(row=>String(row.Id)===`e${Number(entityId)}~${date}`
    &&Number(row.Cantidad_Reservas_Pendientes)>0&&row.Puede_Pagar);
  if(!group)throw new Error(`No hay grupo pagable pendiente para entidad ${entityId} y fecha ${date}: ${JSON.stringify((response?.grupos||[]).map(row=>({Id:row.Id,pendientes:row.Cantidad_Reservas_Pendientes,Puede_Pagar:row.Puede_Pagar,motivo:row.Motivo_No_Pagable})))}`);
  return group;
}

async function closeCommissionJourneyForOneReservation(spec,actorId){
  const allPassengers=await timed('step:commissionJourneyPassengers',()=>confirmacion.obtenerPasajerosPorTour(spec.tourId,spec.finalDate));
  const [targetRows]=await db.query('SELECT Id_Pasajero FROM pasajeros WHERE Id_Reserva=? ORDER BY Id_Pasajero',[spec.Id_Reserva]);
  const targetIds=new Set(targetRows.map(row=>Number(row.Id_Pasajero)));
  if(!targetIds.size)throw new Error(`La reserva de ajuste ${spec.Id_Reserva} no tiene pasajeros.`);
  const changes=allPassengers.map(row=>({Id_Pasajero:Number(row.Id_Pasajero),Confirmacion:targetIds.has(Number(row.Id_Pasajero))?1:Number(row.Confirmacion||0)}));
  const result=await timed('service:closeCommissionAdjustmentJourney',()=>confirmacion.actualizarConfirmacion({
    Id_Tour:Number(spec.tourId),Fecha:spec.finalDate,pasajeros:changes,
  },actorId));
  const [[journey]]=await db.query(`SELECT Id_Confirmacion,Id_Tour,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour,
      Total_Pasajeros,Total_Viajaron,DATE_FORMAT(Confirmada_En,'%Y-%m-%d %H:%i:%s') AS Confirmada_En
    FROM confirmaciones_jornada WHERE Id_Tour=? AND Fecha_Tour=? LIMIT 1`,[spec.tourId,spec.finalDate]);
  if(!journey||journey.Fecha_Tour!==spec.finalDate||Number(journey.Total_Viajaron)<targetIds.size)
    throw new Error(`No se cerró la jornada para el ajuste de comisión ${spec.Id_Reserva}: ${JSON.stringify(journey)}.`);
  return {result,journey,updatedPassengers:targetIds.size};
}

async function runCommissionLotsStep(stepRecord,actorIds,inputs,metadata){
  const roleOperation=manifest.operations.reservations.find(row=>row.role==='agency-commission-group');
  const roleSpec=roleOperation&&manifest.plan.reservationSpecs.find(row=>String(row.Id_Reserva)===String(roleOperation.Id_Reserva));
  if(!roleOperation||!roleSpec?.entity)throw new Error('El manifiesto no contiene el grupo de agencia nacional aprobado para probar comisiones.');
  const entityId=Number(roleSpec.entity.Id_Entidad_Reportante);const date=String(roleOperation.finalDate);
  const actorId=Number(actorIds[0]);
  const firstGroup=await listPayableCommissionGroup(entityId,date);
  const firstPayload=paymentPayloadForTest();firstPayload.Monto_Pendiente_Esperado=Number(firstGroup.Monto_Pendiente);
  firstPayload.Cantidad_Reservas_Pendientes_Esperada=Number(firstGroup.Cantidad_Reservas_Pendientes);
  const firstPaid=await timed('service:payCommissionLot',()=>comisionGrupos.marcarGrupoPagado(firstGroup.Id,firstPayload,actorId));
  stepRecord.paidLot={reference:firstGroup.Id,entityId,date,expected:{amount:firstPayload.Monto_Pendiente_Esperado,count:firstPayload.Cantidad_Reservas_Pendientes_Esperada},result:firstPaid};
  await writeManifest();

  const spec={sequence:99001,kind:'Grupal',tourId:Number(roleSpec.tourId),channelId:2,entity:roleSpec.entity,
    finalDate:date,role:'agency-commission-group',cancel:false,modify:null,leadDays:3,
    registrationDate:addDays(date,-3),registrationDateTime:`${addDays(date,-3)} 12:00:00`,
    reporterName:`${MARKER}_AJUSTE_COMISION`,reporterPhone:'+573990059901',capacityPoolId:normalizeTourForCapacity(roleSpec.tourId),
    temporaryCreateDate:TEMP_DATE,serviceDateBeforeMove:TEMP_DATE,originalDate:TEMP_DATE,
    originalAvailabilityKey:{Id_Tour:normalizeTourForCapacity(roleSpec.tourId),Fecha_Tour:TEMP_DATE},
    finalAvailabilityKey:{Id_Tour:normalizeTourForCapacity(roleSpec.tourId),Fecha_Tour:date}};
  await timed('step:commissionAdjustmentInput',()=>createInputsForSpec(spec,inputs));
  const created=await createReservation(spec,actorId,inputs);
  manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,type:spec.kind,
    channelId:spec.channelId,entityId,originalDate:TEMP_DATE,finalDate:date,serviceDateAtCreate:TEMP_DATE,
    registrationDate:spec.registrationDate,fechaRegistroBeforeBackdate:created.Fecha_Registro,
    registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,capacityPoolId:spec.capacityPoolId,
    originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
    consumesGroupCapacity:true,actorId,role:spec.role,modify:null,cancel:false,commissionAdjustment:true});
  stepRecord.adjustmentReservation=spec.Id_Reserva;await writeManifest();
  await timed('control:reconcileCommissionAdjustment',()=>reconcileReservationPool(spec.capacityPoolId,[{
    Id_Reserva:spec.Id_Reserva,kind:'Grupal',finalDate:date,registrationDateTime:spec.registrationDateTime,
    serviceDateBeforeMove:TEMP_DATE,modify:null,cancel:false,
  }],manifest.baselineAvailabilityKeys||[]));
  await timed('service:syncCommissionAdjustment',()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:date}));
  await timed('service:normalizeCommissionAdjustmentState',()=>reservas.actualizarEstadosReservasVencidas());
  await timed('sql:backdateCommissionAdjustmentHistory',()=>backdateAutomaticReservationStateHistory([spec]));
  const journey=await closeCommissionJourneyForOneReservation(spec,actorId);
  const secondGroup=await listPayableCommissionGroup(entityId,date);
  if(Number(secondGroup.Cantidad_Reservas_Pendientes)<1||Number(secondGroup.Monto_Pendiente)<=0)
    throw new Error(`El ajuste no creó una comisión positiva pendiente: ${JSON.stringify(secondGroup)}.`);
  const secondPayload=paymentPayloadForTest();secondPayload.Monto_Pendiente_Esperado=Number(secondGroup.Monto_Pendiente);
  secondPayload.Cantidad_Reservas_Pendientes_Esperada=Number(secondGroup.Cantidad_Reservas_Pendientes);
  const adjustmentPaid=await timed('service:payCommissionAdjustmentLot',()=>comisionGrupos.marcarGrupoPagado(secondGroup.Id,secondPayload,actorId));
  const [[paymentState]]=await db.query(`SELECT COUNT(*) AS n FROM liquidaciones WHERE Id_Reserva=? AND Estado='PAGADO'`,[spec.Id_Reserva]);
  if(Number(paymentState.n)!==1)throw new Error(`La reserva ${spec.Id_Reserva} no quedó PAGADO en su liquidación.`);
  stepRecord.adjustmentLot={reference:secondGroup.Id,expected:{amount:secondPayload.Monto_Pendiente,count:secondPayload.Cantidad_Reservas_Pendientes},
    result:adjustmentPaid,journey,liquidationRows:Number(paymentState.n)};
  return {firstLot:stepRecord.paidLot,adjustmentReservation:spec.Id_Reserva,adjustmentLot:stepRecord.adjustmentLot};
}

function makeSinglePassengerPayload(inputs,{sequence,tourId,date,markerSuffix='CONCURRENCIA'}){
  const schedule=inputs.schedules[Number(tourId)];const plan=inputs.planPrices[Number(tourId)];
  return {cabeceraReserva:{Id_Tour:Number(tourId),Id_Horario:Number(schedule.Id_Horario),Fecha_Tour:date,
      Tipo_Reserva:'Grupal',Id_Canal:7,Id_Entidad_Reportante:null,Id_Moneda:1,Idioma_Reserva:'ESPAÑOL',
      Telefono_Reportante:`+57399070${String(sequence).padStart(4,'0')}`,Nombre_Reportante:`${MARKER}_${markerSuffix}_${sequence}`,
      Observaciones:`${MARKER} | ${markerSuffix} | ${date}`,Id_Punto:Number(schedule.Id_Punto)},
    pasajeros:[{Nombre_Pasajero:`${MARKER}_${markerSuffix}_PAX_${sequence}`,DNI:String(991000000000+sequence),
      Nacionalidad:'Colombiana',Telefono_Pasajero:`+57399071${String(sequence).padStart(4,'0')}`,Tipo_Pasajero:'ADULTO',
      Edad:30,Id_Plan:Number(plan.Id_Plan),Precio_Tour:Number(plan.prices.ADULTO),Precio_Pasajero:Number(plan.prices.ADULTO),
      Comision:0,Id_Punto:Number(schedule.Id_Punto),Confirmacion:0}],
    pagos:[{Tipo:'Pago Directo',Monto:0,Observaciones:`Pago en el punto; ${MARKER}`} ]};
}

async function createSingleServiceReservation(inputs,actorId,sequence,tourId,date,label){
  const payload=makeSinglePassengerPayload(inputs,{sequence,tourId,date,markerSuffix:label});
  const created=await timed(`service:${label}:${sequence}`,()=>reservas.crearReservaConPasajerosYPagos(payload,{},actorId));
  if(!created?.Id_Reserva)throw new Error(`${label} ${sequence}: el servicio no devolvió Id_Reserva.`);
  const [[row]]=await db.query(`SELECT Id_Reserva,Estado,Creado_Por,Observaciones,DATE_FORMAT(Fecha_Tour,'%Y-%m-%d') AS Fecha_Tour
    FROM reservas WHERE Id_Reserva=?`,[created.Id_Reserva]);
  if(!row||row.Fecha_Tour!==date||!String(row.Observaciones||'').includes(MARKER)||Number(row.Creado_Por)!==Number(actorId))
    throw new Error(`${label} ${sequence}: fila creada distinta al payload: ${JSON.stringify(row)}.`);
  return {id:String(row.Id_Reserva),sequence,tourId:Number(tourId),date,state:row.Estado,actorId:Number(actorId)};
}

async function runConcurrencyStep(stepRecord,actorIds,inputs){
  const serviceHorizon=serviceDateHorizon();
  const dates=serviceHorizon.filter(date=>isOperatingDay(inputs,8,date));
  const candidates=[];
  for(const date of dates){
    const pool=normalizeTourForCapacity(8);const capacity=await effectiveCapacity(db,pool,date);const occupied=await occupancyForPool(db,pool,date);
    if(capacity>0&&occupied<=capacity)candidates.push({tourId:8,pool,date,capacity,occupied,free:capacity-occupied});
  }
  const target=candidates.sort((a,b)=>a.free-b.free||a.date.localeCompare(b.date))[0];
  if(!target)throw new Error('No existe fecha futura operativa de Pablo Escobar con capacidad consultable para el ensayo concurrente.');
  const availability=await readAvailability(target.pool,target.date);
  if(availability&&Number(availability.Cupos_Disponibles)!==target.free)
    throw new Error(`Disponibilidad previa de concurrencia desincronizada ${target.pool}/${target.date}: ${availability.Cupos_Disponibles}, esperado ${target.free}.`);
  const setupCount=Math.max(0,target.free-3);
  if(setupCount>12)throw new Error(`La prueba concurrente requeriría ${setupCount} reservas preparatorias, máximo 12 para tour 8.`);
  const setup=[];for(let index=0;index<setupCount;index+=1)
    setup.push(await createSingleServiceReservation(inputs,actorIds[index%actorIds.length],50000+index,8,target.date,'CONCURRENCIA_PREP'));
  const afterSetup=await occupancyForPool(db,target.pool,target.date);const freeForRace=target.capacity-afterSetup;
  if(freeForRace!==3)throw new Error(`La preparación dejó ${freeForRace} cupos para concurrencia; se esperaban 3.`);
  const beforeIds=new Set();
  const outcomes=await Promise.allSettled(Array.from({length:20},(_,index)=>{
    const sequence=50100+index;const payload=makeSinglePassengerPayload(inputs,{sequence,tourId:8,date:target.date});
    return timed(`service:concurrentReservation:${index+1}`,async()=>{
      const result=await reservas.crearReservaConPasajerosYPagos(payload,{},actorIds[index%actorIds.length]);
      if(!result?.Id_Reserva)throw new Error('crearReservaConPasajerosYPagos no devolvió Id_Reserva.');
      const [[row]]=await db.query('SELECT Id_Reserva,Estado,Observaciones FROM reservas WHERE Id_Reserva=?',[result.Id_Reserva]);
      if(!row||!String(row.Observaciones||'').includes(MARKER))throw new Error(`Reserva concurrente ${result.Id_Reserva} no tiene marcador.`);
      beforeIds.add(String(row.Id_Reserva));return {id:String(row.Id_Reserva),state:row.Estado,sequence};
    });
  }));
  const succeeded=outcomes.filter(row=>row.status==='fulfilled').map(row=>row.value);
  const failed=outcomes.filter(row=>row.status==='rejected').map(row=>({message:String(row.reason?.message||row.reason),code:row.reason?.errorCode||row.reason?.code||null}));
  if(succeeded.length!==3||failed.length!==17||failed.some(row=>row.code!=='OVERBOOKING_CONFLICT'))
    throw new Error(`Concurrencia esperada 3 éxitos/17 OVERBOOKING_CONFLICT; obtenido ${succeeded.length}/${JSON.stringify(failed.slice(0,5))}.`);
  const occupiedAfter=await occupancyForPool(db,target.pool,target.date);const availabilityAfter=await readAvailability(target.pool,target.date);
  if(occupiedAfter>target.capacity||!availabilityAfter||Number(availabilityAfter.Cupos_Disponibles)!==target.capacity-occupiedAfter)
    throw new Error(`Concurrencia dejó cupos inconsistentes: ${JSON.stringify({capacity:target.capacity,occupiedAfter,availabilityAfter})}.`);
  stepRecord.target={...target,setupCount,freeForRace};stepRecord.setupReservations=setup;
  stepRecord.serviceDateHorizon={from:serviceHorizon[0],through:serviceHorizon.at(-1),days:serviceHorizon.length};
  stepRecord.concurrentAttempts=20;stepRecord.concurrentSucceeded=succeeded;stepRecord.concurrentRejected=failed;
  stepRecord.availabilityAfter={capacity:target.capacity,occupied:occupiedAfter,available:Number(availabilityAfter.Cupos_Disponibles)};
  return {target:stepRecord.target,setup:setup.length,attempted:20,succeeded:succeeded.length,rejected:failed.length,
    availabilityAfter:stepRecord.availabilityAfter};
}

async function runSavedListStep(stepRecord,actorIds){
  const date='2026-10-31';const tourIds=[...FULL_TOURS];
  const plan=await timed('service:generateSavedListPlan',()=>programacion.generarPlanLogistico(date,tourIds));
  const reservations=Number((plan.buses||[]).reduce((sum,bus)=>sum+(bus.reservas||[]).length,0));
  if((plan.reservasSinAsignar||[]).length)throw new Error(`No se guarda listado: ${plan.reservasSinAsignar.length} reservas sin asignar.`);
  if(!reservations)throw new Error('No se guarda un listado vacío para el día pico.');
  const saved=await timed('service:saveFinalList',()=>programacion.guardarListadoFinal({fecha:date,idsTours:tourIds,buses:plan.buses,userId:Number(actorIds[0])}));
  if(!saved?.ok||Number(saved.reservas)!==reservations)throw new Error(`El servicio de listado no guardó todas las reservas: ${JSON.stringify({saved,reservations})}.`);
  stepRecord.savedList={date,tourIds,buses:Number(saved.buses),reservations:Number(saved.reservas),idProgramacion:Number(saved.idProgramacion),
    alerts:plan.alertas||[],unassigned:(plan.reservasSinAsignar||[]).length};
  return stepRecord.savedList;
}

async function runAdditionalStep(stepName){
  const state=await timed(`step:${stepName}:manifestState`,()=>validateManifestStateReadOnly(args.manifestPath));
  if(args.runId!==manifest.runId)throw new Error(`runId ${args.runId} no coincide con el manifiesto ${manifest.runId}.`);
  if(manifest.full?.state!=='FULL_DONE'||!['FULL_DONE',
      'STEP_PENDIENTES_BLOQUE_DONE','STEP_COMISIONES_LOTES_DONE','STEP_CONCURRENCIA_DONE'].includes(manifest.state))
    throw new Error(`Los pasos adicionales requieren full completo y ningún paso previo fallido; estado=${manifest.state}/${manifest.full?.state}.`);
  const order=['pendientes-bloque','comisiones-lotes','concurrencia','listado-guardado'];
  const prior=manifest.steps||{};const index=order.indexOf(stepName);
  if(prior[stepName])throw new Error(`El paso ${stepName} ya está registrado (${prior[stepName].state}); no se repite ni reintenta.`);
  for(const required of order.slice(0,index))if(prior[required]?.state!=='DONE')
    throw new Error(`El paso ${stepName} requiere que ${required} haya terminado DONE.`);
  const server=await timed(`step:${stepName}:serverOffline`,assertServerOffline);
  const [[outbox]]=await timed(`step:${stepName}:emailOutboxBefore`,()=>db.query('SELECT COUNT(*) AS n FROM email_outbox'));
  if(Number(outbox.n)!==0)throw new Error(`email_outbox contiene ${outbox.n} filas antes del paso ${stepName}.`);
  instrumentDatabaseQueries();
  const metadata=await timed(`step:${stepName}:pkMetadata`,primaryKeyMetadata);
  const beforeKeys=await timed(`step:${stepName}:keysBefore`,()=>capturePrimaryKeys(metadata));
  const countsBefore=await timed(`step:${stepName}:countsBefore`,countSnapshot);
  const maxKeys=await stepMaxPrimaryKeys(metadata);
  const inputs=await timed(`step:${stepName}:catalogs`,readLoadInputs);
  const actorIds=manifest.actorIds.map(Number);
  if(!actorIds.length)throw new Error(`El manifiesto no tiene usuarios asesores para ${stepName}.`);
  manifest.steps=manifest.steps||{};
  const stepRecord={state:'STARTED',startedAt:new Date().toISOString(),runId:manifest.runId,marker:manifest.marker,
    logPath:LOG_PATH,before:{counts:countsBefore,total:sumCounts(countsBefore)},beforeMax:maxKeys,server};
  manifest.steps[stepName]=stepRecord;manifest.state=`STEP_${stepName.toUpperCase().replace(/-/g,'_')}_START`;
  manifest.currentPhase=manifest.state;await writeManifest();logLine('ADDITIONAL_STEP_START',{stepName,runId:manifest.runId,countsBeforeTotal:sumCounts(countsBefore)});
  try{
    let result;
    if(stepName==='pendientes-bloque')result=await runPendingBlockStep(stepRecord,actorIds,inputs);
    else if(stepName==='comisiones-lotes')result=await runCommissionLotsStep(stepRecord,actorIds,inputs,metadata);
    else if(stepName==='concurrencia')result=await runConcurrencyStep(stepRecord,actorIds,inputs);
    else if(stepName==='listado-guardado')result=await runSavedListStep(stepRecord,actorIds);
    const [[outboxAfter]]=await db.query('SELECT COUNT(*) AS n FROM email_outbox');
    if(Number(outboxAfter.n)!==0)throw new Error(`email_outbox cambió durante ${stepName}: ${outboxAfter.n}.`);
    const afterKeys=await capturePrimaryKeys(metadata);const countsAfter=await countSnapshot();
    stepRecord.createdIdsByTable=diffPrimaryKeys(beforeKeys,afterKeys);
    stepRecord.countsAfter=countsAfter;stepRecord.deltaByTable=compareCounts(countsBefore,countsAfter);
    stepRecord.emailOutboxAfter=Number(outboxAfter.n);stepRecord.result=result;
    stepRecord.state='DONE';stepRecord.finishedAt=new Date().toISOString();
    const baseline=JSON.parse(fs.readFileSync(path.resolve(manifest.baselineKeysPath),'utf8'));
    await captureChanges(metadata,baseline,manifest.countsBefore);
    manifest.state=`STEP_${stepName.toUpperCase().replace(/-/g,'_')}_DONE`;manifest.currentPhase=manifest.state;
    await writeManifest();logLine('ADDITIONAL_STEP_DONE',{stepName,result,deltaByTable:stepRecord.deltaByTable,elapsedMs:timeTotal(`step:`)});
    console.log(JSON.stringify({status:manifest.state,step:stepName,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsBefore:stepRecord.before.total,countsAfter:sumCounts(countsAfter),deltaByTable:stepRecord.deltaByTable,
      createdIdsByTable:stepRecord.createdIdsByTable,result,timingsMs:TIMED.filter(row=>row.label.includes(`step:${stepName}`)||row.label.startsWith('service:')||row.label.startsWith('control:'))},null,2));
    return {state,stepRecord};
  }catch(error){
    const serialized=errorJson(error);stepRecord.state='FAILED_NO_CLEANUP';stepRecord.error=serialized;stepRecord.failedAt=new Date().toISOString();
    try{
      const afterKeys=await capturePrimaryKeys(metadata);const countsAfter=await countSnapshot();
      stepRecord.createdIdsByTable=diffPrimaryKeys(beforeKeys,afterKeys);stepRecord.countsAfter=countsAfter;
      stepRecord.deltaByTable=compareCounts(countsBefore,countsAfter);
      const baseline=JSON.parse(fs.readFileSync(path.resolve(manifest.baselineKeysPath),'utf8'));
      await captureChanges(metadata,baseline,manifest.countsBefore);
    }catch(captureError){stepRecord.captureFailure=errorJson(captureError);}
    manifest.state=`STEP_${stepName.toUpperCase().replace(/-/g,'_')}_FAILED_NO_CLEANUP`;manifest.currentPhase=manifest.state;
    await writeManifest();logLine('ADDITIONAL_STEP_FAILED_NO_CLEANUP',{stepName,error:serialized,countsAfter:stepRecord.countsAfter,deltaByTable:stepRecord.deltaByTable});
    console.error(JSON.stringify({status:manifest.state,step:stepName,error:serialized,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsAfter:stepRecord.countsAfter,deltaByTable:stepRecord.deltaByTable},null,2));process.exitCode=1;
  }
}

function initializeServiceToday(){
  const serviceToday=bogotaTodayYmd();
  if(args.today&&args.today!==serviceToday)
    throw new Error(`--today ${args.today} difiere de la fecha America/Bogota del servicio (${serviceToday}).`);
  TODAY=serviceToday;
  return TODAY;
}

async function run() {
  db=require('../database/db');
  initializeServiceToday();
  if(args.resumeFullValidation){
    try{await preflightFullValidationResume();}
    catch(error){try{await db.end();}catch{}throw error;}
    resumePreflightPassed=true;
  }
  installOutputLog();
  if (args.planOnly || args.validateOnly) enforceSelectOnly(db);
  reservas=require('../services/Reservas/reservas.service');
  transfers=require('../services/Transfers/transfers.service');
  mercadeo=require('../services/Mercadeo/mercadeo.service');
  entityActivity=require('../services/EntidadesReportantes/entidades-mercadeo.service');
  comisiones=require('../services/Comisiones/comisiones.service');
  comisionGrupos=require('../services/Comisiones/comisiones-grupos.service');
  confirmacion=require('../services/Confirmacion/confirmacion.service');
  programacionNovedades=require('../services/Programacion/programacion-novedades.service');
  programacion=require('../services/Programacion/programacion.service');
  listadoGeneral=require('../services/Programacion/listado-general.service');
  seguros=require('../services/Seguros/seguros.service');
  if(args.resumeFullValidation){
    try{await resumeFullValidation();return;}finally{try{await db.end();}catch{}}
  }

  if(args.validateOnly){
    try{
      const result=await runValidateOnly();
      console.log(JSON.stringify(result,null,2));
      return;
    }finally{try{await db.end();}catch{}}
  }
  if(args.step){
    try{await runAdditionalStep(args.step);return;}finally{try{await db.end();}catch{}}
  }
  if(args.stage==='mid'&&args.planOnly){
    try{await planMidReadOnly();return;}finally{try{await db.end();}catch{}}
  }
  if(args.stage==='full'&&args.planOnly){
    try{await planFullReadOnly();return;}finally{try{await db.end();}catch{}}
  }
  if(args.stage==='mid')return await runMidStage();
  if(args.stage==='full')return await runFullStage();

  const pre=await timed('preflight:database',preflight);
  const inputs=await timed('read:catalogs',readLoadInputs);
  const rng=seedRandom(args.seed);
  const reservationSpecs=buildReservationSpecs(inputs,rng);
  const transferSpecs=buildTransferSpecs(inputs);
  const modifications=assignChanges(reservationSpecs,inputs,{edits:6,cancellations:3});
  for(const item of reservationSpecs){
    item.capacityPoolId=normalizeTourForCapacity(item.tourId);
    item.temporaryCreateDate=TEMP_DATE;
    item.serviceDateBeforeMove=item.updatedServiceDate||TEMP_DATE;
    item.originalDate=item.serviceDateBeforeMove;
    item.originalAvailabilityKey={Id_Tour:item.capacityPoolId,Fecha_Tour:item.serviceDateBeforeMove};
    item.finalAvailabilityKey={Id_Tour:item.capacityPoolId,Fecha_Tour:item.finalDate};
  }
  for (const spec of reservationSpecs) {
    await timed(`plan:buildReservationInput:${spec.sequence}`, () => createInputsForSpec(spec, inputs));
  }
  for (const spec of transferSpecs) spec.transferPlan = buildTransferPayload(spec, inputs);
  const actorPlan = assignPlannedActors(pre.actorIds, reservationSpecs, transferSpecs);
  const plan=validatePlan(inputs,reservationSpecs,transferSpecs);
  const inputCounts = validatePlannedInputs(inputs, reservationSpecs, transferSpecs, modifications);
  plan.capacityByPoolAndDate = await timed('plan:capacityByPoolAndDate', () => buildCapacityPlan(inputs, reservationSpecs));
  plan.operationSummary = groupSummary([
    ...reservationSpecs,
    ...transferSpecs.map(row => ({ ...row, kind: 'Transfer', tourId: 'TRANSFER' })),
  ], inputs, item => item.kind === 'Transfer'
    ? (item.finalDate < TODAY ? 'Completado' : 'Confirmado') : expectedReservationState(item));
  const silletero = buildSilleteroReadout(inputs);
  if (args.planOnly) {
    const after = await timed('plan:countSnapshotAfter', countSnapshot);
    const delta = compareCounts(pre.counts, after);
    const markersAfter = await timed('plan:markerScanAfter', assertNoTestMarker);
    if (delta.length || sumCounts(after) !== 10176 || after.length !== 78) {
      throw new Error(`--plan-only detectó un cambio en sir2: ${JSON.stringify({delta,tableCount:after.length,total:sumCounts(after)})}`);
    }
    if (markersAfter.length) throw new Error(`--plan-only detectó marcadores ZZ_TEST_ tras la planificación: ${JSON.stringify(markersAfter)}.`);
    console.log(JSON.stringify({
      status: 'PLAN_ONLY_OK', database: pre.identity.databaseName, today: pre.identity.today,
      runId: args.runId, marker: MARKER, readOnly: true,
      readOnlyGuard: 'Solo SELECT/SHOW/DESCRIBE/EXPLAIN; getConnection bloqueado.',
      inputs: inputCounts,
      operationSummary: plan.operationSummary,
      commissionDefaultsSummary: commissionSummary(reservationSpecs, inputs),
      edits: reservationSpecs.filter(row => row.modify).map(row => ({ sequence: row.sequence, type: row.modify,
        tour: inputs.tours.get(Number(row.tourId))?.Nombre_Tour, date: row.finalDate,
        updatedDate: row.updatedServiceDate || null, channel: inputs.channelMap.get(row.channelId)?.Nombre_Canal })),
      cancellations: reservationSpecs.filter(row => row.cancel).map(row => ({ sequence: row.sequence,
        tour: inputs.tours.get(Number(row.tourId))?.Nombre_Tour, date: row.finalDate,
        channel: inputs.channelMap.get(row.channelId)?.Nombre_Canal })),
      capacityByPoolAndDate: plan.capacityByPoolAndDate,
      actorSummary: actorSummary(actorPlan),
      silletero,
      countsBefore: { tables: pre.counts.length, total: sumCounts(pre.counts) },
      countsAfter: { tables: after.length, total: sumCounts(after), deltaByTable: delta },
      timingsMs: {
        preflight: TIMED.find(row => row.label === 'preflight:database')?.elapsedMs,
        catalogs: TIMED.find(row => row.label === 'read:catalogs')?.elapsedMs,
        buildAllReservationInputs: Number(TIMED.filter(row => row.label.startsWith('plan:buildReservationInput:'))
          .reduce((sum,row) => sum + row.elapsedMs, 0).toFixed(2)),
        capacity: TIMED.find(row => row.label === 'plan:capacityByPoolAndDate')?.elapsedMs,
        postPlanCountsAndMarkerScan: Number(TIMED.filter(row => ['plan:countSnapshotAfter','plan:markerScanAfter'].includes(row.label))
          .reduce((sum,row) => sum + row.elapsedMs, 0).toFixed(2)),
      },
    }, null, 2));
    await db.end();
    return;
  }
  await assertNoPreExistingRunData(args.runId);
  const metadata=await primaryKeyMetadata();
  const countsBefore=pre.counts;
  const beforeKeys=await timed('snapshot:primaryKeys',()=>capturePrimaryKeys(metadata));
  atomicJson(BASELINE_KEYS_PATH,beforeKeys);
  const baselineMaxIds={};
  for(const table of ['historial','detalle_historial']){
    const column=metadata[table]?.[0];
    const [[row]]=await db.query(`SELECT COALESCE(MAX(${quoteId(column)}),0) AS n FROM ${quoteId(table)}`);
    baselineMaxIds[table]=Number(row.n);
  }
  manifest={schemaVersion:1,database:'sir2',stage:'pilot',runId:args.runId,seed:args.seed,marker:MARKER,
    state:'PREFLIGHT_OK',createdAt:new Date().toISOString(),manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
    baselineKeysPath:BASELINE_KEYS_PATH,backup:pre.baseBackup,preflight:pre,countsBefore,countsTotalBefore:sumCounts(countsBefore),
    baselineMaxIds,actorIds:pre.actorIds,selectedTours:[...inputs.tours.values()].map(row=>({Id_Tour:Number(row.Id_Tour),Nombre_Tour:row.Nombre_Tour,Cupo_Base:Number(row.Cupo_Base)})),
    excludedTours:[{Id_Tour:6,Nombre_Tour:'SILLETERO',reason:'No tiene día/temporada futura operativa; la temporada disponible termina 2026-08-09 y no se usará un día inválido.'}],
    plan:{reservations:60,groupReservations:54,privateReservations:6,transfers:6,capacityPlan:plan,
      modifications,cancellations:reservationSpecs.filter(row=>row.cancel).map(row=>row.sequence),
      channelQuotas:{2:28,3:7,10:5,8:4,9:4,6:3,5:2,7:2,11:2,4:3},
      transferChannels:{2:1,3:1,10:1,8:1,11:1,4:1},reservationSpecs,transferSpecs,
      sharedCapacityCodeFinding:'normalizarTourParaCupos mapea tours 1 y 5 a pool 5; se encontró consulta de ocupación del servicio con h.Id_Tour=? exacto, por lo que el piloto reconcilia explícitamente ambos en SQL y mantiene el lote por debajo del aforo.'},
    operations:{reservations:[],transfers:[],pendingEvents:[],notifications:[]},controlledSql:{availabilityBefore:[],reservationHistoryBefore:[],privateReservationsBefore:[],transfersBefore:[],historyAfter:[],automaticStateHistoryAfter:[],transferRegisterAfter:[],poolTransactions:[],privateTransactions:[]},
    validations:[],pendingJob:null,timings:TIMED};
  await writeManifest();
  logLine('PILOT_START',{runId:args.runId,seed:args.seed,countsTotalBefore:manifest.countsTotalBefore,plan:{reservations:60,transfers:6}});
  try{
    // Work in explicit create -> move -> reconcile cycles for each normalized
    // pool. Private bookings move in the same cycle but do not consume seats.
    const groupSpecs=reservationSpecs.filter(row=>row.kind==='Grupal');
    const poolIds=[...new Set(groupSpecs.map(row=>row.capacityPoolId))].sort((a,b)=>a-b);
    const baselineAvailabilityKeys=beforeKeys.tables.disponibilidad||[];
    for(const pool of poolIds){
      const groupLot=groupSpecs.filter(row=>row.capacityPoolId===pool);
      const privateLot=reservationSpecs.filter(row=>row.kind==='Privada'&&row.capacityPoolId===pool);
      await setManifestState(`CREATING_RESERVATION_LOT_POOL_${pool}`,{groupCount:groupLot.length,privateCount:privateLot.length});
      for(const spec of [...groupLot,...privateLot]){
        const row=await timed(`service:reservationWrapper:${spec.sequence}`,()=>createReservation(spec,spec.createActorId,inputs));
        manifest.operations.reservations.push({Id_Reserva:spec.Id_Reserva,sequence:spec.sequence,tourId:spec.tourId,
          type:spec.kind,channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
          originalDate:spec.serviceDateBeforeMove,finalDate:spec.finalDate,serviceDateAtCreate:TEMP_DATE,registrationDate:spec.registrationDate,
          fechaRegistroBeforeBackdate:row.Fecha_Registro,
          registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,capacityPoolId:spec.capacityPoolId,
          originalAvailabilityKey:spec.originalAvailabilityKey,finalAvailabilityKey:spec.finalAvailabilityKey,
          consumesGroupCapacity:spec.kind==='Grupal',actorId:Number(row.Creado_Por),role:spec.role||null,modify:spec.modify||null,cancel:spec.cancel});
        await writeManifest();
      }
      for(const spec of groupLot.filter(row=>row.modify))await timed(`service:reservationUpdateWrapper:${spec.sequence}`,
        ()=>updateReservation(spec,spec.updateActorId,inputs));
      for(const spec of groupLot.filter(row=>row.cancel))await timed(`service:reservationCancelWrapper:${spec.sequence}`,
        ()=>cancelReservation(spec,spec.cancelActorId));
      for(const spec of [...groupLot,...privateLot]){
        const operation=manifest.operations.reservations.find(row=>row.Id_Reserva===spec.Id_Reserva);
        if(operation){operation.serviceDateBeforeMove=spec.serviceDateBeforeMove;operation.originalDate=spec.serviceDateBeforeMove;
          operation.originalAvailabilityKey=spec.originalAvailabilityKey;operation.serviceUpdate=spec.serviceUpdate||null;operation.serviceCancel=spec.serviceCancel||null;}
      }
      await writeManifest();
      await setManifestState(`MOVING_RESERVATION_LOT_POOL_${pool}`,{reservationIds:[...groupLot,...privateLot].map(row=>row.Id_Reserva)});
      if(groupLot.length){
        const rows=groupLot.map(row=>({Id_Reserva:row.Id_Reserva,kind:row.kind,finalDate:row.finalDate,
          registrationDateTime:row.registrationDateTime,serviceDateBeforeMove:row.serviceDateBeforeMove,modify:row.modify,cancel:row.cancel}));
        await setManifestState(`RECONCILING_RESERVATION_LOT_POOL_${pool}`,{reservationIds:groupLot.map(row=>row.Id_Reserva)});
        await timed(`control:reconcilePool:${pool}`,()=>reconcileReservationPool(pool,rows,baselineAvailabilityKeys));
      }
      if(privateLot.length){await setManifestState(`MOVING_PRIVATE_LOT_POOL_${pool}`,{reservationIds:privateLot.map(row=>row.Id_Reserva)});
        await timed(`control:movePrivate:${pool}`,()=>movePrivateReservations(privateLot));}
      logLine('RESERVATION_LOT_DONE',{pool,groupReservations:groupLot.map(row=>row.Id_Reserva),
        privateReservations:privateLot.map(row=>row.Id_Reserva)});
      console.log(`lote pool ${pool}: ${groupLot.length} grupales, ${privateLot.length} privadas; fechas movidas y disponibilidad reconciliada`);
    }
    await setManifestState('CREATING_TRANSFERS',{count:transferSpecs.length});
    for(const spec of transferSpecs){
      const row=await timed(`service:transferWrapper:${spec.sequence}`,()=>createTransfer(spec,spec.actorId,inputs));
      manifest.operations.transfers.push({Id_Transfer:spec.Id_Transfer,Codigo_Transfer:spec.Codigo_Transfer,
        channelId:spec.channelId,entityId:spec.entity?Number(spec.entity.Id_Entidad_Reportante):null,
        originalDate:spec.finalDate,finalDate:spec.finalDate,serviceDateAtCreate:spec.finalDate,registrationDate:spec.registrationDate,
        fechaRegistroBeforeBackdate:row.Fecha_Registro,
        registrationDateTime:spec.registrationDateTime,leadDays:spec.leadDays,estadoAtCreate:spec.serviceStateAtCreate,
        valor:spec.valor,actorId:spec.actorId});
      await writeManifest();
    }
    await setManifestState('BACKDATING_TRANSFERS',{count:transferSpecs.length});
    await timed('control:backdateTransfers:all',()=>backdateTransfers(transferSpecs));
    await setManifestState('SYNCING_PROGRAMMATION',{count:reservationSpecs.length});
    for(const spec of reservationSpecs)await timed(`service:syncProgramacionAfterMove:${spec.sequence}`,
      ()=>programacionNovedades.syncForReservationChange({reservationId:spec.Id_Reserva,fecha:spec.finalDate}));
    await setManifestState('NORMALIZING_RESERVATION_STATES');
    const reservationStates=await timed('service:normalizePastReservations',()=>reservas.actualizarEstadosReservasVencidas());
    manifest.stateNormalization=reservationStates;
    manifest.stateNormalizationHistoryRows=await timed('sql:backdateAutomaticStateHistory',()=>backdateAutomaticReservationStateHistory(reservationSpecs));
    await writeManifest();
    await setManifestState('CLOSING_COMMISSION_JOURNEY');
    await timed('service:closeCommissionJourney',()=>closeAgencyCommissionJourney(reservationSpecs,actorPlan.commissionJourneyActorId));

    // Baseline rows have no reservas/transfers. Capture IDs and count deltas
    // before the only pending-job invocation.
    let changeCapture=await captureChanges(metadata,beforeKeys,countsBefore);
    const missingEmail=await db.query('SELECT COUNT(*) AS n FROM email_outbox').then(result=>Number(result[0][0].n));
    if(missingEmail!==0)throw new Error(`email_outbox contiene ${missingEmail} filas antes del job; no se ejecutará pendientesJob.`);
    const pending=await runPendingJobOnce();
    manifest.pendingJob=pending;await writeManifest();

    await setManifestState('VALIDATING_PILOT');
    const capacityResults=await timed('validation:capacity',()=>validateCapacity(reservationSpecs));
    manifest.validations.push({name:'integridad de cupos y disponibilidad',ok:true,elapsedMs:TIMED.find(x=>x.label==='validation:capacity')?.elapsedMs,
      groups:capacityResults});await writeManifest();
    await timed('validation:foreignKeys',async()=>{
      const fresh=await capturePrimaryKeys(metadata);const diff=diffPrimaryKeys(beforeKeys,fresh);
      const result=await validateFks(diff,metadata);manifest.foreignKeyChecks=result;
      manifest.validations.push({name:'FKs y huérfanos de filas creadas',ok:true,checkedConstraints:result.length,orphanRows:0});await writeManifest();return result;
    });
    await timed('validation:codes',()=>validateUniqueCodes(reservationSpecs,transferSpecs));
    await timed('validation:commissions',()=>validateCommissionDefaults(reservationSpecs));
    await timed('validation:historyDates',()=>validateHistoryAndDates(reservationSpecs,transferSpecs));
    await timed('validation:serviceFilters',()=>validateServiceFilters(reservationSpecs,transferSpecs,inputs));

    const [[queueState]]=await db.query(`SELECT COUNT(*) AS total FROM email_outbox`);
    const [[payCounts]]=await db.query(`SELECT
      (SELECT COUNT(*) FROM pagos_reservas p WHERE p.Id_Reserva IN (?)) AS reservationPayments,
      (SELECT COUNT(*) FROM pagos_transfers p WHERE p.Id_Transfer IN (?)) AS transferPayments`,
      [reservationSpecs.map(row=>row.Id_Reserva),transferSpecs.map(row=>row.Id_Transfer)]);
    const [[statesChanged]]=await db.query(`SELECT
      (SELECT COUNT(*) FROM reservas r WHERE r.Id_Reserva IN (?) AND r.Estado NOT IN ('Confirmada','Completada','Cancelada')) AS unexpectedReservations,
      (SELECT COUNT(*) FROM transfers t WHERE t.Id_Transfer IN (?) AND t.Estado NOT IN ('Confirmado','Completado')) AS unexpectedTransfers`,
      [reservationSpecs.map(row=>row.Id_Reserva),transferSpecs.map(row=>row.Id_Transfer)]);
    if(Number(queueState.total)!==0)throw new Error(`email_outbox no quedó vacío: ${queueState.total}.`);
    if(Number(payCounts.reservationPayments)!==60||Number(payCounts.transferPayments)!==0)throw new Error(`Pagos inesperados: ${JSON.stringify(payCounts)}.`);
    if(Number(statesChanged.unexpectedReservations)!==0||Number(statesChanged.unexpectedTransfers)!==0)throw new Error(`Estados finales inesperados: ${JSON.stringify(statesChanged)}.`);
    manifest.finalChecks={emailOutbox:Number(queueState.total),reservationPayments:Number(payCounts.reservationPayments),transferPayments:Number(payCounts.transferPayments),
      unexpectedReservationStates:Number(statesChanged.unexpectedReservations),unexpectedTransferStates:Number(statesChanged.unexpectedTransfers)};
    manifest.estimates=estimates();
    await finalizeManifest(metadata,beforeKeys,countsBefore,'PILOT_DONE');
    logLine('PILOT_DONE',{manifestPath:MANIFEST_PATH,logPath:LOG_PATH,deltaByTable:manifest.deltaByTable,estimates:manifest.estimates});
    console.log(JSON.stringify({status:manifest.state,manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsBefore:manifest.countsTotalBefore,countsAfter:manifest.countsTotalAfter,deltaByTable:manifest.deltaByTable,
      reservationIds:manifest.operations.reservations.map(row=>row.Id_Reserva),transferIds:manifest.operations.transfers.map(row=>({Id_Transfer:row.Id_Transfer,Codigo_Transfer:row.Codigo_Transfer})),
      validations:manifest.validations, pendingJob:manifest.pendingJob, estimates:manifest.estimates},null,2));
  }catch(error){
    const failedDuring=manifest?.state||null;
    const jobStarted=['STARTED','DONE','TIMEOUT'].includes(String(manifest?.pendingJob?.state||''))
      ||failedDuring?.startsWith('PENDIENTES_JOB');
    const state=jobStarted?'PILOT_FAILED_AFTER_PENDING_JOB_NO_CLEANUP':'PILOT_FAILED_NO_CLEANUP';
    if(manifest)manifest.failedDuring=failedDuring;
    await finalizeManifest(metadata,beforeKeys,countsBefore,state,error);
    logLine('PILOT_STOPPED_NO_CLEANUP',{state,error:errorJson(error),manifestPath:MANIFEST_PATH});
    console.error(JSON.stringify({status:state,error:errorJson(error),manifestPath:MANIFEST_PATH,logPath:LOG_PATH,
      countsAfter:manifest.countsAfter,deltaByTable:manifest.deltaByTable},null,2));
    process.exitCode=1;
  }finally{
    try{await db.end();}catch{}
  }
}

run().catch(async error=>{
  const serialized=errorJson(error);const artifactManifestPath=args.validateOnly?path.resolve(args.manifestPath):MANIFEST_PATH;
  if(args.resumeFullValidation&&!resumePreflightPassed){
    console.error(JSON.stringify({status:'FULL_RESUME_PREFLIGHT_REJECTED_READ_ONLY',error:serialized,manifestPath:artifactManifestPath},null,2));
    process.exitCode=1;return;
  }
  const status=args.validateOnly?'VALIDATE_ONLY_FAILED_READ_ONLY':(manifest?.state||'PREFLIGHT_FAILED_NO_DB_WRITE');
  logLine('FATAL_NO_CLEANUP',{error:serialized,manifestPath:artifactManifestPath});
  if(manifest&&!args.validateOnly&&!args.planOnly){manifest.state='PREFLIGHT_FAILED_NO_DB_WRITE';manifest.error=serialized;await writeManifest();}
  console.error(JSON.stringify({status,error:serialized,manifestPath:artifactManifestPath,logPath:args.validateOnly?null:LOG_PATH},null,2));
  if(db){try{await db.end();}catch{}}
  process.exitCode=1;
});
