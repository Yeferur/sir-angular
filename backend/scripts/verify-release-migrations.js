// Clona una base local de pruebas, aplica dos veces las migraciones de release
// y elimina siempre la base temporal. Nunca acepta un destino de producción.
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { readMigrations } = require('./release-migrate-sir2');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });

function quote(value) { return `\`${value.replaceAll('`', '``')}\``; }

async function prepareObservedSir2State(conn, temporary) {
  const [[target]] = await conn.query('SELECT DATABASE() AS db');
  if (target.db !== temporary || !/^sir_release_test_[0-9a-f]{8}$/.test(temporary)) {
    throw new Error('Preparación rechazada: no es la copia temporal.');
  }
  // Sólo la copia temporal: reproducir las estructuras observadas en sir2.
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of [
    'pendientes_eventos', 'pendientes_operativos', 'reglas_pendientes',
    'permisos_cache_revision', 'programacion_transfers_snapshot',
    'programacion_transfers_listados', 'historial_cambios',
  ]) await conn.query(`DROP TABLE IF EXISTS ${quote(temporary)}.${quote(table)}`);
  await conn.query('SET FOREIGN_KEY_CHECKS=1');

  const historicalCodes = [
    'RESERVAS.CANCELAR', 'TRANSFERS.CANCELAR', 'NOTIFICACIONES.LEER',
    'PENDIENTES.LEER', 'PENDIENTES.GESTIONAR', 'PENDIENTES.AUDITAR',
    'RECORDATORIOS.LEER', 'RECORDATORIOS.CREAR',
    'RECORDATORIOS.ACTUALIZAR', 'RECORDATORIOS.ELIMINAR',
  ];
  for (const table of ['usuario_permisos', 'rol_permisos']) {
    await conn.query(`DELETE FROM ${quote(table)} WHERE Id_Permiso IN
      (SELECT Id_Permiso FROM permisos WHERE Codigo_Permiso IN (?))`, [historicalCodes]);
  }
  await conn.query('DELETE FROM permisos WHERE Codigo_Permiso IN (?)', [historicalCodes]);

  // La copia local contiene avisos nuevos; sir2 aún tiene el tipo histórico.
  await conn.query('DELETE FROM notificaciones');
  await conn.query('ALTER TABLE notificaciones DROP INDEX uq_notificaciones_usuario_deduplicacion');
  await conn.query('ALTER TABLE notificaciones DROP COLUMN Clave_Deduplicacion');
  await conn.query('ALTER TABLE notificaciones MODIFY COLUMN Entidad_Id BIGINT UNSIGNED NULL');

  await conn.query('DELETE FROM recordatorios');
  await conn.query('ALTER TABLE recordatorios DROP INDEX idx_recordatorios_usuario_estado');
  await conn.query('ALTER TABLE recordatorios DROP INDEX idx_recordatorios_trigger');
  for (const column of [
    'Enviar_Correo', 'Fecha_Actualizacion', 'Fecha_Creacion', 'Entidad_Id',
    'Entidad_Tipo', 'Suprimido_Hasta', 'Estado',
  ]) await conn.query(`ALTER TABLE recordatorios DROP COLUMN ${quote(column)}`);

  // En sir2 las tablas de email ya existen y sus enums aún no incluyen reminder.
  const [[emailCount]] = await conn.query('SELECT COUNT(*) AS n FROM email_outbox');
  if (emailCount.n !== 0) throw new Error('La base fuente de pruebas ya tiene correos; no se puede simular el estado anterior.');
  await conn.query("ALTER TABLE email_outbox MODIFY COLUMN Tipo ENUM('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL");
  await conn.query("ALTER TABLE email_outbox_dispatches MODIFY COLUMN Tipo ENUM('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL");
  const [insert] = await conn.query(`INSERT INTO email_outbox
    (Tipo, Destinatario, Payload, Dedupe_Key, Estado)
    VALUES ('schedule', 'release-test@example.invalid', JSON_OBJECT('test', true), 'release-sir2-sentinel', 'enviado')`);
  await conn.query(`INSERT INTO email_outbox_dispatches (Id_Email, Tipo)
    VALUES (?, 'schedule')`, [insert.insertId]);

  await conn.query(`INSERT INTO disponibilidad
    (Id_Tour, Fecha_Tour, Cupos_Totales, Cupos_Disponibles)
    VALUES (1, '2099-01-01', 10, 7)`);
  const [[user]] = await conn.query('SELECT Id_Usuario FROM usuarios ORDER BY Id_Usuario LIMIT 1');
  await conn.query(`INSERT INTO notificaciones
    (Id_Usuario, Tipo, Titulo, Mensaje, Entidad_Id)
    VALUES (?, 'TEST', 'Aviso de prueba', 'Estado previo a release', 1)`, [user.Id_Usuario]);
  return insert.insertId;
}

async function assertSchema(conn) {
  const [tables] = await conn.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const availability = tables.filter(row => row.TABLE_NAME.toLowerCase() === 'disponibilidad');
  if (availability.length !== 1 || availability[0].TABLE_NAME !== 'disponibilidad') {
    throw new Error('Debe existir exactamente una tabla disponibilidad en minúscula.');
  }
  const required = {
    historial: ['Id_Registro'],
    historial_cambios: ['Id_Cambio', 'Tabla', 'Id_Registro', 'Id_Usuario', 'Cambio_JSON', 'IP_Cliente', 'Fecha_Registro'],
    confirmaciones_jornada: ['Id_Confirmacion', 'Id_Tour', 'Fecha_Tour', 'Total_Pasajeros', 'Total_Viajaron', 'Total_No_Viajaron', 'Confirmada_En', 'Confirmada_Por'],
    disponibilidad: ['Id_Disponibilidad', 'Id_Tour', 'Fecha_Tour', 'Cupos_Totales', 'Cupos_Disponibles', 'Updated_At'],
    email_outbox: ['Id_Email', 'Tipo', 'Prioridad', 'Destinatario', 'Payload', 'Dedupe_Key', 'Estado', 'Intentos', 'Max_Intentos', 'Disponible_En', 'Expira_En', 'Bloqueado_En', 'Bloqueado_Por', 'Enviado_En', 'Fallido_En', 'Smtp_Message_Id', 'Ultimo_Error', 'Fecha_Creacion', 'Fecha_Actualizacion'],
    email_outbox_control: ['Id_Control', 'Pausado_Hasta', 'Motivo', 'Fecha_Actualizacion'],
    email_outbox_dispatches: ['Id_Despacho', 'Id_Email', 'Tipo', 'Reservado_En'],
    permisos_cache_revision: ['Tipo', 'Id_Entidad', 'Revision'],
    reglas_pendientes: ['Id_Regla', 'Codigo', 'Activa', 'Configuracion'],
    pendientes_operativos: ['Id_Pendiente', 'Id_Regla', 'Clave_Deduplicacion', 'Estado', 'Datos'],
    pendientes_eventos: ['Id_Evento', 'Id_Pendiente', 'Tipo'],
    notificaciones: ['Id_Notificacion', 'Id_Usuario', 'Entidad_Tipo', 'Entidad_Id', 'Datos', 'Clave_Deduplicacion', 'Leida', 'Fecha_Lectura', 'Fecha_Creacion'],
    recordatorios: ['Estado', 'Suprimido_Hasta', 'Entidad_Tipo', 'Entidad_Id', 'Fecha_Creacion', 'Fecha_Actualizacion', 'Enviar_Correo'],
    programacion_transfers_listados: ['Fecha_Operacion', 'Revision', 'Firma', 'Confirmado_En', 'Confirmado_Por'],
    programacion_transfers_snapshot: ['Fecha_Operacion', 'Revision_Listado', 'Id_Transfer', 'Datos_Snapshot'],
  };
  const [columns] = await conn.query(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`);
  const byTable = new Map();
  for (const row of columns) {
    if (!byTable.has(row.TABLE_NAME.toLowerCase())) byTable.set(row.TABLE_NAME.toLowerCase(), new Map());
    byTable.get(row.TABLE_NAME.toLowerCase()).set(row.COLUMN_NAME, row.COLUMN_TYPE);
  }
  for (const [table, names] of Object.entries(required)) {
    const actual = byTable.get(table);
    for (const name of names) {
      if (!actual?.has(name)) throw new Error(`Falta ${table}.${name}`);
    }
  }
  if (!/varchar|text/i.test(byTable.get('historial').get('Id_Registro'))) throw new Error('historial.Id_Registro no es texto');
  for (const table of ['email_outbox', 'email_outbox_dispatches']) {
    if (!byTable.get(table).get('Tipo').includes("'reminder'")) throw new Error(`${table}.Tipo no admite reminder`);
  }
  const [indexes] = await conn.query(`SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()`);
  const indexSet = new Set(indexes.map(row => `${row.TABLE_NAME.toLowerCase()}.${row.INDEX_NAME}`));
  for (const index of [
    'historial_cambios.idx_historial_cambios_registro',
    'historial_cambios.idx_historial_cambios_tabla',
    'historial_cambios.idx_historial_cambios_usuario',
    'confirmaciones_jornada.ux_confirmaciones_jornada_tour_fecha',
    'confirmaciones_jornada.idx_confirmaciones_jornada_fecha',
    'confirmaciones_jornada.idx_confirmaciones_jornada_usuario',
    'disponibilidad.ux_disponibilidad_tour_fecha',
    'email_outbox.ux_email_outbox_dedupe',
    'email_outbox.idx_email_outbox_dispatch',
    'email_outbox.idx_email_outbox_lock',
    'email_outbox_dispatches.idx_email_dispatches_quota',
    'email_outbox_dispatches.idx_email_dispatches_email',
    'notificaciones.uq_notificaciones_usuario_deduplicacion',
    'reglas_pendientes.uq_reglas_pendientes_codigo',
    'pendientes_operativos.uq_pendientes_clave',
    'recordatorios.idx_recordatorios_usuario_estado',
    'recordatorios.idx_recordatorios_trigger',
    'programacion_transfers_snapshot.idx_programacion_transfer_referencia',
  ]) if (!indexSet.has(index)) throw new Error(`Falta índice ${index}`);
  const [fks] = await conn.query(`SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='email_outbox_dispatches'`);
  if (!fks.some(row => row.CONSTRAINT_NAME === 'fk_email_dispatches_outbox')) throw new Error('Falta FK de email_outbox_dispatches');
  const codes = [
    'RESERVAS.CANCELAR', 'TRANSFERS.CANCELAR', 'NOTIFICACIONES.LEER',
    'PENDIENTES.LEER', 'PENDIENTES.GESTIONAR', 'PENDIENTES.AUDITAR',
    'RECORDATORIOS.LEER', 'RECORDATORIOS.CREAR',
    'RECORDATORIOS.ACTUALIZAR', 'RECORDATORIOS.ELIMINAR',
  ];
  const [permissions] = await conn.query('SELECT Codigo_Permiso FROM permisos WHERE Codigo_Permiso IN (?)', [codes]);
  if (permissions.length !== codes.length) throw new Error('Faltan permisos históricos de 20260911.');
  const [rules] = await conn.query(`SELECT Codigo FROM reglas_pendientes WHERE Codigo IN
    ('CONTROL_VIAJE_CIERRE_PENDIENTE', 'PROGRAMACION_CAMBIOS_OPERATIVOS')`);
  if (rules.length !== 2) throw new Error('Faltan reglas de Pendientes/Programación.');
  await conn.query(`SELECT p.Id_Pendiente FROM pendientes_operativos p
    JOIN reglas_pendientes r ON r.Id_Regla=p.Id_Regla LIMIT 1`);
  await conn.query('SELECT Id_Notificacion, Clave_Deduplicacion FROM notificaciones LIMIT 1');
}

async function assertBackendStarts(conn, database) {
  const [[user]] = await conn.query(`SELECT u.Id_Usuario FROM usuarios u
    JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE u.Activo=1 AND LOWER(TRIM(r.Nombre_Rol))='administrador'
    ORDER BY u.Id_Usuario LIMIT 1`);
  if (!user || !process.env.JWT_SECRET) throw new Error('Falta usuario administrador o JWT_SECRET en la base local de prueba.');
  const token = jwt.sign({ id: user.Id_Usuario }, process.env.JWT_SECRET, { expiresIn: '10m' });
  await conn.query(`INSERT INTO sesiones (Id_Usuario, Token, Fecha_Inicio, Fecha_Expira)
    VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 10 MINUTE))`, [user.Id_Usuario, token]);
  const port = 45000 + crypto.randomInt(10000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_NAME: database, DB_DATABASE: database,
      PORT: String(port), NODE_ENV: 'production', EMAIL_OUTBOX_ENABLED: 'false' },
    stdio: 'ignore',
  });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw new Error(`Backend terminó con código ${child.exitCode}`);
      const response = await new Promise(resolve => {
        const request = http.request({ host: '127.0.0.1', port, path: '/api/login', method: 'POST',
          headers: { 'Content-Type': 'application/json' }, timeout: 1000 }, res => {
          res.resume(); resolve(res.statusCode);
        });
        request.on('error', () => resolve(null));
        request.on('timeout', () => { request.destroy(); resolve(null); });
        request.end('{"username":"__release_healthcheck__","password":"invalid"}');
      });
      if (response) {
        if (response >= 500) throw new Error(`Backend respondió HTTP ${response}`);
        for (const route of ['/api/pendientes', '/api/notificaciones', '/api/recordatorios']) {
          const status = await new Promise((resolve, reject) => {
            const request = http.get({ host: '127.0.0.1', port, path: route,
              headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }, res => {
              res.resume(); resolve(res.statusCode);
            });
            request.on('error', reject);
            request.on('timeout', () => request.destroy(new Error(`Timeout ${route}`)));
          });
          if (status !== 200) throw new Error(`${route} respondió HTTP ${status}, se esperaba 200.`);
        }
        console.log('Backend iniciado sobre base temporal: Pendientes, Avisos y Recordatorios HTTP 200');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Backend no inició en el plazo esperado');
  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
    });
  }
}

async function main() {
  const env = process.env;
  const source = String(env.DB_NAME || env.DB_DATABASE || '');
  const host = String(env.DB_HOST || '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)
    || !/(^|_)test(_|$)/i.test(source)
    || /(^|_)(prod|production|operativa)(_|$)/i.test(source)
    || String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('Solo se permite una base MySQL local identificada como test.');
  }
  const temporary = `sir_release_test_${crypto.randomBytes(4).toString('hex')}`;
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS, database: source, multipleStatements: false,
  });
  let created = false;
  try {
    await conn.query(`CREATE DATABASE ${quote(temporary)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const [objects] = await conn.query(`SHOW FULL TABLES FROM ${quote(source)}`);
    const tables = objects.filter(row => Object.values(row)[1] === 'BASE TABLE').map(row => Object.values(row)[0]);
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query(`USE ${quote(temporary)}`);
    for (const table of tables) {
      const [[definition]] = await conn.query(`SHOW CREATE TABLE ${quote(source)}.${quote(table)}`);
      await conn.query(definition['Create Table']);
    }
    for (const table of tables) {
      const [columns] = await conn.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION`, [source, table]);
      const list = columns.map(row => quote(row.COLUMN_NAME)).join(',');
      await conn.query(`INSERT INTO ${quote(temporary)}.${quote(table)} (${list}) SELECT ${list} FROM ${quote(source)}.${quote(table)}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    const emailId = await prepareObservedSir2State(conn, temporary);
    const migrations = await readMigrations();
    const before = new Map();
    for (const table of tables) {
      if (['pendientes_eventos', 'pendientes_operativos', 'reglas_pendientes',
        'permisos_cache_revision', 'programacion_transfers_snapshot',
        'programacion_transfers_listados', 'historial_cambios',
        'permisos', 'rol_permisos', 'usuario_permisos', 'notificaciones',
      ].includes(table)) continue;
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`);
      before.set(table, row.n);
    }
    for (let pass = 1; pass <= 2; pass++) {
      for (const { name, statements } of migrations) {
        for (const [index, statement] of statements.entries()) {
          try { await conn.query(statement); }
          catch (error) { throw new Error(`${name}, sentencia ${index + 1}: ${error.code || error.message}`); }
        }
      }
      await assertSchema(conn);
      const [[availability]] = await conn.query(`SELECT Cupos_Totales, Cupos_Disponibles
        FROM disponibilidad WHERE Id_Tour=1 AND Fecha_Tour='2099-01-01'`);
      if (availability?.Cupos_Totales !== 10 || availability?.Cupos_Disponibles !== 7) {
        throw new Error('Los datos sintéticos de disponibilidad cambiaron.');
      }
      const [[email]] = await conn.query('SELECT Dedupe_Key, Tipo, Estado FROM email_outbox WHERE Id_Email=?', [emailId]);
      const [[dispatch]] = await conn.query('SELECT COUNT(*) AS n FROM email_outbox_dispatches WHERE Id_Email=?', [emailId]);
      if (email?.Dedupe_Key !== 'release-sir2-sentinel' || email?.Tipo !== 'schedule'
        || email?.Estado !== 'enviado' || dispatch.n !== 1) {
        throw new Error('Las filas existentes de email_outbox cambiaron.');
      }
      for (const [table, count] of before) {
        const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`);
        if (row.n !== count) throw new Error(`La migración cambió filas de ${table}`);
      }
      console.log(`PASS ${pass}: ${migrations.length} migraciones; sir2 sintético, esquema y datos conservados`);
    }
    await assertBackendStarts(conn, temporary);
  } finally {
    if (created) {
      await conn.query(`DROP DATABASE ${quote(temporary)}`);
      console.log('Base temporal eliminada');
    }
    await conn.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
