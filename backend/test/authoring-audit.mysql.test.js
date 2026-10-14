const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { createCopy, connectionOptions } = require('../scripts/create-validation-copy');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');
const { parseMigrationSql } = require('../scripts/release-migrate-sir2');

test('MySQL local: migración final, autoría directa y snapshots de auditoría', {
  skip: process.env.AUTHORING_AUDIT_MYSQL_TEST !== '1', timeout: 180000,
}, async (t) => {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assert.equal(process.env.DB_NAME || process.env.DB_DATABASE, 'sir2');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase()));

  const database = `sir2_authoring_validation_${randomBytes(10).toString('hex')}`;
  const stopCleanup = installSignalCleanup(database);
  await createCopy(database);
  const oldName = process.env.DB_NAME, oldDatabase = process.env.DB_DATABASE;
  process.env.DB_NAME = database;
  process.env.DB_DATABASE = database;
  let connection;
  let db;
  t.after(async () => {
    stopCleanup();
    if (connection) await connection.end();
    if (db) await db.end();
    delete require.cache[require.resolve('../database/db')];
    if (process.env.SIR_KEEP_VALIDATION_DB !== '1') await dropGeneratedDatabase(database);
    process.env.DB_NAME = oldName;
    process.env.DB_DATABASE = oldDatabase;
  });

  connection = await mysql.createConnection(connectionOptions(database));
  const migrationPath = path.join(__dirname, '..', 'database', 'migrations',
    '20261013_0014_final_authoring_audit_schema.sql');
  const migrationSql = await fs.readFile(migrationPath, 'utf8');
  const statements = parseMigrationSql(migrationSql);
  for (const statement of statements) await connection.query(statement);
  for (const statement of statements) await connection.query(statement);
  const [[historicalActors]] = await connection.query(`SELECT COUNT(*) AS total,
      SUM(h.Actor_Nombre IS NOT NULL AND (r.Id_Rol IS NULL OR h.Actor_Rol IS NOT NULL)) AS backfilled
    FROM historial h JOIN usuarios u ON u.Id_Usuario=h.Id_Usuario
    LEFT JOIN roles r ON r.Id_Rol=u.Id_Rol`);
  assert.ok(Number(historicalActors.total) > 0, 'la copia debe incluir eventos anteriores con actor resoluble');
  assert.equal(Number(historicalActors.backfilled), Number(historicalActors.total));

  const [columns] = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME IN ('tours','puntos','liquidaciones')
      AND COLUMN_NAME IN ('Creado_Por','Actualizado_Por')) OR (TABLE_NAME='programaciones' AND COLUMN_NAME='Creado_Por')
      OR (TABLE_NAME='historial' AND COLUMN_NAME IN ('Actor_Nombre','Actor_Rol')))`);
  const columnSet = new Set(columns.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  for (const expected of [
    'tours.Creado_Por','tours.Actualizado_Por','puntos.Creado_Por','puntos.Actualizado_Por',
    'liquidaciones.Creado_Por','liquidaciones.Actualizado_Por','programaciones.Creado_Por',
    'historial.Actor_Nombre','historial.Actor_Rol',
  ]) assert.ok(columnSet.has(expected), `falta ${expected}`);

  const [[actor]] = await connection.query(`SELECT u.Id_Usuario,u.Nombres_Apellidos,r.Nombre_Rol
    FROM usuarios u LEFT JOIN roles r ON r.Id_Rol=u.Id_Rol ORDER BY u.Id_Usuario LIMIT 1`);
  assert.ok(actor);
  db = require('../database/db');
  await require('../services/schema-capabilities').initializeSchemaCapabilities(db);
  const tours = require('../services/Tours/tours.service');
  const points = require('../services/Puntos/puntos.service');
  const insurance = require('../services/Seguros/seguros.service');
  const programacion = require('../services/Programacion/programacion.service');
  const suffix = randomBytes(4).toString('hex');

  const createdTour = await tours.crearTour({
    Nombre_Tour: `Audit ${suffix}`,
    Abreviacion: `A${suffix.slice(0, 6)}`,
    Cupo_Base: 20,
    Planes: [{ Nombre_Plan: 'Base', Monedas: [] }],
  }, actor.Id_Usuario);
  await tours.actualizarTour(createdTour.Id_Tour, {
    Nombre_Tour: `Audit ${suffix} editado`, Abreviacion: `B${suffix.slice(0, 6)}`, Cupo_Base: 21,
  }, actor.Id_Usuario);
  const [[tourAuthors]] = await connection.query('SELECT Creado_Por,Actualizado_Por FROM tours WHERE Id_Tour=?', [createdTour.Id_Tour]);
  assert.equal(Number(tourAuthors.Creado_Por), Number(actor.Id_Usuario));
  assert.equal(Number(tourAuthors.Actualizado_Por), Number(actor.Id_Usuario));

  const createdPoint = await points.crearPunto({
    Nombre_Punto: `Audit point ${suffix}`, Sector: 'Audit', Direccion: `Audit ${suffix}`,
    ruta: `AUDIT_${suffix}`, horarios: [{ Id_Tour: createdTour.Id_Tour, Hora_Salida: '08:00' }],
  }, actor.Id_Usuario);
  const [[pointAuthors]] = await connection.query('SELECT Creado_Por,Actualizado_Por FROM puntos WHERE Id_Punto=?', [createdPoint.insertId]);
  assert.equal(Number(pointAuthors.Creado_Por), Number(actor.Id_Usuario));
  await points.actualizarPunto(createdPoint.insertId, {
    Nombre_Punto: `Audit point ${suffix}`, Sector: 'Audit editado', Direccion: `Audit ${suffix}`,
    ruta: `AUDIT_${suffix}`, horarios: [{ Id_Tour: createdTour.Id_Tour, Hora_Salida: '09:15' }],
  }, actor.Id_Usuario);
  const [[pointUpdated]] = await connection.query('SELECT Actualizado_Por FROM puntos WHERE Id_Punto=?', [createdPoint.insertId]);
  assert.equal(Number(pointUpdated.Actualizado_Por), Number(actor.Id_Usuario));
  const [[schedule]] = await connection.query('SELECT Id_Horario FROM horarios WHERE Id_Punto=? AND Id_Tour=? ORDER BY Id_Horario DESC LIMIT 1',
    [createdPoint.insertId, createdTour.Id_Tour]);
  assert.ok(schedule);
  const [scheduleEvents] = await connection.query(`SELECT h.Id_Usuario,h.Actor_Nombre,h.Actor_Rol,
      d.Columna,d.Valor_Anterior,d.Valor_Nuevo
    FROM historial h JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
    WHERE h.Tabla='horarios' AND h.Id_Registro=? AND h.Accion='ACTUALIZAR_HORARIO_PUNTO'`, [String(schedule.Id_Horario)]);
  assert.ok(scheduleEvents.length >= 1);
  assert.ok(scheduleEvents.every(row => Number(row.Id_Usuario) === Number(actor.Id_Usuario)));
  assert.ok(scheduleEvents.every(row => row.Actor_Nombre && row.Actor_Rol));
  assert.ok(scheduleEvents.some(row => row.Columna === 'Hora_Salida' && row.Valor_Anterior === '08:00' && row.Valor_Nuevo === '09:15'));
  assert.ok(scheduleEvents.some(row => row.Columna === 'Id_Punto' && Number(row.Valor_Anterior) === Number(createdPoint.insertId)));

  const programacionId = await programacion.insertarCabeceraProgramacion(connection, {
    fecha: '2031-01-02', tourId: createdTour.Id_Tour, userId: actor.Id_Usuario, tipo: 'grupal',
  });
  const [[programacionAuthors]] = await connection.query('SELECT Confirmado_Por,Creado_Por FROM programaciones WHERE Id_Programacion=?', [programacionId]);
  assert.equal(Number(programacionAuthors.Confirmado_Por), Number(actor.Id_Usuario));
  assert.equal(Number(programacionAuthors.Creado_Por), Number(actor.Id_Usuario));
  const [busInsert] = await connection.query(`INSERT INTO programacion_buses
    (Id_Programacion,Placa_Display,Orden_Bus) VALUES (?, 'BUS-AUDIT', 1)`, [programacionId]);
  await insurance.actualizarPersonalBus(busInsert.insertId, {
    Guia: 'Guia auditoria', DNI_Guia: 'AUDIT-G1', Conductor: 'Conductor auditoria', DNI_Conductor: 'AUDIT-C1',
  }, actor.Id_Usuario);
  const [insuranceEvents] = await connection.query(`SELECT h.Id_Usuario,d.Columna,d.Valor_Anterior,d.Valor_Nuevo
    FROM historial h JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
    WHERE h.Tabla='programacion_buses' AND h.Id_Registro=? AND h.Accion='ACTUALIZAR_ASIGNACION_SEGUROS'`,
    [String(busInsert.insertId)]);
  assert.ok(insuranceEvents.length >= 4);
  assert.ok(insuranceEvents.every(row => Number(row.Id_Usuario) === Number(actor.Id_Usuario)));

  const [tourEvents] = await connection.query(`SELECT Accion,Actor_Nombre,Actor_Rol FROM historial
    WHERE Tabla='tours' AND Id_Registro=?`, [String(createdTour.Id_Tour)]);
  assert.ok(tourEvents.some(row => row.Accion === 'CREAR_TOUR'));
  assert.ok(tourEvents.some(row => row.Accion === 'ACTUALIZAR_TOUR'));
  assert.ok(tourEvents.every(row => row.Actor_Nombre && row.Actor_Rol));
});
