const { obtenerTours, obtenerTourPorId, obtenerDisponibilidadTour } = require('../../Tours/tours.service');
const { obtenerDatosInicio } = require('../../inicio.service');
const { normalizeText } = require('../ia-query-normalizer.service');

async function resolveTour(tourId, tourName) {
  if (tourId) {
    const detail = await obtenerTourPorId(Number(tourId));
    return detail ? { id: Number(detail.Id_Tour), nombre: detail.Nombre_Tour, detail } : null;
  }

  if (!tourName) return null;

  const tours = await obtenerTours();
  const needle = normalizeText(tourName);
  const match = tours.find((tour) =>
    normalizeText(tour.Nombre_Tour).includes(needle)
    || normalizeText(tour.Abreviacion).includes(needle)
  );

  if (!match) return null;
  const detail = await obtenerTourPorId(Number(match.Id_Tour));
  return detail ? { id: Number(detail.Id_Tour), nombre: detail.Nombre_Tour, detail } : null;
}

async function executeConsultarTour({ input }) {
  const resolved = await resolveTour(input.tourId, input.query || input.tourName);
  return {
    rows: resolved?.detail ? [resolved.detail] : [],
    entityType: 'tours',
    tables: ['tours', 'planes_tours', 'tour_precios'],
    expectedAction: 'ver_tours',
    filters: { query: input.query || input.tourName || null },
  };
}

async function executeConsultarDisponibilidadTour({ input }) {
  const resolved = await resolveTour(input.tourId, input.tourName);
  const disponibilidad = resolved ? await obtenerDisponibilidadTour(resolved.id) : null;

  return {
    rows: disponibilidad ? [disponibilidad] : [],
    entityType: 'tours',
    tables: ['tours_dias', 'tours_temporadas', 'tours_temporada_dias'],
    expectedAction: 'ver_tours',
    filters: { tourId: resolved?.id || null, tourLike: resolved?.nombre || input.tourName || null },
    disponibilidad,
    tour: resolved ? { id: resolved.id, nombre: resolved.nombre } : null,
  };
}

async function executeConsultarCuposTourFecha({ input }) {
  const fecha = String(input.fecha || '').trim();
  const data = await obtenerDatosInicio(fecha);
  const tours = Array.isArray(data?.tours) ? data.tours : [];
  const resolved = await resolveTour(input.tourId, input.tourName);
  const filtered = resolved
    ? tours.filter((tour) => Number(tour.Id_Tour) === resolved.id)
    : tours;

  const rows = filtered.map((tour) => {
    const cupos = Number(tour.cupos || 0);
    const ocupados = Number(tour.NumeroPasajeros || 0);
    const disponibles = Math.max(cupos - ocupados, 0);
    const ocupacionPct = cupos > 0 ? Number(((ocupados / cupos) * 100).toFixed(1)) : 0;
    return {
      Id_Tour: Number(tour.Id_Tour),
      Nombre_Tour: tour.Nombre_Tour,
      cupos,
      ocupados,
      disponibles,
      ocupacionPct,
      totalReservas: Number(tour.totalReservas || 0),
      totalPrivados: Number(tour.totalPrivados || 0),
    };
  });

  return {
    rows,
    entityType: 'aforos',
    tables: ['aforos', 'tours', 'reservas'],
    expectedAction: 'ver_aforos',
    filters: { date: fecha, tourLike: resolved?.nombre || input.tourName || null },
  };
}

const toursTools = [
  {
    name: 'consultar_tour',
    description: 'Consulta el detalle de un tour por nombre o id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 120 },
        tourId: { type: 'integer', minimum: 1 },
        tourName: { type: 'string', minLength: 2, maxLength: 120 },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TOURS.LEER',
    module: 'tours',
    execute: executeConsultarTour,
  },
  {
    name: 'consultar_disponibilidad_tour',
    description: 'Consulta la disponibilidad base y temporadas de un tour.',
    inputSchema: {
      type: 'object',
      properties: {
        tourId: { type: 'integer', minimum: 1 },
        tourName: { type: 'string', minLength: 2, maxLength: 120 },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TOURS.LEER',
    module: 'tours',
    execute: executeConsultarDisponibilidadTour,
  },
  {
    name: 'consultar_cupos_tour_fecha',
    description: 'Consulta cupos y ocupación de un tour para una fecha específica.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tourId: { type: 'integer', minimum: 1 },
        tourName: { type: 'string', minLength: 2, maxLength: 120 },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TOURS.LEER',
    module: 'tours',
    execute: executeConsultarCuposTourFecha,
  },
];

module.exports = {
  toursTools,
};
