const test = require('node:test');
const assert = require('node:assert/strict');
const { nextReminder } = require('../services/Pendientes/pendientes-trigger.service');

test('la próxima notificación usa la recurrencia configurada por la regla', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  assert.equal(nextReminder(90, now), '2026-09-11 08:30:00');
  assert.equal(nextReminder(null, now), null);
});
