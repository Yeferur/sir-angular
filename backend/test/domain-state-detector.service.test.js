const test = require('node:test');
const assert = require('node:assert/strict');
const detector = require('../services/Pendientes/domain-state-detector.service');

test('los textos consumen el estado calculado existente sin redefinir sus validaciones', () => {
  assert.match(detector.descriptionFor('La reserva', 'Pendiente de datos'), /información operativa/);
  assert.match(detector.descriptionFor('El transfer', 'Pendiente de pago'), /pago/);
  assert.equal(detector.PENDING_STATES.includes('Completada'), false);
});
