const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararMatrizOSRM,
} = require('../services/Programacion/shadow/programacion-shadow.distances');
const {
  generarPlanSombra,
} = require('../services/Programacion/shadow/programacion-shadow.optimizer');

const PUNTOS = [
  { lat: 6.21, lon: -75.58 },
  { lat: 6.23, lon: -75.56 },
];

test('construye una matriz vial OSRM por bloques', async () => {
  let llamadas = 0;
  const fetchImpl = async (url) => {
    llamadas += 1;
    const fuentes = url.searchParams.get('sources').split(';');
    const destinos = url.searchParams.get('destinations').split(';');
    return {
      ok: true,
      async json() {
        return {
          code: 'Ok',
          data_version: '2026-07-23T00:00:00Z',
          distances: fuentes.map(() => destinos.map(() => 1200)),
        };
      },
    };
  };

  const resultado = await prepararMatrizOSRM({
    puntos: PUNTOS,
    baseUrl: 'http://127.0.0.1:5000',
    tamanoBloque: 1,
    fetchImpl,
  });

  assert.equal(resultado.fuente, 'osrm-local');
  assert.equal(llamadas, 4);
  assert.equal(resultado.metadata.dataVersion, '2026-07-23T00:00:00Z');
  assert.equal(resultado.contexto.obtenerKm(PUNTOS[0], PUNTOS[1]), 1.2);

  const plan = generarPlanSombra({
    puntoBase: PUNTOS[0],
    distancias: resultado.contexto,
    fuenteDistancias: resultado.fuente,
    metadataDistancias: resultado.metadata,
    reservas: [{
      Id_Reserva: 1,
      NumeroPasajeros: 2,
      Idioma_Reserva: 'ESPAÑOL',
      puntosReserva: [{
        Id_Punto: 10,
        NombrePunto: 'PUNTO VIAL',
        Latitud: PUNTOS[1].lat,
        Longitud: PUNTOS[1].lon,
        ruta: '1',
      }],
    }],
  });

  assert.equal(plan.fuenteDistancias, 'osrm-local');
  assert.equal(plan.metricas.distanciaTotalKm, 1.2);
  assert.equal(plan.metadataDistancias.fallbacksHaversine, 0);
});

test('usa Haversine cuando OSRM no está configurado', async () => {
  const resultado = await prepararMatrizOSRM({
    puntos: PUNTOS,
    baseUrl: '',
  });

  assert.equal(resultado.fuente, 'haversine-local');
  assert.equal(resultado.contexto, null);
  assert.equal(resultado.metadata.osrmConfigurado, false);
});

test('degrada de forma controlada cuando OSRM no responde', async () => {
  const resultado = await prepararMatrizOSRM({
    puntos: PUNTOS,
    baseUrl: 'http://127.0.0.1:5000',
    fetchImpl: async () => {
      throw new Error('conexión rechazada');
    },
  });

  assert.equal(resultado.fuente, 'haversine-local');
  assert.equal(resultado.contexto, null);
  assert.equal(resultado.metadata.osrmConfigurado, true);
  assert.match(resultado.metadata.motivoFallback, /conexión rechazada/);
});
