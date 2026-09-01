const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularRutaVisualOSRM
} = require('../services/Programacion/programacion.service');

test('conserva los tramos de OSRM para separar la recogida y el viaje al tour', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  const previousFetch = global.fetch;

  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';
  let requests = 0;
  global.fetch = async (url) => {
    requests += 1;
    assert.match(String(url), /route\/v1\/driving/);
    assert.match(String(url), /steps=true/);

    return {
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          geometry: {
            coordinates: [
              [-75.57, 6.21],
              [-75.55, 6.23],
              [-75.45, 6.31]
            ]
          },
          distance: 30000,
          duration: 3300,
          legs: [
            { distance: 12000, duration: 1500 },
            { distance: 18000, duration: 1800 }
          ]
        }]
      })
    };
  };

  try {
    const route = await calcularRutaVisualOSRM([
      { lat: 6.21, lng: -75.57 },
      { lat: 6.23, lng: -75.55 },
      { lat: 6.31, lng: -75.45 }
    ]);

    assert.equal(route.duration, 3300);
    assert.deepEqual(route.legs, [
      { distance: 12000, duration: 1500 },
      { distance: 18000, duration: 1800 }
    ]);
    assert.equal(requests, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});

test('prefiere una alternativa considerablemente más corta con penalización de tiempo moderada', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  const previousFetch = global.fetch;
  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';

  const inicio = [-75.5557421, 6.3094608];
  const fin = [-75.3311533, 6.1689398];
  const viaRionegro = [-75.37, 6.15];
  const viaGuarne = [-75.44, 6.28];
  let requests = 0;

  global.fetch = async (url) => {
    requests += 1;
    const isAlternativeRequest = String(url).includes('alternatives=3');

    return {
      ok: true,
      json: async () => isAlternativeRequest
        ? ({
            code: 'Ok',
            routes: [
              {
                geometry: { coordinates: [inicio, viaRionegro, fin] },
                distance: 51639.7,
                duration: 3954.4
              },
              {
                geometry: { coordinates: [inicio, viaGuarne, fin] },
                distance: 42408.3,
                duration: 4157.3
              }
            ]
          })
        : ({
            code: 'Ok',
            routes: [{
              geometry: { coordinates: [inicio, viaRionegro, fin] },
              distance: 51639.7,
              duration: 3954.4,
              legs: [{
                distance: 51639.7,
                duration: 3954.4,
                steps: [
                  { geometry: { coordinates: [inicio, viaRionegro] } },
                  { geometry: { coordinates: [viaRionegro, fin] } }
                ]
              }]
            }]
          })
    };
  };

  try {
    const route = await calcularRutaVisualOSRM([
      { lat: inicio[1], lng: inicio[0] },
      { lat: fin[1], lng: fin[0] }
    ]);

    assert.equal(requests, 2);
    assert.deepEqual(route.coordinates, [inicio, viaGuarne, fin]);
    assert.equal(route.distance, 42408.3);
    assert.equal(route.duration, 4157.3);
    assert.deepEqual(route.legs, [{ distance: 42408.3, duration: 4157.3 }]);
    assert.deepEqual(route.routingPolicy, { longLegsEvaluated: 1, alternativesSelected: 1 });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});

test('conserva la ruta principal cuando la alternativa corta supera el tiempo permitido', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  const previousFetch = global.fetch;
  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';

  const inicio = [-75.55, 6.30];
  const fin = [-75.33, 6.17];
  const principal = [inicio, [-75.37, 6.15], fin];

  global.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('alternatives=3')
      ? ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: [inicio, [-75.44, 6.28], fin] },
            distance: 40000,
            duration: 4000
          }]
        })
      : ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: principal },
            distance: 50000,
            duration: 3600,
            legs: [{ distance: 50000, duration: 3600, steps: [] }]
          }]
        })
  });

  try {
    const route = await calcularRutaVisualOSRM([
      { lat: inicio[1], lng: inicio[0] },
      { lat: fin[1], lng: fin[0] }
    ]);

    assert.deepEqual(route.coordinates, principal);
    assert.equal(route.distance, 50000);
    assert.equal(route.duration, 3600);
    assert.deepEqual(route.routingPolicy, { longLegsEvaluated: 1, alternativesSelected: 0 });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});
