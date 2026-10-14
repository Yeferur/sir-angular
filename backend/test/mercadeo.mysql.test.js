const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const express = require('express');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { once } = require('node:events');
const { createCopy, connectionOptions } = require('../scripts/create-validation-copy');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');

test('MySQL local: endpoint Mercadeo cubre filtros, paginación, permiso y autoría', {
  skip: process.env.MERCADEO_MYSQL_TEST !== '1', timeout: 60000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assert.equal(process.env.DB_NAME || process.env.DB_DATABASE, 'sir2');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase()));
  assert.notEqual(String(process.env.NODE_ENV).toLowerCase(), 'production');
  const databaseName = `sir2_mercadeo_validation_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const removeSignalCleanup = installSignalCleanup(databaseName);
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET requerido para probar el endpoint autenticado');
  await createCopy(databaseName);
  const previousName = process.env.DB_NAME;
  const previousDatabase = process.env.DB_DATABASE;
  process.env.DB_NAME = databaseName;
  process.env.DB_DATABASE = databaseName;
  let connection;
  const tag = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const code = (suffix) => `MK${tag}${suffix}`;
  const codes = [];
  const users = [];
  const roles = [];
  let server;

  t.after(async () => {
    removeSignalCleanup();
    if (server?.listening) await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    try { if (connection) await connection.end(); }
    finally {
      await require('../database/db').end();
      if (process.env.SIR_KEEP_VALIDATION_DB !== '1') await dropGeneratedDatabase(databaseName);
      if (previousName === undefined) delete process.env.DB_NAME;
      else process.env.DB_NAME = previousName;
      if (previousDatabase === undefined) delete process.env.DB_DATABASE;
      else process.env.DB_DATABASE = previousDatabase;
    }
  });
  connection = await mysql.createConnection(connectionOptions(databaseName));

  const [categories] = await connection.query('SELECT Id_Canal FROM canales_reservas ORDER BY Id_Canal LIMIT 2');
  assert.ok(categories.length >= 1, 'se requiere al menos una categoría de reserva');
  const channelOne = categories[0].Id_Canal;
  const channelTwo = categories[1]?.Id_Canal ?? channelOne;
  const [[baseline]] = await connection.query(`
    SELECT (SELECT COUNT(*) FROM reservas) AS reservas,
           (SELECT COUNT(*) FROM pasajeros) AS pasajeros
  `);
  const [[permission]] = await connection.query('SELECT Id_Permiso FROM permisos WHERE Codigo_Permiso = ?', ['MERCADEO.RESERVAS.LEER']);
  assert.ok(permission, 'la migración debe crear el permiso granular');

  const [roleResult] = await connection.query('INSERT INTO roles (Nombre_Rol, Descripcion, Activo) VALUES (?, ?, 1)', [`Mercadeo test ${tag}`, 'Rol efímero de pruebas']);
  const allowedRoleId = roleResult.insertId;
  roles.push(allowedRoleId);
  const [deniedRoleResult] = await connection.query('INSERT INTO roles (Nombre_Rol, Descripcion, Activo) VALUES (?, ?, 1)', [`Mercadeo sin permiso ${tag}`, 'Rol efímero de pruebas']);
  const deniedRoleId = deniedRoleResult.insertId;
  roles.push(deniedRoleId);
  await connection.query('INSERT INTO rol_permisos (Id_Rol, Id_Permiso) VALUES (?, ?)', [allowedRoleId, permission.Id_Permiso]);

  const userBase = Number(`${Date.now()}`.slice(-9)) * 10000 + Math.floor(Math.random() * 10000);
  const allowedUserId = userBase + 1000000000000;
  const inactiveCreatorId = allowedUserId + 1;
  const deniedUserId = allowedUserId + 2;
  users.push(allowedUserId, inactiveCreatorId, deniedUserId);
  const insertUser = async (id, label, userRole, active) => {
    await connection.query(`INSERT INTO usuarios
      (Id_Usuario, Nombres_Apellidos, Usuario, Correo, Contrasena, Id_Rol, Activo)
      VALUES (?, ?, ?, ?, 'test-only-no-login', ?, ?)`,
    [id, `${label} ${tag}`, `mercadeo_${tag}_${id}`, `mercadeo_${tag}_${id}@example.invalid`, userRole, active]);
  };
  await insertUser(allowedUserId, 'Creador activo', allowedRoleId, 1);
  await insertUser(inactiveCreatorId, 'Creador inactivo', null, 0);
  await insertUser(deniedUserId, 'Usuario sin permiso', deniedRoleId, 1);

  const activeToken = jwt.sign({ id: allowedUserId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const deniedToken = jwt.sign({ id: deniedUserId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  for (const [id, token] of [[allowedUserId, activeToken], [deniedUserId, deniedToken]]) {
    await connection.query('INSERT INTO sesiones (Id_Usuario, Token, Fecha_Inicio, Fecha_Expira) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [id, token]);
  }

  const fixtures = [];
  const pushBooking = (suffix, channel, creatorId, passengerRows) => {
    const id = code(suffix);
    codes.push(id);
    fixtures.push({ id, channel, creatorId, passengerRows });
  };
  pushBooking('A', channelOne, allowedUserId, [
    [`MK${tag} Alpha One`, `DOC-${tag}-001`],
    [`MK${tag} Beta Two`, `DOC-${tag}-002`],
    [`MK${tag} Gamma Three`, null],
  ]);
  pushBooking('B', channelOne, inactiveCreatorId, [[`MK${tag} Inactive Creator`, `DOC-${tag}-010`]]);
  pushBooking('C', channelTwo, null, [[`MK${tag} No Creator`, `DOC-${tag}-011`]]);
  for (let index = 3; index < 28; index += 1) {
    pushBooking(String(index).padStart(2, '0'), index < 15 ? channelOne : channelTwo,
      index % 2 ? allowedUserId : null, [[`MK${tag} Passenger ${index}`, `DOC-${tag}-${String(index).padStart(3, '0')}`]]);
  }

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const day = String((index % 28) + 1).padStart(2, '0');
    await connection.query(`INSERT INTO reservas
      (Id_Reserva, Tipo_Reserva, Fecha_Tour, Fecha_Registro, Id_Canal, Nombre_Reportante,
       Telefono_Reportante, Estado, Creado_Por, Actualizado_Por)
      VALUES (?, 'Grupal', '2100-01-15', ?, ?, ?, '+573001112233', 'Pendiente', ?, ?)` ,
    [fixture.id, `2099-08-${day} 09:30:00`, fixture.channel, `Reporta ${tag}`, fixture.creatorId,
      fixture.creatorId && fixture.creatorId === allowedUserId ? fixture.creatorId : null]);
    for (const [name, document] of fixture.passengerRows) {
      await connection.query('INSERT INTO pasajeros (Id_Reserva, Nombre_Pasajero, DNI) VALUES (?, ?, ?)', [fixture.id, name, document]);
    }
  }

  const app = express();
  app.use('/api/mercadeo', require('../routes/Mercadeo/mercadeo.routes'));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/mercadeo`;
  async function get(pathname, token = activeToken) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  }
  const reservations = (body) => body.data;
  const exactCode = encodeURIComponent(fixtures[0].id);

  assert.equal((await get('/categorias')).status, 200);
  assert.equal((await get('/reservas', null)).status, 401);
  assert.equal((await get('/reservas', deniedToken)).status, 403, 'backend rechaza a quien no tiene permiso');

  const noFilters = reservations((await get('/reservas')).body);
  assert.equal(noFilters.pageSize, 25);
  assert.equal(noFilters.totalReservas, Number(baseline.reservas) + fixtures.length);
  assert.equal(noFilters.totalPasajeros, Number(baseline.pasajeros) + fixtures.reduce((sum, item) => sum + item.passengerRows.length, 0));
  assert.equal(noFilters.items.length, 25);

  const dateRange = reservations((await get('/reservas?fechaRegistroDesde=2099-08-01&fechaRegistroHasta=2099-08-28')).body);
  assert.equal(dateRange.totalReservas, fixtures.length);
  assert.equal(dateRange.totalPasajeros, fixtures.reduce((sum, item) => sum + item.passengerRows.length, 0));
  const tourDate = reservations((await get('/reservas?fechaTour=2100-01-15')).body);
  assert.equal(tourDate.totalReservas, fixtures.length);
  const exact = reservations((await get(`/reservas?codigoReserva=${exactCode}`)).body);
  assert.equal(exact.items.length, 1);
  assert.equal(exact.totalReservas, 1);
  assert.equal(exact.totalPasajeros, 3);
  assert.equal(exact.items[0].pasajeros.length, 3, 'tres pasajeros pertenecen a una sola reserva en la respuesta');
  assert.equal(exact.items[0].UsuarioCreador, `Creador activo ${tag}`);

  const byCategory = reservations((await get(`/reservas?fechaRegistroDesde=2099-08-01&fechaRegistroHasta=2099-08-28&categoria=${channelOne}`)).body);
  assert.equal(byCategory.totalReservas, fixtures.filter((item) => item.channel === channelOne).length);
  const byName = reservations((await get(`/reservas?nombrePasajero=${encodeURIComponent(`MK${tag} Alpha`)}`)).body);
  assert.equal(byName.totalReservas, 1);
  assert.equal(byName.totalPasajeros, 1);
  const byDocument = reservations((await get(`/reservas?documento=${encodeURIComponent(`DOC-${tag}-002`)}`)).body);
  assert.equal(byDocument.totalReservas, 1);
  assert.equal(byDocument.totalPasajeros, 1);
  const combined = reservations((await get(`/reservas?fechaRegistroDesde=2099-08-01&fechaRegistroHasta=2099-08-28&fechaTour=2100-01-15&codigoReserva=${exactCode}&categoria=${channelOne}&nombrePasajero=${encodeURIComponent(`MK${tag} Alpha`)}&documento=${encodeURIComponent(`DOC-${tag}-001`)}`)).body);
  assert.equal(combined.totalReservas, 1);
  assert.equal(combined.totalPasajeros, 1);
  const empty = reservations((await get('/reservas?codigoReserva=MK-NO-SUCH-BOOKING')).body);
  assert.equal(empty.totalReservas, 0);
  assert.equal(empty.totalPasajeros, 0);
  assert.deepEqual(empty.items, []);

  const noCreator = reservations((await get(`/reservas?codigoReserva=${encodeURIComponent(fixtures[2].id)}`)).body);
  assert.equal(noCreator.items[0].UsuarioCreador, null);
  const inactiveCreator = reservations((await get(`/reservas?codigoReserva=${encodeURIComponent(fixtures[1].id)}`)).body);
  assert.equal(inactiveCreator.items[0].UsuarioCreador, `Creador inactivo ${tag}`);

  const secondPage = reservations((await get('/reservas?page=2')).body);
  assert.equal(secondPage.page, 2);
  assert.ok(secondPage.items.some((item) => item.Id_Reserva === fixtures[0].id));
  assert.equal(secondPage.totalReservas, noFilters.totalReservas);
  const configuredLimit = reservations((await get('/reservas?pageSize=1000')).body);
  assert.equal(configuredLimit.pageSize, 100, 'backend limita pageSize a 100, UI envía el patrón actual de 25');
});
