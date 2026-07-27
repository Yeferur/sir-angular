const CAPACIDAD_BUS = 38;

/**
 * Las rutas son zonas estratégicas, no fronteras geográficas.
 * Esta matriz solo aporta una preferencia suave al optimizador.
 */
const RUTAS_RELACIONADAS = {
  '0': ['2', '5'],
  '1': ['2', '3', '4', '5'],
  '2': ['0', '1', '3', '4', '5'],
  '3': ['1', '2', '4'],
  '4': ['1', '2', '3', '5'],
  '5': ['0', '1', '2', '4'],
  '6': ['7', '8', '12', '13', '14'],
  '7': ['6', '8', '12'],
  '8': ['6', '7', '9', '10', '12'],
  '9': ['8', '10', '12'],
  '10': ['8', '9', '12'],
  '12': ['6', '7', '8', '9', '10', '14'],
  '13': ['6', '14'],
  '14': ['6', '12', '13'],
};

const PUNTO_BASE = {
  lat: 6.2129433,
  lon: -75.57716,
  nombre: 'ESTACION POBLADO',
};

const PERFILES_BUSQUEDA = [
  {
    nombre: 'capacidad',
    pesoDistancia: 0,
    pesoRuta: 0.1,
    pesoOcupacion: 100,
    orden: 'pax-ruta',
  },
  {
    nombre: 'equilibrado',
    pesoDistancia: 1,
    pesoRuta: 2.5,
    pesoOcupacion: 0.3,
    orden: 'pax-ruta',
  },
  {
    nombre: 'ruta',
    pesoDistancia: 1.1,
    pesoRuta: 5,
    pesoOcupacion: 0.18,
    orden: 'ruta-pax',
  },
  {
    nombre: 'geografico',
    pesoDistancia: 2,
    pesoRuta: 1.5,
    pesoOcupacion: 0.2,
    orden: 'angulo-pax',
  },
  {
    nombre: 'ocupacion',
    pesoDistancia: 0.7,
    pesoRuta: 1.2,
    pesoOcupacion: 0.8,
    orden: 'pax-ruta',
  },
];

const UMBRALES_COHERENCIA = {
  incrementoDistanciaTotal: 0.15,
  incrementoDistanciaMaxima: 0.25,
  toleranciaDistanciaTotalKm: 2,
  toleranciaDistanciaMaximaKm: 3,
  incrementoMezclaRutas: 2,
};

module.exports = {
  CAPACIDAD_BUS,
  RUTAS_RELACIONADAS,
  PUNTO_BASE,
  PERFILES_BUSQUEDA,
  UMBRALES_COHERENCIA,
};
