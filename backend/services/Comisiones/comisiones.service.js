const db = require('../../database/db');
const ExcelJS = require('exceljs');

/* ===========================
 * QUERY BASE
 * =========================== */
function buildBaseQuery(conditions, params, extraSelect = '') {
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    return {
        sql: `
            SELECT
                R.Id_Reserva,
                R.Fecha_Tour,
                R.Nombre_Reportante,
                R.Estado         AS Estado_Reserva,
                C.Id_Canal,
                C.Nombre_Canal,
                T.Id_Tour,
                T.Nombre_Tour,
                TC.Valor         AS Comision_Unitaria,
                COUNT(P.Id_Pasajero)          AS Num_Pasajeros,
                SUM(P.Comision)               AS Total_Comision,
                COALESCE(L.Estado, 'PENDIENTE')        AS Estado_Liquidacion,
                L.Forma_Pago,
                L.Cuenta_Bancaria,
                L.Fecha_Pago
                ${extraSelect}
            FROM reservas R
            INNER JOIN horarios H        ON R.Id_Horario  = H.Id_Horario
            INNER JOIN tours T           ON H.Id_Tour     = T.Id_Tour
            INNER JOIN canales_reservas C ON R.Id_Canal   = C.Id_Canal
            INNER JOIN tour_comisiones TC ON TC.Id_Tour   = T.Id_Tour
                                         AND TC.Id_Canal  = C.Id_Canal
            INNER JOIN pasajeros P       ON P.Id_Reserva  = R.Id_Reserva
            LEFT  JOIN liquidaciones L   ON L.Id_Reserva  = R.Id_Reserva
            ${whereClause}
            GROUP BY
                R.Id_Reserva, R.Fecha_Tour, R.Nombre_Reportante, R.Estado,
                C.Id_Canal, C.Nombre_Canal,
                T.Id_Tour, T.Nombre_Tour,
                TC.Valor,
                L.Estado, L.Forma_Pago, L.Cuenta_Bancaria, L.Fecha_Pago
            ORDER BY C.Nombre_Canal, R.Nombre_Reportante, R.Id_Reserva
        `,
        params
    };
}

function buildConditions(filtros) {
    const { Id_Tour, Fecha, Id_Canal, Nombre_Reportante, Estado } = filtros;
    const conditions = [
        "C.Tiene_Comision = 1",
        "(R.Estado = 'Activa' OR R.Estado = 'Completada' OR R.Estado = 'Confirmada')"
    ];
    const params = [];

    if (Fecha) {
        conditions.push('R.Fecha_Tour = ?');
        params.push(Fecha);
    }

    if (Id_Tour) {
        const arr = Array.isArray(Id_Tour) ? Id_Tour : [Id_Tour];
        if (arr.length > 0 && arr[0] !== '') {
            conditions.push(`H.Id_Tour IN (${arr.map(() => '?').join(',')})`);
            params.push(...arr);
        }
    }

    if (Id_Canal) {
        conditions.push('C.Id_Canal = ?');
        params.push(Id_Canal);
    }

    if (Nombre_Reportante) {
        conditions.push('R.Nombre_Reportante LIKE ?');
        params.push(`%${Nombre_Reportante}%`);
    }

    if (Estado && (Estado === 'PENDIENTE' || Estado === 'PAGADO')) {
        conditions.push('COALESCE(L.Estado, \'PENDIENTE\') = ?');
        params.push(Estado);
    }

    return { conditions, params };
}

/* ===========================
 * LISTAR COMISIONES
 * =========================== */
async function listarComisiones(filtros) {
    const { conditions, params } = buildConditions(filtros);
    const { sql, params: qParams } = buildBaseQuery(conditions, params);
    const [rows] = await db.query(sql, qParams);

    const canalesMap = new Map();

    for (const row of rows) {
        const canalKey = row.Id_Canal;

        if (!canalesMap.has(canalKey)) {
            canalesMap.set(canalKey, {
                Id_Canal:        row.Id_Canal,
                Nombre_Canal:    row.Nombre_Canal,
                reportantes:     new Map(),
                Total_Canal:     0,
                Pendiente_Canal: 0,
                Pagado_Canal:    0
            });
        }

        const canal = canalesMap.get(canalKey);
        const reportanteKey = row.Nombre_Reportante || '(Sin reportante)';

        if (!canal.reportantes.has(reportanteKey)) {
            canal.reportantes.set(reportanteKey, {
                Nombre_Reportante:    reportanteKey,
                Forma_Pago:           row.Forma_Pago || null,
                Cuenta_Bancaria:      row.Cuenta_Bancaria || null,
                reservas:             [],
                Total_Reportante:     0,
                Pendiente_Reportante: 0,
                Pagado_Reportante:    0
            });
        }

        const reportante  = canal.reportantes.get(reportanteKey);
        const totalComision = Number(row.Total_Comision) || 0;
        const esPagado    = row.Estado_Liquidacion === 'PAGADO';

        reportante.reservas.push({
            Id_Reserva:         row.Id_Reserva,
            Fecha_Tour:         row.Fecha_Tour,
            Nombre_Tour:        row.Nombre_Tour,
            Num_Pasajeros:      Number(row.Num_Pasajeros),
            Comision_Unitaria:  Number(row.Comision_Unitaria),
            Total_Comision:     totalComision,
            Estado_Liquidacion: row.Estado_Liquidacion,
            Forma_Pago:         row.Forma_Pago  || null,
            Cuenta_Bancaria:    row.Cuenta_Bancaria || null,
            Fecha_Pago:         row.Fecha_Pago  || null
        });

        reportante.Total_Reportante     += totalComision;
        reportante.Pendiente_Reportante += esPagado ? 0 : totalComision;
        reportante.Pagado_Reportante    += esPagado ? totalComision : 0;

        canal.Total_Canal     += totalComision;
        canal.Pendiente_Canal += esPagado ? 0 : totalComision;
        canal.Pagado_Canal    += esPagado ? totalComision : 0;
    }

    const result = [];
    for (const canal of canalesMap.values()) {
        const reportantesArr = [];
        for (const rep of canal.reportantes.values()) {
            reportantesArr.push(rep);
        }
        result.push({ ...canal, reportantes: reportantesArr });
    }

    return result;
}

/* ===========================
 * ACTUALIZAR ESTADO DE LIQUIDACIÓN
 * Upsert de Estado + datos de pago opcionales.
 * Solo actualiza Fecha_Pago cuando el nuevo estado es PAGADO;
 * si se revierte a PENDIENTE la limpia.
 * =========================== */
async function actualizarLiquidacion(payload) {
    const { reservas, Estado, Forma_Pago, Cuenta_Bancaria } = payload;

    if (!reservas?.length) throw new Error('Se requiere al menos una reserva');
    if (!Estado)           throw new Error('El campo Estado es obligatorio');

    const Fecha_Pago = Estado === 'PAGADO'
        ? new Date().toISOString().split('T')[0]
        : null;

    // UPSERT: inserta o actualiza solo las columnas de estado
    const sql = `
        INSERT INTO liquidaciones (Id_Reserva, Estado, Forma_Pago, Cuenta_Bancaria, Fecha_Pago)
        VALUES ?
        ON DUPLICATE KEY UPDATE
            Estado          = VALUES(Estado),
            Forma_Pago      = VALUES(Forma_Pago),
            Cuenta_Bancaria = VALUES(Cuenta_Bancaria),
            Fecha_Pago      = VALUES(Fecha_Pago)
    `;

    const values = reservas.map(idReserva => [
        idReserva,
        Estado,
        Forma_Pago      || null,
        Cuenta_Bancaria || null,
        Fecha_Pago
    ]);

    await db.query(sql, [values]);
    return { updated: reservas.length };
}

/* ===========================
 * ACTUALIZAR SOLO DATOS DE PAGO
 * No toca Estado ni Fecha_Pago.
 * Si la fila no existe aún en liquidaciones, la crea con Estado = PENDIENTE.
 * =========================== */
async function actualizarDatosPago(payload) {
    const { reservas, Forma_Pago, Cuenta_Bancaria } = payload;

    if (!reservas?.length) throw new Error('Se requiere al menos una reserva');
    if (!Forma_Pago)       throw new Error('El campo Forma_Pago es obligatorio');

    // UPSERT: si no existe la fila la crea como PENDIENTE;
    // si ya existe solo pisa Forma_Pago y Cuenta_Bancaria, nunca Estado ni Fecha_Pago.
    const sql = `
        INSERT INTO liquidaciones (Id_Reserva, Estado, Forma_Pago, Cuenta_Bancaria)
        VALUES ?
        ON DUPLICATE KEY UPDATE
            Forma_Pago      = VALUES(Forma_Pago),
            Cuenta_Bancaria = VALUES(Cuenta_Bancaria)
    `;

    const values = reservas.map(idReserva => [
        idReserva,
        'PENDIENTE',
        Forma_Pago,
        Cuenta_Bancaria || null
    ]);

    await db.query(sql, [values]);
    return { updated: reservas.length };
}

/* ===========================
 * EXPORTAR EXCEL
 * =========================== */
async function generarExcelComisiones(filtros, res) {
    const { conditions, params } = buildConditions(filtros);
    const { sql, params: qParams } = buildBaseQuery(conditions, params);
    const [data] = await db.query(sql, qParams);

    const workbook = new ExcelJS.Workbook();

    const porCanal = {};
    for (const row of data) {
        const key = row.Nombre_Canal;
        if (!porCanal[key]) porCanal[key] = [];
        porCanal[key].push(row);
    }

    const formatCOP = (val) => {
        const n = Number(val) || 0;
        return new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP', minimumFractionDigits: 0
        }).format(n);
    };

    const borderThin = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };

    const fillHeader = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFE5E7EB' }
    };
    const fillSummary = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' }
    };
    const fillGrandTotal = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFD1D5DB' }
    };

    for (const [canalNombre, rows] of Object.entries(porCanal)) {
        const ws = workbook.addWorksheet(canalNombre);

        ws.columns = [
            { key: 'Id_Reserva',         width: 18 },
            { key: 'Nombre_Reportante',  width: 28 },
            { key: 'Nombre_Tour',        width: 22 },
            { key: 'Num_Pasajeros',      width: 14 },
            { key: 'Comision_Unitaria',  width: 18 },
            { key: 'Total_Comision',     width: 18 },
            { key: 'Forma_Pago',         width: 26 },
            { key: 'Cuenta_Bancaria',    width: 22 },
            { key: 'Estado_Liquidacion', width: 14 },
            { key: 'Fecha_Pago',         width: 14 },
        ];

        const headers = [
            'ID RESERVA', 'REPORTANTE', 'TOUR',
            'PASAJEROS', 'COM. UNITARIA', 'TOTAL COM.',
            'FORMA DE PAGO', 'CUENTA', 'ESTADO', 'FECHA PAGO'
        ];

        const headerRow = ws.addRow(headers);
        headerRow.font      = { bold: true, color: { argb: 'FF111827' }, size: 10 };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height    = 22;
        headerRow.eachCell(cell => {
            cell.fill   = fillHeader;
            cell.border = borderThin;
        });

        const porReportante = {};
        for (const row of rows) {
            const k = row.Nombre_Reportante || '(Sin reportante)';
            if (!porReportante[k]) porReportante[k] = [];
            porReportante[k].push(row);
        }

        let totalCanal = 0;

        for (const [reportante, resRows] of Object.entries(porReportante)) {
            const startIdx = ws.rowCount + 1;
            let totalReportante = 0;

            for (const r of resRows) {
                const total = Number(r.Total_Comision) || 0;
                totalReportante += total;

                const dataRow = ws.addRow([
                    r.Id_Reserva,
                    reportante,
                    r.Nombre_Tour,
                    Number(r.Num_Pasajeros),
                    formatCOP(r.Comision_Unitaria),
                    formatCOP(total),
                    r.Forma_Pago ? r.Forma_Pago.replace(/_/g, ' ') : '—',
                    r.Cuenta_Bancaria || '—',
                    r.Estado_Liquidacion || 'PENDIENTE',
                    r.Fecha_Pago
                        ? new Date(r.Fecha_Pago).toLocaleDateString('es-CO')
                        : '—'
                ]);

                dataRow.alignment = { vertical: 'middle', horizontal: 'center' };
                dataRow.eachCell({ includeEmpty: true }, cell => { cell.border = borderThin; });

                const estadoCell = dataRow.getCell(9);
                estadoCell.font = { bold: true, color: { argb: 'FF111827' } };
            }

            const endIdx = ws.rowCount;

            if (endIdx > startIdx) {
                ws.mergeCells(`B${startIdx}:B${endIdx}`);
                ws.getCell(`B${startIdx}`).alignment = { vertical: 'middle', horizontal: 'center' };
            }

            totalCanal += totalReportante;

            const subtotalRow = ws.addRow([
                '', `SUBTOTAL ${reportante}`, '', '', '',
                formatCOP(totalReportante), '', '', '', ''
            ]);
            subtotalRow.font = { bold: true, italic: true };
            subtotalRow.getCell(2).alignment = { horizontal: 'right' };
            subtotalRow.eachCell({ includeEmpty: true }, cell => {
                cell.fill = fillSummary;
                cell.border = borderThin;
            });

            ws.addRow([]);
        }

        const totalRow = ws.addRow([
            '', `TOTAL ${canalNombre}`, '', '', '',
            formatCOP(totalCanal), '', '', '', ''
        ]);
        totalRow.font = { bold: true, size: 11 };
        totalRow.getCell(2).alignment = { horizontal: 'right' };
        totalRow.eachCell({ includeEmpty: true }, cell => {
            cell.fill = fillGrandTotal;
            cell.font = { bold: true, color: { argb: 'FF111827' } };
            cell.border = borderThin;
        });
    }

    const fecha = filtros.Fecha || new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Comisiones_${fecha}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    listarComisiones,
    actualizarLiquidacion,
    actualizarDatosPago,
    generarExcelComisiones
};
