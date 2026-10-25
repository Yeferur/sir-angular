const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..');
for (const file of ['.env', path.join('env', '.env')]) {
  dotenv.config({ path: path.join(backendRoot, file), override: false, quiet: true });
}

function required(name, fallback = null) {
  const value = process.env[name] || (fallback ? process.env[fallback] : null);
  if (!value) throw new Error(`Falta ${name}${fallback ? `/${fallback}` : ''}.`);
  return value;
}

function getArguments(argv) {
  if (argv.length !== 3 || argv[0] !== '--confirm-sir2' || argv[1] !== '--backup') {
    throw new Error('Uso: node scripts/integration-comisiones-grupos-sir2.js --confirm-sir2 --backup <ruta-backup-sir2.sql>');
  }
  return path.resolve(argv[2]);
}

function parseBackupCounts(sql) {
  const counts = new Map();
  for (const match of sql.matchAll(/DROP TABLE IF EXISTS `([^`]+)`;/g)) counts.set(match[1], 0);
  let position = 0;
  while ((position = sql.indexOf('INSERT INTO `', position)) >= 0) {
    const tableMatch = /^INSERT INTO `([^`]+)`/.exec(sql.slice(position));
    if (!tableMatch) { position += 12; continue; }
    const table = tableMatch[1];
    const valuesAt = sql.indexOf(' VALUES', position);
    if (valuesAt < 0) break;
    let index = valuesAt + 7;
    let quoted = false;
    let escaped = false;
    let depth = 0;
    let rows = 0;
    for (; index < sql.length; index++) {
      const char = sql[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === "'") quoted = false;
        continue;
      }
      if (char === "'") { quoted = true; continue; }
      if (char === ';') break;
      if (char === '(') { if (depth === 0) rows++; depth++; }
      else if (char === ')') depth--;
    }
    counts.set(table, (counts.get(table) || 0) + rows);
    position = index + 1;
  }
  return counts;
}

function mysqlOptions(database = 'sir2') {
  return {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

async function getCurrentCounts(conn) {
  const [tableRows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
  );
  const counts = new Map();
  for (const { TABLE_NAME: table } of tableRows) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS Total FROM \`${table}\``);
    counts.set(table, Number(row.Total));
  }
  return counts;
}

function compareCounts(expected, actual) {
  const names = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  return names.flatMap((table) => {
    const before = expected.get(table);
    const after = actual.get(table);
    return before === after ? [] : [{ table, expected: before ?? null, actual: after ?? null }];
  });
}

async function restoreBackup(backupSql) {
  const restore = await mysql.createConnection({ ...mysqlOptions('sir2'), multipleStatements: true });
  try {
    const [[row]] = await restore.query('SELECT DATABASE() AS Database_Name');
    if (row.Database_Name !== 'sir2') throw new Error('La restauración fue rechazada: la conexión no apunta a sir2.');
    await restore.query(backupSql);
  } finally {
    await restore.end();
  }
}

function quoteIdentifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Identificador MySQL inesperado: ${value}`);
  return `\`${value}\``;
}

async function resetAutoIncrementValues(conn, baseline) {
  for (const [table, value] of baseline) {
    if (value == null) continue;
    await conn.query(`ALTER TABLE ${quoteIdentifier(table)} AUTO_INCREMENT = ${Number(value)}`);
  }
}

async function removeGroupFiles(groupIds) {
  const privateRoot = path.resolve(backendRoot, 'private_uploads', 'comisiones');
  for (const id of new Set(groupIds.map(String))) {
    if (!/^\d+$/.test(id)) continue;
    const directory = path.resolve(privateRoot, `grupo-${id}`);
    if (!directory.startsWith(`${privateRoot}${path.sep}`)) throw new Error('Ruta de limpieza fuera del almacén privado.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function verify(condition, message, result) {
  assert.ok(condition, message);
  result.push(message);
}

async function main() {
  const backupPath = getArguments(process.argv.slice(2));
  if ((process.env.DB_NAME || process.env.DB_DATABASE) !== 'sir2') {
    throw new Error('Destino rechazado: la configuración debe señalar exactamente sir2.');
  }
  const backupSql = await fs.readFile(backupPath, 'utf8');
  if (!backupSql.startsWith('-- SIR Angular logical backup\n-- Database: sir2\n')) {
    throw new Error('El backup debe ser un respaldo lógico reciente de sir2.');
  }
  const backupSha256 = crypto.createHash('sha256').update(backupSql).digest('hex');
  const backupCounts = parseBackupCounts(backupSql);
  if (!backupCounts.size) throw new Error('No se pudieron leer las tablas del backup.');

  const conn = await mysql.createConnection(mysqlOptions());
  const db = require('../database/db');
  const { initializeSchemaCapabilities } = require('../services/schema-capabilities');
  const service = require('../services/Comisiones/comisiones-grupos.service');
  const report = {
    database: 'sir2', backup: backupPath, backupSha256,
    fixturePrefix: 'ZZ_TEST_', checks: [], cleanupErrors: [],
    initialCountDifferences: [], finalCountDifferences: [], restoredBackup: false,
  };
  let entityId = null;
  let tourId = null;
  let scheduleId = null;
  let dateTour = null;
  let actorId = null;
  let reservationIds = [];
  const createdReservationIds = [];
  let groupIds = [];
  let entityInserted = false;
  let confirmationInserted = false;
  let writesStarted = false;
  let primaryError = null;
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const fixtureName = `ZZ_TEST_H_${suffix}`;
  const fixtureNameNormalized = fixtureName.toUpperCase();
  const receiptBytes = Buffer.from('%PDF-1.7\nZZ_TEST comprobante de integración\n%%EOF\n');
  const autoIncrementTables = [
    'entidades_reportantes', 'pasajeros', 'confirmaciones_jornada',
    'comisiones_grupos_pago', 'liquidaciones', 'historial', 'detalle_historial',
  ];
  const autoIncrementBaseline = new Map();
  let dbPoolClosed = false;

  try {
    const [[currentDatabase]] = await conn.query('SELECT DATABASE() AS Database_Name');
    if (currentDatabase.Database_Name !== 'sir2') throw new Error('Conexión inesperada fuera de sir2.');
    const currentCounts = await getCurrentCounts(conn);
    report.initialCountDifferences = compareCounts(backupCounts, currentCounts);
    if (report.initialCountDifferences.length) {
      throw new Error(`El conteo actual ya difiere del backup antes de los fixtures: ${JSON.stringify(report.initialCountDifferences)}`);
    }
    const [autoRows] = await conn.query(
      `SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
      [autoIncrementTables],
    );
    for (const row of autoRows) autoIncrementBaseline.set(row.TABLE_NAME, row.AUTO_INCREMENT);
    const [[channel]] = await conn.query(
      `SELECT Id_Canal FROM canales_reservas
        WHERE Id_Canal = 1 AND Nombre_Canal = 'HOTEL' AND Tiene_Comision = 1`,
    );
    if (!channel) throw new Error('No existe el canal HOTEL esperado para la fixture.');
    const [[schedule]] = await conn.query(
      `SELECT H.Id_Horario, H.Id_Tour, T.Nombre_Tour
         FROM horarios H INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
        WHERE H.Id_Tour IS NOT NULL ORDER BY H.Id_Horario LIMIT 1`,
    );
    if (!schedule) throw new Error('No existe un horario/tour para asociar la reserva de prueba.');
    const [[dateRow]] = await conn.query(
      `SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d') AS Fecha_Tour`,
    );
    const [[actor]] = await conn.query('SELECT Id_Usuario FROM usuarios ORDER BY Id_Usuario LIMIT 1');
    if (!actor) throw new Error('No existe un usuario válido para dejar el actor de historial.');
    tourId = Number(schedule.Id_Tour);
    scheduleId = Number(schedule.Id_Horario);
    dateTour = dateRow.Fecha_Tour;
    actorId = actor.Id_Usuario;
    reservationIds = [`ZZ_TEST_R1_${suffix}`, `ZZ_TEST_R2_${suffix}`, `ZZ_TEST_R3_${suffix}`];
    verify(reservationIds.every((id) => id.length <= 20), 'Las claves ZZ_TEST_ caben en reservas.Id_Reserva.', report.checks);

    const [[existingReservations]] = await conn.query(
      'SELECT COUNT(*) AS Total FROM reservas WHERE Id_Horario = ? AND Fecha_Tour = ?',
      [scheduleId, dateTour],
    );
    const [[existingJourney]] = await conn.query(
      'SELECT COUNT(*) AS Total FROM confirmaciones_jornada WHERE Id_Tour = ? AND Fecha_Tour = ?',
      [tourId, dateTour],
    );
    if (Number(existingReservations.Total) || Number(existingJourney.Total)) {
      throw new Error('El horario/fecha de prueba tiene datos existentes; no se modificarán.');
    }

    const [existingFixtureIds] = await conn.query(
      `SELECT Id_Reserva FROM reservas WHERE Id_Reserva IN (${reservationIds.map(() => '?').join(',')})`,
      reservationIds,
    );
    if (existingFixtureIds.length) throw new Error('Las claves de reserva ZZ_TEST_ ya están ocupadas.');

    writesStarted = true;
    const [entityInsert] = await conn.query(
      `INSERT INTO entidades_reportantes
       (Tipo, Nombre, Nombre_Normalizado, Activo, Estado_Validacion, Creado_Por, Validado_Por, Validado_En)
       VALUES ('HOTEL', ?, ?, 1, 'VALIDADA', ?, ?, NOW())`,
      [fixtureName, fixtureNameNormalized, actorId, actorId],
    );
    entityId = String(entityInsert.insertId);
    entityInserted = true;

    async function insertReservation(index, commission) {
      const id = reservationIds[index - 1];
      await conn.query(
        `INSERT INTO reservas
         (Id_Reserva, Tipo_Reserva, Id_Horario, Fecha_Tour, Id_Canal,
          Id_Entidad_Reportante, Nombre_Reportante, Estado, Creado_Por)
         VALUES (?, 'ZZ_TEST_Grupal', ?, ?, 1, ?, ?, 'Confirmada', ?)`,
        [id, scheduleId, dateTour, entityId, fixtureName, actorId],
      );
      createdReservationIds.push(id);
      await conn.query(
        `INSERT INTO pasajeros
         (Id_Reserva, Nombre_Pasajero, DNI, Tipo_Pasajero, Precio_Tour,
          Precio_Pasajero, Comision, Confirmacion)
         VALUES (?, ?, ?, 'ADULTO', 100000, 100000, ?, 1)`,
        [id, `ZZ_TEST_P${index}_${suffix}`, `ZZ_TEST_DNI_${suffix}_${index}`, commission],
      );
    }

    await insertReservation(1, 12000);
    await conn.query(
      `INSERT INTO confirmaciones_jornada
       (Id_Tour, Fecha_Tour, Total_Pasajeros, Total_Viajaron, Total_No_Viajaron, Confirmada_En, Confirmada_Por)
       VALUES (?, ?, 1, 1, 0, NOW(), ?)`,
      [tourId, dateTour, actorId],
    );
    confirmationInserted = true;
    await initializeSchemaCapabilities(db);

    const groupKey = `e${entityId}~${dateTour}`;
    let listing = await service.listarGrupos({ desde: dateTour, hasta: dateTour, idEntidad: entityId, limit: 25, page: 1 });
    let row = listing.grupos.find((item) => item.Id === groupKey);
    verify(Boolean(row), 'El listado paginado devuelve la entidad y el día de prueba.', report.checks);
    verify(Number(row?.Monto_Pendiente) === 12000 && Number(row?.Cantidad_Reservas_Pendientes) === 1,
      'El listado inicial muestra el total y la cantidad esperados.', report.checks);
    verify(Boolean(row?.Puede_Pagar), 'El listado identifica la jornada cerrada como pagable.', report.checks);

    let detail = await service.obtenerDetalleGrupo(groupKey, { page: 1, limit: 25 });
    verify(detail.reservasPendientes.some((reservation) => reservation.Id_Reserva === reservationIds[0]),
      'El detalle bajo demanda incluye la primera reserva.', report.checks);

    const firstPayment = await service.marcarGrupoPagado(groupKey, {
      Monto_Pendiente_Esperado: 12000, Cantidad_Reservas_Pendientes_Esperada: 1,
    }, actorId, {
      buffer: receiptBytes, mimetype: 'application/pdf', originalname: 'ZZ_TEST_comprobante.pdf',
    });
    groupIds.push(firstPayment.Id_Grupo_Comision);
    verify(firstPayment.Numero_Lote === 1 && firstPayment.Monto_Pagado === 12000,
      'El pago inicial crea el lote 1 con monto y cantidad correctos.', report.checks);

    detail = await service.obtenerDetalleGrupo(groupKey, { page: 1, limit: 25 });
    verify(detail.lotes.some((lot) => lot.Id_Grupo_Comision === firstPayment.Id_Grupo_Comision
      && lot.Tiene_Comprobante && lot.Estado === 'PAGADO'),
    'El detalle presenta el lote pagado y su comprobante.', report.checks);
    const firstLotDetail = await service.obtenerDetalleGrupo(groupKey, {
      loteId: firstPayment.Id_Grupo_Comision, page: 1, limit: 25,
    });
    verify(firstLotDetail.loteDetalle.reservas.some((reservation) => reservation.Id_Reserva === reservationIds[0]),
      'La página de detalle del lote conserva su reserva.', report.checks);
    const proof = await service.obtenerComprobante(firstPayment.Id_Grupo_Comision);
    const proofContent = await fs.readFile(proof.absolutePath);
    verify(proofContent.equals(receiptBytes) && proof.Comprobante_Nombre_Original === 'ZZ_TEST_comprobante.pdf',
      'La descarga autenticada de servicio lee el comprobante almacenado sin transformarlo.', report.checks);

    await insertReservation(2, 17000);
    await conn.query(
      `UPDATE confirmaciones_jornada
          SET Total_Pasajeros = 2, Total_Viajaron = 2, Total_No_Viajaron = 0, Confirmada_En = NOW(), Confirmada_Por = ?
        WHERE Id_Tour = ? AND Fecha_Tour = ?`,
      [actorId, tourId, dateTour],
    );
    listing = await service.listarGrupos({ desde: dateTour, hasta: dateTour, idEntidad: entityId, limit: 25, page: 1 });
    row = listing.grupos.find((item) => item.Id === groupKey);
    verify(Boolean(row?.Tiene_Ajuste_Pendiente) && Number(row.Monto_Pendiente) === 17000
      && Number(row.Cantidad_Reservas_Pendientes) === 1,
    'Una reserva posterior aparece como ajuste pendiente en la misma fila diaria.', report.checks);

    let concurrencyError = null;
    try {
      await service.marcarGrupoPagado(groupKey, {
        Monto_Pendiente_Esperado: 16999, Cantidad_Reservas_Pendientes_Esperada: 1,
      }, actorId);
    } catch (error) { concurrencyError = error; }
    verify(concurrencyError?.status === 409 && concurrencyError?.errorCode === 'GROUP_TOTAL_CHANGED'
      && Number(concurrencyError?.details?.Monto_Pendiente_Actual) === 17000
      && Number(concurrencyError?.details?.Cantidad_Reservas_Pendientes_Actual) === 1,
    'El endpoint rechaza el total obsoleto con 409 y los valores actuales.', report.checks);

    const adjustmentPayment = await service.marcarGrupoPagado(groupKey, {
      Monto_Pendiente_Esperado: 17000, Cantidad_Reservas_Pendientes_Esperada: 1,
    }, actorId);
    groupIds.push(adjustmentPayment.Id_Grupo_Comision);
    verify(adjustmentPayment.Numero_Lote === 2 && adjustmentPayment.Monto_Pagado === 17000,
      'El pago del ajuste crea un nuevo lote 2 y no modifica el lote 1.', report.checks);

    const annulled = await service.anularPago(firstPayment.Id_Grupo_Comision, { Motivo: 'ZZ_TEST_prueba anulacion' }, actorId);
    verify(annulled.Estado === 'ANULADO' && annulled.Reservas_Liberadas === 1
      && annulled.Monto_Pagado_Conservado === 12000,
    'La anulación libera la liquidación y conserva el histórico del lote 1.', report.checks);
    const retainedProof = await service.obtenerComprobante(firstPayment.Id_Grupo_Comision);
    verify(retainedProof.Comprobante_Nombre_Original === 'ZZ_TEST_comprobante.pdf',
      'La anulación conserva el comprobante asociado al lote histórico.', report.checks);
    const retainedDetail = await service.obtenerDetalleGrupo(groupKey, {
      loteId: firstPayment.Id_Grupo_Comision, page: 1, limit: 25,
    });
    verify(retainedDetail.lotes.some((lot) => lot.Id_Grupo_Comision === firstPayment.Id_Grupo_Comision && lot.Estado === 'ANULADO')
      && retainedDetail.loteDetalle.reservas.some((reservation) => reservation.Id_Reserva === reservationIds[0]),
    'El lote anulado conserva la membresía y sigue visible en el historial.', report.checks);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (entityInserted && entityId) {
        const [groups] = await conn.query(
          `SELECT Id_Grupo_Comision FROM comisiones_grupos_pago
            WHERE Id_Entidad_Reportante = ? AND Fecha_Tour = ?`,
          [entityId, dateTour],
        );
        groupIds = [...new Set([...groupIds, ...groups.map((group) => String(group.Id_Grupo_Comision))])];
      }
      if (groupIds.length) {
        await removeGroupFiles(groupIds);
        const placeholders = groupIds.map(() => '?').join(',');
        await conn.query(
          `DELETE D FROM detalle_historial D
            INNER JOIN historial H ON H.Id_Historial = D.Id_Historial
           WHERE H.Tabla = 'comisiones_grupos_pago' AND H.Id_Registro IN (${placeholders})`,
          groupIds,
        );
        await conn.query(
          `DELETE FROM historial WHERE Tabla = 'comisiones_grupos_pago' AND Id_Registro IN (${placeholders})`,
          groupIds,
        );
        await conn.query(
          `DELETE FROM liquidaciones WHERE Id_Reserva IN (${reservationIds.map(() => '?').join(',')})`,
          reservationIds,
        );
        await conn.query(
          `DELETE FROM comisiones_grupos_pago_reservas WHERE Id_Grupo_Comision IN (${placeholders})`,
          groupIds,
        );
        await conn.query(
          `DELETE FROM comisiones_grupos_pago WHERE Id_Grupo_Comision IN (${placeholders})`,
          groupIds,
        );
      } else if (entityId) {
        await removeGroupFiles(groupIds);
      }
      if (confirmationInserted && tourId && dateTour) {
        await conn.query('DELETE FROM confirmaciones_jornada WHERE Id_Tour = ? AND Fecha_Tour = ?', [tourId, dateTour]);
      }
      if (createdReservationIds.length) {
        await conn.query(`DELETE FROM pasajeros WHERE Id_Reserva IN (${createdReservationIds.map(() => '?').join(',')})`, createdReservationIds);
        await conn.query(`DELETE FROM reservas WHERE Id_Reserva IN (${createdReservationIds.map(() => '?').join(',')})`, createdReservationIds);
      }
      if (entityInserted && entityId) await conn.query('DELETE FROM entidades_reportantes WHERE Id_Entidad_Reportante = ?', [entityId]);
      if (writesStarted) await resetAutoIncrementValues(conn, autoIncrementBaseline);
    } catch (error) {
      report.cleanupErrors.push(error.message);
    }

    try {
      report.finalCountDifferences = compareCounts(backupCounts, await getCurrentCounts(conn));
    } catch (error) {
      report.cleanupErrors.push(`No se pudieron comparar conteos finales: ${error.message}`);
      report.finalCountDifferences = [{ table: '(conteo)', expected: null, actual: null }];
    }
    await conn.end();

    if (report.finalCountDifferences.length && writesStarted) {
      try {
        await restoreBackup(backupSql);
        report.restoredBackup = true;
        const checkConn = await mysql.createConnection(mysqlOptions());
        try { report.finalCountDifferences = compareCounts(backupCounts, await getCurrentCounts(checkConn)); }
        finally { await checkConn.end(); }
      } catch (error) {
        report.cleanupErrors.push(`Falló la restauración del backup: ${error.message}`);
      }
    }
    if (groupIds.length) {
      try { await removeGroupFiles(groupIds); }
      catch (error) { report.cleanupErrors.push(`No se pudieron eliminar archivos de prueba: ${error.message}`); }
    }
    await db.end();
    dbPoolClosed = true;
  }

  report.cleanupSucceeded = report.cleanupErrors.length === 0 && report.finalCountDifferences.length === 0;
  report.testSucceeded = !primaryError && report.checks.length > 0;
  report.error = primaryError?.stack || primaryError?.message || null;
  console.log(JSON.stringify(report, null, 2));
  if (!report.testSucceeded || !report.cleanupSucceeded) process.exitCode = 1;
  if (dbPoolClosed) return;
}

main().catch((error) => {
  console.error(`Integración de Comisiones contra sir2 falló: ${error.stack || error.message}`);
  process.exitCode = 1;
});
