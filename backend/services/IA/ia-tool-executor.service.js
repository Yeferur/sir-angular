const Ajv = require('ajv');

const { pool, SQL_TIMEOUT_MS, SQL_MAX_ROWS } = require('../../config/db-readonly');
const { getIaToolByName } = require('./ia-tool-registry.service');
const { assertIaToolPermission } = require('./tools/ia-permission-guard.service');

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: false,
  useDefaults: true,
});

const validatorCache = new Map();

function getValidator(tool) {
  if (!validatorCache.has(tool.name)) {
    validatorCache.set(tool.name, ajv.compile(tool.inputSchema));
  }

  return validatorCache.get(tool.name);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function hasPermission(userPermissions, permission) {
  return !permission || userPermissions.includes(permission);
}

function ensurePermissions(userPermissions, permissions) {
  const required = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
  return required.every((permission) => hasPermission(userPermissions, permission));
}

function buildLikeParam(value) {
  return `%${String(value || '').trim()}%`;
}

function limitValue(value = 20) {
  return Math.min(Math.max(1, value), Math.max(1, Math.min(100, SQL_MAX_ROWS || 50)));
}

function getTodayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function addDaysYmd(dateYmd, days) {
  const [year, month, day] = String(dateYmd).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function queryReadonly(sql, values = []) {
  const [rows] = await pool.query({
    sql,
    values,
    timeout: SQL_TIMEOUT_MS,
  });

  return Array.isArray(rows) ? rows : [];
}

async function safeQuerySection(runSection) {
  try {
    return {
      ok: true,
      data: await runSection(),
      warning: null,
    };
  } catch (error) {
    console.warn('[IA TOOL] diagnosticar_operacion sección parcial:', error.message);
    return {
      ok: false,
      data: null,
      warning: error.message,
    };
  }
}

function buildDiagnosticIncludes(input = {}) {
  const incluir = input?.incluir && typeof input.incluir === 'object' ? input.incluir : {};
  return {
    reservas: incluir.reservas !== false,
    cupos: incluir.cupos !== false,
    pagos: incluir.pagos !== false,
    transfers: incluir.transfers !== false,
    puntos: incluir.puntos !== false,
    listados: incluir.listados !== false,
  };
}

function resolveDiagnosticDate(input = {}) {
  const today = getTodayYmd();
  if (input.scope === 'mañana') return addDaysYmd(today, 1);
  if (input.scope === 'hoy' || input.scope === 'general') return today;
  if (input.fecha) return String(input.fecha);
  return today;
}

async function resolveTourReference(tourName) {
  if (!tourName) return null;

  const rows = await queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour',
      'FROM tours t',
      'WHERE t.Activo = 1',
      'AND (t.Nombre_Tour LIKE ? OR t.Abreviacion LIKE ?)',
      'ORDER BY t.Nombre_Tour ASC',
      'LIMIT 1',
    ].join(' '),
    [buildLikeParam(tourName), buildLikeParam(tourName)]
  );

  if (!rows.length) return null;

  return {
    id: Number(rows[0].Id_Tour),
    nombre: String(rows[0].Nombre_Tour || '').trim(),
  };
}

function buildReservationFilters({ date, tour }) {
  const joins = [
    'FROM reservas r',
    'LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario',
    'LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour',
  ];
  const filters = ['r.Fecha_Tour = ?'];
  const values = [date];

  if (tour?.id) {
    filters.push('t.Id_Tour = ?');
    values.push(tour.id);
  } else if (tour?.nombre) {
    filters.push('t.Nombre_Tour LIKE ?');
    values.push(buildLikeParam(tour.nombre));
  }

  return {
    joins,
    whereClause: `WHERE ${filters.join(' AND ')}`,
    values,
  };
}

function pushDiagnosticAlert(alerts, recommendations, alert) {
  alerts.push(alert);
  if (alert?.recomendacion && !recommendations.includes(alert.recomendacion)) {
    recommendations.push(alert.recomendacion);
  }
}

async function fetchReservaDiagnostics({ date, tour, includePayments, includePoints }) {
  const { joins, whereClause, values } = buildReservationFilters({ date, tour });
  const pointsProjection = includePoints
    ? 'COALESCE(SUM(CASE WHEN pax_point.Sin_Punto = 1 THEN 1 ELSE 0 END), 0) AS pasajerosSinPunto,'
    : '0 AS pasajerosSinPunto,';
  const paymentsProjection = includePayments
    ? 'COALESCE(SUM(CASE WHEN COALESCE(pg.Total_Pagado, 0) < COALESCE(pax.Total_Valor, 0) THEN 1 ELSE 0 END), 0) AS reservasPendientesPago'
    : '0 AS reservasPendientesPago';

  const aggregateRows = await queryReadonly(
    [
      'SELECT',
      'COUNT(DISTINCT r.Id_Reserva) AS totalReservas,',
      'COALESCE(SUM(pax.Total_Pasajeros), 0) AS totalPasajeros,',
      `COALESCE(SUM(CASE WHEN UPPER(COALESCE(r.Estado, '')) IN ('PENDIENTE DE PAGO', 'PENDIENTE PAGO') THEN 1 ELSE 0 END), 0) AS reservasEstadoPendientePago,`,
      `COALESCE(SUM(CASE WHEN h.Id_Punto IS NULL THEN 1 ELSE 0 END), 0) AS reservasSinPunto,`,
      `COALESCE(SUM(CASE WHEN r.Id_Horario IS NULL THEN 1 ELSE 0 END), 0) AS reservasSinHorario,`,
      pointsProjection,
      paymentsProjection,
      ...joins,
      'LEFT JOIN (',
      '  SELECT pa.Id_Reserva, COUNT(*) AS Total_Pasajeros, SUM(COALESCE(pa.Precio_Pasajero, 0)) AS Total_Valor',
      '  FROM pasajeros pa',
      '  GROUP BY pa.Id_Reserva',
      ') pax ON pax.Id_Reserva = r.Id_Reserva',
      includePoints
        ? [
            'LEFT JOIN (',
            '  SELECT pa2.Id_Reserva, MAX(CASE WHEN pa2.Id_Punto IS NULL THEN 1 ELSE 0 END) AS Sin_Punto',
            '  FROM pasajeros pa2',
            '  GROUP BY pa2.Id_Reserva',
            ') pax_point ON pax_point.Id_Reserva = r.Id_Reserva',
          ].join(' ')
        : '',
      includePayments
        ? [
            'LEFT JOIN (',
            '  SELECT pr.Id_Reserva, SUM(COALESCE(pr.Monto, 0)) AS Total_Pagado',
            '  FROM pagos_reservas pr',
            '  GROUP BY pr.Id_Reserva',
            ') pg ON pg.Id_Reserva = r.Id_Reserva',
          ].join(' ')
        : '',
      whereClause,
      'LIMIT 1',
    ].filter(Boolean).join(' '),
    values
  );

  const statesRows = await queryReadonly(
    [
      'SELECT UPPER(COALESCE(r.Estado, "SIN ESTADO")) AS estado, COUNT(*) AS total',
      ...joins,
      whereClause,
      'GROUP BY UPPER(COALESCE(r.Estado, "SIN ESTADO"))',
      'ORDER BY total DESC',
      `LIMIT ${limitValue(10)}`,
    ].join(' '),
    values
  );

  return {
    totalReservas: Number(aggregateRows[0]?.totalReservas || 0),
    totalPasajeros: Number(aggregateRows[0]?.totalPasajeros || 0),
    reservasPendientesPago: Number(aggregateRows[0]?.reservasPendientesPago || aggregateRows[0]?.reservasEstadoPendientePago || 0),
    reservasSinPunto: Number(aggregateRows[0]?.reservasSinPunto || 0),
    reservasSinHorario: Number(aggregateRows[0]?.reservasSinHorario || 0),
    pasajerosSinPunto: Number(aggregateRows[0]?.pasajerosSinPunto || 0),
    porEstado: statesRows.map((row) => ({
      estado: String(row.estado || 'SIN ESTADO'),
      total: Number(row.total || 0),
    })),
  };
}

async function fetchCuposDiagnostics({ date, tour }) {
  const rows = await queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour,',
      'COALESCE(a.Cupo, t.Cupo_Base) AS aforo,',
      'COALESCE(occ.Reservados, 0) AS ocupados,',
      'GREATEST(COALESCE(a.Cupo, t.Cupo_Base) - COALESCE(occ.Reservados, 0), 0) AS disponibles,',
      'CASE',
      '  WHEN COALESCE(a.Cupo, t.Cupo_Base) > 0',
      '    THEN ROUND((COALESCE(occ.Reservados, 0) / COALESCE(a.Cupo, t.Cupo_Base)) * 100, 1)',
      '  ELSE 0',
      'END AS porcentajeOcupacion',
      'FROM tours t',
      'LEFT JOIN (',
      '  SELECT a1.Id_Tour, a1.Cupo',
      '  FROM aforos a1',
      '  INNER JOIN (',
      '    SELECT Id_Tour, MAX(Id_Aforo) AS Max_Aforo',
      '    FROM aforos',
      '    WHERE Fecha_Aforo = ?',
      '    GROUP BY Id_Tour',
      '  ) last_aforo ON last_aforo.Max_Aforo = a1.Id_Aforo',
      ') a ON a.Id_Tour = t.Id_Tour',
      'LEFT JOIN (',
      '  SELECT h.Id_Tour, COUNT(pa.Id_Pasajero) AS Reservados',
      '  FROM reservas r',
      '  JOIN horarios h ON h.Id_Horario = r.Id_Horario',
      '  LEFT JOIN pasajeros pa ON pa.Id_Reserva = r.Id_Reserva',
      "  WHERE r.Fecha_Tour = ? AND UPPER(COALESCE(r.Estado, '')) NOT IN ('CANCELADA', 'CANCELADO')",
      '  GROUP BY h.Id_Tour',
      ') occ ON occ.Id_Tour = t.Id_Tour',
      'WHERE t.Activo = 1',
      tour?.id ? 'AND t.Id_Tour = ?' : '',
      'ORDER BY porcentajeOcupacion DESC, t.Nombre_Tour ASC',
      `LIMIT ${limitValue(20)}`,
    ].filter(Boolean).join(' '),
    tour?.id ? [date, date, tour.id] : [date, date]
  );

  return rows.map((row) => ({
    id: Number(row.Id_Tour),
    tour: String(row.Nombre_Tour || '').trim(),
    aforo: Number(row.aforo || 0),
    ocupados: Number(row.ocupados || 0),
    disponibles: Number(row.disponibles || 0),
    porcentajeOcupacion: Number(row.porcentajeOcupacion || 0),
  }));
}

async function fetchTransfersDiagnostics({ date }) {
  const totalsRows = await queryReadonly(
    [
      'SELECT',
      'COUNT(*) AS totalTransfers,',
      `COALESCE(SUM(CASE WHEN UPPER(COALESCE(tr.Estado, '')) IN ('PENDIENTE', 'PENDIENTE DE PAGO', 'PENDIENTE PAGO') THEN 1 ELSE 0 END), 0) AS transfersPendientes,`,
      `COALESCE(SUM(CASE WHEN COALESCE(pt.Total_Pagado, 0) < COALESCE(tr.Valor, 0) THEN 1 ELSE 0 END), 0) AS transfersPendientesPago,`,
      `COALESCE(SUM(CASE WHEN NULLIF(TRIM(COALESCE(pt.UltimoComprobante, '')), '') IS NULL THEN 1 ELSE 0 END), 0) AS transfersSinComprobante`,
      'FROM transfers tr',
      'LEFT JOIN (',
      '  SELECT pgt.Id_Transfer,',
      '         SUM(COALESCE(pgt.Monto, 0)) AS Total_Pagado,',
      '         MAX(NULLIF(TRIM(COALESCE(pgt.Pago_Comprobante, "")), "")) AS UltimoComprobante',
      '  FROM pagos_transfers pgt',
      '  GROUP BY pgt.Id_Transfer',
      ') pt ON pt.Id_Transfer = tr.Id_Transfer',
      'WHERE tr.Fecha_Transfer = ?',
      'LIMIT 1',
    ].join(' '),
    [date]
  );

  const statesRows = await queryReadonly(
    [
      'SELECT UPPER(COALESCE(tr.Estado, "SIN ESTADO")) AS estado, COUNT(*) AS total',
      'FROM transfers tr',
      'WHERE tr.Fecha_Transfer = ?',
      'GROUP BY UPPER(COALESCE(tr.Estado, "SIN ESTADO"))',
      'ORDER BY total DESC',
      `LIMIT ${limitValue(10)}`,
    ].join(' '),
    [date]
  );

  return {
    totalTransfers: Number(totalsRows[0]?.totalTransfers || 0),
    transfersPendientes: Number(totalsRows[0]?.transfersPendientes || 0),
    transfersPendientesPago: Number(totalsRows[0]?.transfersPendientesPago || 0),
    transfersSinComprobante: Number(totalsRows[0]?.transfersSinComprobante || 0),
    porEstado: statesRows.map((row) => ({
      estado: String(row.estado || 'SIN ESTADO'),
      total: Number(row.total || 0),
    })),
  };
}

async function fetchListadosDiagnostics({ date, tour }) {
  const values = [date, date];
  let filter = '';

  if (tour?.id) {
    filter = 'AND t.Id_Tour = ?';
    values.push(tour.id);
  }

  const rows = await queryReadonly(
    [
      'SELECT base.Id_Tour, base.Nombre_Tour,',
      'MAX(base.Id_Programacion) AS Id_Programacion,',
      'MAX(base.Confirmado_En) AS Confirmado_En,',
      'MAX(base.TieneListado) AS TieneListado',
      'FROM (',
      '  SELECT DISTINCT t.Id_Tour, t.Nombre_Tour,',
      '         p.Id_Programacion, p.Confirmado_En,',
      '         CASE WHEN p.Estado = "activa" THEN 1 ELSE 0 END AS TieneListado',
      '  FROM reservas r',
      '  INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario',
      '  INNER JOIN tours t ON t.Id_Tour = h.Id_Tour',
      '  LEFT JOIN programacion_tours pt ON pt.Id_Tour = t.Id_Tour',
      '  LEFT JOIN programaciones p ON p.Id_Programacion = pt.Id_Programacion AND p.Fecha_Tour = ? AND p.Estado = "activa"',
      '  WHERE r.Fecha_Tour = ?',
      filter,
      ') base',
      'GROUP BY base.Id_Tour, base.Nombre_Tour',
      'ORDER BY base.Nombre_Tour ASC',
      `LIMIT ${limitValue(20)}`,
    ].filter(Boolean).join(' '),
    values
  );

  const detalles = rows.map((row) => ({
    idTour: Number(row.Id_Tour),
    nombreTour: String(row.Nombre_Tour || '').trim(),
    listadoGenerado: Boolean(Number(row.TieneListado || 0)),
    listadoConfirmado: Boolean(row.Confirmado_En),
    confirmadoEn: row.Confirmado_En || null,
  }));

  return {
    toursConListado: detalles.filter((item) => item.listadoGenerado).length,
    toursSinListado: detalles.filter((item) => !item.listadoGenerado).length,
    detalles,
  };
}

async function runDiagnosticarOperacion(input) {
  const scope = String(input.scope || 'general');
  const fecha = resolveDiagnosticDate(input);
  const incluir = buildDiagnosticIncludes(input);
  const tour = input.tourName ? await resolveTourReference(input.tourName) : null;
  const warnings = [];
  const alertas = [];
  const recomendaciones = [];

  if (input.tourName && !tour) {
    warnings.push(`No encontré un tour exacto para "${String(input.tourName)}", así que el diagnóstico puede venir más amplio de lo esperado.`);
  }

  const reservasResult = incluir.reservas
    ? await safeQuerySection(() => fetchReservaDiagnostics({
      date: fecha,
      tour,
      includePayments: incluir.pagos,
      includePoints: incluir.puntos,
    }))
    : { ok: true, data: null, warning: null };
  if (reservasResult.warning) warnings.push('No pude completar toda la sección de reservas.');

  const cuposResult = incluir.cupos
    ? await safeQuerySection(() => fetchCuposDiagnostics({ date: fecha, tour }))
    : { ok: true, data: [], warning: null };
  if (cuposResult.warning) warnings.push('No pude completar toda la sección de cupos.');

  const transfersResult = incluir.transfers && !tour
    ? await safeQuerySection(() => fetchTransfersDiagnostics({ date: fecha }))
    : { ok: true, data: null, warning: null };
  if (transfersResult.warning) warnings.push('No pude completar toda la sección de transfers.');

  const listadosResult = incluir.listados
    ? await safeQuerySection(() => fetchListadosDiagnostics({ date: fecha, tour }))
    : { ok: true, data: null, warning: null };
  if (listadosResult.warning) warnings.push('No pude completar toda la sección de listados.');

  const reservas = reservasResult.data || {
    totalReservas: 0,
    totalPasajeros: 0,
    reservasPendientesPago: 0,
    reservasSinPunto: 0,
    reservasSinHorario: 0,
    pasajerosSinPunto: 0,
    porEstado: [],
  };
  const cupos = Array.isArray(cuposResult.data) ? cuposResult.data : [];
  const transfers = transfersResult.data || {
    totalTransfers: 0,
    transfersPendientes: 0,
    transfersPendientesPago: 0,
    transfersSinComprobante: 0,
    porEstado: [],
  };
  const listados = listadosResult.data || {
    toursConListado: 0,
    toursSinListado: 0,
    detalles: [],
  };

  const toursAltaOcupacion = cupos.filter((item) => item.porcentajeOcupacion >= 85);
  const toursSinCupos = cupos.filter((item) => item.disponibles <= 0 && item.aforo > 0);
  const listadosPendientes = Array.isArray(listados.detalles)
    ? listados.detalles.filter((item) => !item.listadoConfirmado).length
    : 0;

  if (reservas.reservasPendientesPago > 0) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'pago_pendiente',
      severidad: reservas.reservasPendientesPago >= 5 ? 'alta' : 'media',
      mensaje: `Hay ${reservas.reservasPendientesPago} reservas pendientes de pago.`,
      datos: {
        total: reservas.reservasPendientesPago,
        fecha,
        ...(tour?.id ? { tourId: tour.id, tourName: tour.nombre } : {}),
      },
      recomendacion: 'Revisar reservas pendientes de pago.',
    });
  }

  if (reservas.reservasSinPunto > 0 || reservas.pasajerosSinPunto > 0) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'sin_punto',
      severidad: reservas.reservasSinPunto >= 3 || reservas.pasajerosSinPunto >= 5 ? 'alta' : 'media',
      mensaje: `Hay ${reservas.reservasSinPunto} reservas sin punto de encuentro${reservas.pasajerosSinPunto ? ` y ${reservas.pasajerosSinPunto} pasajeros sin punto asignado` : ''}.`,
      datos: {
        reservasSinPunto: reservas.reservasSinPunto,
        pasajerosSinPunto: reservas.pasajerosSinPunto,
        fecha,
      },
      recomendacion: 'Validar puntos de encuentro faltantes.',
    });
  }

  for (const item of toursSinCupos.slice(0, 2)) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'sin_cupos',
      severidad: 'alta',
      mensaje: `${item.tour} está sin cupos para ${fecha}.`,
      datos: {
        tourId: item.id,
        tour: item.tour,
        aforo: item.aforo,
        ocupados: item.ocupados,
        disponibles: item.disponibles,
      },
      recomendacion: 'Validar tours sin cupos antes de cerrar la programación.',
    });
  }

  for (const item of toursAltaOcupacion.filter((entry) => entry.disponibles > 0).slice(0, 2)) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'alta_ocupacion',
      severidad: item.porcentajeOcupacion >= 95 ? 'alta' : 'media',
      mensaje: `${item.tour} está con ocupación alta (${item.porcentajeOcupacion}%).`,
      datos: {
        tourId: item.id,
        tour: item.tour,
        porcentajeOcupacion: item.porcentajeOcupacion,
        disponibles: item.disponibles,
      },
      recomendacion: 'Monitorear tours con ocupación alta.',
    });
  }

  if (transfers.totalTransfers > 0 && (transfers.transfersPendientes > 0 || transfers.transfersPendientesPago > 0 || transfers.transfersSinComprobante > 0)) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'transfer_pendiente',
      severidad: transfers.transfersPendientes >= 4 || transfers.transfersPendientesPago >= 3 ? 'media' : 'baja',
      mensaje: `Encontré ${transfers.transfersPendientes || 0} transfers pendientes, ${transfers.transfersPendientesPago || 0} con pago pendiente y ${transfers.transfersSinComprobante || 0} sin comprobante.`,
      datos: {
        totalTransfers: transfers.totalTransfers,
        transfersPendientes: transfers.transfersPendientes,
        transfersPendientesPago: transfers.transfersPendientesPago,
        transfersSinComprobante: transfers.transfersSinComprobante,
        fecha,
      },
      recomendacion: 'Revisar transfers pendientes y sus soportes de pago.',
    });
  }

  if (listadosPendientes > 0) {
    pushDiagnosticAlert(alertas, recomendaciones, {
      tipo: 'listado_pendiente',
      severidad: 'media',
      mensaje: `Hay ${listadosPendientes} listados aún sin confirmación para ${fecha}.`,
      datos: {
        listadosPendientes,
        fecha,
        ...(tour?.id ? { tourId: tour.id } : {}),
      },
      recomendacion: 'Confirmar listados antes de cerrar la programación.',
    });
  }

  if (!recomendaciones.length) {
    recomendaciones.push('Revisar reservas nuevas, pagos recientes y listados antes de cerrar la programación.');
  }

  return {
    rows: [],
    entityType: 'operacion',
    tables: ['reservas', 'horarios', 'tours', 'pasajeros', 'aforos', 'transfers', 'programaciones'],
    expectedAction: 'diagnosticar_operacion',
    filters: {
      date: fecha,
      scope,
      tourLike: tour?.nombre || input.tourName || null,
    },
    fecha,
    scope,
    tour,
    resumen: {
      totalReservas: reservas.totalReservas,
      totalPasajeros: reservas.totalPasajeros,
      totalTransfers: transfers.totalTransfers,
      pendientesPago: reservas.reservasPendientesPago + transfers.transfersPendientesPago,
      reservasSinPunto: reservas.reservasSinPunto,
      toursAltaOcupacion: toursAltaOcupacion.length,
      toursSinCupos: toursSinCupos.length,
      listadosPendientes,
    },
    alertas: alertas.slice(0, 8),
    recomendaciones,
    secciones: {
      reservas,
      cupos,
      transfers,
      listados,
    },
    warnings,
  };
}

async function runBuscarEntidad(input) {
  const query = String(input.query || '').trim();
  const numericMatch = normalizeText(query).match(/\b(reserva|transfer)\s+(\d+)\b/);

  if (numericMatch?.[1] === 'reserva') {
    const rows = await queryReadonly(
      [
        'SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante',
        'FROM reservas r',
        'WHERE r.Id_Reserva = ?',
        'LIMIT 5',
      ].join(' '),
      [Number(numericMatch[2])]
    );

    return {
      rows,
      entityType: 'reservas',
      tables: ['reservas'],
      expectedAction: 'buscar_reservas',
      filters: {
        query,
      },
    };
  }

  if (numericMatch?.[1] === 'transfer') {
    const rows = await queryReadonly(
      [
        'SELECT tr.Id_Transfer, tr.Fecha_Transfer, tr.Estado, tr.Nombre_Titular',
        'FROM transfers tr',
        'WHERE tr.Id_Transfer = ?',
        'LIMIT 5',
      ].join(' '),
      [Number(numericMatch[2])]
    );

    return {
      rows,
      entityType: 'transfers',
      tables: ['transfers'],
      expectedAction: 'ver_transfers',
      filters: {
        query,
      },
    };
  }

  const tours = await queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour, t.Abreviacion',
      'FROM tours t',
      'WHERE t.Activo = 1',
      'AND (t.Nombre_Tour LIKE ? OR t.Abreviacion LIKE ?)',
      'ORDER BY t.Nombre_Tour ASC',
      'LIMIT 5',
    ].join(' '),
    [buildLikeParam(query), buildLikeParam(query)]
  );

  if (tours.length) {
    return {
      rows: tours,
      entityType: 'tours',
      tables: ['tours'],
      expectedAction: 'ver_tours',
      filters: {
        query,
      },
    };
  }

  const puntos = await queryReadonly(
    [
      'SELECT p.Id_Punto, p.Nombre_Punto, p.Sector, p.ruta',
      'FROM puntos p',
      'WHERE p.Nombre_Punto LIKE ? OR p.Sector LIKE ?',
      'ORDER BY p.Nombre_Punto ASC',
      'LIMIT 5',
    ].join(' '),
    [buildLikeParam(query), buildLikeParam(query)]
  );

  return {
    rows: puntos,
    entityType: 'puntos',
    tables: ['puntos'],
    expectedAction: 'ver_puntos',
    filters: {
      query,
    },
  };
}

async function runConsultarReservas(input) {
  if (input.paymentStatus === 'pending') {
    return runConsultarPagos({
      entityType: 'reservas',
      paymentStatus: 'pending',
      date: input.date,
      tourLike: input.tourLike,
      countOnly: input.countOnly,
    });
  }

  const joins = ['FROM reservas r'];
  const filters = [];
  const values = [];

  if (input.tourLike) {
    joins.push('JOIN horarios h ON h.Id_Horario = r.Id_Horario');
    joins.push('JOIN tours t ON t.Id_Tour = h.Id_Tour');
    filters.push('t.Nombre_Tour LIKE ?');
    values.push(buildLikeParam(input.tourLike));
  }

  if (input.date) {
    filters.push('r.Fecha_Tour = ?');
    values.push(input.date);
  }

  if (input.status) {
    filters.push('LOWER(r.Estado) LIKE ?');
    values.push(buildLikeParam(input.status.toLowerCase()));
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  if (input.countOnly) {
    const rows = await queryReadonly(
      [
        'SELECT COUNT(DISTINCT r.Id_Reserva) AS total',
        ...joins,
        whereClause,
        'LIMIT 1',
      ].filter(Boolean).join(' '),
      values
    );

    const total = Number(rows[0]?.total || 0);
    return {
      rows,
      entityType: 'reservas',
      tables: input.tourLike ? ['reservas', 'horarios', 'tours'] : ['reservas'],
      expectedAction: 'buscar_reservas',
      filters: {
        date: input.date || null,
        tourLike: input.tourLike || null,
        status: input.status || null,
        countOnly: true,
      },
    };
  }

  const listRows = await queryReadonly(
    [
      'SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante,',
      input.tourLike ? 't.Nombre_Tour' : 'NULL AS Nombre_Tour',
      ...joins,
      whereClause,
      'ORDER BY r.Fecha_Tour ASC, r.Id_Reserva DESC',
      `LIMIT ${limitValue(20)}`,
    ].filter(Boolean).join(' '),
    values
  );

  return {
    rows: listRows,
    entityType: 'reservas',
    tables: input.tourLike ? ['reservas', 'horarios', 'tours'] : ['reservas'],
    expectedAction: 'buscar_reservas',
    filters: {
      date: input.date || null,
      tourLike: input.tourLike || null,
      status: input.status || null,
      countOnly: false,
    },
  };
}

async function runConsultarCupos(input) {
  const rows = await queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour,',
      'COALESCE(a.Cupo, t.Cupo_Base) AS Cupo_Total,',
      'COALESCE(occ.Reservados, 0) AS Reservados,',
      'GREATEST(COALESCE(a.Cupo, t.Cupo_Base) - COALESCE(occ.Reservados, 0), 0) AS Cupos_Disponibles,',
      '? AS Fecha_Operacion',
      'FROM tours t',
      'LEFT JOIN (',
      '  SELECT a1.Id_Tour, a1.Cupo',
      '  FROM aforos a1',
      '  INNER JOIN (',
      '    SELECT Id_Tour, MAX(Id_Aforo) AS Max_Aforo',
      '    FROM aforos',
      '    WHERE Fecha_Aforo = ?',
      '    GROUP BY Id_Tour',
      '  ) last_aforo ON last_aforo.Max_Aforo = a1.Id_Aforo',
      ') a ON a.Id_Tour = t.Id_Tour',
      'LEFT JOIN (',
      '  SELECT h.Id_Tour, COUNT(pa.Id_Pasajero) AS Reservados',
      '  FROM reservas r',
      '  JOIN horarios h ON h.Id_Horario = r.Id_Horario',
      '  LEFT JOIN pasajeros pa ON pa.Id_Reserva = r.Id_Reserva',
      "  WHERE r.Fecha_Tour = ? AND UPPER(COALESCE(r.Estado, '')) NOT IN ('CANCELADA', 'CANCELADO')",
      '  GROUP BY h.Id_Tour',
      ') occ ON occ.Id_Tour = t.Id_Tour',
      'WHERE t.Activo = 1',
      input.tourLike ? 'AND t.Nombre_Tour LIKE ?' : '',
      'ORDER BY t.Nombre_Tour ASC',
      `LIMIT ${limitValue(20)}`,
    ].filter(Boolean).join(' '),
    input.tourLike
      ? [input.date, input.date, input.date, buildLikeParam(input.tourLike)]
      : [input.date, input.date, input.date]
  );

  return {
    rows,
    entityType: 'aforos',
    tables: ['tours', 'aforos', 'reservas', 'horarios', 'pasajeros'],
    expectedAction: 'ver_aforos',
    filters: {
      date: input.date || null,
      tourLike: input.tourLike || null,
      countOnly: false,
    },
  };
}

async function runConsultarTransfers(input) {
  const filters = [];
  const values = [];

  if (input.date) {
    filters.push('tr.Fecha_Transfer = ?');
    values.push(input.date);
  }

  if (input.status) {
    filters.push('LOWER(tr.Estado) LIKE ?');
    values.push(buildLikeParam(input.status.toLowerCase()));
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  if (input.countOnly) {
    const rows = await queryReadonly(
      [
        'SELECT COUNT(*) AS total',
        'FROM transfers tr',
        whereClause,
        'LIMIT 1',
      ].filter(Boolean).join(' '),
      values
    );

    const total = Number(rows[0]?.total || 0);
    return {
      rows,
      entityType: 'transfers',
      tables: ['transfers'],
      expectedAction: 'ver_transfers',
      filters: {
        date: input.date || null,
        status: input.status || null,
        countOnly: true,
      },
    };
  }

  const rows = await queryReadonly(
    [
      'SELECT tr.Id_Transfer, tr.Fecha_Transfer, tr.Hora_Recogida, tr.Estado, tr.Nombre_Titular, tr.Punto_Salida, tr.Punto_Destino',
      'FROM transfers tr',
      whereClause,
      'ORDER BY tr.Fecha_Transfer ASC, tr.Hora_Recogida ASC, tr.Id_Transfer DESC',
      `LIMIT ${limitValue(20)}`,
    ].filter(Boolean).join(' '),
    values
  );

  return {
    rows,
    entityType: 'transfers',
    tables: ['transfers'],
    expectedAction: 'ver_transfers',
    filters: {
      date: input.date || null,
      status: input.status || null,
      countOnly: false,
    },
  };
}

async function runConsultarPagos(input) {
  const filters = [
    "UPPER(COALESCE(r.Estado, '')) NOT IN ('CANCELADA', 'CANCELADO')",
    'COALESCE(pg.Total_Pagado, 0) < COALESCE(ps.Total_Reserva, 0)',
  ];
  const values = [];

  if (input.date) {
    filters.push('r.Fecha_Tour = ?');
    values.push(input.date);
  }

  if (input.tourLike) {
    filters.push('t.Nombre_Tour LIKE ?');
    values.push(buildLikeParam(input.tourLike));
  }

  const whereClause = `WHERE ${filters.join(' AND ')}`;

  if (input.countOnly) {
    const rows = await queryReadonly(
      [
        'SELECT COUNT(*) AS total',
        'FROM reservas r',
        'JOIN horarios h ON h.Id_Horario = r.Id_Horario',
        'JOIN tours t ON t.Id_Tour = h.Id_Tour',
        'LEFT JOIN (SELECT Id_Reserva, SUM(COALESCE(Precio_Pasajero, 0)) AS Total_Reserva FROM pasajeros GROUP BY Id_Reserva) ps ON ps.Id_Reserva = r.Id_Reserva',
        'LEFT JOIN (SELECT Id_Reserva, SUM(COALESCE(Monto, 0)) AS Total_Pagado FROM pagos_reservas GROUP BY Id_Reserva) pg ON pg.Id_Reserva = r.Id_Reserva',
        whereClause,
        'LIMIT 1',
      ].join(' '),
      values
    );

    const total = Number(rows[0]?.total || 0);
    return {
      rows,
      entityType: 'reservas',
      tables: ['reservas', 'horarios', 'tours', 'pasajeros', 'pagos_reservas'],
      expectedAction: 'buscar_reservas',
      filters: {
        entityType: input.entityType || 'reservas',
        paymentStatus: input.paymentStatus || 'pending',
        date: input.date || null,
        tourLike: input.tourLike || null,
        countOnly: true,
      },
    };
  }

  const rows = await queryReadonly(
    [
      'SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante, t.Nombre_Tour,',
      'COALESCE(ps.Total_Reserva, 0) AS Valor_Total,',
      'COALESCE(pg.Total_Pagado, 0) AS Valor_Pagado,',
      'GREATEST(COALESCE(ps.Total_Reserva, 0) - COALESCE(pg.Total_Pagado, 0), 0) AS Valor_Pendiente',
      'FROM reservas r',
      'JOIN horarios h ON h.Id_Horario = r.Id_Horario',
      'JOIN tours t ON t.Id_Tour = h.Id_Tour',
      'LEFT JOIN (SELECT Id_Reserva, SUM(COALESCE(Precio_Pasajero, 0)) AS Total_Reserva FROM pasajeros GROUP BY Id_Reserva) ps ON ps.Id_Reserva = r.Id_Reserva',
      'LEFT JOIN (SELECT Id_Reserva, SUM(COALESCE(Monto, 0)) AS Total_Pagado FROM pagos_reservas GROUP BY Id_Reserva) pg ON pg.Id_Reserva = r.Id_Reserva',
      whereClause,
      'ORDER BY r.Fecha_Tour ASC, Valor_Pendiente DESC, r.Id_Reserva DESC',
      `LIMIT ${limitValue(20)}`,
    ].join(' '),
    values
  );

  return {
    rows,
    entityType: 'reservas',
    tables: ['reservas', 'horarios', 'tours', 'pasajeros', 'pagos_reservas'],
    expectedAction: 'buscar_reservas',
    filters: {
      entityType: input.entityType || 'reservas',
      paymentStatus: input.paymentStatus || 'pending',
      date: input.date || null,
      tourLike: input.tourLike || null,
      countOnly: false,
    },
  };
}

async function runConsultarPuntos(input) {
  const rows = await queryReadonly(
    [
      'SELECT p.Id_Punto, p.Nombre_Punto, p.Sector, p.Direccion, p.ruta, p.posicion',
      'FROM puntos p',
      'WHERE p.Nombre_Punto LIKE ? OR p.Sector LIKE ? OR p.Direccion LIKE ?',
      'ORDER BY p.Nombre_Punto ASC',
      `LIMIT ${limitValue(20)}`,
    ].join(' '),
    [buildLikeParam(input.query), buildLikeParam(input.query), buildLikeParam(input.query)]
  );

  return {
    rows,
    entityType: 'puntos',
    tables: ['puntos'],
    expectedAction: 'ver_puntos',
    filters: {
      query: input.query || null,
      countOnly: false,
    },
  };
}

async function runConsultarTours(input) {
  const filters = ['t.Activo = 1'];
  const values = [];

  if (input.query) {
    filters.push('(t.Nombre_Tour LIKE ? OR t.Abreviacion LIKE ?)');
    values.push(buildLikeParam(input.query), buildLikeParam(input.query));
  }

  const rows = await queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour, t.Abreviacion, t.Cupo_Base',
      'FROM tours t',
      `WHERE ${filters.join(' AND ')}`,
      'ORDER BY t.Nombre_Tour ASC',
      `LIMIT ${limitValue(20)}`,
    ].join(' '),
    values
  );

  return {
    rows,
    entityType: 'tours',
    tables: ['tours'],
    expectedAction: 'ver_tours',
    filters: {
      query: input.query || null,
      countOnly: false,
    },
  };
}

async function runTool(toolName, input) {
  switch (toolName) {
    case 'diagnosticar_operacion':
      return runDiagnosticarOperacion(input);
    case 'buscar_entidad':
      return runBuscarEntidad(input);
    case 'consultar_reservas':
      return runConsultarReservas(input);
    case 'consultar_cupos':
      return runConsultarCupos(input);
    case 'consultar_transfers':
      return runConsultarTransfers(input);
    case 'consultar_pagos':
      return runConsultarPagos(input);
    case 'consultar_puntos':
      return runConsultarPuntos(input);
    case 'consultar_tours':
      return runConsultarTours(input);
    default:
      throw new Error(`Tool no soportada: ${toolName}`);
  }
}

function getDateFromScope(scope) {
  const normalized = normalizeText(scope);
  const today = getTodayYmd();
  if (normalized === 'manana' || normalized === 'mañana') {
    return addDaysYmd(today, 1);
  }
  return today;
}

async function executeTool({ toolName, input = {}, user, context, internalCall = false }) {
  void internalCall;

  const tool = getIaToolByName(toolName);
  if (!tool) {
    return {
      success: false,
      errorCode: 'IA_TOOL_NOT_FOUND',
      message: 'No encontré una herramienta disponible para esa consulta.',
    };
  }

  const validator = getValidator(tool);
  const toolInput = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  if (!validator(toolInput)) {
    return {
      success: false,
      errorCode: 'IA_TOOL_VALIDATION_FAILED',
      message: 'Necesito un poco más de contexto para usar esa herramienta.',
      data: {
        validationErrors: validator.errors || [],
      },
    };
  }

  try {
    await assertIaToolPermission({
      user,
      requiredPermission: tool.requiredPermission || null,
      toolName,
    });

    const helpers = {
      executeTool,
      queryReadonly,
      limitValue,
      normalizeText,
      getTodayYmd,
      addDaysYmd,
      getDateFromScope,
    };

    const data = typeof tool.execute === 'function'
      ? await tool.execute({
        input: toolInput,
        user,
        context,
        helpers,
      })
      : await runTool(toolName, toolInput);

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error?.code === 'IA_TOOL_PERMISSION_DENIED') {
      return {
        success: false,
        errorCode: 'IA_PERMISSION_DENIED',
        message: 'No tienes permisos para consultar esa información.',
      };
    }

    console.error(`[IA TOOL] ${toolName}:`, error.message);
    return {
      success: false,
      errorCode: 'IA_TOOL_EXECUTION_FAILED',
      message: 'No pude ejecutar esa consulta en este momento.',
    };
  }
}

module.exports = {
  executeTool,
};
