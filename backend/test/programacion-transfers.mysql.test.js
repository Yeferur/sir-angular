const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const ExcelJS = require('exceljs');
const { assertTestDestination, migrate } = require('../scripts/migrate-programacion-transfers');

test('MySQL real: listado exportado, audiencia efectiva, deduplicación, cierre y reinicio', {
  skip: process.env.PROGRAMACION_TRANSFERS_MYSQL_TEST !== '1', timeout: 60000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  const source = process.env.DB_NAME || process.env.DB_DATABASE;
  assertTestDestination(process.env, source);
  assert.match(source, /^[a-z0-9_]+$/i);
  const database = `sir_programacion_transfers_test_${randomUUID().replaceAll('-', '')}`;
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS, database: source, multipleStatements: true });
  let created = false;
  let pool;
  const originalDatabase = process.env.DB_NAME;
  t.after(async () => {
    if (pool) await pool.end();
    try {
      assert.match(database, /^sir_programacion_transfers_test_[a-f0-9]{32}$/);
      assert.notEqual(source, database);
      if (created) await connection.query(`DROP DATABASE \`${database}\``);
    } finally {
      await connection.end();
      if (originalDatabase === undefined) delete process.env.DB_NAME;
      else process.env.DB_NAME = originalDatabase;
    }
  });
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME NOT IN ('programacion_transfers_listados','programacion_transfers_snapshot')`, [source]);
  await connection.query(`USE \`${database}\``);
  await connection.query('SET FOREIGN_KEY_CHECKS=0');
  for (const { TABLE_NAME: table } of tables) {
    assert.match(table, /^[a-z0-9_]+$/i);
    const [[schema]] = await connection.query(`SHOW CREATE TABLE \`${source}\`.\`${table}\``);
    await connection.query(schema['Create Table']);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS=1');
  await migrate(connection, process.env);
  await migrate(connection, process.env); // idempotencia real.
  process.env.DB_NAME = database;
  pool = require('../database/db');
  const service = require('../services/Programacion/programacion-transfers-novedades.service');
  const programming = require('../services/Programacion/programacion.service');
  const reservationAlerts = require('../services/Programacion/programacion-novedades.service');
  const pending = require('../services/Pendientes/pendientes.service');
  const websocket = require('../websocketManager');
  const events = [];
  t.mock.method(websocket, 'sendToUser', (userId, event) => events.push({ userId, type: event.type }));
  await connection.query(`INSERT INTO permisos SELECT * FROM \`${source}\`.permisos`);
  await connection.query(`INSERT INTO reglas_pendientes SELECT * FROM \`${source}\`.reglas_pendientes
    WHERE Codigo='PROGRAMACION_CAMBIOS_OPERATIVOS'`);
  await connection.query("INSERT INTO roles (Id_Rol,Nombre_Rol) VALUES (1,'Operador'),(2,'Solo lectura'),(3,'Solo actualización'),(4,'Denegado'),(5,'Cliente'),(6,'Administrador')");
  await connection.query(`INSERT INTO usuarios (Id_Usuario,Nombres_Apellidos,Usuario,Correo,Contrasena,Id_Rol)
    VALUES ?`, [[10,11,12,13,14,15,16].map((id, i) => [id, `Prueba ${id}`, `prueba${id}`, `${id}@example.invalid`, 'sin_login', i === 6 ? 6 : i + 1])]);
  const [permissionRows] = await connection.query("SELECT Id_Permiso,Codigo_Permiso FROM permisos WHERE Codigo_Permiso IN ('PROGRAMACION.LEER','PROGRAMACION.ACTUALIZAR')");
  assert.equal(permissionRows.length, 2);
  const read = permissionRows.find((r) => r.Codigo_Permiso.endsWith('.LEER')).Id_Permiso;
  const update = permissionRows.find((r) => r.Codigo_Permiso.endsWith('.ACTUALIZAR')).Id_Permiso;
  await connection.query('INSERT INTO rol_permisos (Id_Rol,Id_Permiso) VALUES ?', [[[1,read],[1,update],[2,read],[3,update],[4,read],[4,update],[5,read],[5,update]]]);
  await connection.query("INSERT INTO usuario_permisos (Id_Usuario,Id_Permiso,Tipo) VALUES (13,?,'DENY'),(16,?,'ALLOW'),(16,?,'ALLOW')", [update,read,update]);
  await connection.query("INSERT INTO servicios_transfer (Id_Servicio,Nombre_Servicio) VALUES (1,'Aeropuerto')");
  await connection.query("INSERT INTO transfers_rangos (Id_Rango,Descripcion,Minimo,Maximo) VALUES (1,'1 a 3 pasajeros',1,3)");
  const fecha = '2026-10-15';
  await connection.query(`INSERT INTO transfers
    (Id_Transfer,Fecha_Transfer,Hora_Recogida,Estado,Punto_Salida,Punto_Destino,Cantidad_Personas,Id_Servicio,Id_Rango,Nombre_Titular,Telefono_Titular,Vuelo,TipoVuelo,Observaciones)
    VALUES (9001,?,'06:30','Confirmado','Hotel','Aeropuerto',3,1,1,'Titular','555','AB12','Salida','Equipaje')`, [fecha]);
  async function counts() {
    const [[row]] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM pendientes_operativos) AS pendientes,
      (SELECT COUNT(*) FROM pendientes_operativos WHERE Estado='ACTIVO') AS activos,
      (SELECT COUNT(*) FROM notificaciones) AS notificaciones,
      (SELECT COUNT(*) FROM pendientes_eventos) AS eventos`);
    return row;
  }
  async function list() { const [[row]] = await connection.query('SELECT CAST(Revision AS CHAR) AS revision FROM programacion_transfers_listados WHERE Fecha_Operacion=?', [fecha]); return row; }

  await t.test('consulta en vivo y transfer sin referencia no generan aviso', async () => {
    await programming.obtenerTransfersProgramacion(fecha);
    await service.syncForDate(fecha);
    assert.equal(await list(), undefined);
    assert.deepEqual(await counts(), { pendientes: 0, activos: 0, notificaciones: 0, eventos: 0 });
  });
  await t.test('Excel exitoso guarda exactamente el listado, sin aviso si coincide', async () => {
    const exported = await programming.exportarTransfersProgramacion(fecha, 10);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.buffer);
    assert.equal(workbook.getWorksheet('Transfers').getRow(5).getCell(15).value, 9001);
    assert.equal((await list()).revision, '1');
    await service.syncSavedLists();
    assert.equal((await counts()).pendientes, 0);
    await programming.exportarTransfersProgramacion(fecha, 10);
    assert.equal((await list()).revision, '1'); // idéntico no crea ciclo nuevo.
  });
  await t.test('administración y horario equivalente no alertan', async () => {
    await connection.query("UPDATE transfers SET DNI='otro', Valor=999, Nombre_Reportante='Administración', Hora_Recogida='6:30 AM' WHERE Id_Transfer=9001");
    await service.syncSavedLists();
    assert.equal((await counts()).pendientes, 0);
    assert.equal(events.length, 0);
  });
  await t.test('cambio relevante solo llega con ambos permisos efectivos; no por rol', async () => {
    await connection.query('UPDATE transfers SET Cantidad_Personas=4 WHERE Id_Transfer=9001');
    await service.syncForTransferChange(9001);
    assert.deepEqual(await counts(), { pendientes: 2, activos: 2, notificaciones: 2, eventos: 2 });
    const [recipients] = await connection.query('SELECT Id_Usuario_Destino FROM pendientes_operativos ORDER BY Id_Usuario_Destino');
    assert.deepEqual(recipients.map((r) => r.Id_Usuario_Destino), [10,16]);
    for (const id of [11,12,13,14,15]) await assert.rejects(reservationAlerts.listForUser(fecha, id), { status: 403 });
    assert.equal((await reservationAlerts.listForUser(fecha, 10)).length, 1);
    assert.equal((await reservationAlerts.listForUser(fecha, 16)).length, 1);
  });
  await t.test('job repetido y proceso reiniciado no duplican pendientes, avisos ni WebSocket', async () => {
    const before = await counts(); const eventCount = events.length;
    await service.syncSavedLists(); await service.syncSavedLists();
    assert.deepEqual(await counts(), before);
    assert.equal(events.length, eventCount);
    const child = fork(path.join(__dirname, '..', 'scripts', 'testing', 'programacion-transfers-sync.cjs'), [], {
      env: { ...process.env, NODE_ENV: 'test' }, silent: true, windowsHide: true,
    });
    child.stdout.resume(); child.stderr.resume();
    const exit = once(child, 'exit');
    const [message] = await once(child, 'message');
    const [code] = await exit;
    assert.equal(code, 0, message.error);
    assert.deepEqual(message.events, []);
    assert.deepEqual(await counts(), before);
  });
  await t.test('múltiples cambios actualizan una situación y refrescan una vez por usuario', async () => {
    const before = await counts(); events.length = 0;
    await connection.query("UPDATE transfers SET Hora_Recogida='08:30',Punto_Salida='Otro hotel',Cantidad_Personas=5 WHERE Id_Transfer=9001");
    await Promise.all([service.syncForDate(fecha), service.syncForDate(fecha)]);
    assert.deepEqual(await counts(), before);
    assert.deepEqual(events, [{ userId: 10, type: 'programacionNovedadesActualizadas' }, { userId: 16, type: 'programacionNovedadesActualizadas' }]);
    const [rows] = await connection.query('SELECT Datos FROM pendientes_operativos WHERE Estado="ACTIVO"');
    assert.equal(rows[0].Datos.cambios.length, 3);
  });
  await t.test('sync de Reservas no cierra avisos independientes de Transfers', async () => {
    await reservationAlerts.syncForDate(fecha);
    assert.equal((await counts()).activos, 2);
  });
  await t.test('marcar revisado usa el descarte auditado y no reaparece en la misma situación', async () => {
    const [item] = await reservationAlerts.listForUser(fecha, 10);
    const controller = require('../controllers/Programacion/programacion.controller');
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.revisarNovedadProgramacionController({ params: { id: item.idPendiente }, user: { id: 10 },
      userPermissions: ['PROGRAMACION.LEER','PROGRAMACION.ACTUALIZAR'] }, response);
    assert.equal(response.code, 200);
    await connection.query('UPDATE transfers SET Cantidad_Personas=6 WHERE Id_Transfer=9001');
    await service.syncSavedLists();
    assert.equal((await reservationAlerts.listForUser(fecha, 10)).length, 0);
    const [[audit]] = await connection.query("SELECT Id_Usuario,Motivo FROM pendientes_eventos WHERE Id_Pendiente=? AND Tipo='DESCARTADO'", [item.idPendiente]);
    assert.equal(audit.Id_Usuario, 10);
    assert.equal(audit.Motivo, 'Revisada desde Programación.');
    assert.equal((await counts()).notificaciones, 2);
  });
  await t.test('actualizar el listado resuelve el pendiente y conserva referencias/eventos', async () => {
    events.length = 0;
    await programming.exportarTransfersProgramacion(fecha, 10);
    assert.equal((await list()).revision, '2');
    assert.equal((await counts()).activos, 0);
    const [[history]] = await connection.query('SELECT COUNT(DISTINCT Revision_Listado) AS n FROM programacion_transfers_snapshot');
    assert.equal(history.n, 2);
    assert.ok(events.some((e) => e.userId === 16 && e.type === 'actividadActualizada'));
    const [[unread]] = await connection.query('SELECT COUNT(*) AS n FROM notificaciones WHERE Leida=0');
    assert.equal(unread.n, 0);
  });
  await t.test('cancelación detectada y lista reexportada sin el cancelado resuelve', async () => {
    await require('../services/Transfers/transfers.service').cancelarTransferSvc(9001, 10);
    await service.syncForTransferChange(9001);
    assert.equal((await counts()).activos, 2);
    const [items] = await reservationAlerts.listForUser(fecha, 10);
    assert.ok(items.datos.cambios.some((c) => c.campo === 'Estado' && c.actual === 'Cancelado'));
    await programming.exportarTransfersProgramacion(fecha, 10);
    assert.equal((await counts()).activos, 0);
  });
  await t.test('cambio de fecha encuentra referencia original y una reversión resuelve', async () => {
    await connection.query("UPDATE transfers SET Estado='Confirmado' WHERE Id_Transfer=9001");
    await programming.exportarTransfersProgramacion(fecha, 10);
    await connection.query("UPDATE transfers SET Fecha_Transfer='2026-10-16' WHERE Id_Transfer=9001");
    await service.syncForTransferChange(9001);
    assert.equal((await counts()).activos, 2);
    await connection.query('UPDATE transfers SET Fecha_Transfer=? WHERE Id_Transfer=9001', [fecha]);
    await service.syncSavedLists();
    assert.equal((await counts()).activos, 0);
  });
  await t.test('eliminación conserva referencia y genera aviso por servicio desaparecido', async () => {
    await require('../services/Transfers/transfers.service').eliminarTransferSvc(9001, 10);
    await service.syncForTransferChange(9001);
    assert.equal((await counts()).activos, 2);
    const [item] = await reservationAlerts.listForUser(fecha, 10);
    assert.equal(item.datos.cambios[0].actual, 'Ya no está disponible');
    await programming.exportarTransfersProgramacion(fecha, 10);
    assert.equal((await counts()).activos, 0);
  });
  await t.test('la edición real del Transfer dispara la detección tras el commit', async () => {
    await connection.query(`INSERT INTO transfers
      (Id_Transfer,Fecha_Transfer,Hora_Recogida,Estado,Punto_Salida,Punto_Destino,Cantidad_Personas,Id_Servicio,Id_Rango,Nombre_Titular,Telefono_Titular,Vuelo,TipoVuelo,Observaciones)
      VALUES (9002,?,'06:30','Confirmado','Hotel','Aeropuerto',3,1,1,'Titular','555','AB12','Salida','Equipaje')`, [fecha]);
    await programming.exportarTransfersProgramacion(fecha, 10);
    await require('../services/Transfers/transfers.service').actualizarTransferSvc(9002, {
      Titular: 'Titular', DNI: '123', Tel_Contacto: '555', Cantidad_Personas: 3,
      Servicio: 1, Salida: 'Nuevo hotel', Llegada: 'Aeropuerto', FechaTransfer: fecha,
      HoraRecogida: '06:30', NombreReporta: 'Agencia', TelefonoTransfer: '555',
      ValorServicio: 100, Vuelo: 'AB12', TipoVuelo: 'Salida', Observaciones: 'Equipaje',
      Pago: { Tipo: 'PagaEnPunto' },
    }, 10);
    for (let attempt = 0; attempt < 50 && (await counts()).activos !== 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((await counts()).activos, 2);
    const [item] = await reservationAlerts.listForUser(fecha, 10);
    assert.equal(item.datos.transferId, '9002');
    assert.ok(item.datos.cambios.some((c) => c.campo === 'Origen'));
    await programming.exportarTransfersProgramacion(fecha, 10);
    assert.equal((await counts()).activos, 0);
  });
  const [[emails]] = await connection.query('SELECT COUNT(*) AS n FROM email_outbox');
  assert.equal(emails.n, 0);
  t.diagnostic(JSON.stringify({ source, database, recipients: [10,16], sourceTablesChanged: 'solo migración',
    snapshotsRetained: true, restartedProcess: true, emails: 0, result: await counts() }));
});
