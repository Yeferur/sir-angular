/**
 * dashboard.service.js  —  SIR Backend
 *
 * Filtros comunes a todos los métodos:
 *   startDate  : string  'YYYY-MM-DD'   (opcional)
 *   endDate    : string  'YYYY-MM-DD'   (opcional)
 *   tourId     : number | null          (opcional — null = todos los tours)
 *   reservationType : 'Grupal' | 'Privada' | null
 *
 * Aclaración de terminología de negocio:
 *   Precio_Pasajero = precio bruto cobrado al cliente
 *   Comision        = comisión del canal / agente
 *   Ingreso bruto   = SUM(Precio_Pasajero)
 *   Ingreso neto    = SUM((Precio_Pasajero - Comision) * 1)   ← por pasajero
 */

const db = require('../../database/db');

const ACTIVE_RESERVATION_SQL = "UPPER(TRIM(COALESCE(r.Estado, ''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')";
const ACTIVE_TRANSFER_SQL = "UPPER(TRIM(COALESCE(tr.Estado, ''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO','ELIMINADA','ELIMINADO')";
const CLOSED_JOURNEY_SQL = 'cj.Id_Confirmacion IS NOT NULL AND cj.Total_Pasajeros = jornada.Total_Pasajeros';

function previousPeriod(filters = {}) {
  if (!filters.startDate || !filters.endDate) return null;
  const start = new Date(`${filters.startDate}T12:00:00Z`);
  const end = new Date(`${filters.endDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

function percentageChange(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!previousValue) return currentValue ? null : 0;
  return ((currentValue - previousValue) / previousValue) * 100;
}

// ─── Helper: construye cláusulas WHERE para filtros estándar ────────────────
function normalizeReservationType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['GRUPAL', 'PRIVADA'].includes(normalized) ? normalized : null;
}

function buildFilters(filters = {}) {
  const { startDate, endDate, tourId } = filters;
  const reservationType = normalizeReservationType(filters.reservationType);
  const conds  = [];
  const params = [];

  if (startDate) { conds.push('r.Fecha_Tour >= ?'); params.push(startDate); }
  if (endDate)   { conds.push('r.Fecha_Tour <= ?'); params.push(endDate);   }
  if (tourId)    { conds.push('h.Id_Tour = ?');     params.push(tourId);    }
  if (reservationType) {
    conds.push("UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'Grupal'))) = ?");
    params.push(reservationType);
  }

  return { conds, params };
}

function buildCancelledReservationsSql(andConds = '') {
  return `
    SELECT COUNT(DISTINCT r.Id_Reserva) AS Reservas_Canceladas
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE UPPER(TRIM(COALESCE(r.Estado, ''))) IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')
    ${andConds}
  `;
}

function buildReservationStatusesSql(andConds = '') {
  return `
    SELECT
      COALESCE(NULLIF(UPPER(TRIM(r.Estado)), ''), 'SIN_ESTADO') AS Estado_Reserva,
      COUNT(DISTINCT r.Id_Reserva) AS Cantidad
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE 1 = 1
    ${andConds}
    GROUP BY Estado_Reserva
    ORDER BY FIELD(Estado_Reserva, 'COMPLETADA', 'CONFIRMADA', 'ACTIVA', 'PENDIENTE', 'PENDIENTEDATOS', 'CANCELADA', 'CANCELADO', 'SIN_ESTADO'), Estado_Reserva
  `;
}

function buildPassengerAgeSql(andConds = '') {
  return `
    SELECT
      COALESCE(NULLIF(UPPER(TRIM(p.Tipo_Pasajero)), ''), 'SIN_TIPO') AS Tipo_Pasajero,
      COUNT(p.Id_Pasajero) AS Cantidad
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY Tipo_Pasajero
    ORDER BY FIELD(Tipo_Pasajero, 'ADULTO', 'NINO', 'INFANTE', 'SIN_TIPO'), Tipo_Pasajero
  `;
}

// ─── 1. Stats generales (KPIs) ───────────────────────────────────────────────
async function getDashboardStatsSnapshot(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const andConds = conds.length
    ? `AND ${conds.join(' AND ')}`
    : '';

  const journeyTotalsSql = `
    SELECT h2.Id_Tour, r2.Fecha_Tour, COUNT(p2.Id_Pasajero) AS Total_Pasajeros
    FROM reservas r2
    JOIN horarios h2 ON h2.Id_Horario = r2.Id_Horario
    LEFT JOIN pasajeros p2 ON p2.Id_Reserva = r2.Id_Reserva
    WHERE ${ACTIVE_RESERVATION_SQL.replaceAll('r.', 'r2.')}
    GROUP BY h2.Id_Tour, r2.Fecha_Tour
  `;

  const reservationsSql = `
    SELECT
      COALESCE(m.Codigo, 'COP') AS Moneda,
      COUNT(DISTINCT r.Id_Reserva) AS Reservas,
      COUNT(p.Id_Pasajero) AS Pasajeros,
      COALESCE(SUM(p.Precio_Pasajero), 0) AS Programado,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero ELSE 0 END
        ELSE p.Precio_Pasajero
      END), 0) AS Ingreso_Tours,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN COALESCE(p.Comision, 0) ELSE 0 END
        ELSE COALESCE(p.Comision, 0)
      END), 0) AS Comisiones,
      SUM(CASE WHEN ${CLOSED_JOURNEY_SQL} AND p.Confirmacion = 1 THEN 1 ELSE 0 END) AS Viajaron,
      SUM(CASE WHEN ${CLOSED_JOURNEY_SQL} AND COALESCE(p.Confirmacion, 0) = 0 THEN 1 ELSE 0 END) AS No_Viajaron,
      SUM(CASE WHEN NOT (${CLOSED_JOURNEY_SQL}) THEN 1 ELSE 0 END) AS Pendientes,
      COUNT(DISTINCT CASE WHEN ${CLOSED_JOURNEY_SQL} THEN CONCAT(h.Id_Tour, ':', r.Fecha_Tour) END) AS Jornadas_Cerradas,
      COUNT(DISTINCT CASE WHEN NOT (${CLOSED_JOURNEY_SQL}) THEN CONCAT(h.Id_Tour, ':', r.Fecha_Tour) END) AS Jornadas_Pendientes
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN monedas m ON m.Id_Moneda = r.Id_Moneda
    LEFT JOIN (${journeyTotalsSql}) jornada
      ON jornada.Id_Tour = h.Id_Tour AND jornada.Fecha_Tour = r.Fecha_Tour
    LEFT JOIN confirmaciones_jornada cj
      ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY COALESCE(m.Codigo, 'COP')
  `;

  const cancelledReservationsSql = buildCancelledReservationsSql(andConds);
  const reservationStatusesSql = buildReservationStatusesSql(andConds);
  const passengerAgeSql = buildPassengerAgeSql(andConds);

  const includeTransfers = !filters.tourId && !normalizeReservationType(filters.reservationType);
  const transferParams = [filters.startDate, filters.endDate].filter(Boolean);
  const transferDateConds = [];
  if (filters.startDate) transferDateConds.push('tr.Fecha_Transfer >= ?');
  if (filters.endDate) transferDateConds.push('tr.Fecha_Transfer <= ?');
  const transferAnd = transferDateConds.length ? `AND ${transferDateConds.join(' AND ')}` : '';
  const transfersSql = `
    SELECT COALESCE(m.Codigo, 'COP') AS Moneda,
           COUNT(*) AS Transfers,
           COALESCE(SUM(tr.Cantidad_Personas), 0) AS Pasajeros_Transfer,
           COALESCE(SUM(tr.Valor), 0) AS Ingreso_Transfers
    FROM transfers tr
    LEFT JOIN monedas m ON m.Id_Moneda = tr.Id_Moneda
    WHERE ${ACTIVE_TRANSFER_SQL}
    ${transferAnd}
    GROUP BY COALESCE(m.Codigo, 'COP')
  `;

  const reservationPaymentsSql = `
    SELECT COALESCE(m.Codigo, 'COP') AS Moneda,
           COALESCE(SUM(CASE WHEN LOWER(TRIM(pr.Tipo)) = 'pago completo' THEN pr.Monto ELSE 0 END), 0) AS Pago_Completo,
           COALESCE(SUM(CASE WHEN LOWER(TRIM(pr.Tipo)) = 'abono' THEN pr.Monto ELSE 0 END), 0) AS Abonos
    FROM pagos_reservas pr
    JOIN reservas r ON r.Id_Reserva = pr.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN monedas m ON m.Id_Moneda = r.Id_Moneda
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY COALESCE(m.Codigo, 'COP')
  `;

  const transferPaymentsSql = `
    SELECT COALESCE(m.Codigo, 'COP') AS Moneda,
           COALESCE(SUM(CASE WHEN LOWER(TRIM(pt.Metodo)) = 'completo' THEN pt.Monto ELSE 0 END), 0) AS Pago_Completo,
           COALESCE(SUM(CASE WHEN LOWER(TRIM(pt.Metodo)) = 'abono' THEN pt.Monto ELSE 0 END), 0) AS Abonos
    FROM pagos_transfers pt
    JOIN transfers tr ON tr.Id_Transfer = pt.Id_Transfer
    LEFT JOIN monedas m ON m.Id_Moneda = tr.Id_Moneda
    WHERE ${ACTIVE_TRANSFER_SQL}
    ${transferAnd}
    GROUP BY COALESCE(m.Codigo, 'COP')
  `;

  const [reservationResult, cancelledReservationResult, reservationStatusesResult, passengerAgeResult, transferResult, reservationPaymentResult, transferPaymentResult] = await Promise.all([
    db.query(reservationsSql, params),
    db.query(cancelledReservationsSql, params),
    db.query(reservationStatusesSql, params),
    db.query(passengerAgeSql, params),
    includeTransfers ? db.query(transfersSql, transferParams) : Promise.resolve([[]]),
    db.query(reservationPaymentsSql, params),
    includeTransfers ? db.query(transferPaymentsSql, transferParams) : Promise.resolve([[]]),
  ]);

  const currencies = new Map();
  const ensureCurrency = (code) => {
    const currency = String(code || 'COP');
    if (!currencies.has(currency)) {
      currencies.set(currency, {
        currency,
        scheduledTours: 0,
        tourRevenue: 0,
        tourCommission: 0,
        tourNetRevenue: 0,
        transferRevenue: 0,
        companyRevenue: 0,
        collectedFull: 0,
        collectedAbonos: 0,
        collectedTotal: 0,
        pendingCollection: 0,
        noShowAdjustment: 0,
      });
    }
    return currencies.get(currency);
  };

  let totalReservas = 0;
  const totalReservasCanceladas = Number(cancelledReservationResult[0]?.[0]?.Reservas_Canceladas || 0);
  let totalPasajeros = 0;
  let totalViajaron = 0;
  let totalNoViajaron = 0;
  let totalPendientes = 0;
  let closedJourneys = 0;
  let pendingJourneys = 0;
  for (const row of reservationResult[0] || []) {
    const target = ensureCurrency(row.Moneda);
    target.scheduledTours += Number(row.Programado || 0);
    target.tourRevenue += Number(row.Ingreso_Tours || 0);
    target.tourCommission += Number(row.Comisiones || 0);
    totalReservas += Number(row.Reservas || 0);
    totalPasajeros += Number(row.Pasajeros || 0);
    totalViajaron += Number(row.Viajaron || 0);
    totalNoViajaron += Number(row.No_Viajaron || 0);
    totalPendientes += Number(row.Pendientes || 0);
    closedJourneys = Math.max(closedJourneys, Number(row.Jornadas_Cerradas || 0));
    pendingJourneys = Math.max(pendingJourneys, Number(row.Jornadas_Pendientes || 0));
  }

  let totalTransfers = 0;
  let totalTransferPassengers = 0;
  for (const row of transferResult[0] || []) {
    const target = ensureCurrency(row.Moneda);
    target.transferRevenue += Number(row.Ingreso_Transfers || 0);
    totalTransfers += Number(row.Transfers || 0);
    totalTransferPassengers += Number(row.Pasajeros_Transfer || 0);
  }

  for (const row of reservationPaymentResult[0] || []) {
    const target = ensureCurrency(row.Moneda);
    target.collectedFull += Number(row.Pago_Completo || 0);
    target.collectedAbonos += Number(row.Abonos || 0);
  }
  for (const row of transferPaymentResult[0] || []) {
    const target = ensureCurrency(row.Moneda);
    target.collectedFull += Number(row.Pago_Completo || 0);
    target.collectedAbonos += Number(row.Abonos || 0);
  }

  const financialByCurrency = Array.from(currencies.values()).map((item) => {
    item.tourNetRevenue = item.tourRevenue - item.tourCommission;
    item.companyRevenue = item.tourRevenue + item.transferRevenue;
    item.collectedTotal = item.collectedFull + item.collectedAbonos;
    item.pendingCollection = Math.max(0, item.companyRevenue - item.collectedTotal);
    item.noShowAdjustment = Math.max(0, item.scheduledTours - item.tourRevenue);
    return item;
  }).sort((a, b) => a.currency.localeCompare(b.currency));

  const primary = financialByCurrency.find((item) => item.currency === 'COP') || financialByCurrency[0] || ensureCurrency('COP');
  return {
    totalReservas,
    totalReservasCanceladas,
    reservationStatuses: (reservationStatusesResult[0] || []).map((row) => ({
      estado: String(row.Estado_Reserva || 'SIN_ESTADO'),
      cantidad: Number(row.Cantidad || 0),
    })),
    passengerAge: (passengerAgeResult[0] || []).map((row) => ({
      tipo: String(row.Tipo_Pasajero || 'SIN_TIPO'),
      cantidad: Number(row.Cantidad || 0),
    })),
    totalPasajeros,
    totalTransfers,
    totalTransferPassengers,
    totalViajaron,
    totalNoViajaron,
    totalPendientes,
    closedJourneys,
    pendingJourneys,
    financialByCurrency,
    mixedCurrencies: financialByCurrency.length > 1,
    primaryCurrency: primary.currency || 'COP',
    totalIngresos: primary.tourRevenue || 0,
    totalIngresosNetos: primary.tourNetRevenue || 0,
    companyRevenue: primary.companyRevenue || 0,
    transferRevenue: primary.transferRevenue || 0,
    scheduledTourRevenue: primary.scheduledTours || 0,
    tourCommission: primary.tourCommission || 0,
    collectedRevenue: primary.collectedTotal || 0,
    pendingCollection: primary.pendingCollection || 0,
    noShowAdjustment: primary.noShowAdjustment || 0,
  };
}

async function getDashboardStatsSvc(filters = {}) {
  const previous = previousPeriod(filters);
  const [current, previousStats] = await Promise.all([
    getDashboardStatsSnapshot(filters),
    previous ? getDashboardStatsSnapshot({ ...filters, ...previous }) : Promise.resolve(null),
  ]);

  const currentClosed = current.totalViajaron + current.totalNoViajaron;
  const previousClosed = Number(previousStats?.totalViajaron || 0) + Number(previousStats?.totalNoViajaron || 0);
  const currentTravelRate = currentClosed ? (current.totalViajaron / currentClosed) * 100 : null;
  const previousTravelRate = previousClosed ? (previousStats.totalViajaron / previousClosed) * 100 : null;

  return {
    ...current,
    comparison: previousStats ? {
      period: previous,
      reservationsPct: percentageChange(current.totalReservas, previousStats.totalReservas),
      passengersPct: percentageChange(current.totalPasajeros, previousStats.totalPasajeros),
      companyRevenuePct: percentageChange(current.companyRevenue, previousStats.companyRevenue),
      transferRevenuePct: percentageChange(current.transferRevenue, previousStats.transferRevenue),
      travelRateDelta: currentTravelRate === null || previousTravelRate === null
        ? null
        : currentTravelRate - previousTravelRate,
    } : null,
  };
}

// ─── 2. Ingresos mensuales (gráfica anual) ────────────────────────────────────
//   Devuelve dos series: bruto y neto, para el año dado
async function getIncomeHistorySvc(year, filters = {}) {
  const { conds, params } = buildFilters({ ...filters, startDate: undefined, endDate: undefined });
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const toursSql = `
    SELECT
      MONTH(r.Fecha_Tour) AS mes,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero ELSE 0 END
        ELSE p.Precio_Pasajero
      END), 0) AS bruto,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero - COALESCE(p.Comision, 0) ELSE 0 END
        ELSE p.Precio_Pasajero - COALESCE(p.Comision, 0)
      END), 0) AS neto
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN (
      SELECT h2.Id_Tour, r2.Fecha_Tour, COUNT(p2.Id_Pasajero) AS Total_Pasajeros
      FROM reservas r2
      JOIN horarios h2 ON h2.Id_Horario = r2.Id_Horario
      LEFT JOIN pasajeros p2 ON p2.Id_Reserva = r2.Id_Reserva
      WHERE ${ACTIVE_RESERVATION_SQL.replaceAll('r.', 'r2.')}
      GROUP BY h2.Id_Tour, r2.Fecha_Tour
    ) jornada ON jornada.Id_Tour = h.Id_Tour AND jornada.Fecha_Tour = r.Fecha_Tour
    LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    AND   YEAR(r.Fecha_Tour) = ?
    ${andConds}
    GROUP BY MONTH(r.Fecha_Tour)
    ORDER BY mes
  `;

  const includeTransfers = !filters.tourId && !normalizeReservationType(filters.reservationType);
  const transfersSql = `
    SELECT MONTH(tr.Fecha_Transfer) AS mes, COALESCE(SUM(tr.Valor), 0) AS transfer
    FROM transfers tr
    WHERE ${ACTIVE_TRANSFER_SQL}
      AND YEAR(tr.Fecha_Transfer) = ?
    GROUP BY MONTH(tr.Fecha_Transfer)
    ORDER BY mes
  `;

  const [tourResult, transferResult] = await Promise.all([
    db.query(toursSql, [year, ...params]),
    includeTransfers ? db.query(transfersSql, [year]) : Promise.resolve([[]]),
  ]);

  const bruto = Array(12).fill(0);
  const neto  = Array(12).fill(0);
  const transfers = Array(12).fill(0);
  tourResult[0].forEach(row => {
    bruto[row.mes - 1] = Number(row.bruto);
    neto [row.mes - 1] = Number(row.neto);
  });
  transferResult[0].forEach((row) => {
    transfers[row.mes - 1] = Number(row.transfer || 0);
  });

  return { bruto, neto, transfers, empresa: bruto.map((value, index) => value + transfers[index]) };
}

// ─── 3. Ingresos por día (gráfica de rango) ───────────────────────────────────
//   Retorna array de { fecha, bruto, neto } para el rango dado
async function getDailyIncomeSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const toursSql = `
    SELECT
      DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS fecha,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero ELSE 0 END
        ELSE p.Precio_Pasajero
      END), 0) AS bruto,
      COALESCE(SUM(CASE
        WHEN ${CLOSED_JOURNEY_SQL} THEN CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero - COALESCE(p.Comision, 0) ELSE 0 END
        ELSE p.Precio_Pasajero - COALESCE(p.Comision, 0)
      END), 0) AS neto
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN (
      SELECT h2.Id_Tour, r2.Fecha_Tour, COUNT(p2.Id_Pasajero) AS Total_Pasajeros
      FROM reservas r2
      JOIN horarios h2 ON h2.Id_Horario = r2.Id_Horario
      LEFT JOIN pasajeros p2 ON p2.Id_Reserva = r2.Id_Reserva
      WHERE ${ACTIVE_RESERVATION_SQL.replaceAll('r.', 'r2.')}
      GROUP BY h2.Id_Tour, r2.Fecha_Tour
    ) jornada ON jornada.Id_Tour = h.Id_Tour AND jornada.Fecha_Tour = r.Fecha_Tour
    LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY DATE(r.Fecha_Tour)
    ORDER BY fecha
  `;

  const includeTransfers = !filters.tourId && !normalizeReservationType(filters.reservationType);
  const transferParams = [];
  const transferConds = [];
  if (filters.startDate) { transferConds.push('tr.Fecha_Transfer >= ?'); transferParams.push(filters.startDate); }
  if (filters.endDate) { transferConds.push('tr.Fecha_Transfer <= ?'); transferParams.push(filters.endDate); }
  const transferAnd = transferConds.length ? `AND ${transferConds.join(' AND ')}` : '';
  const transfersSql = `
    SELECT DATE_FORMAT(tr.Fecha_Transfer, '%Y-%m-%d') AS fecha,
           COALESCE(SUM(tr.Valor), 0) AS transfer
    FROM transfers tr
    WHERE ${ACTIVE_TRANSFER_SQL}
    ${transferAnd}
    GROUP BY DATE(tr.Fecha_Transfer)
    ORDER BY fecha
  `;

  const [tourResult, transferResult] = await Promise.all([
    db.query(toursSql, params),
    includeTransfers ? db.query(transfersSql, transferParams) : Promise.resolve([[]]),
  ]);
  const byDate = new Map();
  for (const row of tourResult[0]) {
    const fecha = String(row.fecha);
    byDate.set(fecha, { fecha, bruto: Number(row.bruto || 0), neto: Number(row.neto || 0), transfer: 0 });
  }
  for (const row of transferResult[0]) {
    const fecha = String(row.fecha);
    const target = byDate.get(fecha) || { fecha, bruto: 0, neto: 0, transfer: 0 };
    target.transfer = Number(row.transfer || 0);
    byDate.set(fecha, target);
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((row) => ({ ...row, empresa: row.bruto + row.transfer }));
}

// ─── 4. Pasajeros por día y tour ──────────────────────────────────────────────
async function getDailyPassengersSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS fecha,
      t.Nombre_Tour            AS tour,
      COUNT(p.Id_Pasajero)     AS pasajeros
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    JOIN horarios h ON r.Id_Horario = h.Id_Horario
    JOIN tours t ON h.Id_Tour = t.Id_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY DATE(r.Fecha_Tour), t.Id_Tour, t.Nombre_Tour
    ORDER BY fecha, tour
  `;

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    fecha:     r.fecha,
    tour:      r.tour,
    pasajeros: Number(r.pasajeros)
  }));
}

// ─── 5. Pasajeros por canal ───────────────────────────────────────────────────
//   Canal = r.Canal_Venta (ajusta el nombre de columna si difiere en tu schema)
async function getPassengersByChannelSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      COALESCE(c.Nombre_Canal, 'Sin canal') AS canal,
      COUNT(p.Id_Pasajero)                  AS cantidad
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN canales_reservas c ON r.Id_Canal = c.Id_Canal
    ${tourJoin}
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY COALESCE(c.Nombre_Canal, 'Sin canal')
    ORDER BY cantidad DESC
  `;

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    canal:    r.canal,
    cantidad: Number(r.cantidad)
  }));
}

// ─── 6. Distribución de pasajeros por estado ──────────────────────────────────
async function getPassengerDistributionSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      CASE
        WHEN p.Confirmacion = 1 THEN 'Viajaron'
        WHEN cj.Id_Confirmacion IS NOT NULL
         AND cj.Total_Pasajeros = jornada.Total_Pasajeros THEN 'No viajaron'
        ELSE 'Pendientes'
      END AS estado,
      COUNT(*) AS cantidad
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN horarios h ON r.Id_Horario = h.Id_Horario
    LEFT JOIN (
      SELECT h2.Id_Tour, r2.Fecha_Tour, COUNT(p2.Id_Pasajero) AS Total_Pasajeros
      FROM pasajeros p2
      JOIN reservas r2 ON p2.Id_Reserva = r2.Id_Reserva
      JOIN horarios h2 ON r2.Id_Horario = h2.Id_Horario
      WHERE UPPER(TRIM(COALESCE(r2.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
      GROUP BY h2.Id_Tour, r2.Fecha_Tour
    ) jornada ON jornada.Id_Tour = h.Id_Tour AND jornada.Fecha_Tour = r.Fecha_Tour
    LEFT JOIN confirmaciones_jornada cj
      ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY 1
  `;

  const [rows] = await db.query(sql, params);
  return rows.map((row) => ({
    estado: row.estado,
    cantidad: Number(row.cantidad || 0)
  }));
}

// ─── 7. Comparativo entre reservas grupales y privadas ───────────────────────
async function getReservationBreakdownSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      CASE
        WHEN UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'Grupal'))) = 'PRIVADA' THEN 'Privadas'
        ELSE 'Grupales'
      END AS tipo,
      COUNT(DISTINCT r.Id_Reserva) AS reservas,
      COUNT(p.Id_Pasajero) AS pasajeros,
      COALESCE(SUM(p.Precio_Pasajero), 0) AS bruto,
      COALESCE(SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)), 0) AS neto
    FROM reservas r
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY tipo
    ORDER BY FIELD(tipo, 'Grupales', 'Privadas')
  `;

  const [rows] = await db.query(sql, params);
  return rows.map((row) => ({
    tipo: row.tipo,
    reservas: Number(row.reservas || 0),
    pasajeros: Number(row.pasajeros || 0),
    bruto: Number(row.bruto || 0),
    neto: Number(row.neto || 0)
  }));
}

// ─── 8. Pasajeros por tour o por plan ─────────────────────────────────────────
async function getTourOccupancySvc(filters = {}) {
  if (filters.tourId) {
    const [planRows] = await db.query(
      `SELECT Id_Plan, Nombre_Plan
       FROM planes_tours
       WHERE Id_Tour = ?
       ORDER BY Id_Plan ASC`,
      [filters.tourId]
    );

    if ((planRows || []).length <= 1) {
      return [];
    }

    const rangeParams = [];
    const rangeConds = [];

    if (filters.startDate) { rangeConds.push('r.Fecha_Tour >= ?'); rangeParams.push(filters.startDate); }
    if (filters.endDate) { rangeConds.push('r.Fecha_Tour <= ?'); rangeParams.push(filters.endDate); }
    const reservationType = normalizeReservationType(filters.reservationType);
    if (reservationType) {
      rangeConds.push("UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'Grupal'))) = ?");
      rangeParams.push(reservationType);
    }

    const andRangeConds = rangeConds.length ? `AND ${rangeConds.join(' AND ')}` : '';

    const metricsByPlanSql = `
      SELECT
        p.Id_Plan,
        COUNT(DISTINCT r.Id_Reserva) AS reservas,
        COUNT(p.Id_Pasajero) AS pasajeros,
        SUM(CASE WHEN p.Tipo_Pasajero = 'ADULTO' THEN 1 ELSE 0 END) AS adultos,
        SUM(CASE WHEN p.Tipo_Pasajero = 'NINO' THEN 1 ELSE 0 END) AS ninos,
        SUM(CASE WHEN p.Tipo_Pasajero = 'INFANTE' THEN 1 ELSE 0 END) AS infantes
      FROM pasajeros p
      JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
      JOIN horarios h ON r.Id_Horario = h.Id_Horario
      JOIN planes_tours assigned_plan
        ON assigned_plan.Id_Plan = p.Id_Plan
       AND assigned_plan.Id_Tour = h.Id_Tour
      WHERE h.Id_Tour = ?
        AND ${ACTIVE_RESERVATION_SQL}
        ${andRangeConds}
      GROUP BY p.Id_Plan
    `;

    const unassignedMetricsSql = `
      SELECT
        NULL AS Id_Plan,
        'Sin plan' AS nombre,
        COUNT(DISTINCT r.Id_Reserva) AS reservas,
        COUNT(p.Id_Pasajero) AS pasajeros,
        SUM(CASE WHEN p.Tipo_Pasajero = 'ADULTO' THEN 1 ELSE 0 END) AS adultos,
        SUM(CASE WHEN p.Tipo_Pasajero = 'NINO' THEN 1 ELSE 0 END) AS ninos,
        SUM(CASE WHEN p.Tipo_Pasajero = 'INFANTE' THEN 1 ELSE 0 END) AS infantes,
        1 AS sin_plan
      FROM pasajeros p
      JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
      JOIN horarios h ON r.Id_Horario = h.Id_Horario
      LEFT JOIN planes_tours assigned_plan
        ON assigned_plan.Id_Plan = p.Id_Plan
       AND assigned_plan.Id_Tour = h.Id_Tour
      WHERE h.Id_Tour = ?
        AND assigned_plan.Id_Plan IS NULL
        AND ${ACTIVE_RESERVATION_SQL}
        ${andRangeConds}
      HAVING COUNT(p.Id_Pasajero) > 0
    `;

    const sqlByPlan = `
      SELECT
        pt.Id_Plan,
        COALESCE(NULLIF(TRIM(pt.Nombre_Plan), ''), CONCAT('Plan ', pt.Id_Plan)) AS nombre,
        COALESCE(px.reservas, 0) AS reservas,
        COALESCE(px.pasajeros, 0) AS pasajeros,
        COALESCE(px.adultos, 0) AS adultos,
        COALESCE(px.ninos, 0) AS ninos,
        COALESCE(px.infantes, 0) AS infantes,
        0 AS sin_plan
      FROM planes_tours pt
      LEFT JOIN (${metricsByPlanSql}) px ON px.Id_Plan = pt.Id_Plan
      WHERE pt.Id_Tour = ?

      UNION ALL

      ${unassignedMetricsSql}

      ORDER BY sin_plan ASC, Id_Plan ASC
    `;

    const [rows] = await db.query(sqlByPlan, [
      filters.tourId,
      ...rangeParams,
      filters.tourId,
      filters.tourId,
      ...rangeParams,
    ]);
    return rows.map((row) => ({
      idPlan: row.Id_Plan == null ? null : Number(row.Id_Plan),
      nombre: row.nombre,
      reservas: Number(row.reservas || 0),
      pasajeros: Number(row.pasajeros || 0),
      adultos: Number(row.adultos || 0),
      ninos: Number(row.ninos || 0),
      infantes: Number(row.infantes || 0),
      sinPlan: Boolean(row.sin_plan),
    }));
  }

  const { conds, params } = buildFilters(filters);
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      t.Nombre_Tour AS nombre,
      COUNT(p.Id_Pasajero) AS pasajeros
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    JOIN horarios h ON r.Id_Horario = h.Id_Horario
    JOIN tours t ON h.Id_Tour = t.Id_Tour
    WHERE ${ACTIVE_RESERVATION_SQL}
    ${andConds}
    GROUP BY t.Nombre_Tour
    ORDER BY pasajeros DESC
    LIMIT 10
  `;

  const [rows] = await db.query(sql, params);
  return rows.map((row) => ({
    nombre: row.nombre,
    pasajeros: Number(row.pasajeros || 0)
  }));
}

// ─── 9. Métricas ampliadas del informe ──────────────────────────────────────
// Expone únicamente métricas agregadas y acotadas para que el informe pueda
// crecer en fechas y registros sin convertirse en una vista operativa de buses.
async function getDashboardOperationalSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';
  const languageSql = `
    SELECT COALESCE(NULLIF(TRIM(r.Idioma_Reserva), ''), 'Sin idioma') AS idioma,
           COUNT(p.Id_Pasajero) AS registrados,
           SUM(CASE WHEN p.Confirmacion = 1 THEN 1 ELSE 0 END) AS viajaron
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
    GROUP BY idioma ORDER BY registrados DESC
  `;
  const pointsSql = `
    SELECT COALESCE(NULLIF(TRIM(pt.Nombre_Punto), ''), 'Sin punto') AS punto,
           COUNT(p.Id_Pasajero) AS registrados,
           SUM(CASE WHEN p.Confirmacion = 1 THEN 1 ELSE 0 END) AS viajaron
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
    GROUP BY punto ORDER BY registrados DESC LIMIT 20
  `;
  const absenceBase = `
    SELECT %GROUP% AS agrupador,
      COUNT(p.Id_Pasajero) AS programados,
      SUM(CASE WHEN p.Confirmacion = 1 THEN 1 ELSE 0 END) AS viajaron,
      SUM(CASE WHEN cj.Id_Confirmacion IS NOT NULL AND cj.Total_Pasajeros = jornada.Total_Pasajeros AND COALESCE(p.Confirmacion, 0) = 0 THEN 1 ELSE 0 END) AS noViajaron,
      SUM(CASE WHEN cj.Id_Confirmacion IS NULL OR cj.Total_Pasajeros <> jornada.Total_Pasajeros THEN 1 ELSE 0 END) AS pendientes
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN (
      SELECT h2.Id_Tour, r2.Fecha_Tour, COUNT(p2.Id_Pasajero) AS Total_Pasajeros
      FROM reservas r2 JOIN horarios h2 ON h2.Id_Horario = r2.Id_Horario
      LEFT JOIN pasajeros p2 ON p2.Id_Reserva = r2.Id_Reserva
      WHERE ${ACTIVE_RESERVATION_SQL.replaceAll('r.', 'r2.')}
      GROUP BY h2.Id_Tour, r2.Fecha_Tour
    ) jornada ON jornada.Id_Tour = h.Id_Tour AND jornada.Fecha_Tour = r.Fecha_Tour
    LEFT JOIN confirmaciones_jornada cj ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
    GROUP BY agrupador ORDER BY programados DESC
  `;
  const channelAbsenceSql = absenceBase.replace('%GROUP%', "COALESCE(c.Nombre_Canal, 'Sin canal')").replace('LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario', 'LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario\n    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal');
  const tourAbsenceSql = absenceBase.replace('%GROUP%', "COALESCE(t.Nombre_Tour, 'Sin tour')").replace('LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario', 'LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario\n    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour');
  const tariffSql = `
    SELECT COALESCE(NULLIF(TRIM(pt.Nombre_Plan), ''), CONCAT('Sin plan · ', COALESCE(p.Tipo_Pasajero, 'Sin tipo'))) AS tarifa,
           COUNT(p.Id_Pasajero) AS pasajeros,
           COALESCE(SUM(p.Precio_Pasajero), 0) AS ingresos
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN planes_tours pt ON pt.Id_Plan = p.Id_Plan AND pt.Id_Tour = h.Id_Tour
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
    GROUP BY tarifa ORDER BY pasajeros DESC LIMIT 20
  `;
  const passportSql = `
    SELECT COALESCE(NULLIF(TRIM(pt.Nombre_Plan), ''), 'Sin plan') AS plan,
           COUNT(p.Id_Pasajero) AS pasajeros
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN planes_tours pt ON pt.Id_Plan = p.Id_Plan AND pt.Id_Tour = h.Id_Tour
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
      AND UPPER(COALESCE(t.Nombre_Tour, '')) LIKE '%NAPOLES%'
    GROUP BY plan ORDER BY pasajeros DESC
  `.replace('LEFT JOIN planes_tours pt ON pt.Id_Plan = p.Id_Plan AND pt.Id_Tour = h.Id_Tour', 'LEFT JOIN planes_tours pt ON pt.Id_Plan = p.Id_Plan AND pt.Id_Tour = h.Id_Tour\n    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour');
  const channelFinancialSql = `
    SELECT COALESCE(c.Nombre_Canal, 'Sin canal') AS canal,
           SUM(CASE WHEN p.Confirmacion = 1 THEN 1 ELSE 0 END) AS viajaron,
           COALESCE(SUM(CASE WHEN p.Confirmacion = 1 THEN p.Precio_Pasajero ELSE 0 END), 0) AS ingresos,
           COALESCE(SUM(CASE WHEN p.Confirmacion = 1 THEN p.Comision ELSE 0 END), 0) AS comisiones
    FROM pasajeros p JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
    WHERE ${ACTIVE_RESERVATION_SQL} ${andConds}
    GROUP BY canal ORDER BY ingresos DESC
  `;

  const [languageResult, pointResult, channelAbsenceResult, tourAbsenceResult, tariffResult, passportResult, channelFinancialResult] = await Promise.all([
    db.query(languageSql, params),
    db.query(pointsSql, params),
    db.query(channelAbsenceSql, params),
    db.query(tourAbsenceSql, params),
    db.query(tariffSql, params),
    db.query(passportSql, params),
    db.query(channelFinancialSql, params),
  ]);
  const normalizeRows = (rows, key) => rows.map((row) => ({ [key]: row.agrupador, programados: Number(row.programados || 0), viajaron: Number(row.viajaron || 0), noViajaron: Number(row.noViajaron || 0), pendientes: Number(row.pendientes || 0) }));
  return {
    idiomas: languageResult[0].map((row) => ({ idioma: row.idioma, registrados: Number(row.registrados || 0), viajaron: Number(row.viajaron || 0) })),
    puntos: pointResult[0].map((row) => ({ punto: row.punto, registrados: Number(row.registrados || 0), viajaron: Number(row.viajaron || 0) })),
    inasistenciaCanal: normalizeRows(channelAbsenceResult[0], 'canal'),
    inasistenciaTour: normalizeRows(tourAbsenceResult[0], 'tour'),
    tarifas: tariffResult[0].map((row) => ({ tarifa: row.tarifa, pasajeros: Number(row.pasajeros || 0), ingresos: Number(row.ingresos || 0) })),
    pasaportes: passportResult[0].map((row) => ({ plan: row.plan, pasajeros: Number(row.pasajeros || 0) })),
    canalFinanciero: channelFinancialResult[0].map((row) => ({ canal: row.canal, viajaron: Number(row.viajaron || 0), ingresos: Number(row.ingresos || 0), comisiones: Number(row.comisiones || 0) })),
  };
}

module.exports = {
  getDashboardStatsSvc,
  getIncomeHistorySvc,
  getDailyIncomeSvc,
  getDailyPassengersSvc,
  getPassengersByChannelSvc,
  getPassengerDistributionSvc,
  getReservationBreakdownSvc,
  getTourOccupancySvc,
  getDashboardOperationalSvc,
  buildCancelledReservationsSql,
  buildReservationStatusesSql,
  buildPassengerAgeSql,
  previousPeriod,
  percentageChange,
};
