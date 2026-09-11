const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../services/Pendientes/pendientes-policy.service');
const pendingService = require('../services/Pendientes/pendientes.service');

test('mantiene la prioridad base fuera de las ventanas y escala al acercarse la operación', () => {
  const rule = {
    prioridadDefault: 'MEDIA',
    ventanasUrgencia: [
      { minutosRestantes: 240, prioridad: 'ALTA' },
      { minutosRestantes: 60, prioridad: 'CRITICA' },
    ],
  };
  const now = new Date('2026-09-11T12:00:00.000Z');

  assert.equal(policy.priorityFor(rule, '2026-09-11T17:00:00.000Z', now), 'MEDIA');
  assert.equal(policy.priorityFor(rule, '2026-09-11T15:00:00.000Z', now), 'ALTA');
  assert.equal(policy.priorityFor(rule, '2026-09-11T12:30:00.000Z', now), 'CRITICA');
});

test('la recurrencia se deriva exclusivamente de la política de la regla', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  assert.equal(policy.nextReminderFor({ recurrenciaMinutos: null }, now), null);
  assert.equal(
    policy.nextReminderFor({ recurrenciaMinutos: 90 }, now).toISOString(),
    '2026-09-11T13:30:00.000Z'
  );
});

test('la audiencia admite el usuario calculado o un permiso efectivo, sin rol ni reasignación', () => {
  const audience = pendingService.audienceClause(7, ['RESERVAS.LEER', 'PENDIENTES.LEER']);
  assert.match(audience.sql, /Id_Usuario_Destino = \?/);
  assert.match(audience.sql, /Permiso_Audiencia IN \(\?,\?\)/);
  assert.deepEqual(audience.params, [7, 'RESERVAS.LEER', 'PENDIENTES.LEER']);
});
