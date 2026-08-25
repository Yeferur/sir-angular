const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizarTourInicio } = require('../services/inicio.service');

test('normaliza los pasajeros grupales y privados para Inicio', () => {
  const tour = normalizarTourInicio({
    cupos: '38',
    NumeroPasajeros: '12',
    NumeroPasajerosPrivados: '4',
    totalReservas: '3',
    totalPrivados: '1',
  });

  assert.deepEqual(tour, {
    cupos: 38,
    NumeroPasajeros: 12,
    NumeroPasajerosPrivados: 4,
    totalReservas: 3,
    totalPrivados: 1,
  });
});

test('los contadores ausentes no muestran valores negativos ni NaN', () => {
  const tour = normalizarTourInicio({
    cupos: null,
    NumeroPasajeros: undefined,
    NumeroPasajerosPrivados: undefined,
    totalReservas: 'no disponible',
    totalPrivados: null,
  });

  assert.equal(tour.cupos, 0);
  assert.equal(tour.NumeroPasajeros, 0);
  assert.equal(tour.NumeroPasajerosPrivados, 0);
  assert.equal(tour.totalReservas, 0);
  assert.equal(tour.totalPrivados, 0);
});
