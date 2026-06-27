const db = require('../../database/db');
const ExcelJS = require('exceljs');

/* ===================================================================
 * LISTAR SEGUROS (desde programacion_buses)
 * Devuelve un array de buses, cada uno con guía, conductor y pasajeros
 * confirmados asignados a ese bus.
 * =================================================================== */
async function listarSeguros(filtros) {
    const { Id_Tour, Fecha } = filtros;

    if (!Fecha || !Id_Tour) {
        return [];
    }

    // 1. Buscar la programación activa para ese tour y fecha
    const [progRows] = await db.query(
        `SELECT Id_Programacion FROM programaciones
         WHERE Fecha_Tour = ? AND Id_Tour = ? AND Estado = 'activa'
         LIMIT 1`,
        [Fecha, Id_Tour]
    );

    if (!progRows.length) return [];
    const Id_Programacion = progRows[0].Id_Programacion;

    // 2. Obtener los buses de esa programación
    const [buses] = await db.query(
        `SELECT
            pb.Id_Bus_Prog,
            pb.Placa_Display,
            pb.Guia,
            pb.Conductor,
            pb.DNI_Guia,
            pb.DNI_Conductor,
            pb.Pasajeros_Total,
            pb.Orden_Bus
         FROM programacion_buses pb
         WHERE pb.Id_Programacion = ?
         ORDER BY pb.Orden_Bus ASC`,
        [Id_Programacion]
    );

    if (!buses.length) return [];

    const busIds = buses.map(b => b.Id_Bus_Prog);

    // 3. Obtener reservas asignadas a esos buses con pasajeros confirmados
    const [pasajeros] = await db.query(
        `SELECT
            pr.Id_Bus_Prog,
            pr.Id_Reserva,
            pr.Nombre_Reportante_Snap AS Nombre_Reportante,
            p.Id_Pasajero,
            p.Nombre_Pasajero,
            p.DNI,
            p.Tipo_Pasajero,
            p.Confirmacion
         FROM programacion_reservas pr
         INNER JOIN pasajeros p ON p.Id_Reserva = pr.Id_Reserva
         WHERE pr.Id_Bus_Prog IN (?)
           AND p.Confirmacion = 1
         ORDER BY pr.Id_Bus_Prog ASC, pr.Id_Reserva ASC, p.Id_Pasajero ASC`,
        [busIds]
    );

    // 4. Agrupar pasajeros por bus
    const pasajerosPorBus = new Map();
    for (const p of pasajeros) {
        if (!pasajerosPorBus.has(p.Id_Bus_Prog)) {
            pasajerosPorBus.set(p.Id_Bus_Prog, []);
        }
        pasajerosPorBus.get(p.Id_Bus_Prog).push(p);
    }

    // 5. Armar respuesta
    return buses.map(bus => ({
        Id_Bus_Prog:    bus.Id_Bus_Prog,
        Placa_Display:  bus.Placa_Display,
        Orden_Bus:      bus.Orden_Bus,
        Guia:           bus.Guia || null,
        DNI_Guia:       bus.DNI_Guia || null,
        Conductor:      bus.Conductor || null,
        DNI_Conductor:  bus.DNI_Conductor || null,
        pasajeros:      pasajerosPorBus.get(bus.Id_Bus_Prog) || []
    }));
}

/* ===================================================================
 * ACTUALIZAR CONDUCTOR / DNI de un bus (PATCH)
 * Solo toca los campos de personal del bus, no afecta pasajeros.
 * =================================================================== */
async function actualizarPersonalBus(Id_Bus_Prog, campos) {
    const permitidos = ['Conductor', 'DNI_Conductor', 'DNI_Guia'];
    const sets = [];
    const params = [];

    for (const key of permitidos) {
        if (Object.prototype.hasOwnProperty.call(campos, key)) {
            sets.push(`\`${key}\` = ?`);
            params.push(campos[key] ?? null);
        }
    }

    if (!sets.length) return { affected: 0 };

    params.push(Id_Bus_Prog);
    const [result] = await db.query(
        `UPDATE programacion_buses SET ${sets.join(', ')} WHERE Id_Bus_Prog = ?`,
        params
    );

    return { affected: result.affectedRows };
}

/* ===================================================================
 * EXPORTAR EXCEL SEGUROS
 * Una hoja por bus: encabezado con datos del bus, luego pasajeros,
 * luego fila de guía y fila de conductor.
 * =================================================================== */
async function generarExcelSeguros(filtros, res) {
    const { Id_Tour, Fecha } = filtros;

    if (!Fecha || !Id_Tour) {
        throw new Error('Faltan parámetros obligatorios: Fecha e Id_Tour');
    }

    const buses = await listarSeguros(filtros);
    if (!buses.length) {
        throw new Error('No hay datos de programación para exportar');
    }

    // Nombre del tour
    const [[tourRow]] = await db.query(
        `SELECT Nombre_Tour FROM tours WHERE Id_Tour = ? LIMIT 1`,
        [Id_Tour]
    );
    const nombreTour = tourRow?.Nombre_Tour || 'Tour';

    const workbook = new ExcelJS.Workbook();

    const borderThin = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };

    const fillTitle   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    const fillHeader  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    const fillSection = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
    const fillAlt     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };

    const fontHeader = { bold: true, color: { argb: 'FF111827' }, size: 11 };
    const fontSection = { bold: true, color: { argb: 'FF111827' }, size: 10 };

    const cols = [
        { header: 'N°',              key: 'num',    width: 6  },
        { header: 'TIPO',            key: 'tipo',   width: 14 },
        { header: 'NOMBRE',          key: 'nombre', width: 36 },
        { header: 'DNI / PASAPORTE', key: 'dni',    width: 22 },
        { header: 'ID RESERVA',      key: 'reserva',width: 16 },
    ];

    for (const [busIndex, bus] of buses.entries()) {
        const sheetName = `Bus ${bus.Orden_Bus} - ${bus.Placa_Display}`.substring(0, 31);
        const ws = workbook.addWorksheet(sheetName);
        ws.columns = cols;

        // --- Fila título ---
        ws.mergeCells('A1:E1');
        const titleCell = ws.getCell('A1');
        titleCell.value = `${nombreTour} — ${Fecha} — Bus ${bus.Orden_Bus} (${bus.Placa_Display})`;
        titleCell.font = { bold: true, size: 13, color: { argb: 'FF111827' } };
        titleCell.fill = fillTitle;
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.border = borderThin;
        ws.getRow(1).height = 24;

        // --- Fila encabezados de columna ---
        const headerRow = ws.getRow(2);
        headerRow.values = cols.map(c => c.header);
        headerRow.eachCell(cell => {
            cell.font = fontHeader;
            cell.fill = fillHeader;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderThin;
        });
        headerRow.height = 20;

        // --- Filas de pasajeros ---
        let rowNum = 3;
        const pasajeros = bus.pasajeros;

        pasajeros.forEach((p, idx) => {
            const row = ws.getRow(rowNum);
            row.values = [
                idx + 1,
                p.Tipo_Pasajero || 'ADULTO',
                p.Nombre_Pasajero || '',
                p.DNI || '',
                p.Id_Reserva || ''
            ];

            if (idx % 2 === 1) {
                row.eachCell({ includeEmpty: true }, cell => {
                    cell.fill = fillAlt;
                });
            }

            row.eachCell({ includeEmpty: true }, cell => {
                cell.border = borderThin;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            // Nombre alineado a la izquierda
            row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
            rowNum++;
        });

        // --- Separador ---
        ws.mergeCells(`A${rowNum}:E${rowNum}`);
        const sepCell = ws.getCell(`A${rowNum}`);
        sepCell.value = 'PERSONAL DEL BUS';
        sepCell.font = fontSection;
        sepCell.fill = fillSection;
        sepCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sepCell.border = borderThin;
        ws.getRow(rowNum).height = 18;
        rowNum++;

        // --- Fila Guía ---
        const guiaRow = ws.getRow(rowNum);
        guiaRow.values = [
            pasajeros.length + 1,
            'GUÍA',
            bus.Guia || '—',
            bus.DNI_Guia || '—',
            ''
        ];
        guiaRow.eachCell({ includeEmpty: true }, cell => {
            cell.border = borderThin;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.fill = fillAlt;
        });
        guiaRow.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
        rowNum++;

        // --- Fila Conductor ---
        const conductorRow = ws.getRow(rowNum);
        conductorRow.values = [
            pasajeros.length + 2,
            'CONDUCTOR',
            bus.Conductor || '—',
            bus.DNI_Conductor || '—',
            ''
        ];
        conductorRow.eachCell({ includeEmpty: true }, cell => {
            cell.border = borderThin;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.fill = fillAlt;
        });
        conductorRow.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
        rowNum++;

        // --- Total ---
        ws.mergeCells(`A${rowNum}:B${rowNum}`);
        ws.getCell(`A${rowNum}`).value = 'Total asegurados';
        ws.getCell(`A${rowNum}`).font = { bold: true };
        ws.getCell(`A${rowNum}`).border = borderThin;
        ws.getCell(`C${rowNum}`).value = pasajeros.length + 2; // pasajeros + guía + conductor
        ws.getCell(`C${rowNum}`).font = { bold: true };
        ws.getCell(`C${rowNum}`).border = borderThin;
        ws.getCell(`C${rowNum}`).alignment = { horizontal: 'center' };

        // Ajuste de alto de filas de datos
        for (let r = 3; r < rowNum; r++) {
            ws.getRow(r).height = 18;
        }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Seguros_${Fecha}_Tour${Id_Tour}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    listarSeguros,
    actualizarPersonalBus,
    generarExcelSeguros
};
