const { obtenerRutasPuntos, obtenerPuntosPorRuta } = require('../../Puntos/puntos.service');

async function executeConsultarRutasPuntos() {
  const rows = await obtenerRutasPuntos();
  return {
    rows,
    entityType: 'puntos',
    tables: ['puntos'],
    expectedAction: 'ver_puntos',
    filters: {},
  };
}

async function executeConsultarPuntosPorRuta({ input }) {
  const ruta = Number(input.ruta);
  const rows = await obtenerPuntosPorRuta(ruta);
  return {
    rows,
    entityType: 'puntos',
    tables: ['puntos', 'horarios'],
    expectedAction: 'ver_puntos',
    filters: { ruta },
  };
}

const puntosTools = [
  {
    name: 'consultar_rutas_puntos',
    description: 'Consulta las rutas disponibles de puntos de encuentro.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'PUNTOS.LEER',
    module: 'puntos',
    execute: executeConsultarRutasPuntos,
  },
  {
    name: 'consultar_puntos_por_ruta',
    description: 'Consulta los puntos de encuentro de una ruta específica.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'integer', minimum: 1 },
      },
      required: ['ruta'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'PUNTOS.LEER',
    module: 'puntos',
    execute: executeConsultarPuntosPorRuta,
  },
];

module.exports = {
  puntosTools,
};
