const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

test('rechazo de entidad en el MySQL local configurado', {
  skip: process.env.RUN_DB_TESTS !== '1', timeout: 120000,
}, async (t) => {
  const db = require('../database/db');
  const entities = require('../services/EntidadesReportantes/entidades-reportantes.service');
  const { resolverEstadoReserva } = require('../services/Reservas/reservas.service');
  const prefix = `ZZ_TEST_${randomBytes(3).toString('hex')}`;
  const fixtures = { entities: [], reservations: [], transfers: [], points: [], events: [] };
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  assert.ok(localHosts.has(String(process.env.DB_HOST || '').toLowerCase()),
    'RUN_DB_TESTS solo permite la base local configurada.');
  const configuredDatabase = process.env.DB_NAME || process.env.DB_DATABASE;
  assert.ok(configuredDatabase && configuredDatabase !== 'sir',
    'Configura DB_NAME o DB_DATABASE con la única base local de pruebas; sir está protegida.');

  const [selection] = await db.query('SELECT DATABASE() AS nombre');
  assert.equal(selection[0]?.nombre, configuredDatabase);
  const [rules] = await db.query(`SELECT Codigo FROM reglas_pendientes WHERE Codigo IN
    ('ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION','ENTIDAD_REPORTANTE_RECHAZADA_SIN_REASIGNAR')`);
  assert.equal(rules.length, 2,
    'La prueba requiere las reglas de 0018 y 0020 ya aplicadas; esta prueba no aplica migraciones.');
  const [[channel]] = await db.query("SELECT Id_Canal FROM canales_reservas WHERE UPPER(TRIM(Nombre_Canal))='HOTEL' LIMIT 1");
  const [users] = await db.query('SELECT Id_Usuario FROM usuarios WHERE Activo=1 ORDER BY Id_Usuario LIMIT 2');
  assert.ok(channel && users.length === 2, 'Se requieren un canal HOTEL y dos usuarios activos existentes.');
  const userIds = users.map(user => user.Id_Usuario);
  const date = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  async function createEntity(suffix, state = 'PENDIENTE_VALIDACION') {
    const name = `${prefix}_${suffix}`;
    const [result] = await db.query(`INSERT INTO entidades_reportantes
      (Tipo,Nombre,Nombre_Normalizado,Activo,Estado_Validacion,Creado_Por)
      VALUES ('HOTEL',?,?,1,?,?)`, [name, entities.searchKey(name), state, userIds[0]]);
    fixtures.entities.push(String(result.insertId));
    return result.insertId;
  }

  async function createReservation(suffix, entityId, creatorId) {
    const id = `${prefix}_${suffix}`;
    await db.query(`INSERT INTO reservas
      (Id_Reserva,Tipo_Reserva,Fecha_Tour,Fecha_Registro,Id_Canal,Id_Entidad_Reportante,
       Nombre_Reportante,Telefono_Reportante,Estado,Creado_Por,Pendiente_Por_Entidad_En)
      VALUES (?,'Grupal',?,NOW(),?,?,'ZZ_TEST_Contacto','3001234567','Confirmada',?,NOW())`,
    [id, date, channel.Id_Canal, entityId, creatorId]);
    fixtures.reservations.push(id);
    return id;
  }

  async function createTransfer(suffix, entityId, creatorId) {
    const [result] = await db.query(`INSERT INTO transfers
      (Id_Canal,Id_Entidad_Reportante,Nombre_Titular,Cantidad_Personas,Fecha_Transfer,
       Hora_Recogida,Estado,Fecha_Registro,Creado_Por,Pendiente_Por_Entidad_En)
      VALUES (?,?,?,2,?,'08:00','Confirmado',NOW(),?,NOW())`,
    [channel.Id_Canal, entityId, `${prefix}_${suffix}`, date, creatorId]);
    fixtures.transfers.push(String(result.insertId));
    return result.insertId;
  }

  function nextEvent(suffix) {
    const eventId = `${prefix}_${suffix}`;
    fixtures.events.push(eventId);
    return () => eventId;
  }

  async function reject(connection, entityId, suffix, other = {}) {
    return entities.runValidationTransaction(connection, {
      id: entityId, state: 'RECHAZADA', actorId: userIds[0], reason: 'ZZ_TEST_motivo',
    }, { eventIdFactory: nextEvent(suffix), websocket: { sendToUser() {} }, ...other });
  }

  async function cleanup() {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (fixtures.events.length) {
        await conn.query(`DELETE FROM notificaciones WHERE Entidad_Tipo='ENTIDAD_REPORTANTE_RECHAZADA'
          AND Entidad_Id IN (?)`, [fixtures.events]);
      }
      const keys = fixtures.entities.map(id => entities.entityValidationPendingKey(id));
      const conditions = [];
      const params = [];
      if (fixtures.events.length) { conditions.push('(Entidad_Tipo=? AND Entidad_Id IN (?))'); params.push('ENTIDAD_REPORTANTE_RECHAZADA', fixtures.events); }
      if (keys.length) { conditions.push('Clave_Deduplicacion IN (?)'); params.push(keys); }
      if (conditions.length) {
        const [rows] = await conn.query(`SELECT Id_Pendiente FROM pendientes_operativos WHERE ${conditions.join(' OR ')}`, params);
        const ids = rows.map(row => row.Id_Pendiente);
        if (ids.length) {
          await conn.query('DELETE FROM pendientes_eventos WHERE Id_Pendiente IN (?)', [ids]);
          await conn.query('DELETE FROM pendientes_operativos WHERE Id_Pendiente IN (?)', [ids]);
        }
      }
      const historyWhere = [];
      const historyParams = [];
      for (const [table, ids] of [
        ['entidades_reportantes', fixtures.entities], ['reservas', fixtures.reservations],
        ['transfers', fixtures.transfers],
      ]) {
        if (!ids.length) continue;
        historyWhere.push('(Tabla=? AND Id_Registro IN (?))'); historyParams.push(table, ids);
      }
      if (historyWhere.length) {
        const [rows] = await conn.query(`SELECT Id_Historial FROM historial WHERE ${historyWhere.join(' OR ')}`, historyParams);
        const ids = rows.map(row => row.Id_Historial);
        if (ids.length) {
          await conn.query('DELETE FROM detalle_historial WHERE Id_Historial IN (?)', [ids]);
          await conn.query('DELETE FROM historial WHERE Id_Historial IN (?)', [ids]);
        }
      }
      if (fixtures.reservations.length) await conn.query('DELETE FROM reservas WHERE Id_Reserva IN (?) AND Id_Reserva LIKE ?', [fixtures.reservations, 'ZZ_TEST_%']);
      if (fixtures.transfers.length) await conn.query('DELETE FROM transfers WHERE Id_Transfer IN (?) AND Nombre_Titular LIKE ?', [fixtures.transfers, 'ZZ_TEST_%']);
      if (fixtures.entities.length) {
        await conn.query('DELETE FROM entidad_reportante_puntos WHERE Id_Entidad_Reportante IN (?)', [fixtures.entities]);
        await conn.query('DELETE FROM perfiles_comision_entidad WHERE Id_Entidad_Reportante IN (?)', [fixtures.entities]);
        await conn.query('DELETE FROM entidades_reportantes WHERE Id_Entidad_Reportante IN (?) AND Nombre LIKE ?', [fixtures.entities, 'ZZ_TEST_%']);
      }
      if (fixtures.points.length) await conn.query('DELETE FROM puntos WHERE Id_Punto IN (?) AND Nombre_Punto LIKE ?', [fixtures.points, 'ZZ_TEST_%']);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }

  try {
    await t.test('FK RESTRICT exige separar transfer y borrar puntos/perfil antes de entidad', async () => {
      const entityId = await createEntity('FK');
      const reservationId = await createReservation('FK_R', entityId, userIds[0]);
      const transferId = await createTransfer('FK_T', entityId, userIds[1]);
      const [point] = await db.query('INSERT INTO puntos (Nombre_Punto,Activo) VALUES (?,1)', [`${prefix}_P`]);
      fixtures.points.push(String(point.insertId));
      await db.query('INSERT INTO entidad_reportante_puntos (Id_Entidad_Reportante,Id_Punto) VALUES (?,?)', [entityId, point.insertId]);
      await db.query('INSERT INTO perfiles_comision_entidad (Id_Entidad_Reportante,Activo) VALUES (?,1)', [entityId]);
      const [fks] = await db.query(`SELECT k.TABLE_NAME,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
          AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
        WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME='entidades_reportantes'`);
      assert.deepEqual(new Set(fks.map(row => row.TABLE_NAME)),
        new Set(['reservas', 'transfers', 'entidad_reportante_puntos', 'perfiles_comision_entidad']));
      assert.equal(fks.find(row => row.TABLE_NAME === 'transfers').DELETE_RULE, 'RESTRICT');
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('UPDATE reservas SET Id_Entidad_Reportante=NULL WHERE Id_Reserva=?', [reservationId]);
        await conn.query('DELETE FROM entidad_reportante_puntos WHERE Id_Entidad_Reportante=?', [entityId]);
        await conn.query('DELETE FROM perfiles_comision_entidad WHERE Id_Entidad_Reportante=?', [entityId]);
        await assert.rejects(conn.query('DELETE FROM entidades_reportantes WHERE Id_Entidad_Reportante=?', [entityId]),
          error => error.errno === 1451);
        await conn.rollback();
      } finally { conn.release(); }
      const worker = await db.getConnection();
      try { await reject(worker, entityId, 'FK_EVENT'); }
      finally { worker.release(); }
      const [[reservation]] = await db.query('SELECT Id_Entidad_Reportante,Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [reservationId]);
      const [[transfer]] = await db.query('SELECT Id_Entidad_Reportante,Estado,Pendiente_Por_Entidad_En FROM transfers WHERE Id_Transfer=?', [transferId]);
      for (const row of [reservation, transfer]) {
        assert.equal(row.Id_Entidad_Reportante, null);
        assert.equal(row.Estado, 'Pendiente de datos');
        assert.equal(row.Pendiente_Por_Entidad_En, null);
      }
      const [[removed]] = await db.query('SELECT COUNT(*) AS n FROM entidades_reportantes WHERE Id_Entidad_Reportante=?', [entityId]);
      assert.equal(Number(removed.n), 0);
      const [[historyName]] = await db.query(`SELECT d.Valor_Nuevo AS nombre FROM historial h
        JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
        WHERE h.Tabla='entidades_reportantes' AND h.Id_Registro=? AND h.Accion='RECHAZAR'
          AND d.Columna='Nombre' LIMIT 1`, [String(entityId)]);
      assert.match(historyName.nombre, /^ZZ_TEST_/);
      const [[pendingName]] = await db.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(Datos,'$.nombreEntidad')) AS nombre
        FROM pendientes_operativos WHERE Entidad_Tipo='ENTIDAD_REPORTANTE_RECHAZADA'
          AND Entidad_Id=? LIMIT 1`, [`${prefix}_FK_EVENT`]);
      assert.match(pendingName.nombre, /^ZZ_TEST_/);
      const [[noticeName]] = await db.query(`SELECT JSON_UNQUOTE(JSON_EXTRACT(Datos,'$.nombreEntidad')) AS nombre
        FROM notificaciones WHERE Entidad_Tipo='ENTIDAD_REPORTANTE_RECHAZADA'
          AND Entidad_Id=? LIMIT 1`, [`${prefix}_FK_EVENT`]);
      assert.match(noticeName.nombre, /^ZZ_TEST_/);
      const [[children]] = await db.query(`SELECT
        (SELECT COUNT(*) FROM entidad_reportante_puntos WHERE Id_Entidad_Reportante=?) AS puntos,
        (SELECT COUNT(*) FROM perfiles_comision_entidad WHERE Id_Entidad_Reportante=?) AS perfiles`,
      [entityId, entityId]);
      assert.equal(Number(children.puntos), 0);
      assert.equal(Number(children.perfiles), 0);
    });

    await t.test('dos conexiones reales: el segundo rechazo espera el bloqueo y recibe entidad resuelta', async () => {
      const entityId = await createEntity('RACE');
      const first = await db.getConnection();
      const second = await db.getConnection();
      const originalQuery = first.query.bind(first);
      let signalLocked; let releaseFirst;
      const locked = new Promise(resolve => { signalLocked = resolve; });
      const gate = new Promise(resolve => { releaseFirst = resolve; });
      first.query = async (sql, params) => {
        const result = await originalQuery(sql, params);
        if (/SELECT Id_Entidad_Reportante,Nombre,Tipo,Activo[\s\S]*FOR UPDATE/.test(String(sql))) {
          signalLocked(); await gate;
        }
        return result;
      };
      let winner; let loser;
      try {
        winner = reject(first, entityId, 'RACE_EVENT');
        await locked;
        let secondDone = false;
        loser = reject(second, entityId, 'RACE_LOSER')
          .then(() => ({ ok: true }), error => ({ ok: false, error }))
          .finally(() => { secondDone = true; });
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal(secondDone, false, 'el segundo validador debe seguir esperando el FOR UPDATE');
        releaseFirst();
        await winner;
        const outcome = await loser;
        assert.equal(outcome.ok, false);
        assert.equal(outcome.error.status, 409);
        assert.match(outcome.error.message, /Esta entidad ya fue resuelta/);
      } finally {
        releaseFirst();
        await Promise.allSettled([winner, loser].filter(Boolean));
        first.release(); second.release();
      }
    });

    await t.test('error después del UPDATE revierte de verdad la entidad y la reserva', async () => {
      const entityId = await createEntity('ROLLBACK');
      const reservationId = await createReservation('RB', entityId, userIds[0]);
      const conn = await db.getConnection();
      try {
        await assert.rejects(reject(conn, entityId, 'ROLLBACK_EVENT', {
          recordHistory: async () => { throw new Error('ZZ_TEST_fallo_forzado'); },
        }), /ZZ_TEST_fallo_forzado/);
      } finally { conn.release(); }
      const [[entity]] = await db.query('SELECT Estado_Validacion FROM entidades_reportantes WHERE Id_Entidad_Reportante=?', [entityId]);
      const [[reservation]] = await db.query('SELECT Id_Entidad_Reportante,Estado,Pendiente_Por_Entidad_En FROM reservas WHERE Id_Reserva=?', [reservationId]);
      assert.equal(entity.Estado_Validacion, 'PENDIENTE_VALIDACION');
      assert.equal(String(reservation.Id_Entidad_Reportante), String(entityId));
      assert.equal(reservation.Estado, 'Confirmada');
      assert.ok(reservation.Pendiente_Por_Entidad_En);
      const [[noticeCount]] = await db.query('SELECT COUNT(*) AS n FROM notificaciones WHERE Entidad_Id=?', [`${prefix}_ROLLBACK_EVENT`]);
      assert.equal(Number(noticeCount.n), 0);
      const [[historyCount]] = await db.query(`SELECT COUNT(*) AS n FROM historial
        WHERE Tabla='entidades_reportantes' AND Id_Registro=? AND Accion='RECHAZAR'`, [String(entityId)]);
      assert.equal(Number(historyCount.n), 0);
    });

    await t.test('reasignar una operación cierra pendiente del creador y aviso agregado', async () => {
      const rejectedEntity = await createEntity('CORRECT');
      const reservationId = await createReservation('CR', rejectedEntity, userIds[0]);
      const worker = await db.getConnection();
      try { await reject(worker, rejectedEntity, 'CORRECT_EVENT'); }
      finally { worker.release(); }
      const replacement = await createEntity('REPLACEMENT', 'VALIDADA');
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const nextState = resolverEstadoReserva({ fechaTour: date, requiereEntidad: true, idEntidadReportante: replacement });
        await conn.query('UPDATE reservas SET Id_Entidad_Reportante=?,Estado=? WHERE Id_Reserva=?',
          [replacement, nextState, reservationId]);
        await entities.resolveRejectedEntityOperation(conn, 'RESERVA', reservationId);
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; }
      finally { conn.release(); }
      const [pendings] = await db.query(`SELECT Estado FROM pendientes_operativos
        WHERE Entidad_Tipo='ENTIDAD_REPORTANTE_RECHAZADA' AND Entidad_Id=?`, [`${prefix}_CORRECT_EVENT`]);
      assert.equal(pendings.length, 2);
      assert.ok(pendings.every(row => row.Estado === 'RESUELTO_AUTOMATICAMENTE'));
      const [notices] = await db.query(`SELECT Leida,Datos FROM notificaciones
        WHERE Entidad_Tipo='ENTIDAD_REPORTANTE_RECHAZADA' AND Entidad_Id=?`, [`${prefix}_CORRECT_EVENT`]);
      assert.ok(notices.length >= 1);
      assert.ok(notices.every(row => Number(row.Leida) === 1));
      assert.ok(notices.some(row => {
        const data = typeof row.Datos === 'string' ? JSON.parse(row.Datos) : row.Datos;
        return data.rol === 'VALIDADOR';
      }), 'un validador debe recibir el aviso agregado');
    });
  } finally {
    try { await cleanup(); }
    finally { await db.end(); }
  }
});
