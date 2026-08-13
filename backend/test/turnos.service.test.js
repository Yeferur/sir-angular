const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateWeeklySchedule,
  getScheduleWarnings,
  getCurrentScheduleStatus,
  getWeekBounds,
  getAdvisorWeekSchedule,
  publishWeek,
  validateVacation,
  _publication,
} = require('../services/Turnos/turnos.service');
const db = require('../database/db');
const emailOutbox = require('../services/email-outbox.service');
const notifications = require('../services/Notificaciones/notificaciones.service');
const websocketManager = require('../websocketManager');

function week(overrides = {}) {
  return Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: index < 5,
    horaInicio: index < 5 ? '08:00' : null,
    horaFin: index < 5 ? '17:30' : null,
    ...(overrides[index + 1] || {}),
  }));
}

function createPublicationHarness({ previousStatus = 'borrador', enqueueError = null } = {}) {
  const events = [];
  const publishedSchedule = validateWeeklySchedule(week());
  let transactionOpen = false;

  const snapshotDays = publishedSchedule.map((day) => ({
    Id_Usuario: 41,
    Dia_Semana: day.diaSemana,
    Es_Laborable: day.esLaborable ? 1 : 0,
    Hora_Inicio: day.horaInicio,
    Hora_Fin: day.horaFin,
  }));
  const persistedDays = publishedSchedule.map((day) => ({
    Id_Turno_Dia: 700 + day.diaSemana,
    Dia_Semana: day.diaSemana,
  }));

  const connection = {
    async beginTransaction() {
      assert.equal(transactionOpen, false);
      transactionOpen = true;
      events.push('begin');
    },
    async commit() {
      assert.equal(transactionOpen, true);
      events.push('commit');
      transactionOpen = false;
    },
    async rollback() {
      assert.equal(transactionOpen, true);
      events.push('rollback');
      transactionOpen = false;
    },
    release() {
      events.push('release');
    },
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();

      if (statement.startsWith('SELECT Id_Semana, Fecha_Inicio, Estado FROM turnos_semanas')) {
        return [[{
          Id_Semana: 7,
          Fecha_Inicio: '2026-08-03',
          Estado: previousStatus,
        }]];
      }
      if (statement.startsWith('SELECT u.Id_Usuario, u.Nombres_Apellidos, u.Correo')) {
        return [[{
          Id_Usuario: 41,
          Nombres_Apellidos: 'Ana Asesora',
          Correo: 'ana@example.com',
        }]];
      }
      if (statement.startsWith('SELECT Id_Usuario, Id_Canal, Es_Supernumerario')) {
        return [[{ Id_Usuario: 41, Id_Canal: null, Es_Supernumerario: 0 }]];
      }
      if (statement.startsWith('SELECT Id_Usuario, Dia_Semana, Es_Laborable')) {
        return [snapshotDays];
      }
      if (statement.startsWith('SELECT Id_Usuario, Fecha_Inicio, Fecha_Fin')) {
        return [[]];
      }
      if (statement.startsWith('SELECT Id_Vacacion FROM turnos_vacaciones')) {
        return [[]];
      }
      if (statement.startsWith('SELECT Id_Turno_Dia, Dia_Semana FROM turnos_dias')) {
        return [persistedDays];
      }
      if (statement.startsWith('INSERT INTO historial ')) {
        return [{ insertId: 91 }];
      }
      if (statement.startsWith('INSERT INTO detalle_historial ')) {
        return [{ affectedRows: 3 }];
      }
      if (
        statement.startsWith('INSERT INTO turnos_dias ')
        || statement.startsWith('INSERT INTO turnos_asesores_semana ')
        || statement.startsWith('UPDATE turnos_dias ')
        || statement.startsWith('UPDATE turnos_semanas ')
      ) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Consulta no contemplada en el mock de publicación: ${statement}`);
    },
  };

  const originals = {
    getConnection: db.getConnection,
    query: db.query,
    createNotification: notifications.createNotification,
    isSingleMailbox: emailOutbox.isSingleMailbox,
    enqueueScheduleEmail: emailOutbox.enqueueScheduleEmail,
    sendToUser: websocketManager.sendToUser,
  };

  db.getConnection = async () => connection;
  db.query = async (sql) => {
    assert.match(String(sql), /INFORMATION_SCHEMA\.COLUMNS/i);
    return [[{ DATA_TYPE: 'varchar' }]];
  };
  notifications.createNotification = async (executor, payload) => {
    assert.equal(transactionOpen, true, 'la notificación interna debe crearse antes del commit');
    assert.equal(executor, connection, 'la notificación debe usar la conexión transaccional');
    events.push('notification');
    assert.equal(payload.userId, '41');
    return '501';
  };
  emailOutbox.isSingleMailbox = () => true;
  emailOutbox.enqueueScheduleEmail = async (payload, publicationId, options) => {
    assert.equal(transactionOpen, true, 'el correo debe encolarse antes del commit');
    assert.equal(options.executor, connection, 'el outbox debe usar la conexión transaccional');
    assert.match(publicationId, /^[0-9a-f-]{36}$/i);
    assert.equal(payload.to, 'ana@example.com');
    events.push('enqueue');
    if (enqueueError) throw enqueueError;
    return { queued: true };
  };
  websocketManager.sendToUser = (userId, payload) => {
    assert.equal(transactionOpen, false, 'WebSocket solo puede emitirse después del commit');
    assert.ok(events.includes('commit'), 'WebSocket requiere un commit previo');
    assert.equal(userId, '41');
    assert.equal(payload.idNotificacion, '501');
    events.push('websocket');
  };

  return {
    events,
    jornadas: [{
      idUsuario: '41',
      idCanalSemanal: null,
      esSupernumerario: false,
      vacacion: null,
      turnos: publishedSchedule,
    }],
    restore() {
      db.getConnection = originals.getConnection;
      db.query = originals.query;
      notifications.createNotification = originals.createNotification;
      emailOutbox.isSingleMailbox = originals.isSingleMailbox;
      emailOutbox.enqueueScheduleEmail = originals.enqueueScheduleEmail;
      websocketManager.sendToUser = originals.sendToUser;
    },
  };
}

test('acepta una jornada semanal completa en bloques de 30 minutos', () => {
  const result = validateWeeklySchedule(week());
  assert.equal(result.length, 7);
  assert.equal(result[0].horaInicio, '08:00');
  assert.equal(result[5].esLaborable, false);
});

test('rechaza horarios que no caen en punto o y media', () => {
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaInicio: '08:15' } })),
    (error) => error.code === 'INVALID_SCHEDULE_STEP'
  );
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaFin: '17:45' } })),
    (error) => error.code === 'INVALID_SCHEDULE_STEP'
  );
});

test('acepta horarios en punto y en y media', () => {
  const result = validateWeeklySchedule(week({ 1: { horaInicio: '08:30', horaFin: '17:00' } }));
  assert.equal(result[0].horaInicio, '08:30');
  assert.equal(result[0].horaFin, '17:00');
});

test('rechaza salidas posteriores a las 11 p. m.', () => {
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaFin: '23:30' } })),
    (error) => error.code === 'SCHEDULE_AFTER_11PM'
  );
});

test('rechaza turnos que terminan antes de empezar', () => {
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaInicio: '18:00', horaFin: '08:00' } })),
    (error) => error.code === 'INVALID_SCHEDULE_RANGE'
  );
});

test('acepta seis jornadas con un día completo de descanso sin advertencias', () => {
  const schedule = Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: index < 6,
    horaInicio: index < 6 ? '14:30' : null,
    horaFin: index < 6 ? '23:00' : null,
  }));
  assert.deepEqual(getScheduleWarnings(schedule), []);
});

test('advierte una semana sin un día completo de descanso', () => {
  const schedule = Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: true,
    horaInicio: '06:00',
    horaFin: '13:30',
  }));
  const codes = getScheduleWarnings(schedule).map((warning) => warning.code);
  assert.ok(codes.includes('NO_REST_DAY'));
});

test('getWeekBounds siempre resuelve al lunes-domingo de la semana de referencia', () => {
  assert.deepEqual(getWeekBounds('2026-08-06'), { fechaInicio: '2026-08-03', fechaFin: '2026-08-09' });
  assert.deepEqual(getWeekBounds('2026-08-03'), { fechaInicio: '2026-08-03', fechaFin: '2026-08-09' });
  assert.deepEqual(getWeekBounds('2026-08-09'), { fechaInicio: '2026-08-03', fechaFin: '2026-08-09' });
});

test('valida un periodo de vacaciones con regreso posterior', () => {
  assert.deepEqual(validateVacation({
    fechaInicio: '2026-08-10', fechaFin: '2026-08-26', fechaRegreso: '2026-08-27', diasHabiles: 15,
  }), {
    idVacacion: null, fechaInicio: '2026-08-10', fechaFin: '2026-08-26', fechaRegreso: '2026-08-27',
    diasHabiles: 15, observaciones: null,
  });
});

test('rechaza vacaciones cuyo regreso no sea posterior al disfrute', () => {
  assert.throws(() => validateVacation({
    fechaInicio: '2026-08-10', fechaFin: '2026-08-26', fechaRegreso: '2026-08-26', diasHabiles: 15,
  }), (error) => error.code === 'INVALID_VACATION');
});

test('calcula el estado actual comparando contra la fecha concreta del día', () => {
  const schedule = validateWeeklySchedule(week()).map((day, index) => ({
    ...day,
    fecha: `2026-08-0${3 + index}`,
  }));
  // 2026-08-03 es lunes; 15:00 UTC = 10:00 Bogotá, dentro del turno 08:00-17:30.
  assert.equal(getCurrentScheduleStatus(schedule, new Date('2026-08-03T15:00:00.000Z')), 'en_turno');
  assert.equal(getCurrentScheduleStatus(schedule, new Date('2026-08-03T23:30:00.000Z')), 'fuera_turno');
  assert.equal(getCurrentScheduleStatus([], new Date('2026-08-03T15:00:00.000Z')), 'sin_configurar');
});

test('la jornada personal exige que el usuario tenga actualmente el rol Asesor', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });
  let capturedSql = '';
  let callCount = 0;
  db.query = async (sql) => {
    callCount += 1;
    capturedSql = sql;
    if (callCount === 1) {
      // Primera consulta: resolver/crear la semana. Se simula que ya existe.
      return [[{ Id_Semana: 1, Fecha_Inicio: '2026-08-03', Fecha_Fin: '2026-08-09', Estado: 'borrador', Fecha_Ultima_Publicacion: null }]];
    }
    return [[]];
  };

  const result = await getAdvisorWeekSchedule('123', '2026-08-03');
  assert.equal(result, null);
  assert.match(capturedSql, /LOWER\(TRIM\(r\.Nombre_Rol\)\) = 'asesor'/);
});

test('la publicación inicial notifica a todos y una republicación sólo a cambios reales', () => {
  const base = {
    idUsuario: '1',
    turnos: validateWeeklySchedule(week()),
    esSupernumerario: false,
    idCanalSemanal: '3',
    vacation: null,
  };
  const second = { ...base, idUsuario: '2' };
  const previous = new Map([
    ['1', _publication.normalizePublicationState(base)],
    ['2', _publication.normalizePublicationState(second)],
  ]);

  assert.deepEqual(
    _publication.resolvePublicationRecipients('borrador', [base, second], previous),
    ['1', '2']
  );
  assert.deepEqual(
    _publication.resolvePublicationRecipients('publicado', [base, second], previous),
    []
  );

  const changed = {
    ...second,
    turnos: validateWeeklySchedule(week({ 1: { horaInicio: '08:30' } })),
  };
  assert.deepEqual(
    _publication.resolvePublicationRecipients('publicado', [base, changed], previous),
    ['2']
  );
});

test('pendiente_republicacion usa alcance completo porque no conserva el roster granular', () => {
  const advisor = {
    idUsuario: '9', turnos: validateWeeklySchedule(week()), esSupernumerario: false,
    idCanalSemanal: null, vacation: null,
  };
  const previous = new Map([['9', _publication.normalizePublicationState(advisor)]]);
  assert.deepEqual(
    _publication.resolvePublicationRecipients('pendiente_republicacion', [advisor], previous),
    ['9']
  );
});

test('publicar crea notificación y outbox en la transacción, y emite WebSocket después del commit', async () => {
  const harness = createPublicationHarness();
  try {
    const result = await publishWeek('7', harness.jornadas, true, '12');

    assert.deepEqual(result, {
      idSemana: '7',
      estado: 'publicado',
      notificados: 1,
      correosEncolados: 1,
      correosOmitidos: 0,
    });
    assert.deepEqual(harness.events, [
      'begin',
      'notification',
      'enqueue',
      'commit',
      'websocket',
      'release',
    ]);
  } finally {
    harness.restore();
  }
});

test('si falla el enqueue de correo, publicar revierte toda la transacción y no emite WebSocket', async () => {
  const enqueueError = new Error('No se pudo persistir el correo');
  const harness = createPublicationHarness({ enqueueError });
  try {
    await assert.rejects(
      publishWeek('7', harness.jornadas, true, '12'),
      enqueueError
    );
    assert.deepEqual(harness.events, [
      'begin',
      'notification',
      'enqueue',
      'rollback',
      'release',
    ]);
    assert.equal(harness.events.includes('commit'), false);
    assert.equal(harness.events.includes('websocket'), false);
  } finally {
    harness.restore();
  }
});

test('republicar una semana idéntica confirma los datos sin crear avisos ni correos', async () => {
  const harness = createPublicationHarness({ previousStatus: 'publicado' });
  try {
    const result = await publishWeek('7', harness.jornadas, true, '12');

    assert.equal(result.notificados, 0);
    assert.equal(result.correosEncolados, 0);
    assert.equal(result.correosOmitidos, 0);
    assert.deepEqual(harness.events, ['begin', 'commit', 'release']);
  } finally {
    harness.restore();
  }
});
