const db = require('../../database/db');

async function getDashboardStatsSvc(filters = {}) {
    const { startDate, endDate } = filters;
    const conditions = [];
    const params = [];

    if (startDate) {
        conditions.push('r.Fecha_Tour >= ?');
        params.push(startDate);
    }
    if (endDate) {
        conditions.push('r.Fecha_Tour <= ?');
        params.push(endDate);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const whereClauseAnd = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    // 1. Total Reservas (No canceladas)
    const sqlReservas = `
    SELECT count(*) as total
    FROM reservas r
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${whereClauseAnd}
  `;

    // 2. Total Pasajeros (No cancelados) en esas reservas
    const sqlPasajeros = `
    SELECT count(*) as total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${whereClauseAnd}
  `;

    // 3. Ingresos Totales (Suma de Precio_Pasajero - Comision)
    // Nota: Ajustar logica de negocio segun necesidad (e.g. solo pagados?)
    // Por ahora sumamos todo lo "vendido" no cancelado
    const sqlIngresos = `
    SELECT SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)) as total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    ${whereClauseAnd}
  `;

    // 4. Ingresos Transfers (Estimado, si existiera precio. Por ahora count)
    const sqlTransfers = `
    SELECT count(*) as total
    FROM transfers tr
    WHERE (tr.Estado IS NULL OR tr.Estado != 'Cancelado')
    ${startDate ? `AND tr.Fecha_Transfer >= '${startDate}'` : ''}
    ${endDate ? `AND tr.Fecha_Transfer <= '${endDate}'` : ''}
  `;

    const [resReservas] = await db.query(sqlReservas, params);
    const [resPasajeros] = await db.query(sqlPasajeros, params);
    const [resIngresos] = await db.query(sqlIngresos, params);
    const [resTransfers] = await db.query(sqlTransfers);

    return {
        totalReservas: resReservas[0]?.total || 0,
        totalPasajeros: resPasajeros[0]?.total || 0,
        totalIngresos: resIngresos[0]?.total || 0,
        totalTransfers: resTransfers[0]?.total || 0
    };
}

async function getIncomeHistorySvc(year) {
    // Ingresos por mes para un año dado
    const sql = `
    SELECT 
      MONTH(r.Fecha_Tour) as mes,
      SUM(p.Precio_Pasajero - COALESCE(p.Comision, 0)) as total
    FROM pasajeros p
    JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
    WHERE (r.Estado IS NULL OR r.Estado != 'Cancelada')
    AND YEAR(r.Fecha_Tour) = ?
    GROUP BY MONTH(r.Fecha_Tour)
    ORDER BY mes
  `;
    const [rows] = await db.query(sql, [year]);

    // Rellenar meses vacios
    const data = Array(12).fill(0);
    rows.forEach(row => {
        data[row.mes - 1] = Number(row.total);
    });
    return data;
}

async function getPassengerDistributionSvc(filters = {}) {
    const { startDate, endDate } = filters;
    let where = "WHERE 1=1";
    const params = [];

    if (startDate) { where += " AND r.Fecha_Tour >= ?"; params.push(startDate); }
    if (endDate) { where += " AND r.Fecha_Tour <= ?"; params.push(endDate); }

    const sql = `
        SELECT 
            CASE 
                WHEN p.Confirmacion = 1 THEN 'Confirmado'
                ELSE 'Pendiente'
            END as estado,
            COUNT(*) as cantidad
        FROM pasajeros p
        JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
        ${where}
        AND (r.Estado IS NULL OR r.Estado != 'Cancelada')
        GROUP BY estado
    `;
    const [rows] = await db.query(sql, params);
    return rows;
}

async function getTourOccupancySvc(filters = {}) {
    const { startDate, endDate } = filters;
    let where = "WHERE 1=1";
    const params = [];

    if (startDate) { where += " AND r.Fecha_Tour >= ?"; params.push(startDate); }
    if (endDate) { where += " AND r.Fecha_Tour <= ?"; params.push(endDate); }

    const sql = `
        SELECT 
            t.Nombre_Tour,
            COUNT(p.Id_Pasajero) as pasajeros
        FROM pasajeros p
        JOIN reservas r ON p.Id_Reserva = r.Id_Reserva
        JOIN horarios h ON r.Id_Horario = h.Id_Horario
        JOIN tours t ON h.Id_Tour = t.Id_Tour
        ${where}
        AND (r.Estado IS NULL OR r.Estado != 'Cancelada')
        GROUP BY t.Nombre_Tour
        ORDER BY pasajeros DESC
        LIMIT 10
    `;
    const [rows] = await db.query(sql, params);
    return rows;
}

module.exports = {
    getDashboardStatsSvc,
    getIncomeHistorySvc,
    getPassengerDistributionSvc,
    getTourOccupancySvc
};
