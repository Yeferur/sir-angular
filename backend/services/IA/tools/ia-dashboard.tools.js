const {
  getDashboardStatsSvc,
  getIncomeHistorySvc,
  getPassengerDistributionSvc,
  getTourOccupancySvc,
} = require('../../Dashboard/dashboard.service');

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeDateRange(input = {}) {
  return {
    startDate: input.startDate ? String(input.startDate).trim() : null,
    endDate: input.endDate ? String(input.endDate).trim() : null,
  };
}

async function executeConsultarDashboardRango({ input }) {
  const filters = normalizeDateRange(input);
  const stats = await getDashboardStatsSvc(filters);

  return {
    rows: [stats],
    entityType: 'dashboard',
    tables: ['reservas', 'pasajeros', 'transfers'],
    expectedAction: null,
    filters,
    stats,
  };
}

async function executeConsultarIngresosPeriodo({ input }) {
  const year = Number(input.year);
  const data = await getIncomeHistorySvc(year);

  return {
    rows: data.map((total, index) => ({ mes: index + 1, total: Number(total || 0) })),
    entityType: 'dashboard',
    tables: ['reservas', 'pasajeros'],
    expectedAction: null,
    filters: { year },
    year,
    serie: data,
  };
}

async function executeConsultarOcupacionTours({ input }) {
  const filters = normalizeDateRange(input);
  const rows = await getTourOccupancySvc(filters);

  return {
    rows,
    entityType: 'tours',
    tables: ['reservas', 'pasajeros', 'horarios', 'tours'],
    expectedAction: 'ver_tours',
    filters,
  };
}

async function executeDiagnosticarOperacion({ input, user, context, helpers }) {
  const incluir = input?.incluir || {};
  const fecha = input?.fecha || helpers.getDateFromScope(input?.scope || 'general');
  const tourName = input?.tourName || null;
  const normalizedTourName = normalizeLabel(tourName);
  const warnings = [];
  const alertas = [];
  const recomendaciones = [];

  const safeCall = async (toolName, toolInput) => {
    try {
      return await helpers.executeTool({
        toolName,
        input: toolInput,
        user,
        context,
        internalCall: true,
      });
    } catch (error) {
      warnings.push(`No pude completar ${toolName}.`);
      return { success: false, errorCode: error?.code || 'IA_INTERNAL_TOOL_FAILED' };
    }
  };

  const inicioResult = await safeCall('consultar_inicio_fecha', { fecha });
  const dashboardResult = await safeCall('consultar_dashboard_rango', { startDate: fecha, endDate: fecha });
  const pagosResult = incluir.pagos === false
    ? { success: true, data: { rows: [], total: 0 } }
    : await safeCall('consultar_reservas_pendientes_pago', { fecha, tourName });
  const transfersResult = (incluir.transfers === false || tourName)
    ? { success: true, data: { rows: [], total: 0 } }
    : await safeCall('consultar_transfers_fecha', { fecha, includePending: true });
  const listadosResult = incluir.listados === false
    ? { success: true, data: { listados: [], resumen: { total: 0, confirmados: 0, pendientes: 0 } } }
    : await safeCall('consultar_listado_generado', { fecha, tourName });
  const cuposResult = incluir.cupos === false
    ? { success: true, data: { rows: [] } }
    : await safeCall('consultar_cupos_tour_fecha', { fecha, tourName });

  const inicio = inicioResult.success ? inicioResult.data : { tours: [], transfers: [], resumen: {} };
  const dashboard = dashboardResult.success ? dashboardResult.data?.stats || dashboardResult.data?.rows?.[0] || {} : {};
  const pagosRows = pagosResult.success ? (pagosResult.data?.rows || []) : [];
  const transferRows = transfersResult.success ? (transfersResult.data?.rows || []) : [];
  const listados = listadosResult.success ? (listadosResult.data?.listados || []) : [];
  const cuposRows = cuposResult.success ? (cuposResult.data?.rows || []) : [];
  const inicioTours = Array.isArray(inicio?.tours) ? inicio.tours : [];

  const toursFiltrados = normalizedTourName
    ? inicioTours.filter((tour) => {
      const normalizedNombre = normalizeLabel(tour?.Nombre_Tour);
      const normalizedAbreviacion = normalizeLabel(tour?.Abreviacion);
      return normalizedNombre.includes(normalizedTourName) || normalizedAbreviacion.includes(normalizedTourName);
    })
    : inicioTours;

  const toursDetalle = toursFiltrados
    .map((tour) => {
      const capacidad = Number(tour?.cupos || 0);
      const pasajeros = Number(tour?.NumeroPasajeros || 0);
      const reservas = Number(tour?.totalReservas || 0);
      const privados = Number(tour?.totalPrivados || 0);
      const disponibles = capacidad - pasajeros;
      const ocupacionPct = capacidad > 0
        ? Math.round((pasajeros / capacidad) * 100)
        : 0;

      return {
        id: tour?.Id_Tour || null,
        nombre: tour?.Nombre_Tour || '',
        abreviacion: tour?.Abreviacion || null,
        pasajeros,
        reservas,
        privados,
        capacidad,
        disponibles,
        ocupacionPct,
      };
    })
    .filter((tour) => tour.nombre);

  const tourResolved = toursDetalle.length === 1
    ? { id: toursDetalle[0].id, nombre: toursDetalle[0].nombre }
    : tourName
      ? { id: null, nombre: tourName }
      : null;

  const totalReservas = toursDetalle.length
    ? toursDetalle.reduce((sum, tour) => sum + tour.reservas, 0)
    : Number(inicio?.resumen?.totalReservas || dashboard.totalReservas || 0);
  const totalPasajeros = toursDetalle.length
    ? toursDetalle.reduce((sum, tour) => sum + tour.pasajeros, 0)
    : Number(inicio?.resumen?.totalPasajeros || dashboard.totalPasajeros || 0);
  const totalTransfers = Number(inicio?.resumen?.totalTransfers || dashboard.totalTransfers || transferRows.length || 0);
  const pendientesPago = Number(pagosResult.data?.total || pagosRows.length || 0);
  const listadosPendientes = Number(listadosResult.data?.resumen?.pendientes || 0);
  const toursAltaOcupacion = cuposRows.filter((row) => Number(row.ocupacionPct || row.porcentajeOcupacion || 0) >= 85);
  const toursSinCupos = cuposRows.filter((row) => Number(row.disponibles || 0) <= 0);
  const reservasSinPunto = Number(
    cuposResult.data?.reservasSinPunto
    || pagosResult.data?.reservasSinPunto
    || 0
  );

  if (pendientesPago > 0) {
    alertas.push({
      tipo: 'pago_pendiente',
      severidad: pendientesPago >= 5 ? 'alta' : 'media',
      mensaje: `Hay ${pendientesPago} reservas pendientes de pago.`,
      datos: { total: pendientesPago, fecha, tourName },
    });
    recomendaciones.push('Revisar reservas pendientes de pago.');
  }

  if (reservasSinPunto > 0) {
    alertas.push({
      tipo: 'sin_punto',
      severidad: reservasSinPunto >= 3 ? 'alta' : 'media',
      mensaje: `Hay ${reservasSinPunto} reservas sin punto de encuentro.`,
      datos: { total: reservasSinPunto, fecha, tourName },
    });
    recomendaciones.push('Validar puntos de encuentro faltantes.');
  }

  for (const tour of toursDetalle.slice(0, 6)) {
    if (tour.disponibles < 0) {
      alertas.push({
        tipo: 'sin_cupos',
        severidad: 'alta',
        mensaje: `${tour.nombre} está en sobrecupo por ${Math.abs(tour.disponibles)} pasajero${Math.abs(tour.disponibles) === 1 ? '' : 's'}.`,
        datos: tour,
      });
      if (!recomendaciones.includes('Ajustar cupos o redistribuir pasajeros en los tours comprometidos.')) {
        recomendaciones.push('Ajustar cupos o redistribuir pasajeros en los tours comprometidos.');
      }
      continue;
    }

    if (tour.disponibles === 0 && tour.pasajeros > 0) {
      alertas.push({
        tipo: 'sin_cupos',
        severidad: 'alta',
        mensaje: `${tour.nombre} ya está sin cupos disponibles.`,
        datos: tour,
      });
      continue;
    }

    if (tour.ocupacionPct >= 85 && tour.pasajeros > 0) {
      alertas.push({
        tipo: 'alta_ocupacion',
        severidad: tour.ocupacionPct >= 95 ? 'alta' : 'media',
        mensaje: `${tour.nombre} está con ocupación alta (${tour.ocupacionPct}%) y ${tour.disponibles} cupo${tour.disponibles === 1 ? '' : 's'} disponible${tour.disponibles === 1 ? '' : 's'}.`,
        datos: tour,
      });
      if (!recomendaciones.includes('Monitorear tours con ocupación alta.')) {
        recomendaciones.push('Monitorear tours con ocupación alta.');
      }
    }
  }

  for (const row of toursSinCupos.slice(0, 2)) {
    alertas.push({
      tipo: 'sin_cupos',
      severidad: 'alta',
      mensaje: `${row.Nombre_Tour || row.tour} está sin cupos para ${fecha}.`,
      datos: row,
    });
  }

  for (const row of toursAltaOcupacion.filter((item) => Number(item.disponibles || 0) > 0).slice(0, 2)) {
    alertas.push({
      tipo: 'alta_ocupacion',
      severidad: Number(row.ocupacionPct || row.porcentajeOcupacion || 0) >= 95 ? 'alta' : 'media',
      mensaje: `${row.Nombre_Tour || row.tour} está con ocupación alta (${row.ocupacionPct || row.porcentajeOcupacion}%).`,
      datos: row,
    });
    if (!recomendaciones.includes('Monitorear tours con ocupación alta.')) {
      recomendaciones.push('Monitorear tours con ocupación alta.');
    }
  }

  if (transferRows.length > 0) {
    const pendingTransfers = transferRows.filter((row) => /pendiente/i.test(String(row.Estado || '')));
    if (pendingTransfers.length > 0) {
      alertas.push({
        tipo: 'transfer_pendiente',
        severidad: pendingTransfers.length >= 4 ? 'media' : 'baja',
        mensaje: `Encontré ${pendingTransfers.length} transfers pendientes para ${fecha}.`,
        datos: { total: pendingTransfers.length, fecha },
      });
      recomendaciones.push('Revisar transfers pendientes y sus soportes de pago.');
    }
  }

  if (listadosPendientes > 0) {
    alertas.push({
      tipo: 'listado_pendiente',
      severidad: 'media',
      mensaje: `Hay ${listadosPendientes} listados pendientes por confirmar.`,
      datos: { total: listadosPendientes, fecha, tourName },
    });
    recomendaciones.push('Confirmar listados antes de cerrar la programación.');
  }

  const uniqueAlertas = [];
  const seenAlertas = new Set();
  for (const alerta of alertas) {
    const key = `${alerta.tipo}:${alerta.mensaje}`;
    if (seenAlertas.has(key)) continue;
    seenAlertas.add(key);
    uniqueAlertas.push(alerta);
  }

  if (!recomendaciones.length) {
    recomendaciones.push('Revisar reservas nuevas, pagos recientes y listados antes de cerrar la programación.');
  }

  return {
    rows: [],
    entityType: 'operacion',
    tables: ['reservas', 'tours', 'transfers', 'programaciones'],
    expectedAction: 'diagnosticar_operacion',
    filters: { date: fecha, scope: input?.scope || 'general', tourLike: tourName || null },
    fecha,
    scope: input?.scope || 'general',
    tour: tourResolved,
    tourEspecifico: tourResolved?.nombre || null,
    resumen: {
      totalTours: toursDetalle.length || inicioTours.length || 0,
      totalReservas,
      totalPasajeros,
      totalTransfers,
      pendientesPago,
      reservasSinPunto,
      toursAltaOcupacion: toursAltaOcupacion.length,
      toursSinCupos: toursSinCupos.length,
      listadosPendientes,
    },
    alertas: uniqueAlertas,
    recomendaciones,
    toursDetalle,
    secciones: {
      inicio,
      dashboard,
      pagos: pagosRows,
      transfers: transferRows,
      cupos: cuposRows,
      listados,
    },
    warnings,
  };
}

const dashboardTools = [
  {
    name: 'consultar_dashboard_rango',
    description: 'Consulta estadísticas generales del dashboard para un rango de fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'DASHBOARD.LEER',
    module: 'dashboard',
    execute: executeConsultarDashboardRango,
  },
  {
    name: 'consultar_ingresos_periodo',
    description: 'Consulta la serie de ingresos por mes para un año.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'integer', minimum: 2020, maximum: 2100 },
      },
      required: ['year'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'DASHBOARD.LEER',
    module: 'dashboard',
    execute: executeConsultarIngresosPeriodo,
  },
  {
    name: 'consultar_ocupacion_tours',
    description: 'Consulta la ocupación o volumen de pasajeros por tour en un rango de fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'DASHBOARD.LEER',
    module: 'dashboard',
    execute: executeConsultarOcupacionTours,
  },
  {
    name: 'diagnosticar_operacion',
    description: 'Analiza la operación de una fecha específica o de un tour específico, revisando reservas, cupos, pagos, transfers, puntos y pendientes importantes.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
        tourName: { anyOf: [{ type: 'string', minLength: 2, maxLength: 120 }, { type: 'null' }] },
        scope: { type: 'string', enum: ['hoy', 'mañana', 'fecha', 'tour_fecha', 'general'] },
        incluir: {
          type: 'object',
          properties: {
            reservas: { type: 'boolean' },
            cupos: { type: 'boolean' },
            pagos: { type: 'boolean' },
            transfers: { type: 'boolean' },
            puntos: { type: 'boolean' },
            listados: { type: 'boolean' },
          },
          required: ['reservas', 'cupos', 'pagos', 'transfers', 'puntos', 'listados'],
          additionalProperties: false,
        },
      },
      required: ['scope', 'incluir'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: null,
    module: 'dashboard',
    execute: executeDiagnosticarOperacion,
  },
];

module.exports = {
  dashboardTools,
};
