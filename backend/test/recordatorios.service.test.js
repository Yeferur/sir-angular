const test = require('node:test');
const assert = require('node:assert/strict');

const reminders = require('../services/Recordatorios/recordatorios.service');

test('normaliza un recordatorio personal con identificador textual de entidad', () => {
  const result = reminders.normalizeInput({
    titulo: ' Revisar reserva ',
    descripcion: 'Confirmar datos',
    fecha: '2026-09-11T20:00:00.000Z',
    entidadTipo: 'RESERVA',
    entidadId: 'CTG11014',
  });

  assert.equal(result.title, 'Revisar reserva');
  assert.equal(result.date, '2026-09-11 15:00:00');
  assert.equal(result.entityId, 'CTG11014');
});

test('un recordatorio siempre exige título y fecha válida', () => {
  assert.throws(
    () => reminders.normalizeInput({ titulo: '', fecha: '2026-09-11T20:00:00.000Z' }),
    (error) => error.code === 'REMINDER_TITLE_REQUIRED'
  );
  assert.throws(
    () => reminders.normalizeInput({ titulo: 'Revisar', fecha: 'sin-fecha' }),
    (error) => error.code === 'INVALID_REMINDER_DATE'
  );
});
