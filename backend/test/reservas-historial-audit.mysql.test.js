const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { createCopy, connectionOptions } = require('../scripts/create-validation-copy');
const { installSignalCleanup, dropGeneratedDatabase } = require('../scripts/temporary-validation-cleanup');

test('MySQL local: auditoría real de reservas y pasajeros en copia temporal', {
  skip: process.env.RESERVAS_HISTORIAL_AUDIT_MYSQL_TEST !== '1', timeout: 240000,
}, async (t) => {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  require('dotenv').config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  assert.equal(process.env.DB_NAME || process.env.DB_DATABASE, 'sir2');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase()));

  const database = `sir2_authoring_validation_${randomBytes(10).toString('hex')}`;
  const oldName = process.env.DB_NAME;
  const oldDatabase = process.env.DB_DATABASE;
  const oldKeep = process.env.SIR_KEEP_VALIDATION_DB;
  delete process.env.SIR_KEEP_VALIDATION_DB;
  const stopCleanup = installSignalCleanup(database);
  let connection;
  let db;
  let cloneCreated = false;

  try {
    await createCopy(database);
    cloneCreated = true;
    process.env.DB_NAME = database;
    process.env.DB_DATABASE = database;
    connection = await mysql.createConnection(connectionOptions(database));
    const [[identity]] = await connection.query('SELECT DATABASE() AS db, @@hostname AS host');
    assert.equal(identity.db, database);
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase()));

    const suffix = randomBytes(6).toString('hex');
    const roleName = `Auditoría sintética ${suffix}`;
    const actorName = `Actor sintético ${suffix}`;
    const actorId = 1000000000000 + Number.parseInt(suffix.slice(0, 7), 16);
    const [role] = await connection.query(
      'INSERT INTO roles (Nombre_Rol,Descripcion,Activo) VALUES (?,?,1)',
      [roleName, 'Rol sintético exclusivo de la copia temporal']
    );
    await connection.query(`INSERT INTO usuarios
      (Id_Usuario,Nombres_Apellidos,Usuario,Correo,Contrasena,Id_Rol,Activo)
      VALUES (?,?,?,?,?,?,1)`, [actorId, actorName, `audit_${suffix}`, `audit_${suffix}@example.invalid`, 'fixture-only', role.insertId]);

    const [[configuration]] = await connection.query(`SELECT t.Id_Tour,t.Cupo_Base,
        h1.Id_Horario AS horario1,h1.Id_Punto AS punto1,
        h2.Id_Horario AS horario2,h2.Id_Punto AS punto2,
        m.Id_Moneda,c.Id_Canal
      FROM tours t
      JOIN horarios h1 ON h1.Id_Tour=t.Id_Tour
      JOIN puntos p1 ON p1.Id_Punto=h1.Id_Punto AND p1.Activo=1
      JOIN horarios h2 ON h2.Id_Tour=t.Id_Tour AND h2.Id_Punto<>h1.Id_Punto
      JOIN puntos p2 ON p2.Id_Punto=h2.Id_Punto AND p2.Activo=1
      CROSS JOIN monedas m
      JOIN canales_reservas c ON c.Nombre_Canal='WEB'
      WHERE t.Activo=1 AND t.Cupo_Base>=4
      ORDER BY t.Id_Tour,h1.Id_Horario,h2.Id_Horario LIMIT 1`);
    assert.ok(configuration, 'se requieren dos puntos activos del mismo tour y canal WEB');

    process.env.DB_NAME = database;
    process.env.DB_DATABASE = database;
    db = require('../database/db');
    await require('../services/schema-capabilities').initializeSchemaCapabilities(db);
    const reservations = require('../services/Reservas/reservas.service');
    const reservationDate = '2033-07-15';
    const contactPhone = '+573001234567';
    const passengerA = {
      Tipo_Pasajero: 'ADULTO', Nombre_Pasajero: `Pasajero A ${suffix}`,
      DNI: `AUDIT-A-${suffix}`, Telefono_Pasajero: null, Id_Punto: configuration.punto1,
      Precio_Tour: 100, Precio_Pasajero: 100,
    };
    const passengerB = {
      Tipo_Pasajero: 'ADULTO', Nombre_Pasajero: `Pasajero B ${suffix}`,
      DNI: `AUDIT-B-${suffix}`, Telefono_Pasajero: null, Id_Punto: configuration.punto1,
      Precio_Tour: 100, Precio_Pasajero: 100,
    };
    const payload = (passengers, overrides = {}) => ({
      cabeceraReserva: {
        Tipo_Reserva: 'Grupal', Id_Tour: configuration.Id_Tour,
        Id_Horario: configuration.horario1, Id_Punto: configuration.punto1,
        Fecha_Tour: reservationDate, Id_Moneda: configuration.Id_Moneda,
        Id_Canal: configuration.Id_Canal, Idioma_Reserva: 'ESPAÑOL',
        Nombre_Reportante: `Reportante sintético ${suffix}`, Telefono_Reportante: contactPhone,
        Observaciones: 'Dato sintético para validar la auditoría',
        ...overrides.cabeceraReserva,
      },
      pasajeros: passengers,
      pagos: overrides.pagos ?? [],
    });

    const reservation = await reservations.crearReservaConPasajerosYPagos(
      payload([passengerA, passengerB]), {}, actorId
    );
    const reservationId = reservation.Id_Reserva;
    const [[point1]] = await connection.query('SELECT Nombre_Punto FROM puntos WHERE Id_Punto=?', [configuration.punto1]);
    const [[point2]] = await connection.query('SELECT Nombre_Punto FROM puntos WHERE Id_Punto=?', [configuration.punto2]);
    const editedReporter = `Reportante editado ${suffix}`;
    const secretObservation = `token=audit-canary-${suffix}`;
    const editedHeader = { Id_Horario: configuration.horario2, Id_Punto: configuration.punto2,
      Nombre_Reportante: editedReporter, Observaciones: secretObservation };
    const inspectHistory = async () => {
      const [rows] = await connection.query(`SELECT h.Id_Historial,h.Tabla,h.Id_Registro,h.Accion,
          h.Id_Usuario,h.Actor_Nombre,h.Actor_Rol,d.Columna,d.Valor_Anterior,d.Valor_Nuevo
        FROM historial h LEFT JOIN detalle_historial d ON d.Id_Historial=h.Id_Historial
        WHERE h.Tabla='reservas' AND h.Id_Registro=? ORDER BY h.Id_Historial,d.Id_Detalle`, [reservationId]);
      return rows;
    };
    const events = async () => {
      const rows = await inspectHistory();
      const grouped = new Map();
      for (const row of rows) {
        if (!grouped.has(row.Id_Historial)) grouped.set(row.Id_Historial, {
          Id_Historial: row.Id_Historial,
          Tabla: row.Tabla, Id_Registro: row.Id_Registro, Accion: row.Accion,
          Id_Usuario: row.Id_Usuario, Actor_Nombre: row.Actor_Nombre, Actor_Rol: row.Actor_Rol, detalles: [],
        });
        if (row.Columna !== null) grouped.get(row.Id_Historial).detalles.push({
          Columna: row.Columna, Valor_Anterior: row.Valor_Anterior, Valor_Nuevo: row.Valor_Nuevo,
        });
      }
      return [...grouped.values()];
    };
    const assertActor = event => {
      assert.equal(String(event.Id_Usuario), String(actorId));
      assert.equal(event.Actor_Nombre, actorName);
      assert.equal(event.Actor_Rol, roleName);
      assert.equal(event.Tabla, 'reservas');
      assert.equal(String(event.Id_Registro), String(reservationId));
    };
    const eventFor = (all, action, afterId = null) => all.find(e => e.Accion === action
      && (afterId === null || Number(e.Id_Historial) > afterId));

    let allEvents = await events();
    const created = eventFor(allEvents, 'CREAR_RESERVA');
    assert.ok(created, 'crearReservaConPasajerosYPagos debe registrar CREAR_RESERVA');
    assertActor(created);
    assert.deepEqual(created.detalles.map(d => d.Columna),
      ['Id_Tour', 'Id_Moneda', 'Fecha_Tour', 'Estado', 'Pasajeros iniciales']);
    assert.equal(created.detalles.find(d => d.Columna === 'Estado').Valor_Nuevo, 'Pendiente de pago');
    const initialPassengers = created.detalles.find(d => d.Columna === 'Pasajeros iniciales').Valor_Nuevo;
    assert.ok(initialPassengers.includes(passengerA.Nombre_Pasajero));
    assert.ok(initialPassengers.includes(passengerB.Nombre_Pasajero));
    assert.ok(!initialPassengers.includes(passengerA.DNI));
    let lastHistoryId = Math.max(...allEvents.map(e => Number(e.Id_Historial)));

    const [originalPassengerRows] = await connection.query(
      'SELECT Id_Pasajero,Nombre_Pasajero FROM pasajeros WHERE Id_Reserva=?', [reservationId]
    );
    const passengerIds = new Map(originalPassengerRows.map(row => [row.Nombre_Pasajero, row.Id_Pasajero]));
    // Edit both existing passengers in one operation, reversing their payload order.
    const changedA = { ...passengerA, Id_Pasajero: passengerIds.get(passengerA.Nombre_Pasajero),
      Nombre_Pasajero: `Nombre editado A ${suffix}`,
      DNI: `AUDIT-M-${suffix}`, Id_Punto: configuration.punto2 };
    const changedB = { ...passengerB, Id_Pasajero: passengerIds.get(passengerB.Nombre_Pasajero),
      Nombre_Pasajero: `Nombre editado B ${suffix}`,
      DNI: `AUDIT-N-${suffix}`, Id_Punto: configuration.punto2 };
    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload([changedB, changedA], {
      cabeceraReserva: editedHeader,
    }), {}, actorId);
    const [changedPassengerRows] = await connection.query(`SELECT Id_Pasajero,Nombre_Pasajero,DNI,Id_Punto
      FROM pasajeros WHERE Id_Reserva=?`, [reservationId]);
    for (const changed of [changedA, changedB]) {
      assert.deepEqual(changedPassengerRows.find(row => String(row.Id_Pasajero) === String(changed.Id_Pasajero)), {
        Id_Pasajero: changed.Id_Pasajero, Nombre_Pasajero: changed.Nombre_Pasajero,
        DNI: changed.DNI, Id_Punto: configuration.punto2,
      });
    }
    allEvents = await events();
    const passengerModified = eventFor(allEvents, 'ACTUALIZAR_RESERVA', lastHistoryId);
    assert.ok(passengerModified, `falta el evento de modificación; eventos observados: ${JSON.stringify(allEvents)}`);
    assertActor(passengerModified);
    assert.equal(passengerModified.detalles.find(d => d.Columna === 'Nombre_Reportante').Valor_Anterior,
      `Reportante sintético ${suffix}`);
    assert.equal(passengerModified.detalles.find(d => d.Columna === 'Nombre_Reportante').Valor_Nuevo,
      editedReporter);
    assert.equal(passengerModified.detalles.find(d => d.Columna === 'NumeroPasajeros'), undefined);
    const pointDetail = passengerModified.detalles.find(d => d.Columna === 'Puntos_Recogida');
    assert.deepEqual([pointDetail.Valor_Anterior, pointDetail.Valor_Nuevo],
      [point1.Nombre_Punto, point2.Nombre_Punto]);
    assert.deepEqual(passengerModified.detalles.find(d => d.Columna === 'Observaciones'), {
      Columna: 'Observaciones', Valor_Anterior: '', Valor_Nuevo: 'Modificadas',
    });
    assert.ok(passengerModified.detalles.every(d => d.Valor_Anterior !== d.Valor_Nuevo));
    const nameAndDocument = eventFor(allEvents, 'ACTUALIZAR_PASAJERO', lastHistoryId);
    assert.ok(nameAndDocument);
    assertActor(nameAndDocument);
    assert.deepEqual(nameAndDocument.detalles.map(d => d.Columna),
      ['Pasajero afectado', 'Nombre', 'DNI', 'Punto de encuentro']);
    assert.deepEqual(nameAndDocument.detalles.find(d => d.Columna === 'Nombre'), {
      Columna: 'Nombre', Valor_Anterior: passengerA.Nombre_Pasajero, Valor_Nuevo: changedA.Nombre_Pasajero,
    });
    assert.deepEqual(nameAndDocument.detalles.find(d => d.Columna === 'DNI'), {
      Columna: 'DNI', Valor_Anterior: passengerA.DNI, Valor_Nuevo: changedA.DNI,
    });
    assert.deepEqual(nameAndDocument.detalles.find(d => d.Columna === 'Punto de encuentro'), {
      Columna: 'Punto de encuentro', Valor_Anterior: point1.Nombre_Punto, Valor_Nuevo: point2.Nombre_Punto,
    });
    const simultaneousUpdates = allEvents.filter(event => event.Accion === 'ACTUALIZAR_PASAJERO'
      && Number(event.Id_Historial) > lastHistoryId);
    assert.equal(simultaneousUpdates.length, 2);
    for (const [before, after] of [[passengerA, changedA], [passengerB, changedB]]) {
      const update = simultaneousUpdates.find(event => event.detalles.some(detail =>
        detail.Columna === 'Nombre' && detail.Valor_Anterior === before.Nombre_Pasajero));
      assert.ok(update);
      assert.equal(update.detalles.find(detail => detail.Columna === 'Nombre').Valor_Nuevo, after.Nombre_Pasajero);
      assert.equal(update.detalles.find(detail => detail.Columna === 'DNI').Valor_Anterior, before.DNI);
      assert.equal(update.detalles.find(detail => detail.Columna === 'DNI').Valor_Nuevo, after.DNI);
    }
    lastHistoryId = Math.max(...allEvents.map(e => Number(e.Id_Historial)));

    // Add a passenger, then remove them; the service replaces the passenger set atomically.
    const secondPassenger = { ...passengerB, Nombre_Pasajero: `Pasajero C ${suffix}`,
      DNI: `AUDIT-C-${suffix}`, Id_Punto: configuration.punto2 };
    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload([changedA, changedB, secondPassenger], {
      cabeceraReserva: editedHeader,
    }), {}, actorId);
    const [[passengerCountAfterAdd]] = await connection.query(
      'SELECT COUNT(*) AS total FROM pasajeros WHERE Id_Reserva=?', [reservationId]
    );
    assert.equal(Number(passengerCountAfterAdd.total), 3);
    allEvents = await events();
    const addedPassenger = eventFor(allEvents, 'AGREGAR_PASAJERO', lastHistoryId);
    assert.ok(addedPassenger);
    assertActor(addedPassenger);
    assert.equal(addedPassenger.detalles.length, 1);
    assert.ok(addedPassenger.detalles[0].Valor_Nuevo.includes(secondPassenger.Nombre_Pasajero));
    assert.ok(!addedPassenger.detalles[0].Valor_Nuevo.includes(secondPassenger.DNI));
    const additionSummary = eventFor(allEvents, 'ACTUALIZAR_RESERVA', lastHistoryId);
    assert.deepEqual(additionSummary.detalles.map(d => d.Columna), ['NumeroPasajeros']);
    assert.deepEqual(additionSummary.detalles.map(d => [d.Valor_Anterior, d.Valor_Nuevo]), [['2', '3']]);
    lastHistoryId = Math.max(...allEvents.map(e => Number(e.Id_Historial)));

    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload([changedA, changedB], {
      cabeceraReserva: editedHeader,
    }), {}, actorId);
    const [[passengerCountAfterRemoval]] = await connection.query(
      'SELECT COUNT(*) AS total FROM pasajeros WHERE Id_Reserva=?', [reservationId]
    );
    assert.equal(Number(passengerCountAfterRemoval.total), 2);
    allEvents = await events();
    const removedPassenger = eventFor(allEvents, 'ELIMINAR_PASAJERO', lastHistoryId);
    assert.ok(removedPassenger);
    assertActor(removedPassenger);
    assert.equal(removedPassenger.detalles.length, 1);
    assert.ok(removedPassenger.detalles[0].Valor_Anterior.includes(secondPassenger.Nombre_Pasajero));
    assert.ok(!removedPassenger.detalles[0].Valor_Anterior.includes(secondPassenger.DNI));
    const removalSummary = eventFor(allEvents, 'ACTUALIZAR_RESERVA', lastHistoryId);
    assert.deepEqual(removalSummary.detalles.map(d => d.Columna), ['NumeroPasajeros']);
    assert.deepEqual(removalSummary.detalles.map(d => [d.Valor_Anterior, d.Valor_Nuevo]), [['3', '2']]);
    lastHistoryId = Math.max(...allEvents.map(e => Number(e.Id_Historial)));

    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload([changedA, changedB], {
      cabeceraReserva: editedHeader,
      pagos: [{ Tipo: 'Pago Directo', Monto: 100 }],
    }), {}, actorId);
    allEvents = await events();
    const statusChanged = eventFor(allEvents, 'ACTUALIZAR_RESERVA', lastHistoryId);
    assert.ok(statusChanged);
    assertActor(statusChanged);
    const statusDetail = statusChanged.detalles.find(d => d.Columna === 'Estado');
    assert.deepEqual([statusDetail.Valor_Anterior, statusDetail.Valor_Nuevo], ['Pendiente de pago', 'Confirmada']);
    assert.ok(statusChanged.detalles.every(d => d.Valor_Anterior !== d.Valor_Nuevo));
    lastHistoryId = Math.max(...allEvents.map(e => Number(e.Id_Historial)));

    await reservations.actualizarReservaConPasajerosYPagos(reservationId, payload([changedA, changedB], {
      cabeceraReserva: editedHeader, pagos: [{ Tipo: 'Pago Directo', Monto: 100 }],
    }), {}, actorId);
    assert.equal((await events()).length, allEvents.length,
      'una actualización equivalente no debe generar eventos ni detalles redundantes');

    await reservations.cancelarReservaSvc(reservationId, actorId);
    allEvents = await events();
    const cancelled = eventFor(allEvents, 'CANCELAR_RESERVA', lastHistoryId);
    assert.ok(cancelled);
    assertActor(cancelled);
    const cancellationState = cancelled.detalles.find(d => d.Columna === 'Estado');
    assert.deepEqual([cancellationState.Valor_Anterior, cancellationState.Valor_Nuevo], ['Confirmada', 'Cancelada']);

    const auditRows = await inspectHistory();
    const passengerEvents = auditRows.filter(row => row.Tabla === 'pasajeros');
    assert.equal(passengerEvents.length, 0, 'las operaciones de pasajeros no generan eventos con Tabla=pasajeros');
    const historyPage = await require('../services/Historial/historial.service')
      .getHistorial({ referencia: reservationId, limit: 50 });
    assert.equal(historyPage.total, allEvents.length, 'el código recupera todos los eventos de la reserva');
    assert.ok(historyPage.data.some(row => row.Tipo_Accion === 'ACTUALIZAR_PASAJERO'
      && row.Detalles.some(detail => detail.columna === 'DNI' && detail.anterior === passengerA.DNI
        && detail.nuevo === changedA.DNI)));
    assert.ok(historyPage.data.some(row => row.Tipo_Accion === 'ACTUALIZAR_RESERVA'
      && row.Detalles.some(detail => detail.columna === 'Puntos_Recogida'
        && detail.anterior === point1.Nombre_Punto && detail.nuevo === point2.Nombre_Punto)));
    const detailText = auditRows.flatMap(row => [row.Columna, row.Valor_Anterior, row.Valor_Nuevo])
      .filter(value => value != null).join('\n');
    for (const sensitiveSynthetic of [secretObservation, contactPhone]) {
      assert.ok(!detailText.includes(sensitiveSynthetic), `no debe persistir ${sensitiveSynthetic} en detalles`);
    }
    assert.ok(!/(password|passwd|token|secret|credential|contrasena|cookie|authorization)/i.test(detailText));

    const report = allEvents.map(event => ({
      ...event, Numero_Detalles: event.detalles.length,
      detalles: event.detalles.map(({ Columna, Valor_Anterior, Valor_Nuevo }) => ({ Columna, Valor_Anterior, Valor_Nuevo })),
    }));
    // The reservation service intentionally schedules programation sync without awaiting it.
    // Let those local best-effort jobs finish before closing the disposable DB pool.
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(JSON.stringify({ database, reservationId, audit: report, passengerEvents: passengerEvents.length,
      sensitiveSyntheticValuesPersisted: false, schemaModified: false }));
  } finally {
    stopCleanup();
    if (connection) await connection.end();
    if (db) {
      await db.end();
      delete require.cache[require.resolve('../database/db')];
    }
    if (cloneCreated && process.env.SIR_KEEP_VALIDATION_DB !== '1') await dropGeneratedDatabase(database);
    if (oldName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = oldName;
    if (oldDatabase === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = oldDatabase;
    if (oldKeep === undefined) delete process.env.SIR_KEEP_VALIDATION_DB;
    else process.env.SIR_KEEP_VALIDATION_DB = oldKeep;
  }
});
