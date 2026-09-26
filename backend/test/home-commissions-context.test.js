const test = require('node:test');
const assert = require('node:assert/strict');

const { commissionProcess } = require('../services/Home/home.service');

test('describe Comisiones con conteo, período y firma estable de las reservas', () => {
  const first = commissionProcess([
    { Id_Reserva: '20', Fecha_Tour: '2026-09-20', Id_Tour: 4, Nombre_Tour: 'Guatapé' },
    { Id_Reserva: '10', Fecha_Tour: '2026-09-01', Id_Tour: 4, Nombre_Tour: 'Guatapé' },
  ]);
  const reordered = commissionProcess([
    { Id_Reserva: '10', Fecha_Tour: '2026-09-01' },
    { Id_Reserva: '20', Fecha_Tour: '2026-09-20' },
  ]);

  assert.equal(first.count, 2);
  assert.equal(first.periodStart, '2026-09-01');
  assert.equal(first.periodEnd, '2026-09-20');
  assert.equal(first.tourId, '4');
  assert.equal(first.tourName, 'Guatapé');
  assert.equal(first.description, '2 reservas viajadas entre 2026-09-01 y 2026-09-20 tienen comisiones pendientes.');
  assert.equal(first.notificationIdentity, reordered.notificationIdentity);
  assert.notEqual(first.notificationIdentity, commissionProcess([
    { Id_Reserva: '10', Fecha_Tour: '2026-09-01' },
  ]).notificationIdentity);
});

test('no inventa un tour cuando las comisiones comprenden varios', () => {
  const result = commissionProcess([
    { Id_Reserva: '10', Fecha_Tour: '2026-09-01', Id_Tour: 4, Nombre_Tour: 'Guatapé' },
    { Id_Reserva: '11', Fecha_Tour: '2026-09-01', Id_Tour: 7, Nombre_Tour: 'Barú' },
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.tourId, null);
  assert.equal(result.tourName, null);
});
