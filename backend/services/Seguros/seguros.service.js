const db = require('../../database/db');
const ExcelJS = require('exceljs');

/* ===========================
 * LISTAR SEGUROS
 * =========================== */
async function listarSeguros(filtros) {
    const { Id_Tour, Fecha } = filtros;

    const conditions = [];
    const params = [];

    if (Fecha) {
        conditions.push('R.Fecha_Tour = ?');
        params.push(Fecha);
    }

    if (Id_Tour) {
        const tourArray = Array.isArray(Id_Tour) ? Id_Tour : [Id_Tour];
        if (tourArray.length > 0 && tourArray[0] !== '') {
            conditions.push(`H.Id_Tour IN (${tourArray.map(() => '?').join(',')})`);
            params.push(...tourArray);
        }
    }

    conditions.push('P.Confirmacion = 1');
    conditions.push('(R.Estado = "Completada" OR R.Estado = "Activa" OR R.Estado = "Confirmada")');

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
    SELECT 
      R.Id_Reserva,
      R.Fecha_Tour,
      T.Nombre_Tour,
      P.Nombre_Pasajero,
      P.DNI AS IdPas,
      P.Confirmacion
    FROM reservas R
    JOIN horarios H ON R.Id_Horario = H.Id_Horario
    JOIN tours T ON H.Id_Tour = T.Id_Tour
    JOIN pasajeros P ON R.Id_Reserva = P.Id_Reserva
    ${whereClause}
    ORDER BY R.Fecha_Tour DESC, R.Id_Reserva DESC
  `;

    const [rows] = await db.query(sql, params);
    return rows;
}

/* ===========================
 * EXPORTAR EXCEL SEGUROS
 * =========================== */
async function generarExcelSeguros(filtros, res) {
    const { Id_Tour, Fecha } = filtros;

    const conditions = [];
    const params = [];

    if (Fecha) {
        conditions.push('R.Fecha_Tour = ?');
        params.push(Fecha);
    }

    if (Id_Tour) {
        const tourArray = Array.isArray(Id_Tour) ? Id_Tour : [Id_Tour];
        if (tourArray.length > 0 && tourArray[0] !== '') {
            conditions.push(`H.Id_Tour IN (${tourArray.map(() => '?').join(',')})`);
            params.push(...tourArray);
        }
    }

    conditions.push('P.Confirmacion = 1');
    conditions.push('(R.Estado = "Completada" OR R.Estado = "Activa" OR R.Estado = "Confirmada")');

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query adapted to schema: R -> H -> T
    const query = `
    SELECT 
        R.Id_Reserva,
        T.Nombre_Tour,
        P.Nombre_Pasajero,
        P.DNI AS IdPas,
        P.Confirmacion
    FROM reservas AS R
    INNER JOIN pasajeros AS P ON R.Id_Reserva = P.Id_Reserva
    LEFT JOIN horarios H ON R.Id_Horario = H.Id_Horario
    LEFT JOIN tours T ON H.Id_Tour = T.Id_Tour
    ${whereClause}
    ORDER BY R.Id_Reserva, P.Id_Pasajero
  `;

    const [data] = await db.query(query, params);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Seguros');

    // Columns
    worksheet.columns = [
        { header: 'ID RESERVA', key: 'Id_Reserva', width: 20 },
        { header: 'TOUR', key: 'Nombre_Tour', width: 30 },
        { header: 'NOMBRE PASAJERO', key: 'Nombre_Pasajero', width: 30 },
        { header: 'DNI/PASAPORTE', key: 'IdPas', width: 20 },
    ];

    // Styles
    const borderStyleThin = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
    };

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
        cell.border = borderStyleThin;
    });

    // Grouping for merge
    let currentRowIndex = 2;
    const groupedData = data.reduce((acc, row) => {
        if (!acc[row.Id_Reserva]) acc[row.Id_Reserva] = [];
        acc[row.Id_Reserva].push(row);
        return acc;
    }, {});

    for (const idReserva in groupedData) {
        const rows = groupedData[idReserva];
        const startRow = currentRowIndex;

        rows.forEach((row, index) => {
            const rowData = {
                Id_Reserva: index === 0 ? row.Id_Reserva : '',
                Nombre_Tour: index === 0 ? row.Nombre_Tour : '',
                Nombre_Pasajero: row.Nombre_Pasajero || '',
                IdPas: row.IdPas || ''
            };

            const newRow = worksheet.addRow(rowData);
            newRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = borderStyleThin;
            });
            currentRowIndex++;
        });

        const endRow = currentRowIndex - 1;

        if (startRow !== endRow) {
            worksheet.mergeCells(`A${startRow}:A${endRow}`); // ID RESERVA
            worksheet.mergeCells(`B${startRow}:B${endRow}`); // TOUR
        }
    }

    worksheet.eachRow((row) => {
        row.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Seguros_Reporte.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    listarSeguros,
    generarExcelSeguros
};
