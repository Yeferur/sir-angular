const db = require('../../database/db');
const ExcelJS = require('exceljs');

function createServiceError(message, statusCode = 400, errorCode = 'SEGUROS_ERROR', details = []) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.errorCode = errorCode;
    error.details = details;
    return error;
}

function cleanText(value, maxLength = 100) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw createServiceError(`El valor supera el máximo de ${maxLength} caracteres.`, 400, 'INVALID_FIELD');
    }
    return normalized;
}

function normalizeAssignmentValue(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function normalizeDocument(value) {
    return normalizeAssignmentValue(value).replace(/[^A-Z0-9]/g, '');
}

function isGenericVehicleIdentifier(value) {
    return /^(BUS|PRIVADO|VEHICULO|VEHÍCULO)\s*\d+$/i.test(String(value || '').trim());
}

function findBusAssignmentConflicts(candidate, buses, currentBusId = null) {
    const conflicts = [];
    const plate = isGenericVehicleIdentifier(candidate.Placa_Display) ? '' : normalizeDocument(candidate.Placa_Display);
    const guide = normalizeAssignmentValue(candidate.Guia);
    const guideDocument = normalizeDocument(candidate.DNI_Guia);
    const driver = normalizeAssignmentValue(candidate.Conductor);
    const driverDocument = normalizeDocument(candidate.DNI_Conductor);

    for (const bus of buses || []) {
        if (Number(bus.Id_Bus_Prog) === Number(currentBusId)) continue;
        const label = String(bus.Placa_Display || '').trim() || `Bus ${bus.Orden_Bus || ''}`.trim();

        if (plate && !isGenericVehicleIdentifier(bus.Placa_Display) && plate === normalizeDocument(bus.Placa_Display)) {
            conflicts.push({ field: 'Placa_Display', label: 'Placa', value: candidate.Placa_Display, bus: label });
        }
        if (guideDocument && guideDocument === normalizeDocument(bus.DNI_Guia)) {
            conflicts.push({ field: 'DNI_Guia', label: 'Documento del guía', value: candidate.DNI_Guia, bus: label });
        } else if (guide && guide === normalizeAssignmentValue(bus.Guia)) {
            conflicts.push({ field: 'Guia', label: 'Guía', value: candidate.Guia, bus: label });
        }
        if (driverDocument && driverDocument === normalizeDocument(bus.DNI_Conductor)) {
            conflicts.push({ field: 'DNI_Conductor', label: 'Documento del conductor', value: candidate.DNI_Conductor, bus: label });
        } else if (driver && driver === normalizeAssignmentValue(bus.Conductor)) {
            conflicts.push({ field: 'Conductor', label: 'Conductor', value: candidate.Conductor, bus: label });
        }
    }

    return conflicts;
}

function buildInsuranceRows(bus) {
    return [
        ...(bus.pasajeros || []).map(p => ({
            tipo: p.Tipo_Pasajero || 'PASAJERO',
            nombre: p.Nombre_Pasajero,
            dni: p.DNI,
            reserva: p.Id_Reserva
        })),
        { tipo: 'GUÍA', nombre: bus.Guia, dni: bus.DNI_Guia, reserva: '' },
        { tipo: 'CONDUCTOR', nombre: bus.Conductor, dni: bus.DNI_Conductor, reserva: '' }
    ];
}

function buildConsolidatedRows(buses) {
    const rows = [];
    for (const bus of buses || []) {
        const busLabel = bus.Tipo_Bus === 'privado' ? `Privado ${bus.Orden_Bus}` : `Bus ${bus.Orden_Bus}`;
        for (const registro of buildInsuranceRows(bus)) {
            rows.push({
                bus: busLabel,
                placa: String(bus.Placa_Display || '').trim(),
                ...registro
            });
        }
    }
    return rows;
}

function buildBusStatus(bus) {
    const missing = [];
    if (!bus.Guia) missing.push({ code: 'GUIA', label: 'Nombre del guía', source: 'seguros' });
    if (!bus.DNI_Guia) missing.push({ code: 'DNI_GUIA', label: 'Documento del guía', source: 'seguros' });
    if (!bus.Conductor) missing.push({ code: 'CONDUCTOR', label: 'Nombre del conductor', source: 'seguros' });
    if (!bus.DNI_Conductor) missing.push({ code: 'DNI_CONDUCTOR', label: 'Documento del conductor', source: 'seguros' });

    const pasajerosSinDocumento = (bus.pasajeros || []).filter(p => !String(p.DNI || '').trim());
    if (pasajerosSinDocumento.length) {
        missing.push({
            code: 'DOCUMENTO_PASAJERO',
            label: `${pasajerosSinDocumento.length} pasajero${pasajerosSinDocumento.length === 1 ? '' : 's'} sin documento`,
            source: 'reserva',
            count: pasajerosSinDocumento.length
        });
    }

    return {
        ...bus,
        Pasajeros_Sin_Documento: pasajerosSinDocumento.length,
        Total_Asegurados: (bus.pasajeros || []).length + 2,
        Faltantes: missing,
        Datos_Completos: missing.length === 0
    };
}

async function listarSeguros(filtros) {
    const { Id_Tour, Fecha } = filtros;
    if (!Fecha || !Id_Tour) return [];

    const [progRows] = await db.query(
        `
        SELECT DISTINCT p.Id_Programacion, COALESCE(p.Tipo_Programacion, 'grupal') AS Tipo_Programacion,
               p.Confirmado_En
        FROM programaciones p
        INNER JOIN programacion_tours pt ON pt.Id_Programacion = p.Id_Programacion
        WHERE p.Fecha_Tour = ?
          AND pt.Id_Tour = ?
          AND p.Estado = 'activa'
        ORDER BY p.Confirmado_En DESC, p.Id_Programacion DESC
        `,
        [Fecha, Id_Tour]
    );

    if (!progRows.length) return [];
    const programacionesPorTipo = new Map();
    for (const programacion of progRows) {
        const tipo = programacion.Tipo_Programacion || 'grupal';
        if (!programacionesPorTipo.has(tipo)) programacionesPorTipo.set(tipo, programacion.Id_Programacion);
    }
    const programacionIds = Array.from(programacionesPorTipo.values());

    const [buses] = await db.query(
        `
        SELECT
            pb.Id_Bus_Prog,
            pb.Placa_Display,
            pb.Guia,
            pb.Conductor,
            pb.DNI_Guia,
            pb.DNI_Conductor,
            pb.Pasajeros_Total,
            pb.Orden_Bus,
            COALESCE(pb.Tipo_Bus, 'grupal') AS Tipo_Bus,
            pb.Id_Reserva_Privada
        FROM programacion_buses pb
        WHERE pb.Id_Programacion IN (?)
          AND (
            COALESCE(pb.Tipo_Bus, 'grupal') <> 'privado'
            OR EXISTS (
                SELECT 1
                FROM reservas rp
                INNER JOIN horarios hp ON hp.Id_Horario = rp.Id_Horario
                WHERE rp.Id_Reserva = pb.Id_Reserva_Privada
                  AND hp.Id_Tour = ?
            )
          )
        ORDER BY pb.Orden_Bus ASC, pb.Id_Bus_Prog ASC
        `,
        [programacionIds, Id_Tour]
    );

    if (!buses.length) return [];

    const grupales = buses.filter(bus => bus.Tipo_Bus !== 'privado');
    const privados = buses.filter(bus => bus.Tipo_Bus === 'privado');
    const pasajerosPorBus = new Map();

    if (grupales.length) {
        const [pasajeros] = await db.query(
            `
            SELECT
                pr.Id_Bus_Prog,
                pr.Id_Reserva,
                pr.Nombre_Reportante_Snap AS Nombre_Reportante,
                p.Id_Pasajero,
                p.Nombre_Pasajero,
                p.DNI,
                p.Tipo_Pasajero
            FROM programacion_reservas pr
            INNER JOIN pasajeros p ON p.Id_Reserva = pr.Id_Reserva
            WHERE pr.Id_Bus_Prog IN (?)
              AND p.Confirmacion = 1
            ORDER BY pr.Id_Bus_Prog ASC, pr.Orden_En_Bus ASC, p.Id_Pasajero ASC
            `,
            [grupales.map(bus => bus.Id_Bus_Prog)]
        );
        for (const pasajero of pasajeros || []) {
            if (!pasajerosPorBus.has(pasajero.Id_Bus_Prog)) pasajerosPorBus.set(pasajero.Id_Bus_Prog, []);
            pasajerosPorBus.get(pasajero.Id_Bus_Prog).push(pasajero);
        }
    }

    const privateReservationIds = Array.from(new Set(
        privados.map(bus => String(bus.Id_Reserva_Privada || '').trim()).filter(Boolean)
    ));
    if (privateReservationIds.length) {
        const [pasajerosPrivados] = await db.query(
            `
            SELECT
                p.Id_Reserva,
                r.Nombre_Reportante,
                p.Id_Pasajero,
                p.Nombre_Pasajero,
                p.DNI,
                p.Tipo_Pasajero
            FROM pasajeros p
            INNER JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
            WHERE p.Id_Reserva IN (?)
              AND p.Confirmacion = 1
            ORDER BY p.Id_Reserva ASC, p.Id_Pasajero ASC
            `,
            [privateReservationIds]
        );

        const pasajerosPorReserva = new Map();
        for (const pasajero of pasajerosPrivados || []) {
            const idReserva = String(pasajero.Id_Reserva);
            if (!pasajerosPorReserva.has(idReserva)) pasajerosPorReserva.set(idReserva, []);
            pasajerosPorReserva.get(idReserva).push(pasajero);
        }

        const cursorPorReserva = new Map();
        for (const bus of privados) {
            const idReserva = String(bus.Id_Reserva_Privada || '');
            const todos = pasajerosPorReserva.get(idReserva) || [];
            const cursor = cursorPorReserva.get(idReserva) || 0;
            const cantidad = Math.max(0, Number(bus.Pasajeros_Total || 0));
            pasajerosPorBus.set(bus.Id_Bus_Prog, todos.slice(cursor, cursor + cantidad));
            cursorPorReserva.set(idReserva, cursor + cantidad);
        }
    }

    return buses.map(bus => buildBusStatus({
        Id_Bus_Prog: bus.Id_Bus_Prog,
        Placa_Display: bus.Placa_Display,
        Orden_Bus: bus.Orden_Bus,
        Tipo_Bus: bus.Tipo_Bus || 'grupal',
        Id_Reserva_Privada: bus.Id_Reserva_Privada || null,
        Guia: bus.Guia || null,
        DNI_Guia: bus.DNI_Guia || null,
        Conductor: bus.Conductor || null,
        DNI_Conductor: bus.DNI_Conductor || null,
        pasajeros: pasajerosPorBus.get(bus.Id_Bus_Prog) || []
    }));
}

async function actualizarPersonalBus(idBusProg, campos) {
    const permitidos = {
        Placa_Display: 20,
        Guia: 100,
        Conductor: 100,
        DNI_Conductor: 20,
        DNI_Guia: 20
    };
    const sets = [];
    const params = [];
    const normalizedFields = {};

    for (const [key, maxLength] of Object.entries(permitidos)) {
        if (Object.prototype.hasOwnProperty.call(campos, key)) {
            const value = cleanText(campos[key], maxLength);
            normalizedFields[key] = value;
            sets.push(key === 'Placa_Display'
                ? '`Placa_Display` = COALESCE(?, CONCAT(\'Bus \', Orden_Bus))'
                : `\`${key}\` = ?`);
            params.push(value);
        }
    }
    if (!sets.length) return { affected: 0 };

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [[currentBus]] = await conn.query(
            `
            SELECT pb.*, p.Fecha_Tour
            FROM programacion_buses pb
            INNER JOIN programaciones p ON p.Id_Programacion = pb.Id_Programacion
            WHERE pb.Id_Bus_Prog = ?
            LIMIT 1
            `,
            [idBusProg]
        );
        if (!currentBus) {
            await conn.rollback();
            return { affected: 0 };
        }

        const [sameDateBuses] = await conn.query(
            `
            SELECT pb.Id_Bus_Prog, pb.Placa_Display, pb.Orden_Bus,
                   pb.Guia, pb.DNI_Guia, pb.Conductor, pb.DNI_Conductor
            FROM programacion_buses pb
            INNER JOIN programaciones p ON p.Id_Programacion = pb.Id_Programacion
            WHERE p.Fecha_Tour = ?
              AND p.Estado = 'activa'
            ORDER BY pb.Id_Bus_Prog ASC
            FOR UPDATE
            `,
            [currentBus.Fecha_Tour]
        );

        const lockedCurrent = sameDateBuses.find(bus => Number(bus.Id_Bus_Prog) === Number(idBusProg)) || currentBus;
        const candidate = { ...lockedCurrent, ...normalizedFields };
        const conflicts = findBusAssignmentConflicts(candidate, sameDateBuses, idBusProg);
        if (conflicts.length) {
            throw createServiceError(
                'No se puede guardar: la placa, el guía o el conductor ya están asignados a otro bus en esta fecha.',
                409,
                'DUPLICATE_BUS_ASSIGNMENT',
                conflicts
            );
        }

        params.push(idBusProg);
        const [result] = await conn.query(
            `UPDATE programacion_buses SET ${sets.join(', ')} WHERE Id_Bus_Prog = ?`,
            params
        );
        await conn.commit();
        return { affected: result.affectedRows };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function generarExcelSeguros(filtros, res) {
    const { Id_Tour, Fecha } = filtros;
    if (!Fecha || !Id_Tour) {
        throw createServiceError('Selecciona la fecha y el tour antes de descargar.', 400, 'MISSING_PARAMS');
    }

    const buses = await listarSeguros(filtros);
    if (!buses.length) {
        throw createServiceError('No hay una programación disponible para esta fecha y tour.', 404, 'NO_PROGRAMACION');
    }

    const incompletos = buses.filter(bus => !bus.Datos_Completos);
    if (incompletos.length) {
        throw createServiceError(
            'Completa los datos pendientes antes de descargar el archivo.',
            409,
            'INCOMPLETE_INSURANCE_DATA',
            incompletos.map(bus => ({
                Id_Bus_Prog: bus.Id_Bus_Prog,
                Orden_Bus: bus.Orden_Bus,
                Faltantes: bus.Faltantes
            }))
        );
    }

    const [[tourRow]] = await db.query(
        'SELECT Nombre_Tour FROM tours WHERE Id_Tour = ? LIMIT 1',
        [Id_Tour]
    );
    const nombreTour = tourRow?.Nombre_Tour || 'Tour';
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Maxitours';
    workbook.created = new Date();

    const border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };
    const columns = [
        { header: 'N°', key: 'num', width: 6 },
        { header: 'TIPO', key: 'tipo', width: 14 },
        { header: 'NOMBRE', key: 'nombre', width: 36 },
        { header: 'DNI / PASAPORTE', key: 'dni', width: 22 },
        { header: 'ID RESERVA', key: 'reserva', width: 16 }
    ];

    const consolidatedColumns = [
        { header: 'N°', key: 'num', width: 6 },
        { header: 'BUS', key: 'bus', width: 16 },
        { header: 'PLACA', key: 'placa', width: 18 },
        { header: 'TIPO', key: 'tipo', width: 14 },
        { header: 'NOMBRE', key: 'nombre', width: 36 },
        { header: 'DNI / PASAPORTE', key: 'dni', width: 22 },
        { header: 'ID RESERVA', key: 'reserva', width: 16 }
    ];
    const consolidated = workbook.addWorksheet('Consolidado');
    consolidated.columns = consolidatedColumns;
    consolidated.views = [{ state: 'frozen', ySplit: 2 }];
    consolidated.autoFilter = { from: 'A2', to: 'G2' };
    consolidated.mergeCells('A1:G1');
    const consolidatedTitle = consolidated.getCell('A1');
    consolidatedTitle.value = `${nombreTour} · ${Fecha} · Consolidado de todos los buses`;
    consolidatedTitle.font = { bold: true, size: 13, color: { argb: 'FF111827' } };
    consolidatedTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    consolidatedTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    consolidatedTitle.border = border;
    consolidated.getRow(1).height = 25;
    const consolidatedHeader = consolidated.getRow(2);
    consolidatedHeader.values = consolidatedColumns.map(column => column.header);
    consolidatedHeader.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = border;
    });
    const consolidatedRows = buildConsolidatedRows(buses);
    consolidatedRows.forEach((registro, index) => {
        const row = consolidated.getRow(index + 3);
        row.values = [index + 1, registro.bus, registro.placa, registro.tipo, registro.nombre, registro.dni, registro.reserva];
        row.eachCell({ includeEmpty: true }, cell => {
            cell.border = border;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        });
        row.getCell(5).alignment = { vertical: 'middle', horizontal: 'left' };
        row.height = 19;
    });
    const consolidatedTotalRow = consolidatedRows.length + 3;
    consolidated.mergeCells(`A${consolidatedTotalRow}:B${consolidatedTotalRow}`);
    consolidated.getCell(`A${consolidatedTotalRow}`).value = 'Total asegurados';
    consolidated.getCell(`A${consolidatedTotalRow}`).font = { bold: true };
    consolidated.getCell(`A${consolidatedTotalRow}`).border = border;
    consolidated.getCell(`C${consolidatedTotalRow}`).value = consolidatedRows.length;
    consolidated.getCell(`C${consolidatedTotalRow}`).font = { bold: true };
    consolidated.getCell(`C${consolidatedTotalRow}`).border = border;
    consolidated.getCell(`C${consolidatedTotalRow}`).alignment = { horizontal: 'center' };

    for (const bus of buses) {
        const plate = String(bus.Placa_Display || '').trim();
        const suffix = plate && !/^bus\s+\d+$/i.test(plate) ? ` - ${plate}` : '';
        const busLabel = bus.Tipo_Bus === 'privado' ? `Privado ${bus.Orden_Bus}` : `Bus ${bus.Orden_Bus}`;
        const ws = workbook.addWorksheet(`${busLabel}${suffix}`.substring(0, 31));
        ws.columns = columns;
        ws.views = [{ state: 'frozen', ySplit: 2 }];
        ws.autoFilter = { from: 'A2', to: 'E2' };

        ws.mergeCells('A1:E1');
        const title = ws.getCell('A1');
        title.value = `${nombreTour} · ${Fecha} · ${busLabel}${suffix}`;
        title.font = { bold: true, size: 13, color: { argb: 'FF111827' } };
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        title.alignment = { horizontal: 'center', vertical: 'middle' };
        title.border = border;
        ws.getRow(1).height = 25;

        const header = ws.getRow(2);
        header.values = columns.map(column => column.header);
        header.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = border;
        });

        const registros = buildInsuranceRows(bus);

        registros.forEach((registro, index) => {
            const row = ws.getRow(index + 3);
            row.values = [index + 1, registro.tipo, registro.nombre, registro.dni, registro.reserva];
            row.eachCell({ includeEmpty: true }, cell => {
                cell.border = border;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            });
            row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
            row.height = 19;
        });

        const totalRowNumber = registros.length + 3;
        ws.mergeCells(`A${totalRowNumber}:B${totalRowNumber}`);
        ws.getCell(`A${totalRowNumber}`).value = 'Total asegurados';
        ws.getCell(`A${totalRowNumber}`).font = { bold: true };
        ws.getCell(`A${totalRowNumber}`).border = border;
        ws.getCell(`C${totalRowNumber}`).value = registros.length;
        ws.getCell(`C${totalRowNumber}`).font = { bold: true };
        ws.getCell(`C${totalRowNumber}`).border = border;
        ws.getCell(`C${totalRowNumber}`).alignment = { horizontal: 'center' };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Seguros_${Fecha}_Tour${Id_Tour}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    listarSeguros,
    actualizarPersonalBus,
    generarExcelSeguros,
    buildBusStatus,
    findBusAssignmentConflicts,
    buildConsolidatedRows
};
