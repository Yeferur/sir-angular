const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const {
  assertValidationDatabaseName,
  assertValidationConnection,
} = require('../scripts/validation-database-guard');
const { connectionOptions } = require('../scripts/create-validation-copy');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');
const { parseMigrationSql, assertMigrationSafe, readMigrations } = require('../scripts/release-migrate-sir2');

function quoteIdentifier(value) { return `\`${String(value).replaceAll('`', '``')}\``; }

function protectConnection(connection, database) {
  const originalQuery = connection.query.bind(connection);
  connection.query = async (sql, params) => {
    const source = String(sql);
    if (/^\s*USE\b/i.test(source) || /(?:`sir2`|\bsir2)\s*\./i.test(source)) {
      throw new Error('La prueba bloqueó una consulta que intentaba seleccionar o referenciar sir2.');
    }
    const [[selected]] = await originalQuery('SELECT DATABASE() AS selected_database');
    if (selected?.selected_database !== database) {
      throw new Error(`La prueba bloqueó una escritura fuera del esquema temporal ${database}.`);
    }
    return params === undefined ? originalQuery(sql) : originalQuery(sql, params);
  };
  return connection;
}

function ymdPlusDays(days) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('MySQL real aislado: migraciones 0016–0018 y validación de entidades reportantes', {
  skip: process.env.ENTIDADES_REPORTANTES_VALIDATION_MYSQL_TEST !== '1', timeout: 240000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });

  let previousDbName = process.env.DB_NAME;
  let previousDbDatabase = process.env.DB_DATABASE;
  const host = String(process.env.DB_HOST || '').toLowerCase();
  const configuredDatabase = process.env.DB_NAME || process.env.DB_DATABASE;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'solo se permite el MySQL local');
  assert.equal(configuredDatabase, 'sir2', 'se espera la configuración local conocida; no se usará como base de conexión');
  assert.notEqual(String(process.env.NODE_ENV).toLowerCase(), 'production');
  assert.notEqual(process.env.SIR_KEEP_VALIDATION_DB, '1', 'el esquema temporal debe eliminarse al finalizar');

  // La conexión inicial no tiene schema por defecto. Esta prueba no consulta ni clona sir2.
  const server = await mysql.createConnection(connectionOptions());
  const [[serverContext]] = await server.query('SELECT DATABASE() AS selected_database, VERSION() AS mysql_version');
  assert.equal(serverContext.selected_database, null, 'la conexión de preparación debe iniciar sin base seleccionada');

  const database = `sir2_mercadeo_validation_${randomBytes(10).toString('hex')}`;
  assertValidationDatabaseName(database);
  const stopSignalCleanup = installSignalCleanup(database);
  let target;
  let db;
  let previousGetConnection;
  let previousDbQuery;
  let servicesLoaded = false;
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); };
  t.after(async () => {
    stopSignalCleanup();
    if (db && servicesLoaded) await db.end();
    if (target) await target.end();
    await server.end();
    if (process.env.SIR_KEEP_VALIDATION_DB !== '1') await dropGeneratedDatabase(database);
    if (previousDbName === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = previousDbName;
    if (previousDbDatabase === undefined) delete process.env.DB_DATABASE; else process.env.DB_DATABASE = previousDbDatabase;
    if (db && previousGetConnection) db.getConnection = previousGetConnection;
    if (db && previousDbQuery) db.query = previousDbQuery;
  });

  const [[alreadyThere]] = await server.query(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  assert.equal(alreadyThere, undefined, 'el nombre efímero no debe existir antes de la prueba');
  await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  target = protectConnection(await mysql.createConnection(connectionOptions(database)), database);
  await assertValidationConnection(target, database);

  const baselinePath = path.join(__dirname, '..', 'database', 'baseline', '0001_schema_base.sql');
  const baseline = await fs.readFile(baselinePath, 'utf8');
  const baselineStatements = parseMigrationSql(baseline);
  assert.ok(baselineStatements.length > 0);
  assert.ok(baselineStatements.every(sql => /^CREATE TABLE\b/i.test(sql)), 'el baseline solo debe aportar DDL de tablas');
  await target.query('SET FOREIGN_KEY_CHECKS=0');
  for (const statement of baselineStatements) await target.query(statement);
  await target.query('SET FOREIGN_KEY_CHECKS=1');

  // Catálogos sintéticos previos permiten verificar las asignaciones por defecto de 0013 y 0017.
  const [roles] = await target.query(`INSERT INTO roles (Nombre_Rol,Activo) VALUES
    ('Administrador',1),('Mercadeo',1),('Solo Validador',1),('Otro',1)`);
  const roleIds = {
    admin: roles.insertId,
    marketing: roles.insertId + 1,
    validator: roles.insertId + 2,
    other: roles.insertId + 3,
  };
  const userIds = {};
  const userIdBase = 900000000000 + randomBytes(4).readUInt32BE(0);
  let userOffset = 0;
  for (const [key, roleId] of Object.entries(roleIds)) {
    const id = userIdBase + userOffset++;
    await target.query(`INSERT INTO usuarios
      (Id_Usuario,Nombres_Apellidos,Usuario,Correo,Contrasena,Id_Rol,Activo)
      VALUES (?,?,?,?,?,?,1)`, [id, `Usuario prueba ${key}`, `f3_${key}_${database.slice(-6)}`,
      `f3_${key}_${database.slice(-6)}@example.invalid`, 'solo-fixture', roleId]);
    userIds[key] = id;
  }
  const [channelRows] = await target.query(`INSERT INTO canales_origen (Nombre_Canal,Tiene_Comision) VALUES
    ('HOTEL',0),('AGENCIA NACIONAL',0),('AGENCIA INTERNACIONAL',0),('FREELANCE',0)`);
  const channels = {
    hotel: channelRows.insertId,
    national: channelRows.insertId + 1,
    international: channelRows.insertId + 2,
    freelance: channelRows.insertId + 3,
  };

  const migrations = await readMigrations();
  const migration0016 = '20261020_0016_transfers_entidad_fecha_registro.sql';
  const migrationIndex = migrations.findIndex(item => item.name === migration0016);
  assert.ok(migrationIndex >= 0, 'debe existir la migración 0016');
  for (const migration of migrations.slice(0, migrationIndex)) {
    for (const statement of migration.statements) {
      assertMigrationSafe(statement);
      await target.query(statement);
    }
  }
  // The committed baseline predates the already-existing transfer channel/entity
  // columns that 0016 indexes. Model that pre-0016 schema state only in this
  // disposable database; no production migration or source schema is touched.
  const [[transferBaseColumns]] = await target.query(`SELECT
    SUM(COLUMN_NAME='Id_Canal') AS canal,
    SUM(COLUMN_NAME='Id_Entidad_Reportante') AS entidad
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='transfers'
      AND COLUMN_NAME IN ('Id_Canal','Id_Entidad_Reportante')`);
  if (!Number(transferBaseColumns.canal)) {
    await target.query('ALTER TABLE transfers ADD COLUMN Id_Canal BIGINT UNSIGNED NULL');
  }
  if (!Number(transferBaseColumns.entidad)) {
    await target.query('ALTER TABLE transfers ADD COLUMN Id_Entidad_Reportante BIGINT UNSIGNED NULL');
  }
  const expectedTail = [
    migration0016,
    '20261021_0017_mercadeo_exportar.sql',
    '20261021_0018_entidades_reportantes_validacion.sql',
  ];
  assert.deepEqual(migrations.slice(migrationIndex, migrationIndex + 3).map(item => item.name), expectedTail);
  for (const migration of migrations.slice(migrationIndex, migrationIndex + 3)) {
    for (const statement of migration.statements) {
      assertMigrationSafe(statement);
      await target.query(statement);
    }
  }
  const [[migrationEvidence]] = await target.query(`SELECT
    (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='transfers' AND INDEX_NAME='ix_transfers_entidad_registro') AS index_0016,
    (SELECT COUNT(*) FROM permisos WHERE Codigo_Permiso='MERCADEO.EXPORTAR') AS permission_0017,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='reservas' AND COLUMN_NAME='Pendiente_Por_Entidad_En') AS marker_0018_reserva,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='transfers' AND COLUMN_NAME='Pendiente_Por_Entidad_En') AS marker_0018_transfer,
    (SELECT COUNT(*) FROM reglas_pendientes WHERE Codigo='ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION') AS rule_0018`);
  assert.deepEqual(Object.values(migrationEvidence).map(Number), [1, 1, 1, 1, 1]);
  const [[permissionAssignments]] = await target.query(`SELECT
    SUM(r.Nombre_Rol='Mercadeo') AS marketing,
    SUM(r.Nombre_Rol='Administrador') AS administrator
    FROM rol_permisos rp JOIN roles r ON r.Id_Rol=rp.Id_Rol
    JOIN permisos p ON p.Id_Permiso=rp.Id_Permiso
    WHERE p.Codigo_Permiso='MERCADEO.EXPORTAR'`);
  assert.deepEqual(Object.values(permissionAssignments).map(Number), [1, 1]);

  previousDbName = process.env.DB_NAME;
  previousDbDatabase = process.env.DB_DATABASE;
  process.env.DB_NAME = database;
  process.env.DB_DATABASE = database;
  db = require('../database/db');
  servicesLoaded = true;
  const rawGetConnection = db.getConnection.bind(db);
  previousGetConnection = db.getConnection;
  previousDbQuery = db.query;
  db.getConnection = async () => protectConnection(await rawGetConnection(), database);
  db.query = async (sql, params) => {
    const connection = await db.getConnection();
    try { return params === undefined ? connection.query(sql) : connection.query(sql, params); }
    finally { connection.release(); }
  };
  const [[poolContext]] = await db.query('SELECT DATABASE() AS selected_database');
  assert.equal(poolContext.selected_database, database);
  await require('../services/schema-capabilities').initializeSchemaCapabilities(db);

  const entities = require('../services/EntidadesReportantes/entidades-reportantes.service');
  const pending = require('../services/Pendientes/pendientes.service');
  const notifications = require('../services/Notificaciones/notificaciones.service');
  const reservations = require('../services/Reservas/reservas.service');
  const transfers = require('../services/Transfers/transfers.service');
  const [[validationPermission]] = await db.query(
    "SELECT Id_Permiso FROM permisos WHERE Codigo_Permiso='ENTIDADES_REPORTANTES.VALIDAR'");
  assert.ok(validationPermission);
  await target.query('INSERT INTO rol_permisos (Id_Rol,Id_Permiso) VALUES (?,?)',
    [roleIds.validator, validationPermission.Id_Permiso]);

  const [point] = await target.query(`INSERT INTO puntos (Nombre_Punto,Activo) VALUES ('Punto integración fase 3',1)`);
  // Tour 1/5 are legacy aliases normalized to tour 5 by the shared-capacity code.
  const [tour] = await target.query(`INSERT INTO tours (Id_Tour,Nombre_Tour,Abreviacion,Cupo_Base,Activo)
    VALUES (6,'Tour integración fase 3','F3',300,1)`);
  const [schedule] = await target.query(`INSERT INTO horarios (Id_Punto,Id_Tour,Hora_Salida)
    VALUES (?,?,'08:00')`, [point.insertId, tour.insertId]);

  async function createEntity(label, creator = userIds.other) {
    const result = await entities.quickCreate({ channelId: channels.hotel,
      name: `F3 ${database.slice(-6)} ${label}`, actorId: creator });
    return result.entity;
  }

  async function insertReservation({ id, entityId, creatorId = userIds.other, state = 'Pendiente',
    deletedAt = null, marker = null, fechaTour = ymdPlusDays(30), horarioId = null, includePassenger = false }) {
    await target.query(`INSERT INTO reservas
      (Id_Reserva,Tipo_Reserva,Id_Horario,Fecha_Tour,Fecha_Registro,Id_Canal,Id_Entidad_Reportante,
       Nombre_Reportante,Telefono_Reportante,Estado,Creado_Por,Eliminada_En,Pendiente_Por_Entidad_En)
      VALUES (?,'Grupal',?,?,NOW(),?,?, 'Contacto prueba','3001234567',?,?,?,?)`,
    [id, horarioId, fechaTour, channels.hotel, entityId, state, creatorId, deletedAt, marker]);
    if (includePassenger) {
      await target.query(`INSERT INTO pasajeros
        (Id_Reserva,Nombre_Pasajero,DNI,Telefono_Pasajero,Tipo_Pasajero,Id_Punto,Precio_Tour,Precio_Pasajero,Comision)
        VALUES (?,'Pasajero integración',?, '3001234568','ADULTO',?,100,100,0)`,
      [id, `F3-${id}`, point.insertId]);
    }
  }

  async function insertTransfer({ entityId, creatorId = userIds.other, state = 'Pendiente',
    marker = null, fechaTransfer = ymdPlusDays(30), titular = `F3 ${database.slice(-6)} transfer` }) {
    const [result] = await target.query(`INSERT INTO transfers
      (Id_Canal,Id_Entidad_Reportante,Nombre_Titular,Cantidad_Personas,Fecha_Transfer,Hora_Recogida,
       Estado,Fecha_Registro,Creado_Por,Pendiente_Por_Entidad_En)
      VALUES (?,?,?,2,?,'08:00',?,NOW(),?,?)`,
    [channels.hotel, entityId, titular, fechaTransfer, state, creatorId, marker]);
    return result.insertId;
  }

  const tag = `F3${randomBytes(5).toString('hex')}`;
  await check('el rechazo actualiza operaciones abiertas, conserva registros asociados y guarda motivo', async () => {
    const entity = await createEntity(`rechazo ${tag}`);
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'VALIDADA', userIds.admin);
    const ids = {
      pending: `${tag}R1`, confirmed: `${tag}R2`, completed: `${tag}R3`, cancelled: `${tag}R4`, deleted: `${tag}R5`,
    };
    await insertReservation({ id: ids.pending, entityId: entity.Id_Entidad_Reportante, creatorId: userIds.other, state: 'Pendiente', includePassenger: true });
    await insertReservation({ id: ids.confirmed, entityId: entity.Id_Entidad_Reportante, creatorId: userIds.validator, state: 'Confirmada' });
    await insertReservation({ id: ids.completed, entityId: entity.Id_Entidad_Reportante, state: 'Completada' });
    await insertReservation({ id: ids.cancelled, entityId: entity.Id_Entidad_Reportante, state: 'Cancelada' });
    await insertReservation({ id: ids.deleted, entityId: entity.Id_Entidad_Reportante, state: 'Pendiente de pago', deletedAt: '2026-01-01 00:00:00' });
    const transferPending = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, creatorId: userIds.other, state: 'Pendiente' });
    const transferConfirmed = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, creatorId: userIds.validator, state: 'Confirmado' });
    const transferCompleted = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, state: 'Completado' });
    const transferCancelled = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, state: 'Cancelado' });
    await target.query(`INSERT INTO pagos_reservas (Id_Reserva,Monto,Tipo,Ruta_Comprobante)
      VALUES (?,100,'Pago Directo','N/A')`, [ids.pending]);
    await target.query(`INSERT INTO liquidaciones (Id_Reserva,Estado) VALUES (?,'PENDIENTE')`, [ids.pending]);
    const [[beforeAssociated]] = await target.query(`SELECT
      (SELECT COUNT(*) FROM pasajeros WHERE Id_Reserva=?) AS pasajeros,
      (SELECT COUNT(*) FROM pagos_reservas WHERE Id_Reserva=?) AS pagos,
      (SELECT COUNT(*) FROM liquidaciones WHERE Id_Reserva=?) AS liquidaciones`, [ids.pending, ids.pending, ids.pending]);

    const rejected = await entities.validateEntity(entity.Id_Entidad_Reportante, 'RECHAZADA', userIds.admin,
      'No se pudo verificar el vínculo con la entidad.');
    assert.equal(rejected.Estado_Validacion, 'RECHAZADA');
    assert.equal(rejected.reservasAfectadas, 2);
    assert.equal(rejected.transfersAfectados, 2);
    const [reservationRows] = await target.query('SELECT Id_Reserva,Estado,Eliminada_En,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva IN (?)', [[...Object.values(ids)]]);
    const byReservation = new Map(reservationRows.map(row => [row.Id_Reserva, row]));
    for (const id of [ids.pending, ids.confirmed]) {
      assert.equal(byReservation.get(id).Estado, 'Pendiente de datos');
      assert.ok(byReservation.get(id).Pendiente_Por_Entidad_En);
    }
    for (const [id, expected] of [[ids.completed, 'Completada'], [ids.cancelled, 'Cancelada'], [ids.deleted, 'Pendiente de pago']]) {
      assert.equal(byReservation.get(id).Estado, expected);
      assert.equal(byReservation.get(id).Pendiente_Por_Entidad_En, null);
    }
    const [transferRows] = await target.query(`SELECT Id_Transfer,Estado,Pendiente_Por_Entidad_En FROM transfers
      WHERE Id_Transfer IN (?,?,?,?)`, [transferPending, transferConfirmed, transferCompleted, transferCancelled]);
    const byTransfer = new Map(transferRows.map(row => [Number(row.Id_Transfer), row]));
    for (const id of [transferPending, transferConfirmed]) {
      assert.equal(byTransfer.get(Number(id)).Estado, 'Pendiente de datos');
      assert.ok(byTransfer.get(Number(id)).Pendiente_Por_Entidad_En);
    }
    assert.equal(byTransfer.get(Number(transferCompleted)).Estado, 'Completado');
    assert.equal(byTransfer.get(Number(transferCancelled)).Estado, 'Cancelado');
    const [[afterAssociated]] = await target.query(`SELECT
      (SELECT COUNT(*) FROM pasajeros WHERE Id_Reserva=?) AS pasajeros,
      (SELECT COUNT(*) FROM pagos_reservas WHERE Id_Reserva=?) AS pagos,
      (SELECT COUNT(*) FROM liquidaciones WHERE Id_Reserva=?) AS liquidaciones`, [ids.pending, ids.pending, ids.pending]);
    assert.deepEqual(Object.values(afterAssociated).map(Number), Object.values(beforeAssociated).map(Number));
    const [reasonHistory] = await target.query(`SELECT d.Valor_Nuevo FROM historial h
      JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
      WHERE h.Tabla='entidades_reportantes' AND h.Id_Registro=? AND h.Accion='RECHAZAR'
        AND d.Columna='Motivo de rechazo'`, [entity.Id_Entidad_Reportante]);
    assert.equal(reasonHistory.at(-1)?.Valor_Nuevo, 'No se pudo verificar el vínculo con la entidad.');

    const [eventNotifications] = await target.query(`SELECT Id_Usuario,Mensaje,Clave_Deduplicacion,Datos
      FROM notificaciones WHERE Tipo='ENTIDAD_REPORTANTE_RECHAZADA' AND Entidad_Tipo='ENTIDAD_REPORTANTE'
        AND Entidad_Id=?`, [String(entity.Id_Entidad_Reportante)]);
    const expectedRecipients = new Set([userIds.other, userIds.validator, userIds.admin, userIds.marketing].map(String));
    assert.equal(eventNotifications.length, expectedRecipients.size);
    assert.deepEqual(new Set(eventNotifications.map(row => String(row.Id_Usuario))), expectedRecipients);
    for (const notice of eventNotifications) {
      assert.match(notice.Mensaje, /2 reservas y 2 transfers quedaron/);
      assert.match(notice.Mensaje, /No se pudo verificar el vínculo/);
      assert.match(notice.Clave_Deduplicacion, new RegExp(`^ENTIDAD_RECHAZO:${entity.Id_Entidad_Reportante}:`));
    }
    const duplicateInput = {
      userId: String(eventNotifications[0].Id_Usuario), type: 'ENTIDAD_REPORTANTE_RECHAZADA',
      title: 'Repetición de prueba', message: 'Reintento del mismo evento', entityType: 'ENTIDAD_REPORTANTE',
      entityId: String(entity.Id_Entidad_Reportante), deduplicationKey: eventNotifications[0].Clave_Deduplicacion,
      data: typeof eventNotifications[0].Datos === 'string'
        ? JSON.parse(eventNotifications[0].Datos) : eventNotifications[0].Datos,
    };
    const duplicateId = await notifications.createNotification(target, duplicateInput);
    assert.equal(String(duplicateId), String((await target.query('SELECT Id_Notificacion FROM notificaciones WHERE Id_Usuario=? AND Clave_Deduplicacion=?',
      [duplicateInput.userId, duplicateInput.deduplicationKey]))[0][0].Id_Notificacion));
    const [[sameEventCount]] = await target.query(`SELECT COUNT(*) AS n FROM notificaciones
      WHERE Id_Usuario=? AND Clave_Deduplicacion=?`, [duplicateInput.userId, duplicateInput.deduplicationKey]);
    assert.equal(Number(sameEventCount.n), 1);

    const firstEventKey = eventNotifications[0].Clave_Deduplicacion;
    const firstMarker = byReservation.get(ids.pending).Pendiente_Por_Entidad_En;
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'VALIDADA', userIds.admin);
    let [[stillPending]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [ids.pending]);
    assert.equal(stillPending.Estado, 'Pendiente de datos');
    assert.equal(String(stillPending.Pendiente_Por_Entidad_En), String(firstMarker));
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'RECHAZADA', userIds.admin, 'Segundo rechazo tras revisión.');
    const [secondEvents] = await target.query(`SELECT Id_Usuario,Clave_Deduplicacion FROM notificaciones
      WHERE Tipo='ENTIDAD_REPORTANTE_RECHAZADA' AND Entidad_Id=?`, [String(entity.Id_Entidad_Reportante)]);
    assert.equal(secondEvents.length, expectedRecipients.size * 2,
      `avisos tras segundo rechazo: ${JSON.stringify(secondEvents)}`);
    const eventKeys = new Set(secondEvents.map(row => row.Clave_Deduplicacion));
    assert.equal(eventKeys.size, 2);
    assert.ok(eventKeys.has(firstEventKey));
    assert.ok([...eventKeys].some(key => key !== firstEventKey));
    const countsByRecipient = new Map();
    for (const row of secondEvents) countsByRecipient.set(String(row.Id_Usuario), (countsByRecipient.get(String(row.Id_Usuario)) || 0) + 1);
    assert.deepEqual(new Set(countsByRecipient.keys()), expectedRecipients);
    assert.ok([...countsByRecipient.values()].every(count => count === 2));
  });

  await check('un error de notificación o del pendiente revierte por completo el rechazo', async () => {
    for (const mode of ['notification', 'pending']) {
      const entity = await createEntity(`rollback ${mode} ${tag}`);
      const reservationId = `${tag}${mode === 'notification' ? 'N' : 'P'}1`;
      await insertReservation({ id: reservationId, entityId: entity.Id_Entidad_Reportante, state: 'Confirmada' });
      const [[pendingBefore]] = await target.query(`SELECT Estado FROM pendientes_operativos
        WHERE Clave_Deduplicacion=?`, [entities.entityValidationPendingKey(entity.Id_Entidad_Reportante)]);
      assert.equal(pendingBefore.Estado, 'ACTIVO');
      let calls = 0;
      const dependencies = {};
      if (mode === 'notification') {
        dependencies.notifications = {
          createNotification: async (conn, input) => {
            calls += 1;
            if (calls === 2) throw new Error('fallo inducido en notificación');
            return notifications.createNotification(conn, input);
          },
        };
      } else {
        dependencies.pendingService = {
          ...pending,
          resolveCondition: async (key, conn) => {
            await pending.resolveCondition(key, conn);
            throw new Error('fallo inducido al resolver pendiente');
          },
        };
      }
      await assert.rejects(entities.runValidationTransaction(target, {
        id: entity.Id_Entidad_Reportante, state: 'RECHAZADA', actorId: userIds.admin,
        reason: `Motivo rollback ${mode}.`,
      }, dependencies), mode === 'notification' ? /fallo inducido en notificación/ : /fallo inducido al resolver pendiente/);
      const [[after]] = await target.query(`SELECT e.Estado_Validacion,r.Estado,r.Pendiente_Por_Entidad_En,
        p.Estado AS Estado_Pendiente,
        (SELECT COUNT(*) FROM notificaciones n WHERE n.Entidad_Tipo='ENTIDAD_REPORTANTE'
          AND n.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
          AND n.Tipo='ENTIDAD_REPORTANTE_RECHAZADA') AS avisos
        FROM entidades_reportantes e JOIN reservas r ON r.Id_Entidad_Reportante=e.Id_Entidad_Reportante
        JOIN pendientes_operativos p ON p.Clave_Deduplicacion=?
        WHERE e.Id_Entidad_Reportante=? LIMIT 1`,
      [entities.entityValidationPendingKey(entity.Id_Entidad_Reportante), entity.Id_Entidad_Reportante]);
      assert.equal(after.Estado_Validacion, 'PENDIENTE_VALIDACION');
      assert.equal(after.Estado, 'Confirmada');
      assert.equal(after.Pendiente_Por_Entidad_En, null);
      assert.equal(after.Estado_Pendiente, pendingBefore.Estado);
      assert.equal(Number(after.avisos), 0);
    }
  });

  await check('alta pendiente, filtro de audiencia por permiso y resolución al validar o rechazar', async () => {
    const [rolePermissionRows] = await target.query(`SELECT p.Codigo_Permiso FROM rol_permisos rp
      JOIN permisos p ON p.Id_Permiso=rp.Id_Permiso WHERE rp.Id_Rol=?`, [roleIds.validator]);
    assert.deepEqual(rolePermissionRows.map(row => row.Codigo_Permiso), ['ENTIDADES_REPORTANTES.VALIDAR']);
    const pendingEntity = await createEntity(`bandeja validar ${tag}`);
    const key = entities.entityValidationPendingKey(pendingEntity.Id_Entidad_Reportante);
    let [[pendingRow]] = await target.query(`SELECT p.Id_Pendiente,p.Permiso_Audiencia,p.Estado,p.Datos
      FROM pendientes_operativos p WHERE p.Clave_Deduplicacion=?`, [key]);
    assert.equal(pendingRow.Permiso_Audiencia, 'ENTIDADES_REPORTANTES.VALIDAR');
    assert.equal(pendingRow.Estado, 'ACTIVO');
    const pendingData = typeof pendingRow.Datos === 'string' ? JSON.parse(pendingRow.Datos) : pendingRow.Datos;
    assert.equal(pendingData.ruta, '/Mercadeo?vista=entidades&validacion=PENDIENTE_VALIDACION');
    await target.query(`INSERT INTO reglas_pendientes (Codigo,Nombre,Descripcion,Activa)
      VALUES ('OTRA_AUDIENCIA_F3','Otra audiencia F3','Pendiente aislado de otra audiencia',1)`);
    await pending.upsertCondition({ ruleCode: 'OTRA_AUDIENCIA_F3', deduplicationKey: `F3:OTHER:${tag}`,
      entityType: 'OTRA_ENTIDAD_F3', entityId: tag, audiencePermission: 'OTRA.AUDIENCIA',
      title: 'Otra audiencia', description: 'No visible para el usuario de validación', data: {} });
    const visible = await pending.listMine(userIds.validator, ['ENTIDADES_REPORTANTES.VALIDAR']);
    assert.ok(visible.some(item => item.idPendiente === String(pendingRow.Id_Pendiente)));
    assert.ok(visible.every(item => item.regla !== 'OTRA_AUDIENCIA_F3'));
    await entities.validateEntity(pendingEntity.Id_Entidad_Reportante, 'VALIDADA', userIds.validator);
    [[pendingRow]] = await target.query('SELECT Estado FROM pendientes_operativos WHERE Clave_Deduplicacion=?', [key]);
    assert.equal(pendingRow.Estado, 'RESUELTO_AUTOMATICAMENTE');

    const rejectedEntity = await createEntity(`bandeja rechazar ${tag}`);
    await entities.validateEntity(rejectedEntity.Id_Entidad_Reportante, 'RECHAZADA', userIds.admin,
      'La entidad no pudo verificarse.');
    const [[resolvedAfterReject]] = await target.query('SELECT Estado FROM pendientes_operativos WHERE Clave_Deduplicacion=?',
      [entities.entityValidationPendingKey(rejectedEntity.Id_Entidad_Reportante)]);
    assert.equal(resolvedAfterReject.Estado, 'RESUELTO_AUTOMATICAMENTE');
  });

  await check('el vencimiento conserva las operaciones marcadas y cancela las no marcadas', async () => {
    const entity = await createEntity(`vencimiento ${tag}`);
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'VALIDADA', userIds.admin);
    const expired = '2000-01-01';
    const markedReservation = `${tag}E1`;
    const unmarkedReservation = `${tag}E2`;
    await insertReservation({ id: markedReservation, entityId: entity.Id_Entidad_Reportante,
      state: 'Pendiente de datos', fechaTour: expired, horarioId: schedule.insertId, marker: '2026-01-01 00:00:00' });
    await insertReservation({ id: unmarkedReservation, entityId: entity.Id_Entidad_Reportante,
      state: 'Pendiente de datos', fechaTour: expired, horarioId: schedule.insertId });
    const markedTransfer = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, state: 'Pendiente de datos',
      fechaTransfer: expired, marker: '2026-01-01 00:00:00', titular: `F3 ${tag} vencimiento marcado` });
    const unmarkedTransfer = await insertTransfer({ entityId: entity.Id_Entidad_Reportante, state: 'Pendiente de datos',
      fechaTransfer: expired, titular: `F3 ${tag} vencimiento sin marca` });
    await reservations.actualizarEstadosReservasVencidas(target);
    await transfers.actualizarEstadosTransfersVencidos(target);
    const [[resMarked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [markedReservation]);
    const [[resUnmarked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [unmarkedReservation]);
    assert.equal(resMarked.Estado, 'Pendiente de datos');
    assert.ok(resMarked.Pendiente_Por_Entidad_En);
    assert.equal(resUnmarked.Estado, 'Cancelada');
    assert.equal(resUnmarked.Pendiente_Por_Entidad_En, null);
    const [[transferMarked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM transfers WHERE Id_Transfer=?', [markedTransfer]);
    const [[transferUnmarked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM transfers WHERE Id_Transfer=?', [unmarkedTransfer]);
    assert.equal(transferMarked.Estado, 'Pendiente de datos');
    assert.ok(transferMarked.Pendiente_Por_Entidad_En);
    assert.equal(transferUnmarked.Estado, 'Cancelado');
    assert.equal(transferUnmarked.Pendiente_Por_Entidad_En, null);
  });

  function reservationEditPayload(entityId, dni, fechaTour) {
    return {
      cabeceraReserva: { Id_Tour: tour.insertId, Id_Horario: schedule.insertId, Fecha_Tour: fechaTour,
        Tipo_Reserva: 'Grupal', Id_Canal: channels.hotel, Id_Entidad_Reportante: entityId,
        Nombre_Reportante: 'Contacto de prueba', Telefono_Reportante: '+573001234567' },
      pasajeros: [{ Nombre_Pasajero: 'Pasajero de prueba', DNI: dni, Nacionalidad: 'Colombiana',
        Telefono_Pasajero: '+573001234568', Tipo_Pasajero: 'ADULTO', Id_Punto: point.insertId,
        Precio_Tour: 100, Precio_Pasajero: 100, Comision: 0 }],
      pagos: [{ Tipo: 'Pago Directo', Monto: 100 }],
    };
  }

  await check('guardar tras revalidar limpia la marca y recalcula; entidad inactiva o rechazada bloquea', async () => {
    await target.query('UPDATE tours SET Cupo_Base=300 WHERE Id_Tour=?', [tour.insertId]);
    const [[capacity]] = await target.query('SELECT Cupo_Base FROM tours WHERE Id_Tour=?', [tour.insertId]);
    assert.equal(Number(capacity.Cupo_Base), 300);
    const entity = await createEntity(`revalidación guardar ${tag}`);
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'VALIDADA', userIds.admin);
    const reservationId = `${tag}S1`;
    await insertReservation({ id: reservationId, entityId: entity.Id_Entidad_Reportante,
      state: 'Pendiente de datos', marker: '2026-01-01 00:00:00', horarioId: schedule.insertId,
      includePassenger: true });
    const payload = reservationEditPayload(entity.Id_Entidad_Reportante, `${tag}DNI1`, ymdPlusDays(60));
    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload, {}, userIds.other);
    let [[saved]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [reservationId]);
    assert.equal(saved.Estado, 'Confirmada');
    assert.equal(saved.Pendiente_Por_Entidad_En, null);

    const blockedId = `${tag}S2`;
    await insertReservation({ id: blockedId, entityId: entity.Id_Entidad_Reportante,
      state: 'Pendiente de datos', marker: '2026-01-01 00:00:00', horarioId: schedule.insertId,
      includePassenger: true });
    await target.query('UPDATE entidades_reportantes SET Activo=0 WHERE Id_Entidad_Reportante=?', [entity.Id_Entidad_Reportante]);
    await assert.rejects(reservations.actualizarReservaConPasajerosYPagos(blockedId,
      reservationEditPayload(entity.Id_Entidad_Reportante, `${tag}DNI2`, ymdPlusDays(61)), {}, userIds.other),
    error => error.errorCode === 'ENTITY_INACTIVE' && /entidad reportante está inactiva/i.test(error.message));
    let [[blocked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [blockedId]);
    assert.equal(blocked.Estado, 'Pendiente de datos');
    assert.ok(blocked.Pendiente_Por_Entidad_En);
    await target.query('UPDATE entidades_reportantes SET Activo=1,Estado_Validacion=\'RECHAZADA\' WHERE Id_Entidad_Reportante=?',
      [entity.Id_Entidad_Reportante]);
    await assert.rejects(reservations.actualizarReservaConPasajerosYPagos(blockedId,
      reservationEditPayload(entity.Id_Entidad_Reportante, `${tag}DNI3`, ymdPlusDays(62)), {}, userIds.other),
    error => error.errorCode === 'ENTITY_REJECTED' && /entidad reportante fue rechazada/i.test(error.message));
    [[blocked]] = await target.query('SELECT Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [blockedId]);
    assert.equal(blocked.Estado, 'Pendiente de datos');
    assert.ok(blocked.Pendiente_Por_Entidad_En);
  });

  await check('concurrencia: rechazo mientras se guarda reserva no deja confirmada una entidad rechazada', async () => {
    const entity = await createEntity(`concurrencia ${tag}`);
    await entities.validateEntity(entity.Id_Entidad_Reportante, 'VALIDADA', userIds.admin);
    const reservationId = `${tag}C1`;
    await insertReservation({ id: reservationId, entityId: entity.Id_Entidad_Reportante,
      state: 'Pendiente de datos', marker: '2026-01-01 00:00:00', horarioId: schedule.insertId,
      includePassenger: true });
    const saveHasEntityLock = deferred();
    const rejectionAttemptedLock = deferred();
    const releaseSave = deferred();
    const originalGet = db.getConnection;
    let connectionNumber = 0;
    db.getConnection = async () => {
      const connection = await originalGet();
      const ordinal = ++connectionNumber;
      const query = connection.query.bind(connection);
      connection.query = async (sql, params) => {
        const source = String(sql);
        const entityLock = /FROM\s+entidades_reportantes\b/i.test(source) && /\bFOR\s+UPDATE\b/i.test(source);
        const resultPromise = params === undefined ? query(sql) : query(sql, params);
        if (ordinal === 2 && entityLock) {
          await new Promise(resolve => setTimeout(resolve, 25));
          rejectionAttemptedLock.resolve();
        }
        const result = await resultPromise;
        if (ordinal === 1 && entityLock) {
          saveHasEntityLock.resolve();
          await releaseSave.promise;
        }
        return result;
      };
      return connection;
    };
    const savePromise = reservations.actualizarReservaConPasajerosYPagos(reservationId,
      reservationEditPayload(entity.Id_Entidad_Reportante, `${tag}DNIC`, ymdPlusDays(70)), {}, userIds.other);
    const waitForSignal = (signal, label) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout esperando ${label} en la prueba concurrente.`)), 15000);
      signal.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    let rejectionPromise;
    try {
      await waitForSignal(saveHasEntityLock.promise, 'el bloqueo de entidad del guardado');
      rejectionPromise = entities.validateEntity(entity.Id_Entidad_Reportante, 'RECHAZADA', userIds.admin,
        'Rechazo concurrente de prueba.');
      await waitForSignal(rejectionAttemptedLock.promise, 'el intento concurrente de rechazo');
      releaseSave.resolve();
      await Promise.all([savePromise, rejectionPromise]);
    } finally {
      releaseSave.resolve();
      if (rejectionPromise) await Promise.allSettled([savePromise, rejectionPromise]);
      db.getConnection = originalGet;
    }
    const [[finalState]] = await target.query(`SELECT e.Estado_Validacion,r.Estado,r.Pendiente_Por_Entidad_En
      FROM entidades_reportantes e JOIN reservas r ON r.Id_Entidad_Reportante=e.Id_Entidad_Reportante
      WHERE e.Id_Entidad_Reportante=? AND r.Id_Reserva=?`, [entity.Id_Entidad_Reportante, reservationId]);
    assert.equal(finalState.Estado_Validacion, 'RECHAZADA');
    assert.equal(finalState.Estado, 'Pendiente de datos');
    assert.ok(finalState.Pendiente_Por_Entidad_En);
  });

  await check('el script demo carga y borra datos/pending/avisos en el esquema posterior a 0018', async () => {
    const [[range]] = await target.query('SELECT Id_Rango FROM transfers_rangos ORDER BY Id_Rango LIMIT 1');
    if (!range) await target.query(`INSERT INTO transfers_rangos (Descripcion,Minimo,Maximo) VALUES ('Rango F3',1,4)`);
    const [[service]] = await target.query('SELECT Id_Servicio FROM servicios_transfer ORDER BY Id_Servicio LIMIT 1');
    if (!service) await target.query(`INSERT INTO servicios_transfer (Nombre_Servicio) VALUES ('Servicio F3')`);
    const demoLoad = await fs.readFile(path.join(__dirname, '..', 'database', 'demo', 'mercadeo_fase2_datos.sql'), 'utf8');
    for (const statement of parseMigrationSql(demoLoad)) await target.query(statement);
    const [[loaded]] = await target.query(`SELECT
      (SELECT COUNT(*) FROM entidades_reportantes WHERE Nombre LIKE 'MKT2D_%') AS entidades,
      (SELECT COUNT(*) FROM reservas WHERE Id_Reserva LIKE 'MKT2D_%') AS reservas,
      (SELECT COUNT(*) FROM transfers WHERE Nombre_Titular LIKE 'MKT2D_%' OR Observaciones LIKE 'MKT2D_%') AS transfers,
      (SELECT COUNT(*) FROM reservas WHERE Id_Reserva LIKE 'MKT2D_%' AND Pendiente_Por_Entidad_En IS NULL) AS reservas_marca_0018,
      (SELECT COUNT(*) FROM transfers WHERE (Nombre_Titular LIKE 'MKT2D_%' OR Observaciones LIKE 'MKT2D_%')
        AND Pendiente_Por_Entidad_En IS NULL) AS transfers_marca_0018`);
    assert.deepEqual(Object.values(loaded).map(Number), [6, 4, 2, 4, 2]);
    const [[demoPendingEntity]] = await target.query(`SELECT Id_Entidad_Reportante FROM entidades_reportantes
      WHERE Nombre='MKT2D_Agencia internacional pendiente' LIMIT 1`);
    await pending.upsertCondition({ ruleCode: 'ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION',
      deduplicationKey: entities.entityValidationPendingKey(demoPendingEntity.Id_Entidad_Reportante),
      entityType: 'ENTIDAD_REPORTANTE', entityId: demoPendingEntity.Id_Entidad_Reportante,
      audiencePermission: 'ENTIDADES_REPORTANTES.VALIDAR', title: 'Entidad demo pendiente',
      description: 'Pendiente para verificar el borrado de demostración.', data: { ruta: '/Mercadeo?vista=entidades' } });
    await notifications.createNotification(target, { userId: String(userIds.validator), type: 'PENDIENTE',
      title: 'Pendiente demo', message: 'Aviso demo asociado al pendiente.', entityType: 'ENTIDAD_REPORTANTE',
      entityId: String(demoPendingEntity.Id_Entidad_Reportante),
      data: { pendienteId: entities.entityValidationPendingKey(demoPendingEntity.Id_Entidad_Reportante) },
      deduplicationKey: `F3_DEMO_PENDING:${demoPendingEntity.Id_Entidad_Reportante}` });
    await notifications.createNotification(target, { userId: String(userIds.validator), type: 'ENTIDAD_REPORTANTE_RECHAZADA',
      title: 'Rechazo demo', message: 'Aviso de rechazo demo.', entityType: 'ENTIDAD_REPORTANTE',
      entityId: String(demoPendingEntity.Id_Entidad_Reportante),
      deduplicationKey: `F3_DEMO_REJECT:${demoPendingEntity.Id_Entidad_Reportante}` });
    const unrelated = await createEntity(`conservar fuera de demo ${tag}`);
    const unrelatedPendingKey = entities.entityValidationPendingKey(unrelated.Id_Entidad_Reportante);
    const [[unrelatedPending]] = await target.query('SELECT Id_Pendiente FROM pendientes_operativos WHERE Clave_Deduplicacion=?',
      [unrelatedPendingKey]);
    await notifications.createNotification(target, { userId: String(userIds.validator), type: 'PENDIENTE',
      title: 'Pendiente ajeno a demo', message: 'Este aviso debe conservarse.', entityType: 'ENTIDAD_REPORTANTE',
      entityId: String(unrelated.Id_Entidad_Reportante), data: { pendienteId: String(unrelatedPending.Id_Pendiente) },
      deduplicationKey: `F3_UNRELATED_PENDING:${unrelated.Id_Entidad_Reportante}` });
    const demoDelete = await fs.readFile(path.join(__dirname, '..', 'database', 'demo', 'mercadeo_fase2_borrar.sql'), 'utf8');
    for (const statement of parseMigrationSql(demoDelete)) await target.query(statement);
    const [[afterDelete]] = await target.query(`SELECT
      (SELECT COUNT(*) FROM entidades_reportantes WHERE Nombre LIKE 'MKT2D_%') AS entidades,
      (SELECT COUNT(*) FROM pendientes_operativos p JOIN entidades_reportantes e
        ON p.Entidad_Tipo='ENTIDAD_REPORTANTE' AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
        WHERE e.Nombre LIKE 'MKT2D_%') AS pendientes,
      (SELECT COUNT(*) FROM pendientes_eventos pe JOIN pendientes_operativos p ON p.Id_Pendiente=pe.Id_Pendiente
        JOIN entidades_reportantes e ON p.Entidad_Tipo='ENTIDAD_REPORTANTE'
          AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR) WHERE e.Nombre LIKE 'MKT2D_%') AS eventos,
      (SELECT COUNT(*) FROM notificaciones n JOIN entidades_reportantes e
        ON n.Entidad_Tipo='ENTIDAD_REPORTANTE' AND n.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
        WHERE e.Nombre LIKE 'MKT2D_%' AND n.Tipo IN ('PENDIENTE','ENTIDAD_REPORTANTE_RECHAZADA')) AS avisos,
      (SELECT COUNT(*) FROM pendientes_operativos WHERE Clave_Deduplicacion=?) AS pendiente_no_demo,
      (SELECT COUNT(*) FROM pendientes_eventos pe JOIN pendientes_operativos p ON p.Id_Pendiente=pe.Id_Pendiente
        WHERE p.Clave_Deduplicacion=?) AS evento_no_demo,
      (SELECT COUNT(*) FROM notificaciones WHERE Entidad_Tipo='ENTIDAD_REPORTANTE' AND Entidad_Id=?
        AND Tipo='PENDIENTE') AS aviso_no_demo`,
    [unrelatedPendingKey, unrelatedPendingKey, String(unrelated.Id_Entidad_Reportante)]);
    assert.deepEqual(Object.values(afterDelete).map(Number), [0, 0, 0, 0, 1, 1, 1]);
  });

  const [[serverAfter]] = await server.query('SELECT DATABASE() AS selected_database');
  assert.equal(serverAfter.selected_database, null);
  t.diagnostic(JSON.stringify({
    mysqlVersion: serverContext.mysql_version,
    serverSchemaSelected: serverAfter.selected_database,
    disposableSchema: database,
    copiedFromSir2: false,
    migrationsAppliedInTemporarySchema: expectedTail,
    checks,
    result: 'PASS',
  }));
});
