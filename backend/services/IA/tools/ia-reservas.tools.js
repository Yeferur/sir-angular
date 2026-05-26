const { filtrarReservas, obtenerReserva } = require('../../Reservas/reservas.service');
const { obtenerTours } = require('../../Tours/tours.service');
const { normalizeText } = require('../ia-query-normalizer.service');

async function resolveTourIdByName(tourName) {
  if (!tourName) return null;
  const tours = await obtenerTours();
  const needle = normalizeText(tourName);
  const match = tours.find((tour) =>
    normalizeText(tour.Nombre_Tour).includes(needle)
    || normalizeText(tour.Abreviacion).includes(needle)
  );
  return match ? Number(match.Id_Tour) : null;
}

async function executeConsultarReservaPorCodigo({ input }) {
  const codigo = String(input.codigoReserva || '').trim();
  const data = await obtenerReserva(codigo);

  return {
    rows: data ? [data] : [],
    entityType: 'reservas',
    tables: ['reservas', 'pasajeros', 'pagos_reservas'],
    expectedAction: 'buscar_reservas',
    filters: { query: codigo },
  };
}

async function executeConsultarReservasFechaTour({ input }) {
  const fecha = String(input.fecha || '').trim();
  const tourId = input.tourId ? Number(input.tourId) : await resolveTourIdByName(input.tourName);
  const rows = await filtrarReservas({
    Fecha_Tour: fecha,
    ...(tourId ? { Id_Tour: tourId } : {}),
  });

  return {
    rows,
    entityType: 'reservas',
    tables: ['reservas', 'horarios', 'tours', 'pasajeros'],
    expectedAction: 'buscar_reservas',
    filters: { date: fecha, tourId, tourLike: input.tourName || null },
  };
}

async function executeConsultarReservasPendientesPago({ input }) {
  const fecha = String(input.fecha || '').trim();
  const tourId = input.tourId ? Number(input.tourId) : await resolveTourIdByName(input.tourName);
  const rows = await filtrarReservas({
    Fecha_Tour: fecha,
    Estado: ['Pendiente de pago', 'Pendiente Pago', 'Pendiente'],
    ...(tourId ? { Id_Tour: tourId } : {}),
  });

  const reservasSinPunto = rows.filter((row) => !row?.Punto).length;

  return {
    rows,
    total: rows.length,
    reservasSinPunto,
    entityType: 'reservas',
    tables: ['reservas', 'horarios', 'tours', 'pasajeros'],
    expectedAction: 'buscar_reservas',
    filters: { date: fecha, paymentStatus: 'pending', tourId, tourLike: input.tourName || null },
  };
}

const reservasTools = [
  {
    name: 'consultar_reserva_por_codigo',
    description: 'Consulta una reserva específica por su código.',
    inputSchema: {
      type: 'object',
      properties: {
        codigoReserva: { type: 'string', minLength: 3, maxLength: 40 },
      },
      required: ['codigoReserva'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'RESERVAS.LEER',
    module: 'reservas',
    execute: executeConsultarReservaPorCodigo,
  },
  {
    name: 'consultar_reservas_fecha_tour',
    description: 'Consulta reservas por fecha y opcionalmente por tour.',
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
    requiredPermission: 'RESERVAS.LEER',
    module: 'reservas',
    execute: executeConsultarReservasFechaTour,
  },
  {
    name: 'consultar_reservas_pendientes_pago',
    description: 'Consulta reservas pendientes de pago por fecha y opcionalmente por tour.',
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
    requiredPermission: 'RESERVAS.LEER',
    module: 'reservas',
    execute: executeConsultarReservasPendientesPago,
  },
];

module.exports = {
  reservasTools,
};
