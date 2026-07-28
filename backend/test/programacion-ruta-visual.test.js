const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularRutaVisualOSRM
} = require('../services/Programacion/programacion.service');

test('conserva los tramos de OSRM para separar la recogida y el viaje al tour', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  const previousFetch = global.fetch;

  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';
  global.fetch = async (url) => {
    assert.match(String(url), /route\/v1\/driving/);

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
          distance: 42000,
          duration: 4800,
          legs: [
            { distance: 12000, duration: 1500 },
            { distance: 30000, duration: 3300 }
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

    assert.equal(route.duration, 4800);
    assert.deepEqual(route.legs, [
      { distance: 12000, duration: 1500 },
      { distance: 30000, duration: 3300 }
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});
