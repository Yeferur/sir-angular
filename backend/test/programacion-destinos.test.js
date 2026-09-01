const test = require('node:test');
const assert = require('node:assert/strict');

const { resolverDestinoTour } = require('../services/Programacion/programacion.service');

const parada = {
  Id_Tour: 2,
  Nombre_Tour: 'Guatapé',
  Nombre_Primera_Parada: 'Restaurante Porto Madero',
  Latitud_Primera_Parada: 6.2076963,
  Longitud_Primera_Parada: -75.282431,
  Latitud_Tour: 6.234311,
  Longitud_Tour: -75.161725,
  Hora_Salida_Base: '6:00 AM',
};

test('devuelve parada operativa y tour cuando ambos tienen coordenadas', () => {
  const destino = resolverDestinoTour([2], { 2: parada });

  assert.deepEqual(destino.primeraParadaOperativa, {
    lat: 6.2076963,
    lng: -75.282431,
    nombre: 'Restaurante Porto Madero',
  });
  assert.deepEqual(destino.tour, {
    lat: 6.234311,
    lng: -75.161725,
    nombre: 'Guatapé',
  });
});

test('conserva solo el destino que tenga coordenadas', () => {
  const soloParada = resolverDestinoTour([2], {
    2: { ...parada, Latitud_Tour: null, Longitud_Tour: null },
  });
  assert.ok(soloParada.primeraParadaOperativa);
  assert.equal(soloParada.tour, null);

  const soloTour = resolverDestinoTour([2], {
    2: { ...parada, Latitud_Primera_Parada: null, Longitud_Primera_Parada: null },
  });
  assert.equal(soloTour.primeraParadaOperativa, null);
  assert.ok(soloTour.tour);
  assert.equal(soloTour.lat, 6.234311);
});

test('no crea destinos cuando ninguna coordenada está configurada', () => {
  const destino = resolverDestinoTour([2], {
    2: {
      ...parada,
      Latitud_Primera_Parada: null,
      Longitud_Primera_Parada: null,
      Latitud_Tour: null,
      Longitud_Tour: null,
    },
  });

  assert.equal(destino, null);
});
