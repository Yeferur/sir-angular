const db = require('../../database/db');
const ExcelJS = require('exceljs');

/* ===========================
 * LISTAR COMISIONES
 * =========================== */
async function listarComisiones(filtros) {
    const { Id_Tour, Fecha } = filtros;

    // Base filters
    const conditions = [];
    const params = [];

    if (Fecha) {
        conditions.push('R.Fecha_Tour = ?');
        params.push(Fecha);
    }

    if (Id_Tour) {
        if (Array.isArray(Id_Tour)) {
            if (Id_Tour.length > 0) {
                conditions.push(`H.Id_Tour IN (${Id_Tour.map(() => '?').join(',')})`);
                params.push(...Id_Tour);
            }
        } else {
            conditions.push('H.Id_Tour = ?');
            params.push(Id_Tour);
        }
    }

    // Mandatory filters from requirements
    // 'P.Confirmacion = 1' is handled in the join or where, but since we want to list potentially everything first in the UI? 
    // No, the requirement says "se usa para saber que comision se debe pagar". 
    // The Excel logic specifically requested:
    // 'P.Confirmacion = 1',
    // '(R.Estado = "Completado" OR R.Estado = "Activo")'

    // Let's apply these to the main list as well to be consistent, or make it optional?
    // The prompt implies the component is for paying commissions, so we likely only want confirmable ones.
    // However, usually detailed lists show everything and let you filter. 
    // But for the "Export" logic it was strict. 
    // Let's implement a general list first, but maybe we can reuse the logic.
    // For now, I will return data for the table. The prompt said: "revisa la db, ahi sabras de donde se obtienen todos los datos"
    // and "sigue la linea de diseño de mi app".
    // The query in the prompt is specific for the export.
    // I will implement a flexible list function.

    let whereClause = '';
    if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    // We need to join with Pasajeros to get passenger counts or details? 
    // The UI likely shows a summary per reservation or a list of passengers?
    // "como seria un listado extenso..." suggests a list of passengers or reservations.
    // Given the export structure (one row per passenger, merged cells for reservation), 
    // the table should probably show passengers.

    const sql = `
    SELECT 
      R.Id_Reserva,
      R.Fecha_Tour,
      T.Nombre_Tour,
      R.Nombre_Reportante,
      P.Nombre_Pasajero,
      P.DNI AS IdPas,
      P.Telefono_Pasajero,
      P.Precio_Tour,
      P.Comision,
      P.Confirmacion,
      R.Estado
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
 * EXPORTAR EXCEL
 * =========================== */
async function generarExcelComisiones(filtros, res) {
    const { Id_Tour, Fecha } = filtros;

    // Filters specifically for the export logic provided
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

    // Fixed filters from legacy logic
    conditions.push('P.Confirmacion = 1');
    conditions.push('(R.Estado = "Completada" OR R.Estado = "Activa" OR R.Estado = "Confirmada")');

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
    SELECT 
        R.Id_Reserva,
        T.Nombre_Tour,
        PTO.Nombre_Punto AS PuntoEncuentro,
        R.Nombre_Reportante,
        P.Nombre_Pasajero,
        P.DNI AS IdPas,
        P.Telefono_Pasajero,
        P.Precio_Tour,
        P.Confirmacion
    FROM reservas AS R
    INNER JOIN pasajeros AS P ON R.Id_Reserva = P.Id_Reserva
    LEFT JOIN horarios H ON R.Id_Horario = H.Id_Horario
    LEFT JOIN tours T ON H.Id_Tour = T.Id_Tour
    LEFT JOIN puntos PTO ON H.Id_Punto = PTO.Id_Punto
    ${whereClause}
    ORDER BY R.Id_Reserva, P.Id_Pasajero
  `;
    // Note: I modified the query slightly to join Puntos correctly via Horarios as per schema 
    // (Reservas -> Horarios -> Puntos). 
    // The prompt's query used `R.PuntoEncuentro` which might not exist directly on R in the new schema. 
    // In `reservas.service.js`: `pto.Nombre_Punto AS PuntoEncuentro` comes from `LEFT JOIN puntos pto ON pto.Id_Punto = h.Id_Punto`.
    // So my join is correct.

    const [data] = await db.query(query, params);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Comisión');

    // Columns
    worksheet.columns = [
        { header: 'ID RESERVA', key: 'Id_Reserva', width: 20 },
        { header: 'TOUR', key: 'Nombre_Tour', width: 30 },
        { header: 'NOMBRE PASAJERO', key: 'Nombre_Pasajero', width: 30 },
        { header: 'DNI/PASAPORTE', key: 'IdPas', width: 15 },
        { header: 'HOTEL', key: 'PuntoEncuentro', width: 20 },
        { header: 'PRECIO', key: 'Precio_Tour', width: 15 },
        { header: 'REPORTA', key: 'Nombre_Reportante', width: 25 },
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
    // We need to process the flat list into groups by Id_Reserva to layout them out
    // The prompt's logic: iterate and manually merge.

    let currentRowIndex = 2; // Start after header
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
                IdPas: row.IdPas || '',
                PuntoEncuentro: index === 0 ? row.PuntoEncuentro : '',
                Precio_Tour: row.Precio_Tour || 0,
                Nombre_Reportante: index === 0 ? row.Nombre_Reportante : ''
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
            worksheet.mergeCells(`E${startRow}:E${endRow}`); // HOTEL
            worksheet.mergeCells(`G${startRow}:G${endRow}`); // REPORTA
        }
    }

    // Alignment
    worksheet.eachRow((row) => {
        row.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Write to response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Comision_Reporte.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    listarComisiones,
    generarExcelComisiones
};
