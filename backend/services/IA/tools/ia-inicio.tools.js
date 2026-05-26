const { obtenerDatosInicio } = require('../../inicio.service');

async function executeConsultarInicioFecha({ input }) {
  const fecha = String(input.fecha || '').trim();
  const data = await obtenerDatosInicio(fecha);
  const tours = Array.isArray(data?.tours) ? data.tours : [];
  const transfers = Array.isArray(data?.transfers) ? data.transfers : [];

  return {
    rows: tours,
    entityType: 'operacion',
    tables: ['tours', 'aforos', 'reservas', 'transfers'],
    expectedAction: 'ver_aforos',
    filters: { date: fecha },
    fecha,
    tours,
    transfers,
    resumen: {
      totalTours: tours.length,
      totalReservas: tours.reduce((acc, item) => acc + Number(item.totalReservas || 0), 0),
      totalPasajeros: tours.reduce((acc, item) => acc + Number(item.NumeroPasajeros || 0), 0),
      totalPrivados: tours.reduce((acc, item) => acc + Number(item.totalPrivados || 0), 0),
      totalTransfers: transfers.reduce((acc, item) => acc + Number(item.totalTransfers || 0), 0),
    },
  };
}

const inicioTools = [
  {
    name: 'consultar_inicio_fecha',
    description: 'Consulta el resumen operativo de inicio para una fecha, incluyendo tours, cupos, reservas privadas y transfers.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'INICIO.LEER',
    module: 'inicio',
    execute: executeConsultarInicioFecha,
  },
];

module.exports = {
  inicioTools,
};
