const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ExcelJS = require('exceljs');

test('MySQL aislado: origen unificado, colaciones, filtros, paginación y soft delete', {
  skip: process.env.MERCADEO_UNIFIED_MYSQL_TEST !== '1', timeout: 60000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  const host = String(process.env.DB_HOST || '127.0.0.1').toLowerCase();
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'la conexión de prueba debe ser local');

  // Conexión de servidor sin esquema por defecto. Este test jamás copia, selecciona,
  // consulta ni modifica sir2: crea un esquema vacío de nombre aleatorio y lo usa.
  const server = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS,
    multipleStatements: false,
  });
  const [[initialDatabase]] = await server.query('SELECT DATABASE() AS selectedDatabase');
  assert.equal(initialDatabase.selectedDatabase, null, 'no debe haber una base seleccionada al preparar la prueba');
  const databaseName = `mkt2_phase2_${randomBytes(9).toString('hex')}`;
  assert.match(databaseName, /^mkt2_phase2_[a-f0-9]+$/);
  await server.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
  const oldName = process.env.DB_NAME;
  const oldDatabase = process.env.DB_DATABASE;
  process.env.DB_NAME = databaseName;
  process.env.DB_DATABASE = databaseName;
  let db;
  let suite;
  t.after(async () => {
    if (db) await db.end();
    await server.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await server.end();
    if (oldName === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = oldName;
    if (oldDatabase === undefined) delete process.env.DB_DATABASE; else process.env.DB_DATABASE = oldDatabase;
  });

  db = require('../database/db');
  const [[target]] = await db.query('SELECT DATABASE() AS selectedDatabase');
  assert.equal(target.selectedDatabase, databaseName);

  await db.query(`CREATE TABLE canales_origen (
    Id_Canal INT NOT NULL PRIMARY KEY,
    Nombre_Canal VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE entidades_reportantes (
    Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    Nombre VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    Tipo VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE usuarios (
    Id_Usuario BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    Nombres_Apellidos VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE reservas (
    Id_Reserva VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL PRIMARY KEY,
    Fecha_Registro DATETIME NOT NULL,
    Fecha_Tour DATE NULL,
    Id_Canal INT NULL,
    Id_Entidad_Reportante BIGINT UNSIGNED NULL,
    Nombre_Reportante VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
    Telefono_Reportante VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    Creado_Por BIGINT UNSIGNED NULL,
    Estado VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    Eliminada_En DATETIME NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE pasajeros (
    Id_Pasajero BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Id_Reserva VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
    Nombre_Pasajero VARCHAR(100) NULL
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE transfers (
    Id_Transfer BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    Fecha_Registro DATETIME NOT NULL,
    Fecha_Transfer DATE NULL,
    Estado VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
    Nombre_Titular VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    Cantidad_Personas INT NOT NULL,
    Id_Canal INT NULL,
    Id_Entidad_Reportante BIGINT UNSIGNED NULL,
    Nombre_Reportante VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
    Telefono_Reportante VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
    Creado_Por BIGINT UNSIGNED NULL
  ) ENGINE=InnoDB`);

  await db.query(`INSERT INTO canales_origen VALUES
    (1,'Canál HOTEL'),(2,'Agencia Nacional'),(3,'Venta directa')`);
  await db.query(`INSERT INTO entidades_reportantes VALUES
    (11,'Hotel Prueba Álamo','HOTEL'),(12,'Agencia Norte','AGENCIA_NACIONAL')`);
  await db.query(`INSERT INTO usuarios VALUES (101,'Creador Uno'),(202,'Creadora Dos')`);
  const reservations = [
    ['MKT2-Á-01','2026-01-01 09:00:00','2026-07-10',1,11,'Reportante HOTEL',101,'Pendiente',null,2],
    ['MKT2-02','2026-01-02 09:00:00','2026-07-11',2,12,'Reportante agencia',202,'Pendiente',null,1],
    ['MKT2-03','2026-02-01 09:00:00','2026-07-12',1,11,'Contacto hotel',101,'Pendiente',null,3],
    ['MKT2-DEL','2026-02-03 09:00:00','2026-07-12',2,12,'Eliminada',202,'Pendiente','2026-02-04 09:00:00',9],
  ];
  for (const [id, registered, serviceDate, channel, entity, reporter, creator, state, deleted, passengerCount] of reservations) {
    await db.query(`INSERT INTO reservas
      (Id_Reserva,Fecha_Registro,Fecha_Tour,Id_Canal,Id_Entidad_Reportante,Nombre_Reportante,Creado_Por,Estado,Eliminada_En)
      VALUES (?,?,?,?,?,?,?,?,?)`, [id, registered, serviceDate, channel, entity, reporter, creator, state, deleted]);
    for (let i = 0; i < passengerCount; i += 1) {
      await db.query('INSERT INTO pasajeros (Id_Reserva,Nombre_Pasajero) VALUES (?,?)', [id, `Pasajero ${id} ${i}`]);
    }
  }
  await db.query(`INSERT INTO transfers
    (Id_Transfer,Fecha_Registro,Fecha_Transfer,Estado,Nombre_Titular,Cantidad_Personas,Id_Canal,Id_Entidad_Reportante,Nombre_Reportante,Creado_Por)
    VALUES
    (41,'2026-01-03 08:00:00','2026-07-13','Pendiente','Titular uno',4,2,12,'Contacto transferencia',101),
    (42,'2026-03-02 08:00:00','2026-07-14','Confirmada','Titular dos',5,3,NULL,'Contacto directo',202)`);

  await require('../services/schema-capabilities').initializeSchemaCapabilities(db);
  const mercadeo = require('../services/Mercadeo/mercadeo.service');
  const [collations] = await db.query(`SELECT COLLATION(ops.tipo) AS tipo,
    COLLATION(ops.id_operacion) AS id_operacion, COLLATION(ops.id_reserva) AS id_reserva,
    COLLATION(ops.canal) AS canal, COLLATION(ops.entidad) AS entidad,
    COLLATION(ops.nombre_reportante) AS nombre_reportante
    FROM (${mercadeo.origenUnionSql()}) ops LIMIT 1`);
  for (const value of Object.values(collations[0])) assert.equal(value, 'utf8mb4_unicode_ci');

  const originalQuery = db.query.bind(db);
  const calls = [];
  db.query = (sql, params) => {
    calls.push({ sql: String(sql), params: params || [] });
    return originalQuery(sql, params);
  };
  suite = mercadeo;
  try {
    const pageOne = await suite.buscarOrigenReservas({ page: 1, pageSize: 2 });
    assert.equal(pageOne.totalOperaciones, 5, 'no incluye la reserva eliminada');
    assert.equal(pageOne.totalPages, 3);
    assert.equal(pageOne.items.length, 2);
    assert.deepEqual(pageOne.items.map(item => `${item.tipo}:${item.id_operacion}`), ['TRANSFER:42', 'RESERVA:MKT2-03']);
    assert.equal(pageOne.totalPasajeros, 8, `solo cuenta pasajeros de las reservas visibles en la página: ${JSON.stringify(pageOne.items)}`);
    assert.equal(pageOne.items[0].pasajeros, 5);
    assert.equal(pageOne.items[1].pasajeros, 3);
    const passengerQuery = calls.find(call => /FROM pasajeros WHERE Id_Reserva IN/.test(call.sql));
    assert.ok(passengerQuery);
    assert.deepEqual(passengerQuery.params, ['MKT2-03'], 'no consulta pasajeros de reservas fuera de esta página');
    assert.ok(calls.some(call => /ORDER BY ops\.fecha_registro DESC[\s\S]*LIMIT \? OFFSET \?/.test(call.sql)),
      'la paginación SQL ocurre en el listado antes de consultar pasajeros');

    const pageTwo = await suite.buscarOrigenReservas({ page: 2, pageSize: 2 });
    assert.deepEqual(pageTwo.items.map(item => `${item.tipo}:${item.id_operacion}`), ['TRANSFER:41', 'RESERVA:MKT2-02']);
    assert.equal(pageTwo.totalPasajeros, 5);
    const pageThree = await suite.buscarOrigenReservas({ page: 3, pageSize: 2 });
    assert.deepEqual(pageThree.items.map(item => item.id_reserva), ['MKT2-Á-01']);
    assert.equal(pageThree.totalPasajeros, 2);

    const all = await suite.buscarOrigenReservas({ tipo: 'TODOS', pageSize: 100 });
    const reservationsOnly = await suite.buscarOrigenReservas({ tipo: 'RESERVA', pageSize: 100 });
    const transfersOnly = await suite.buscarOrigenReservas({ tipo: 'TRANSFER', pageSize: 100 });
    assert.equal(all.totalOperaciones, 5);
    assert.equal(reservationsOnly.totalOperaciones, 3);
    assert.ok(reservationsOnly.items.every(item => item.tipo === 'RESERVA'));
    assert.equal(transfersOnly.totalOperaciones, 2);
    assert.ok(transfersOnly.items.every(item => item.tipo === 'TRANSFER'));

    const byChannel = await suite.buscarOrigenReservas({ categoria: '2', pageSize: 100 });
    assert.equal(byChannel.totalOperaciones, 2, 'canal filtra reservas y transfers sin contar la eliminada');
    const byCreator = await suite.buscarOrigenReservas({ creadorIds: '202', pageSize: 100 });
    assert.equal(byCreator.totalOperaciones, 2);
    const byPeriod = await suite.buscarOrigenReservas({ fechaRegistroDesde: '2026-02-01', fechaRegistroHasta: '2026-02-28', pageSize: 100 });
    assert.equal(byPeriod.totalOperaciones, 1, 'el período de creación aplica a ambas ramas y excluye la eliminada');
    assert.equal(byPeriod.items[0].id_reserva, 'MKT2-03');
    assert.equal(byPeriod.totalPasajeros, 3);

    const output = new PassThrough();
    const chunks = [];
    output.on('data', chunk => chunks.push(chunk));
    await suite.streamOrigenExcel({ tipo: 'TRANSFER', categoria: '2' }, output);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks));
    const sheet = workbook.getWorksheet('Origen de reservas');
    assert.equal(sheet.rowCount, 2, 'la exportación aplica los filtros y contiene encabezado más una operación');
    assert.equal(sheet.getRow(2).getCell(1).value, 'TRANSFER');
    assert.equal(sheet.getRow(2).getCell(2).value, '41');
  } finally {
    db.query = originalQuery;
  }
});
