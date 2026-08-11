const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateWeeklySchedule,
  getScheduleWarnings,
  getCurrentScheduleStatus,
  getWeekBounds,
  getAdvisorWeekSchedule,
  validateVacation,
} = require('../services/Turnos/turnos.service');
const db = require('../database/db');

function week(overrides = {}) {
  return Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: index < 5,
    horaInicio: index < 5 ? '08:00' : null,
    horaFin: index < 5 ? '17:30' : null,
    ...(overrides[index + 1] || {}),
  }));
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
