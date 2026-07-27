const test = require('node:test');
const assert = require('node:assert/strict');

const { validarCoordenadasOSRM } = require('../services/Puntos/puntos.service');

test('acepta coordenadas conectadas a una vía de OSRM', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';
  try {
    const result = await validarCoordenadasOSRM(6.2129, -75.5771, async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        waypoints: [{ distance: 12.4, location: [-75.577, 6.213] }]
      })
    }));
    assert.equal(result.valida, true);
    assert.equal(result.distanciaViaMetros, 12);
  } finally {
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});

test('rechaza coordenadas demasiado alejadas de una vía', async () => {
  const previousUrl = process.env.PROGRAMACION_OSRM_URL;
  process.env.PROGRAMACION_OSRM_URL = 'http://osrm.test';
  try {
    await assert.rejects(
      validarCoordenadasOSRM(6.2129, -75.5771, async () => ({
        ok: true,
        json: async () => ({
          code: 'Ok',
          waypoints: [{ distance: 2500, location: [-75.577, 6.213] }]
        })
      })),
      /demasiado lejos/
    );
  } finally {
    if (previousUrl === undefined) delete process.env.PROGRAMACION_OSRM_URL;
    else process.env.PROGRAMACION_OSRM_URL = previousUrl;
  }
});
