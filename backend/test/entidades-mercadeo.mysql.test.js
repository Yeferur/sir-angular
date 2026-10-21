const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { createCopy, connectionOptions } = require('../scripts/create-validation-copy');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');
const { parseMigrationSql } = require('../scripts/release-migrate-sir2');

test('MySQL local: entidades reportantes y actividad de Mercadeo', {
  skip: process.env.ENTIDADES_MYSQL_TEST !== '1', timeout: 180000,
}, async (t) => {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assert.equal(process.env.DB_NAME || process.env.DB_DATABASE, 'sir2');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase()));
  assert.notEqual(process.env.SIR_KEEP_VALIDATION_DB, '1', 'La copia temporal se debe eliminar al terminar.');
  const database = `sir2_mercadeo_validation_${randomBytes(10).toString('hex')}`;
  const stopCleanup = installSignalCleanup(database);
  await createCopy(database);
  const oldName = process.env.DB_NAME, oldDatabase = process.env.DB_DATABASE;
  process.env.DB_NAME = database; process.env.DB_DATABASE = database;
  let connection;
  t.after(async () => {
    stopCleanup();
    if (connection) await connection.end();
    await require('../database/db').end();
    if (process.env.SIR_KEEP_VALIDATION_DB !== '1') await dropGeneratedDatabase(database);
    process.env.DB_NAME = oldName; process.env.DB_DATABASE = oldDatabase;
  });
  connection = await mysql.createConnection(connectionOptions(database));
  const [[directTarget]] = await connection.query('SELECT DATABASE() AS selected_database');
  assert.equal(directTarget.selected_database, database);
  const [columns] = await connection.query(`SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='entidades_reportantes' AND COLUMN_NAME='Nombre_Normalizado'`);
  if (!columns.length) {
    const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations',
      '20261013_0013_entidades_mercadeo.sql'), 'utf8');
    for (const statement of parseMigrationSql(sql)) await connection.query(statement);
  }
  const db = require('../database/db');
  const [[poolTarget]] = await db.query('SELECT DATABASE() AS selected_database');
  assert.equal(poolTarget.selected_database, database);
  const entities = require('../services/EntidadesReportantes/entidades-reportantes.service');
  const marketing = require('../services/EntidadesReportantes/entidades-mercadeo.service');
  const reservations = require('../services/Reservas/reservas.service');
  const transfers = require('../services/Transfers/transfers.service');
  await require('../services/schema-capabilities').initializeSchemaCapabilities(db);
  const [[actor]] = await connection.query(`SELECT u.Id_Usuario FROM usuarios u JOIN roles r ON r.Id_Rol=u.Id_Rol
    WHERE LOWER(TRIM(r.Nombre_Rol))='administrador' LIMIT 1`);
  const [channels] = await connection.query('SELECT Id_Canal,Nombre_Canal FROM canales_reservas');
  const [points] = await connection.query('SELECT Id_Punto FROM puntos WHERE Activo=1 ORDER BY Id_Punto LIMIT 2');
  const [[currency]] = await connection.query('SELECT Id_Moneda FROM monedas LIMIT 1');
  assert.ok(actor && currency && points.length === 2);
  const channel = name => channels.find(c => c.Nombre_Canal === name).Id_Canal;
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  const from = '2027-07-01', to = '2027-07-31';
  const f = { desde: from, hasta: to };
  const tag = randomBytes(5).toString('hex');
  const hotelName = `Hotel Poblado Boutique ${tag}`;
  const agencyName = `Viajes Bogotá ${tag}`;
  const agencyUpdatedName = `Viajes Bogotá SAS ${tag}`;
  const internationalName = `São Paulo Travel rápida ${tag}`;
  const adminInternationalName = `São Paulo Travel ${tag}`;
  const transferOnlyName = `Hotel solo transfers ${tag}`;
  const [tour] = await connection.query(`INSERT INTO tours (Nombre_Tour,Abreviacion,Cupo_Base,Activo)
    VALUES ('Validación actividad de entidades','ENT',30,1)`);
  const [schedule] = await connection.query(`INSERT INTO horarios (Id_Punto,Id_Tour,Hora_Salida)
    VALUES (?,?,'08:00')`, [points[0].Id_Punto, tour.insertId]);
  const payload = (channelId, entityId, contact, pointId) => ({
    cabeceraReserva: { Id_Tour: tour.insertId, Id_Horario: schedule.insertId,
      Fecha_Tour: '2027-07-15', Tipo_Reserva: 'Grupal', Id_Moneda: currency.Id_Moneda,
      Id_Canal: channelId, Id_Entidad_Reportante: entityId,
      Nombre_Reportante: contact, Telefono_Reportante: '+573001234567' },
    pasajeros: [{ Nombre_Pasajero: 'Pasajero prueba', Tipo_Pasajero: 'ADULTO',
      Id_Punto: pointId, Telefono_Pasajero: '+573001234567', Precio_Tour: 100, Precio_Pasajero: 100 }],
    pagos: [{ Tipo: 'Pago Directo', Monto: 100 }],
  });

  const hotel = (await entities.quickCreate({ channelId: channel('HOTEL'),
    name: hotelName, actorId: actor.Id_Usuario })).entity;
  await check('duplicado normalizado', async () => {
    const duplicate = await entities.quickCreate({ channelId: channel('HOTEL'),
      name: `  HÓTEL  POBLADO - BOUTIQUE  ${tag}  `, actorId: actor.Id_Usuario });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.entity.Id_Entidad_Reportante, hotel.Id_Entidad_Reportante);
    assert.equal(duplicate.entity.Nombre, hotelName);
  });
  await check('búsqueda normalizada', async () => {
    const found = await entities.listEntities({ type: 'HOTEL', search: 'hótel poblado' });
    assert.ok(found.some(x => x.Id_Entidad_Reportante === hotel.Id_Entidad_Reportante));
  });
  const agency = (await entities.quickCreate({ channelId: channel('AGENCIA NACIONAL'),
    name: agencyName, actorId: actor.Id_Usuario })).entity;
  const international = (await entities.quickCreate({ channelId: channel('AGENCIA INTERNACIONAL'),
    name: internationalName, actorId: actor.Id_Usuario })).entity;
  await check('creación rápida deriva el tipo de cada canal', async () => {
    assert.equal(hotel.Tipo, 'HOTEL');
    assert.equal(agency.Tipo, 'AGENCIA_NACIONAL');
    assert.equal(international.Tipo, 'AGENCIA_INTERNACIONAL');
  });
  await check('tipo por categoría', async () => {
    await assert.rejects(entities.validateReservationEntity(db, channel('HOTEL'), agency.Id_Entidad_Reportante),
      e => e.errorCode === 'ENTITY_CHANNEL_MISMATCH');
    await assert.rejects(entities.validateReservationEntity(db, channel('AGENCIA NACIONAL'), null),
      e => e.errorCode === 'ENTITY_REQUIRED');
  });
  let neverReportedEntity;
  await check('creación administrativa', async () => {
    const created = await marketing.createEntity({ Tipo: 'AGENCIA_INTERNACIONAL', Nombre: adminInternationalName }, actor.Id_Usuario);
    neverReportedEntity = created.entity;
    assert.equal(created.entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
    assert.equal(created.entity.Nombre, adminInternationalName);
  });
  await entities.validateEntity(neverReportedEntity.Id_Entidad_Reportante, 'VALIDADA', actor.Id_Usuario);
  const { DIAS_SIN_REPORTAR_ALERTA } = require('../config/entidades-reportantes');
  await connection.query(`UPDATE entidades_reportantes
    SET Validado_En=DATE_SUB(CURRENT_DATE, INTERVAL ? DAY) WHERE Id_Entidad_Reportante=?`,
  [DIAS_SIN_REPORTAR_ALERTA + 30, neverReportedEntity.Id_Entidad_Reportante]);
  await check('edición y estado independientes', async () => {
    const updated = await marketing.updateEntity(agency.Id_Entidad_Reportante,
      { Nombre: agencyUpdatedName, Activo: 0 }, actor.Id_Usuario);
    assert.equal(updated.Activo, 0);
    assert.equal((await marketing.detail(agency.Id_Entidad_Reportante)).entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
    await marketing.updateEntity(agency.Id_Entidad_Reportante, { Activo: 1 }, actor.Id_Usuario);
  });
  await check('validación', async () => {
    await entities.validateEntity(hotel.Id_Entidad_Reportante, 'VALIDADA', actor.Id_Usuario);
    assert.equal((await marketing.detail(hotel.Id_Entidad_Reportante)).entity.Estado_Validacion, 'VALIDADA');
  });
  await check('relación oficial de punto', async () => {
    await marketing.setPoint(hotel.Id_Entidad_Reportante, points[0].Id_Punto, true, actor.Id_Usuario);
    const detail = await marketing.detail(hotel.Id_Entidad_Reportante);
    assert.equal(detail.associated.length, 1);
    assert.equal(detail.observed.length, 0);
  });
  const reservation = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('HOTEL'), hotel.Id_Entidad_Reportante, 'Andrea', points[1].Id_Punto), {}, actor.Id_Usuario);
  await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?', ['2027-07-10 10:00:00', reservation.Id_Reserva]);
  const sameHotelContact = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('HOTEL'), hotel.Id_Entidad_Reportante, 'Juan Pérez', points[1].Id_Punto), {}, actor.Id_Usuario);
  const nationalHomonym = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('AGENCIA NACIONAL'), agency.Id_Entidad_Reportante, 'Juan Pérez', points[1].Id_Punto), {}, actor.Id_Usuario);
  const internationalHomonym = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('AGENCIA INTERNACIONAL'), international.Id_Entidad_Reportante, 'Juan Pérez', points[1].Id_Punto), {}, actor.Id_Usuario);
  for (const [id, day] of [[sameHotelContact.Id_Reserva, '11'],
    [nationalHomonym.Id_Reserva, '12'], [internationalHomonym.Id_Reserva, '13']]) {
    await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?',
      [`2027-07-${day} 10:00:00`, id]);
  }
  let [[transferRange]] = await connection.query(`SELECT Id_Rango,Minimo FROM transfers_rangos
    WHERE Minimo >= 1 ORDER BY Minimo LIMIT 1`);
  if (!transferRange) {
    const [[nextRange]] = await connection.query('SELECT COALESCE(MAX(Id_Rango),0)+1 AS Id_Rango FROM transfers_rangos');
    await connection.query(`INSERT INTO transfers_rangos (Id_Rango,Descripcion,Minimo,Maximo)
      VALUES (?,'Rango de prueba aislado',1,1)`, [nextRange.Id_Rango]);
    transferRange = { Id_Rango: nextRange.Id_Rango, Minimo: 1 };
  }
  let [[transferService]] = await connection.query('SELECT Id_Servicio FROM servicios_transfer ORDER BY Id_Servicio LIMIT 1');
  if (!transferService) {
    const [[nextService]] = await connection.query('SELECT COALESCE(MAX(Id_Servicio),0)+1 AS Id_Servicio FROM servicios_transfer');
    await connection.query('INSERT INTO servicios_transfer (Id_Servicio,Nombre_Servicio) VALUES (?,?)',
      [nextService.Id_Servicio, 'Servicio de prueba aislado']);
    transferService = { Id_Servicio: nextService.Id_Servicio };
  }
  const transferPassengers = Number(transferRange.Minimo);
  const sampleTransfer = await transfers.crearTransferSvc({
    Id_Canal: channel('HOTEL'), Id_Entidad_Reportante: hotel.Id_Entidad_Reportante,
    Titular: 'Titular de prueba', DNI: 'TEST-ENTIDAD', Tel_Contacto: '3000000000',
    Cantidad_Personas: transferPassengers, Servicio: transferService.Id_Servicio, Salida: 'Hotel de prueba',
    Llegada: 'Aeropuerto de prueba', FechaTransfer: '2027-07-15', HoraRecogida: '08:00',
    NombreReporta: 'Contacto de transfer', TelefonoTransfer: '3000000001', ValorServicio: 0,
    Id_Moneda: null, Vuelo: null, TipoVuelo: null, Observaciones: 'Fixture de prueba aislado',
  }, { userId: actor.Id_Usuario });
  await connection.query('UPDATE transfers SET Fecha_Registro=? WHERE Id_Transfer=?',
    ['2027-07-14 10:00:00', sampleTransfer.Id_Transfer]);
  const transferOnlyEntity = (await entities.quickCreate({ channelId: channel('HOTEL'),
    name: transferOnlyName, actorId: actor.Id_Usuario })).entity;
  await entities.validateEntity(transferOnlyEntity.Id_Entidad_Reportante, 'VALIDADA', actor.Id_Usuario);
  const transferOnly = await transfers.crearTransferSvc({
    Id_Canal: channel('HOTEL'), Id_Entidad_Reportante: transferOnlyEntity.Id_Entidad_Reportante,
    Titular: 'Titular solo transfer', DNI: 'TEST-TRANSFER-ONLY', Tel_Contacto: '3000000002',
    Cantidad_Personas: transferPassengers, Servicio: transferService.Id_Servicio,
    Salida: 'Hotel de prueba', Llegada: 'Aeropuerto de prueba', FechaTransfer: '2027-07-16',
    HoraRecogida: '08:00', NombreReporta: 'Contacto solo transfer', TelefonoTransfer: '3000000003',
    ValorServicio: 0, Id_Moneda: null, Vuelo: null, TipoVuelo: null,
    Observaciones: 'Fixture de prueba aislado: solo transfers',
  }, { userId: actor.Id_Usuario });
  await connection.query('UPDATE transfers SET Fecha_Registro=? WHERE Id_Transfer=?',
    ['2027-07-16 10:00:00', transferOnly.Id_Transfer]);
  await check('actividad y pasajero por FK', async () => {
    const page = await marketing.listActivity({ ...f, tipo: 'HOTEL', actividad: 'CON_RESERVAS', buscar: hotelName });
    const row = page.items.find(x => x.Id_Entidad_Reportante === hotel.Id_Entidad_Reportante);
    assert.equal(Number(row.Reservas), 2);
    assert.equal(Number(row.Transfers), 1);
    assert.equal(Number(row.Operaciones), 3);
    assert.equal(Number(row.Pasajeros), 2 + transferPassengers);
    assert.ok(row.Primera_Reserva);
    assert.ok(row.Ultima_Reserva);
    assert.ok(Number(row.Dias_Sin_Reportar) >= 0);
    assert.equal(row.Contacto_Reciente, 'Juan Pérez');
    assert.equal(page.items.length, 1);
    const nationalPage = await marketing.listActivity({ ...f, tipo: 'AGENCIA_NACIONAL', actividad: 'CON_RESERVAS', buscar: agencyUpdatedName });
    const internationalPage = await marketing.listActivity({ ...f, tipo: 'AGENCIA_INTERNACIONAL', actividad: 'CON_RESERVAS', buscar: internationalName });
    const nationalRow = nationalPage.items.find(x => x.Id_Entidad_Reportante === agency.Id_Entidad_Reportante);
    const internationalRow = internationalPage.items.find(x => x.Id_Entidad_Reportante === international.Id_Entidad_Reportante);
    assert.equal(Number(nationalRow.Reservas), 1);
    assert.equal(Number(internationalRow.Reservas), 1);
    assert.equal(nationalPage.items.length, 1);
    assert.equal(internationalPage.items.length, 1);
    assert.equal(Number(page.summary.Total_Reservas), 2);
    assert.equal(Number(page.summary.Total_Transfers), 1);
    assert.equal(Number(page.summary.Total_Operaciones), 3);
    assert.equal(Number(page.summary.Total_Pasajeros), 2 + transferPassengers);
    assert.equal(Number(page.summary.Con_Actividad), 1);
    assert.equal(nationalRow.Primera_Actividad, null);
    assert.equal(nationalRow.Ultima_Actividad, null);
    assert.equal(nationalRow.Primera_Reserva, null);
    assert.equal(nationalRow.Ultima_Reserva, null);
    assert.equal(nationalRow.Dias_Sin_Reportar, null);
  });
  await check('entidad con transfers y sin reservas', async () => {
    const result = await marketing.listActivity({ ...f, tipo: 'HOTEL', buscar: transferOnlyName });
    const row = result.items.find(item => item.Id_Entidad_Reportante === transferOnlyEntity.Id_Entidad_Reportante);
    assert.equal(result.total, 1);
    assert.equal(Number(row.Reservas), 0);
    assert.equal(Number(row.Transfers), 1);
    assert.equal(Number(row.Operaciones), 1);
    assert.equal(Number(row.Pasajeros), transferPassengers);
    assert.ok(row.Primera_Reserva);
    assert.ok(row.Ultima_Reserva);
  });
  await check('contacto y puntos separados', async () => {
    const detail = await marketing.detail(hotel.Id_Entidad_Reportante, f);
    assert.ok(detail.contacts.some(contact => contact.Nombre === 'Andrea'));
    assert.ok(detail.contacts.some(contact => contact.Nombre === 'Juan Pérez'));
    assert.equal(detail.contacts.reduce((sum, contact) => sum + Number(contact.Reservas), 0), 2);
    assert.equal(String(detail.observed[0].Id_Punto), String(points[1].Id_Punto));
    assert.equal(Number(detail.observed[0].Reservas), 2);
    assert.equal(String(detail.associated[0].Id_Punto), String(points[0].Id_Punto));
  });
  const reservationOutsidePeriod = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('HOTEL'), hotel.Id_Entidad_Reportante, 'Contacto período posterior', points[1].Id_Punto),
    {}, actor.Id_Usuario);
  await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?',
    ['2027-08-01 10:00:00', reservationOutsidePeriod.Id_Reserva]);
  await check('el periodo limita totales, pero la última fecha conserva toda la historia', async () => {
    const page = await marketing.listActivity({ ...f, tipo: 'HOTEL', buscar: hotelName });
    const row = page.items.find(item => item.Id_Entidad_Reportante === hotel.Id_Entidad_Reportante);
    assert.equal(Number(row.Reservas), 2);
    assert.equal(Number(row.Transfers), 1);
    assert.equal(Number(row.Operaciones), 3);
    assert.equal(new Date(row.Ultima_Reserva).toISOString().slice(0, 10), '2027-08-01');
  });
  const categoryReservation = await reservations.crearReservaConPasajerosYPagos(
    payload(channel('HOTEL'), hotel.Id_Entidad_Reportante, 'Andrea', points[1].Id_Punto), {}, actor.Id_Usuario);
  await check('cambio de categoría exige entidad compatible', async () => {
    const data = payload(channel('AGENCIA NACIONAL'), hotel.Id_Entidad_Reportante,
      'Andrea', points[1].Id_Punto);
    await assert.rejects(reservations.actualizarReservaConPasajerosYPagos(
      categoryReservation.Id_Reserva, data, {}, actor.Id_Usuario), e => e.errorCode === 'ENTITY_CHANNEL_MISMATCH');
    data.cabeceraReserva.Id_Entidad_Reportante = agency.Id_Entidad_Reportante;
    await reservations.actualizarReservaConPasajerosYPagos(categoryReservation.Id_Reserva, data, {}, actor.Id_Usuario);
    const [[changed]] = await connection.query('SELECT Id_Entidad_Reportante,Nombre_Reportante FROM reservas WHERE Id_Reserva=?',
      [categoryReservation.Id_Reserva]);
    assert.equal(String(changed.Id_Entidad_Reportante), String(agency.Id_Entidad_Reportante));
    assert.equal(changed.Nombre_Reportante, 'Andrea');
  });
  await check('otra categoría limpia entidad e historiza', async () => {
    const other = channels.find(c => !['HOTEL', 'AGENCIA NACIONAL', 'AGENCIA INTERNACIONAL'].includes(c.Nombre_Canal));
    const data = payload(other.Id_Canal, null, 'Andrea', points[1].Id_Punto);
    await reservations.actualizarReservaConPasajerosYPagos(categoryReservation.Id_Reserva, data, {}, actor.Id_Usuario);
    const [[row]] = await connection.query('SELECT Id_Entidad_Reportante FROM reservas WHERE Id_Reserva=?', [categoryReservation.Id_Reserva]);
    assert.equal(row.Id_Entidad_Reportante, null);
    const [history] = await connection.query(`SELECT d.Valor_Anterior,d.Valor_Nuevo FROM historial h
      JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial WHERE h.Tabla='reservas'
      AND h.Id_Registro=? AND d.Columna='Id_Entidad_Reportante'`, [categoryReservation.Id_Reserva]);
    assert.ok(history.some(h => String(h.Valor_Anterior) === String(agency.Id_Entidad_Reportante) && h.Valor_Nuevo === ''));
  });
  await check('Freelance crea y edita reservas con FK de entidad nula', async () => {
    const freelance = await reservations.crearReservaConPasajerosYPagos(
      payload(channel('FREELANCE'), null, 'Andrea', points[1].Id_Punto), {}, actor.Id_Usuario);
    let [[row]] = await connection.query('SELECT Id_Entidad_Reportante FROM reservas WHERE Id_Reserva=?', [freelance.Id_Reserva]);
    assert.equal(row.Id_Entidad_Reportante, null);

    await reservations.actualizarReservaConPasajerosYPagos(freelance.Id_Reserva,
      payload(channel('FREELANCE'), hotel.Id_Entidad_Reportante, 'Andrea', points[1].Id_Punto), {}, actor.Id_Usuario);
    [[row]] = await connection.query('SELECT Id_Entidad_Reportante FROM reservas WHERE Id_Reserva=?', [freelance.Id_Reserva]);
    assert.equal(row.Id_Entidad_Reportante, null);
    const activity = await marketing.listActivity({ ...f, tipo: 'HOTEL' });
    assert.equal(activity.items.length, 2);
    assert.ok(activity.items.some(item => String(item.Id_Entidad_Reportante) === String(hotel.Id_Entidad_Reportante)));
    assert.ok(activity.items.some(item => String(item.Id_Entidad_Reportante) === String(transferOnlyEntity.Id_Entidad_Reportante)));
  });
  await check('filtros y métricas', async () => {
    const page = await marketing.listActivity({ ...f, tipo: 'HOTEL', actividad: 'CON_RESERVAS', buscar: hotelName });
    assert.equal(page.total, 1);
    assert.equal(Number(page.summary.Total_Reservas), 2);
    const inactive = await marketing.listActivity({ ...f, tipo: 'HOTEL', buscar: hotelName, estado: 'INACTIVA' });
    assert.equal(inactive.total, 0);
  });
  await check('paginación', async () => {
    const page = await marketing.listActivity({ ...f, pageSize: 1, page: 2 });
    assert.equal(page.items.length, 1);
    assert.equal(page.pageSize, 1);
  });
  await check('Excel completo filtrado', async () => {
    const workbook = require('exceljs');
    const buffer = await marketing.exportExcel({ ...f, tipo: 'HOTEL', buscar: hotelName });
    const parsed = await new workbook.Workbook().xlsx.load(buffer);
    assert.equal(parsed.worksheets[0].rowCount, 2);
    assert.equal(parsed.worksheets[0].getRow(2).getCell(2).value, hotelName);
    assert.equal(Number(parsed.worksheets[0].getRow(2).getCell(5).value), 2);
    assert.ok(parsed.worksheets[0].getRow(2).getCell(11).value);
    assert.ok(parsed.worksheets[0].getRow(2).getCell(12).value);
  });
  await check('EXPLAIN e índices existentes', async () => {
    const [indexes] = await connection.query(`SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      AND ((TABLE_NAME='reservas' AND INDEX_NAME='ix_reservas_entidad_registro')
        OR (TABLE_NAME='entidades_reportantes' AND INDEX_NAME='ux_entidades_tipo_nombre_normalizado'))
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
    assert.ok(indexes.some(x => x.INDEX_NAME === 'ix_reservas_entidad_registro'));
    assert.ok(indexes.some(x => x.INDEX_NAME === 'ux_entidades_tipo_nombre_normalizado'));
    const [plan] = await connection.query(`EXPLAIN SELECT r.Id_Entidad_Reportante,COUNT(*)
      FROM reservas r WHERE r.Id_Entidad_Reportante IS NOT NULL
      AND r.Fecha_Registro>=? AND r.Fecha_Registro<? GROUP BY r.Id_Entidad_Reportante`,
    [`${from} 00:00:00`, `${to} 23:59:59`]);
    assert.ok(plan.length);
    console.log(JSON.stringify({ explainActivity: plan.map(row => ({ table: row.table,
      type: row.type, key: row.key, rows: row.rows })), indexes }));
  });
  await check('permiso Mercadeo', async () => {
    const [rows] = await connection.query(`SELECT p.Codigo_Permiso FROM rol_permisos rp
      JOIN roles r ON r.Id_Rol=rp.Id_Rol JOIN permisos p ON p.Id_Permiso=rp.Id_Permiso
      WHERE LOWER(TRIM(r.Nombre_Rol))='mercadeo' AND p.Codigo_Permiso LIKE 'ENTIDADES_REPORTANTES.%'`);
    assert.equal(rows.length, 4);
  });
  await check('rutas restringen administración y registro rápido', async () => {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const { once } = require('node:events');
    const [[marketingRole]] = await connection.query("SELECT Id_Rol FROM roles WHERE LOWER(TRIM(Nombre_Rol))='mercadeo'");
    const [role] = await connection.query("INSERT INTO roles (Nombre_Rol,Descripcion,Activo) VALUES ('Creador validación','Temporal',1)");
    const [[createPermission]] = await connection.query("SELECT Id_Permiso FROM permisos WHERE Codigo_Permiso='RESERVAS.CREAR'");
    await connection.query('INSERT INTO rol_permisos (Id_Rol,Id_Permiso) VALUES (?,?)', [role.insertId, createPermission.Id_Permiso]);
    const userBase = 1000000000000 + Math.floor(Math.random() * 10000000);
    const tokens = [];
    for (const [id, roleId, label] of [[userBase, marketingRole.Id_Rol, 'mercadeo'],
      [userBase + 1, role.insertId, 'reservas']]) {
      await connection.query(`INSERT INTO usuarios
        (Id_Usuario,Nombres_Apellidos,Usuario,Correo,Contrasena,Id_Rol,Activo)
        VALUES (?,?,?,?,?,?,1)`, [id, label, `${label}_${id}`, `${label}_${id}@example.invalid`, 'test-only', roleId]);
      const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '10m' });
      await connection.query('INSERT INTO sesiones (Id_Usuario,Token,Fecha_Inicio,Fecha_Expira) VALUES (?,?,NOW(),DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [id, token]);
      tokens.push(token);
    }
    const app = express(); app.use(express.json());
    app.use('/api', require('../routes/EntidadesReportantes/entidades-reportantes.routes'));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}/api/entidades-reportantes`;
    const call = (path, token, method = 'GET', body) => fetch(`${endpoint}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    try {
      assert.equal((await call('/actividad', tokens[0])).status, 200);
      assert.equal((await call('/actividad', tokens[1])).status, 403);
      assert.equal((await call('', tokens[1], 'POST', { Tipo: 'HOTEL', Nombre: 'Bloqueada' })).status, 403);
      assert.equal((await call('/rapida', tokens[0], 'POST', { Id_Canal: channel('HOTEL'), Nombre: 'Bloqueada' })).status, 403);
      assert.equal((await call('/rapida', tokens[1], 'POST', { Id_Canal: channel('HOTEL'), Nombre: 'Permitida' })).status, 201);
    } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  });
  await check('límite de período', async () => {
    assert.throws(() => marketing.filters({ desde: '2027-07-01', hasta: '2027-08-01' }),
      e => e.errorCode === 'DATE_RANGE_TOO_LONG');
    assert.equal(marketing.filters({ diasSinReportarMin: '90', ordenarPor: 'dias_sin_reportar', orden: 'desc' }).daysSinceReportMin, 90);
    assert.throws(() => marketing.filters({ diasSinReportarMin: '-1' }),
      e => e.errorCode === 'INACTIVITY_DAYS_INVALID');
    assert.equal(marketing.filters({ ordenarPor: 'no_es_una_columna', orden: 'desc' }).sortBy, 'nombre');
  });
  await check('filtro por días, orden y entidades sin actividad', async () => {
    await connection.query(`UPDATE reservas SET Fecha_Registro=DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
      WHERE Id_Entidad_Reportante=? AND Eliminada_En IS NULL`,
    [DIAS_SIN_REPORTAR_ALERTA + 30, hotel.Id_Entidad_Reportante]);
    await connection.query(`UPDATE transfers SET Fecha_Registro=DATE_SUB(CURRENT_DATE, INTERVAL ? DAY)
      WHERE Id_Entidad_Reportante=?`,
    [DIAS_SIN_REPORTAR_ALERTA + 10, hotel.Id_Entidad_Reportante]);
    const oldReports = await marketing.listActivity({ tipo: 'HOTEL', buscar: hotelName,
      diasSinReportarMin: DIAS_SIN_REPORTAR_ALERTA, ordenarPor: 'dias_sin_reportar', orden: 'DESC' });
    assert.equal(oldReports.items.length, 1);
    assert.ok(Number(oldReports.items[0].Dias_Sin_Reportar) > DIAS_SIN_REPORTAR_ALERTA);
    assert.equal(oldReports.ordenarPor, 'dias_sin_reportar');
    assert.equal(oldReports.orden, 'DESC');
    const ranked = await marketing.listActivity({ ordenarPor: 'operaciones', orden: 'DESC', pageSize: 100 });
    assert.equal(ranked.items[0].Id_Entidad_Reportante, hotel.Id_Entidad_Reportante);
    const neverReported = await marketing.listActivity({ tipo: 'AGENCIA_INTERNACIONAL',
      buscar: adminInternationalName, actividad: 'SIN_RESERVAS', ordenarPor: 'ultima_reserva' });
    assert.equal(neverReported.items.length, 1);
    assert.equal(Number(neverReported.items[0].Reservas), 0);
    assert.equal(Number(neverReported.items[0].Transfers), 0);
    assert.equal(Number(neverReported.items[0].Operaciones), 0);
    assert.equal(neverReported.items[0].Primera_Reserva, null);
    assert.equal(neverReported.items[0].Ultima_Reserva, null);
    assert.equal(neverReported.items[0].Dias_Sin_Reportar, null);
    const neverReportedTooLong = await marketing.listActivity({ tipo: 'AGENCIA_INTERNACIONAL',
      buscar: adminInternationalName, diasSinReportarMin: DIAS_SIN_REPORTAR_ALERTA });
    assert.equal(neverReportedTooLong.items.length, 1);
    assert.equal(neverReportedTooLong.items[0].Id_Entidad_Reportante,
      neverReportedEntity.Id_Entidad_Reportante);
    assert.equal(neverReportedTooLong.items[0].Dias_Sin_Reportar, null);
  });
  await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?',
    ['2027-07-10 10:00:00', reservation.Id_Reserva]);
  await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?',
    ['2027-07-11 10:00:00', sameHotelContact.Id_Reserva]);
  await connection.query('UPDATE reservas SET Fecha_Registro=? WHERE Id_Reserva=?',
    ['2027-08-01 10:00:00', reservationOutsidePeriod.Id_Reserva]);
  await connection.query('UPDATE transfers SET Fecha_Registro=? WHERE Id_Transfer=?',
    ['2027-07-14 10:00:00', sampleTransfer.Id_Transfer]);
  await check('reservas eliminadas fuera de la actividad y fechas de inactividad', async () => {
    const deleted = await reservations.crearReservaConPasajerosYPagos(
      payload(channel('HOTEL'), hotel.Id_Entidad_Reportante, 'Contacto eliminado', points[1].Id_Punto),
      {}, actor.Id_Usuario);
    await connection.query('UPDATE reservas SET Fecha_Registro=?,Eliminada_En=NOW() WHERE Id_Reserva=?',
      ['2027-08-20 10:00:00', deleted.Id_Reserva]);
    const [[deletedState]] = await connection.query('SELECT Eliminada_En FROM reservas WHERE Id_Reserva=?', [deleted.Id_Reserva]);
    assert.ok(deletedState.Eliminada_En);
    assert.equal(require('../services/schema-capabilities').getSchemaCapabilities().reservasSoftDelete, true);
    const beforeDeactivate = await marketing.listActivity({ tipo: 'HOTEL', buscar: hotelName });
    const activeRow = beforeDeactivate.items[0];
    assert.equal(Number(activeRow.Reservas), 3);
    assert.equal(Number(activeRow.Transfers), 1);
    assert.equal(new Date(activeRow.Ultima_Reserva).toISOString().slice(0, 10), '2027-08-01');
    assert.notEqual(activeRow.Contacto_Reciente, 'Contacto eliminado');
    await marketing.updateEntity(hotel.Id_Entidad_Reportante, { Activo: 0 }, actor.Id_Usuario);
    const inactive = await marketing.listActivity({ tipo: 'HOTEL', buscar: hotelName });
    assert.equal(inactive.items[0].Primera_Reserva, null);
    assert.equal(inactive.items[0].Ultima_Reserva, null);
    assert.equal(inactive.items[0].Dias_Sin_Reportar, null);
  });
  await check('quitar asociación oficial', async () => {
    await marketing.setPoint(hotel.Id_Entidad_Reportante, points[0].Id_Punto, false, actor.Id_Usuario);
    assert.equal((await marketing.detail(hotel.Id_Entidad_Reportante)).associated.length, 0);
  });
  console.log(JSON.stringify({ database, passed: checks.length, checks }));
});
