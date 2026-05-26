const { generarPlanLogistico, obtenerListadoFinal } = require('../../Programacion/programacion.service');
const { obtenerTours } = require('../../Tours/tours.service');
const { normalizeText } = require('../ia-query-normalizer.service');

async function resolveTourIds(input = {}) {
  if (Array.isArray(input.idsTours) && input.idsTours.length) {
    return input.idsTours.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  }

  if (!input.tourName) {
    return [];
  }

  const tours = await obtenerTours();
  const needle = normalizeText(input.tourName);
  return tours
    .filter((tour) => normalizeText(tour.Nombre_Tour).includes(needle) || normalizeText(tour.Abreviacion).includes(needle))
    .slice(0, 5)
    .map((tour) => Number(tour.Id_Tour))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function summarizePlan(plan = {}) {
  const buses = Array.isArray(plan.buses) ? plan.buses : [];
  const reservasSinAsignar = Array.isArray(plan.reservasSinAsignar) ? plan.reservasSinAsignar : [];
  const totalReservas = buses.reduce((acc, bus) => acc + (Array.isArray(bus.reservas) ? bus.reservas.length : 0), 0);
  const totalPasajeros = buses.reduce((acc, bus) => acc + Number(bus.ocupados || 0), 0);
  const ocupacionPromedio = buses.length
    ? Number((buses.reduce((acc, bus) => {
        const capacidad = Number(bus.capacidad || 0);
        const ocupados = Number(bus.ocupados || 0);
        if (!capacidad) return acc;
        return acc + ((ocupados / capacidad) * 100);
      }, 0) / buses.length).toFixed(1))
    : 0;

  return {
    totalBuses: buses.length,
    totalReservas,
    totalPasajeros,
    ocupacionPromedio,
    reservasSinAsignar: reservasSinAsignar.length,
  };
}

async function executeSimularListadoBuses({ input }) {
  const fecha = String(input.fecha || '').trim();
  const idsTours = await resolveTourIds(input);
  const plan = await generarPlanLogistico(fecha, idsTours);

  return {
    rows: Array.isArray(plan?.buses) ? plan.buses : [],
    entityType: 'programacion',
    tables: ['reservas', 'horarios', 'tours', 'puntos'],
    expectedAction: 'ver_listados',
    filters: { date: fecha, idsTours },
    fecha,
    idsTours,
    buses: plan?.buses || [],
    reservasSinAsignar: plan?.reservasSinAsignar || [],
    alertas: plan?.alertas || [],
    resumen: summarizePlan(plan),
  };
}

async function executeConsultarListadoGenerado({ input }) {
  const fecha = String(input.fecha || '').trim();
  const idsTours = await resolveTourIds(input);
  const result = await obtenerListadoFinal({ fecha, idsTours });
  const buses = Array.isArray(result?.buses) ? result.buses : [];

  return {
    rows: buses,
    entityType: 'programacion',
    tables: ['programaciones', 'programacion_tours', 'programacion_buses', 'programacion_reservas'],
    expectedAction: 'ver_listados',
    filters: { date: fecha, idsTours },
    fecha,
    idsTours,
    listados: buses,
    resumen: {
      total: buses.length,
      confirmados: result?.exists ? buses.length : 0,
      pendientes: result?.exists ? 0 : idsTours.length || 0,
    },
    exists: Boolean(result?.exists),
    data: result,
  };
}

const programacionTools = [
  {
    name: 'simular_listado_buses',
    description: 'Genera una propuesta de buses y distribución operativa para una fecha y uno o varios tours, sin guardar cambios.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        idsTours: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          minItems: 1,
          maxItems: 20,
        },
        tourName: { type: 'string', minLength: 2, maxLength: 120 },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'PROGRAMACION.LEER',
    module: 'programacion',
    execute: executeSimularListadoBuses,
  },
  {
    name: 'consultar_listado_generado',
    description: 'Consulta si ya existe un listado generado o confirmado para una fecha y uno o varios tours.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        idsTours: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          minItems: 1,
          maxItems: 20,
        },
        tourName: { type: 'string', minLength: 2, maxLength: 120 },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'PROGRAMACION.LEER',
    module: 'programacion',
    execute: executeConsultarListadoGenerado,
  },
];

module.exports = {
  programacionTools,
};
