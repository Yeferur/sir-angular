const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateWeeklySchedule,
  getCurrentScheduleStatus,
  getAdvisorSchedule,
  isAdministratorRole,
} = require('../services/Turnos/turnos.service');
const db = require('../database/db');

function week(overrides = {}) {
  return Array.from({ length: 7 }, (_, index) => ({
    diaSemana: index + 1,
    esLaborable: index < 5,
    horaInicio: index < 5 ? '08:00' : null,
    horaFin: index < 5 ? '17:00' : null,
    ...(overrides[index + 1] || {}),
  }));
}

test('acepta una jornada semanal completa sin cruces de medianoche', () => {
  const result = validateWeeklySchedule(week());
  assert.equal(result.length, 7);
  assert.equal(result[0].horaInicio, '08:00');
  assert.equal(result[5].esLaborable, false);
});

test('rechaza salidas posteriores a las 11 p. m.', () => {
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaFin: '23:01' } })),
    (error) => error.code === 'SCHEDULE_AFTER_11PM'
  );
});

test('rechaza turnos que terminan antes de empezar', () => {
  assert.throws(
    () => validateWeeklySchedule(week({ 1: { horaInicio: '18:00', horaFin: '08:00' } })),
    (error) => error.code === 'INVALID_SCHEDULE_RANGE'
  );
});

test('calcula el estado actual con la zona horaria de Bogotá', () => {
  const schedule = validateWeeklySchedule(week());
  assert.equal(getCurrentScheduleStatus(schedule, new Date('2026-08-03T15:00:00.000Z')), 'en_turno');
  assert.equal(getCurrentScheduleStatus(schedule, new Date('2026-08-03T23:30:00.000Z')), 'fuera_turno');
  assert.equal(getCurrentScheduleStatus([], new Date('2026-08-03T15:00:00.000Z')), 'sin_configurar');
});

test('la consulta personal exige que el usuario tenga actualmente el rol Asesor', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });
  let capturedSql = '';
  db.query = async (sql) => {
    capturedSql = sql;
    return [[]];
  };

  const result = await getAdvisorSchedule('123');
  assert.equal(result, null);
  assert.match(capturedSql, /LOWER\(TRIM\(r\.Nombre_Rol\)\) = 'asesor'/);
  assert.doesNotMatch(capturedSql, /OR\s+u\.Id_Usuario/);
});

test('la gestión general exige rol Administrador además de los permisos', () => {
  assert.equal(isAdministratorRole('Asesor'), false);
  assert.equal(isAdministratorRole(null), false);
  assert.equal(isAdministratorRole(' Administrador '), true);
  assert.equal(isAdministratorRole('ADMINISTRADOR'), true);
});
