const test = require('node:test');
const assert = require('node:assert/strict');
const {
  annotateSharedCapacity,
  consolidateCapacityAlerts,
} = require('../services/Aforos/shared-capacity.service');

test('el cupo compartido usa la capacidad del tour 5 y suma la ocupación de 1 y 5', () => {
  const tours = annotateSharedCapacity([
    { Id_Tour: 1, Nombre_Tour: 'Río Claro', cupos: 12, NumeroPasajeros: 40 },
    { Id_Tour: 5, Nombre_Tour: 'Hacienda Nápoles', cupos: 100, NumeroPasajeros: 53 },
  ]);
  const linked = tours.find((tour) => tour.Id_Tour === 1);
  assert.deepEqual(linked.Tours_Cupo_Compartido, [1, 5]);
  assert.equal(linked.Fuente_Cupo_Compartido, 5);
  assert.equal(linked.Cupo_Compartido, 100);
  assert.equal(linked.Ocupacion_Compartida, 93);

  const alerts = consolidateCapacityAlerts([
    { Id_Tour: 1, Nombre_Tour: 'Río Claro', Fecha: '2026-10-31', Capacidad: 12, Ocupados: 40 },
    { Id_Tour: 5, Nombre_Tour: 'Hacienda Nápoles', Fecha: '2026-10-31', Capacidad: 100, Ocupados: 53 },
  ]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tourId, 1);
  assert.equal(alerts[0].capacity, 100);
  assert.equal(alerts[0].occupied, 93);
  assert.equal(alerts[0].percentage, 93);
  assert.equal(alerts[0].status, 'critical');
});
