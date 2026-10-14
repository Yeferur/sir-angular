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
  const [columns] = await connection.query(`SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='entidades_reportantes' AND COLUMN_NAME='Nombre_Normalizado'`);
  if (!columns.length) {
    const sql = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations',
      '20261013_0013_entidades_mercadeo.sql'), 'utf8');
    for (const statement of parseMigrationSql(sql)) await connection.query(statement);
  }
  const db = require('../database/db');
  const entities = require('../services/EntidadesReportantes/entidades-reportantes.service');
  const marketing = require('../services/EntidadesReportantes/entidades-mercadeo.service');
  const reservations = require('../services/Reservas/reservas.service');
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
    name: 'Hotel Poblado Boutique', actorId: actor.Id_Usuario })).entity;
  await check('duplicado normalizado', async () => {
    const duplicate = await entities.quickCreate({ channelId: channel('HOTEL'),
      name: '  HÓTEL  POBLADO - BOUTIQUE  ', actorId: actor.Id_Usuario });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.entity.Id_Entidad_Reportante, hotel.Id_Entidad_Reportante);
    assert.equal(duplicate.entity.Nombre, 'Hotel Poblado Boutique');
  });
  await check('búsqueda normalizada', async () => {
    const found = await entities.listEntities({ type: 'HOTEL', search: 'hótel poblado' });
    assert.ok(found.some(x => x.Id_Entidad_Reportante === hotel.Id_Entidad_Reportante));
  });
  const agency = (await entities.quickCreate({ channelId: channel('AGENCIA NACIONAL'),
    name: 'Viajes Bogotá', actorId: actor.Id_Usuario })).entity;
  await check('tipo por categoría', async () => {
    await assert.rejects(entities.validateReservationEntity(db, channel('HOTEL'), agency.Id_Entidad_Reportante),
      e => e.errorCode === 'ENTITY_CHANNEL_MISMATCH');
    await assert.rejects(entities.validateReservationEntity(db, channel('AGENCIA NACIONAL'), null),
      e => e.errorCode === 'ENTITY_REQUIRED');
  });
  await check('creación administrativa', async () => {
    const created = await marketing.createEntity({ Tipo: 'AGENCIA_INTERNACIONAL', Nombre: 'São Paulo Travel' }, actor.Id_Usuario);
    assert.equal(created.entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
    assert.equal(created.entity.Nombre, 'São Paulo Travel');
  });
  await check('edición y estado independientes', async () => {
    const updated = await marketing.updateEntity(agency.Id_Entidad_Reportante,
      { Nombre: 'Viajes Bogotá SAS', Activo: 0 }, actor.Id_Usuario);
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
  await check('actividad y pasajero por FK', async () => {
    const page = await marketing.listActivity(f);
    const row = page.items.find(x => x.Id_Entidad_Reportante === hotel.Id_Entidad_Reportante);
    assert.equal(Number(row.Reservas), 1);
    assert.equal(Number(row.Pasajeros), 1);
    assert.equal(row.Contacto_Reciente, 'Andrea');
  });
  await check('contacto y puntos separados', async () => {
    const detail = await marketing.detail(hotel.Id_Entidad_Reportante, f);
    assert.equal(detail.contacts[0].Nombre, 'Andrea');
    assert.equal(String(detail.observed[0].Id_Punto), String(points[1].Id_Punto));
    assert.equal(String(detail.associated[0].Id_Punto), String(points[0].Id_Punto));
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
  await check('filtros y métricas', async () => {
    const page = await marketing.listActivity({ ...f, tipo: 'HOTEL', actividad: 'CON_RESERVAS' });
    assert.equal(page.total, 1);
    assert.equal(Number(page.summary.Total_Reservas), 1);
    const inactive = await marketing.listActivity({ ...f, estado: 'INACTIVA' });
    assert.equal(inactive.total, 0);
  });
  await check('paginación', async () => {
    const page = await marketing.listActivity({ ...f, pageSize: 1, page: 2 });
    assert.equal(page.items.length, 1);
    assert.equal(page.pageSize, 1);
  });
  await check('Excel completo filtrado', async () => {
    const workbook = require('exceljs');
    const buffer = await marketing.exportExcel({ ...f, tipo: 'HOTEL' });
    const parsed = await new workbook.Workbook().xlsx.load(buffer);
    assert.equal(parsed.worksheets[0].rowCount, 2);
    assert.equal(parsed.worksheets[0].getRow(2).getCell(2).value, 'Hotel Poblado Boutique');
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
  });
  await check('quitar asociación oficial', async () => {
    await marketing.setPoint(hotel.Id_Entidad_Reportante, points[0].Id_Punto, false, actor.Id_Usuario);
    assert.equal((await marketing.detail(hotel.Id_Entidad_Reportante)).associated.length, 0);
  });
  console.log(JSON.stringify({ database, passed: checks.length, checks }));
});
