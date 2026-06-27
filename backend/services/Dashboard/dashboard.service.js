/**
 * dashboard.service.js  —  SIR Backend
 *
 * Filtros comunes a todos los métodos:
 *   startDate  : string  'YYYY-MM-DD'   (opcional)
 *   endDate    : string  'YYYY-MM-DD'   (opcional)
 *   tourId     : number | null          (opcional — null = todos los tours)
 *
 * Aclaración de terminología de negocio:
 *   Precio_Pasajero = precio bruto cobrado al cliente
 *   Comision        = comisión del canal / agente
 *   Ingreso bruto   = SUM(Precio_Pasajero)
 *   Ingreso neto    = SUM((Precio_Pasajero - Comision) * 1)   ← por pasajero
 */

const db = require('../../database/db');

// ─── Helper: construye cláusulas WHERE para filtros estándar ────────────────
function buildFilters(filters = {}) {
  const { startDate, endDate, tourId } = filters;
  const conds  = [];
  const params = [];

  if (startDate) { conds.push('r.Fecha_Tour >= ?'); params.push(startDate); }
  if (endDate)   { conds.push('r.Fecha_Tour <= ?'); params.push(endDate);   }
  if (tourId)    { conds.push('h.Id_Tour = ?');     params.push(tourId);    }

  return { conds, params };
}

// ─── 1. Stats generales (KPIs) ───────────────────────────────────────────────
async function getDashboardStatsSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);

  // Base join cuando se filtra por tour (necesita horarios)
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin
    ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario'
    : '';

  const andConds = conds.length
    ? `AND ${conds.join(' AND ')}`
    : '';

  // Reservas activas
  const sqlReservas = `
    SELECT COUNT(DISTINCT r.Id_Reserva) AS total
    FROM reservas r
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
  `;

  // Pasajeros totales
  const sqlPasajeros = `
    SELECT COUNT(p.Id_Pasajero) AS total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
  `;

  // Ingresos brutos  = SUM(Precio_Pasajero)
  const sqlBruto = `
    SELECT COALESCE(SUM(p.Precio_Pasajero), 0) AS total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
  `;

  // Ingresos netos   = SUM(Precio_Pasajero - Comision)
  const sqlNeto = `
    SELECT COALESCE(SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)), 0) AS total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
  `;

  // Transfers (no filtra por tour — no aplica)
  const { conds: tConds, params: tParams } = buildFilters({ startDate: filters.startDate, endDate: filters.endDate });
  const tAnd = tConds.length ? `AND ${tConds.map(c => c.replace('r.Fecha_Tour', 'tr.Fecha_Transfer')).join(' AND ')}` : '';
  const sqlTransfers = `
    SELECT COUNT(*) AS total
    FROM transfers tr
    WHERE (tr.Estado IS NULL OR tr.Estado != 'Cancelado')
    ${tAnd}
  `;

  const [[rRes], [pRes], [bRes], [nRes], [tRes]] = await Promise.all([
    db.query(sqlReservas,  params),
    db.query(sqlPasajeros, params),
    db.query(sqlBruto,     params),
    db.query(sqlNeto,      params),
    db.query(sqlTransfers, tParams)
  ]);

  return {
    totalReservas:  rRes[0]?.total || 0,
    totalPasajeros: pRes[0]?.total || 0,
    totalIngresos:  bRes[0]?.total || 0,   // bruto
    totalIngresosNetos: nRes[0]?.total || 0, // neto
    totalTransfers: tRes[0]?.total || 0
  };
}

// ─── 2. Ingresos mensuales (gráfica anual) ────────────────────────────────────
//   Devuelve dos series: bruto y neto, para el año dado
async function getIncomeHistorySvc(year, filters = {}) {
  const { conds, params } = buildFilters({ ...filters, startDate: undefined, endDate: undefined });
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      MONTH(r.Fecha_Tour)                                             AS mes,
      COALESCE(SUM(p.Precio_Pasajero), 0)                            AS bruto,
      COALESCE(SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)), 0)  AS neto
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    AND   YEAR(r.Fecha_Tour) = ?
    ${andConds}
    GROUP BY MONTH(r.Fecha_Tour)
    ORDER BY mes
  `;

  const [rows] = await db.query(sql, [year, ...params]);

  const bruto = Array(12).fill(0);
  const neto  = Array(12).fill(0);
  rows.forEach(row => {
    bruto[row.mes - 1] = Number(row.bruto);
    neto [row.mes - 1] = Number(row.neto);
  });

  return { bruto, neto };
}

// ─── 3. Ingresos por día (gráfica de rango) ───────────────────────────────────
//   Retorna array de { fecha, bruto, neto } para el rango dado
async function getDailyIncomeSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      DATE(r.Fecha_Tour)                                              AS fecha,
      COALESCE(SUM(p.Precio_Pasajero), 0)                            AS bruto,
      COALESCE(SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)), 0)  AS neto
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
    GROUP BY DATE(r.Fecha_Tour)
    ORDER BY fecha
  `;

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    fecha: r.fecha,            // Date object — se serializa como ISO en JSON
    bruto: Number(r.bruto),
    neto:  Number(r.neto)
  }));
}

// ─── 4. Pasajeros totales por día ─────────────────────────────────────────────
async function getDailyPassengersSvc(filters = {}) {
  const { conds, params } = buildFilters(filters);
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      DATE(r.Fecha_Tour)       AS fecha,
      COUNT(p.Id_Pasajero)     AS pasajeros
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
    GROUP BY DATE(r.Fecha_Tour)
    ORDER BY fecha
  `;

  const [rows] = await db.query(sql, params);
  return rows.map(r => ({
    fecha:     r.fecha,
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
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
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
  const needsTourJoin = !!filters.tourId;
  const tourJoin = needsTourJoin ? 'JOIN horarios h ON r.Id_Horario = h.Id_Horario' : '';
  const andConds = conds.length ? `AND ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      CASE WHEN p.Confirmacion = 1 THEN 'Confirmado' ELSE 'Pendiente' END AS estado,
      COUNT(*) AS cantidad
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    ${tourJoin}
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${andConds}
    GROUP BY estado
  `;

  const [rows] = await db.query(sql, params);
  return rows;
}

// ─── 7. Top destinos por pasajeros ────────────────────────────────────────────
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

    const andRangeConds = rangeConds.length ? `AND ${rangeConds.join(' AND ')}` : '';

    const sqlByPlan = `
      SELECT
        pt.Id_Plan,
        pt.Nombre_Plan AS nombre,
        COALESCE(px.pasajeros, 0) AS pasajeros
      FROM planes_tours pt
      LEFT JOIN (
        SELECT
          base.plan_resuelto AS Id_Plan,
          COUNT(base.Id_Pasajero) AS pasajeros
        FROM (
          SELECT
            p.Id_Pasajero,
            COALESCE(
              pt_direct.Id_Plan,
              (
                SELECT pt2.Id_Plan
                FROM planes_tours pt2
                WHERE pt2.Id_Tour = h.Id_Tour
                  AND (
                    pt2.Fecha_Inicio IS NULL
                    OR (pt2.Fecha_Inicio <= DATE(r.Fecha_Tour) AND pt2.Fecha_Fin >= DATE(r.Fecha_Tour))
                  )
                ORDER BY
                  CASE WHEN pt2.Fecha_Inicio IS NULL THEN 1 ELSE 0 END,
                  pt2.Fecha_Inicio DESC,
                  pt2.Id_Plan ASC
                LIMIT 1
              )
            ) AS plan_resuelto
          FROM pasajeros p
          JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
          JOIN horarios h ON r.Id_Horario = h.Id_Horario
          LEFT JOIN planes_tours pt_direct
            ON pt_direct.Id_Plan = p.Id_Plan
           AND pt_direct.Id_Tour = h.Id_Tour
          WHERE h.Id_Tour = ?
            AND (r.Estado IS NULL OR r.Estado != 'Cancelada')
            ${andRangeConds}
        ) base
        WHERE base.plan_resuelto IS NOT NULL
        GROUP BY base.plan_resuelto
      ) px ON px.Id_Plan = pt.Id_Plan
      WHERE pt.Id_Tour = ?
      ORDER BY pt.Id_Plan ASC
    `;

    const [rows] = await db.query(sqlByPlan, [filters.tourId, ...rangeParams, filters.tourId]);
    return rows.map((row) => ({
      nombre: row.nombre,
      pasajeros: Number(row.pasajeros || 0)
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
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
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

module.exports = {
  getDashboardStatsSvc,
  getIncomeHistorySvc,
  getDailyIncomeSvc,
  getDailyPassengersSvc,
  getPassengersByChannelSvc,
  getPassengerDistributionSvc,
  getTourOccupancySvc
};
