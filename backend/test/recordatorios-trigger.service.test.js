const test = require('node:test');
const assert = require('node:assert/strict');
const { nextTrigger } = require('../services/Recordatorios/recordatorios-trigger.service');

test('un recordatorio sin recurrencia notifica una vez', () => {
  assert.equal(nextTrigger({ Recurrencia: null, Intervalo: null }), null);
});

test('la recurrencia diaria y semanal conserva un intervalo acotado', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  assert.equal(nextTrigger({ Recurrencia: 'DIARIA', Intervalo: '2' }, now), '2026-09-13 07:00:00');
  assert.equal(nextTrigger({ Recurrencia: 'SEMANAL', Intervalo: '1' }, now), '2026-09-18 07:00:00');
});
