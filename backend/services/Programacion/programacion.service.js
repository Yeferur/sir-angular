const db = require('../../database/db'); // Asegúrate de que la ruta a tu conexión de DB sea correcta
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');

// =================================================================
// --- CONFIGURACIÓN Y CACHÉ GLOBAL ---
// =================================================================
const CONFIG = {
    CAPACIDADES_BUSES: [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b), // Ordenar de menor a mayor
    PUNTO_BASE: { lat: 6.212757856694648, lon: -75.57759200491337, NombrePunto: 'Punto Base' },
    GRAFO_PATH: 'grafo_antioquia.json',
};

// =================================================================
// --- FUNCIONES DE UTILIDAD Y DATOS (Optimizadas) ---
// =================================================================
async function obtenerReservas(fecha, idsTours) {
    // Normalizar a array si viene un solo ID
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];

    const sql = `
        SELECT
            r.Id_Reserva,
            h.Id_Tour,
            r.Fecha_Tour,
            r.Estado,
            r.Tipo_Reserva,
            COUNT(p.Id_Pasajero) AS NumeroPasajeros,
            MIN(p.Id_Punto) AS Id_Punto,
            MIN(pt.Nombre_Punto) AS NombrePunto,
            MIN(pt.Latitud) AS Latitud,
            MIN(pt.Longitud) AS Longitud
        FROM reservas r
        INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
        INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
        WHERE r.Fecha_Tour = ?
          AND h.Id_Tour IN (?)
          AND r.Estado NOT IN ('Cancelada', 'Rechazada')
          AND r.Tipo_Reserva = 'Grupal'
        GROUP BY r.Id_Reserva, h.Id_Tour, r.Fecha_Tour, r.Estado, r.Tipo_Reserva
    `;

    try {
        const [rows] = await db.query(sql, [fecha, tours]);
        return (rows || []).map(r => ({
            ...r,
            NumeroPasajeros: parseInt(r.NumeroPasajeros, 10),
            Latitud: r.Latitud !== null && r.Latitud !== undefined ? Number(r.Latitud) : null,
            Longitud: r.Longitud !== null && r.Longitud !== undefined ? Number(r.Longitud) : null,
        }));
    } catch (error) {
        console.error("Error al obtener reservas:", error);
        throw new Error("Fallo al contactar la base de datos de reservas.");
    }
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
    const tieneCoords = (v) => Number.isFinite(Number(v));
    if (!tieneCoords(lat1) || !tieneCoords(lon1) || !tieneCoords(lat2) || !tieneCoords(lon2)) {
        return Number.MAX_VALUE;
    }

    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(Number(lat2) - Number(lat1));
    const dLon = toRad(Number(lon2) - Number(lon1));
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function generarPlanLogistico(fecha, idsTours) {
    try {
        const reservas = await obtenerReservas(fecha, idsTours);
        const reservasPendientes = [...reservas];
        if (reservasPendientes.length === 0) return [];

        const buses = [];
        let contadorBus = 1;
        const CAPACIDAD_BUS = 38;

        while (reservasPendientes.length > 0) {
            let idxSemilla = 0;
            for (let i = 1; i < reservasPendientes.length; i++) {
                const paxActual = Number(reservasPendientes[i].NumeroPasajeros || 0);
                const paxSemilla = Number(reservasPendientes[idxSemilla].NumeroPasajeros || 0);
                if (paxActual > paxSemilla) {
                    idxSemilla = i;
                }
            }

            const [reservaSemilla] = reservasPendientes.splice(idxSemilla, 1);
            const nuevoBus = {
                id: `Bus ${contadorBus}`,
                capacidad: CAPACIDAD_BUS,
                ocupados: Number(reservaSemilla.NumeroPasajeros || 0),
                reservas: [reservaSemilla],
                guia: ''
            };

            let referencia = reservaSemilla;

            while (nuevoBus.ocupados < CAPACIDAD_BUS) {
                const espacioRestante = CAPACIDAD_BUS - nuevoBus.ocupados;
                let mejorIdx = -1;
                let mejorDistancia = Number.MAX_VALUE;
                let mejorPax = -1;

                for (let i = 0; i < reservasPendientes.length; i++) {
                    const candidata = reservasPendientes[i];
                    const pax = Number(candidata.NumeroPasajeros || 0);
                    if (pax > espacioRestante) continue;

                    const distancia = calcularDistancia(
                        referencia.Latitud,
                        referencia.Longitud,
                        candidata.Latitud,
                        candidata.Longitud
                    );

                    if (
                        distancia < mejorDistancia ||
                        (distancia === mejorDistancia && pax > mejorPax)
                    ) {
                        mejorDistancia = distancia;
                        mejorPax = pax;
                        mejorIdx = i;
                    }
                }

                if (mejorIdx === -1) break;

                const [reservaSeleccionada] = reservasPendientes.splice(mejorIdx, 1);
                nuevoBus.reservas.push(reservaSeleccionada);
                nuevoBus.ocupados += Number(reservaSeleccionada.NumeroPasajeros || 0);
                referencia = reservaSeleccionada;
            }

            buses.push(nuevoBus);
            contadorBus += 1;
        }

        return buses;

    } catch (error) {
        console.error("Fallo crítico en la generación del plan logístico:", error);
        throw new Error(error.message || "Ocurrió un error inesperado al procesar la solicitud.");
    }
}

async function guardarListadoFinal({ fecha, idsTours, buses }) {
    if (!fecha || !idsTours || !Array.isArray(buses)) {
        throw new Error('Datos inválidos para guardar el listado.');
    }

    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];
    // Usamos el primer ID como "principal" para asociar la asignación (o el 5 si está presente, pero simplifiquemos a el primero)
    // O mejor, guardamos en `Id_Tour` el ID del primer tour, pero limpiamos para TODOS.
    // IMPORTANTE: Si es 1 y 5, guardaremos bajo 5 (si viene [1, 5] el "principal" podría ser cualquiera, 
    // pero para consistencia usemos el mayor o el que venga definido).
    // Asumiremos que el frontend envíaIdsTours. El backend asociará al primer ID del array como referencia.
    const primaryTourId = tours.includes(5) ? 5 : tours[0];

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Limpiar asignaciones en reservas para TODOS los tours involucrados
        await conn.query(
            `
            UPDATE reservas r
            JOIN horarios h ON h.Id_Horario = r.Id_Horario
            SET r.Placa_Bus = NULL, r.Orden_Ruta = NULL
            WHERE r.Fecha_Tour = ? AND h.Id_Tour IN (?)
            `,
            [fecha, tours]
        );

        // 2. Eliminar asignaciones de buses previas (del ID principal y posibles secundarios si existieran "huerfanos")
        // Para evitar duplicados, borramos de todos los IDs involucrados
        await conn.query(
            `
            DELETE FROM asignacion_buses
            WHERE Id_Tour IN (?) AND DATE(Fecha_Creacion) = DATE(?)
            `,
            [tours, fecha]
        );

        const fechaCreacion = `${fecha} 00:00:00`;
        let reservasActualizadas = 0;
        const updatesMasivos = [];

        for (let i = 0; i < buses.length; i++) {
            const bus = buses[i] || {};
            const placa = String(bus.id || '').trim() || `Bus ${i + 1}`;
            const capacidad = Number(bus.capacidad || 0);
            const cantidad = Number(bus.ocupados || 0);
            const guia = bus.guia ? String(bus.guia).trim() : null;

            // Insertar SIEMPRE asociado al primaryTourId para mantener un "owner" del plan
            await conn.query(
                `
                INSERT INTO asignacion_buses
                (Placa_Bus, Capacidad, Cantidad_Pasajeros, Guia, Id_Tour, Fecha_Creacion)
                VALUES (?, ?, ?, ?, ?, ?)
                `,
                [placa, capacidad, cantidad, guia || null, primaryTourId, fechaCreacion]
            );

            if (Array.isArray(bus.reservas)) {
                for (let r = 0; r < bus.reservas.length; r++) {
                    const reserva = bus.reservas[r];
                    const idReserva = reserva?.Id_Reserva;
                    if (!idReserva) continue;

                    updatesMasivos.push([idReserva, placa, r + 1]);
                    reservasActualizadas += 1;
                }
            }
        }

        if (updatesMasivos.length > 0) {
            const valuesSql = updatesMasivos.map(() => '(?, ?, ?)').join(', ');
            const params = updatesMasivos.flat();
            await conn.query(
                `INSERT INTO reservas (Id_Reserva, Placa_Bus, Orden_Ruta)
                 VALUES ${valuesSql}
                 ON DUPLICATE KEY UPDATE
                    Placa_Bus = VALUES(Placa_Bus),
                    Orden_Ruta = VALUES(Orden_Ruta)`,
                params
            );
        }

        await conn.commit();
        return { ok: true, buses: buses.length, reservas: reservasActualizadas };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function obtenerListadoFinal({ fecha, idsTours }) {
    if (!fecha || !idsTours) {
        throw new Error('Datos inválidos para consultar el listado.');
    }

    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];

    const [busesRows] = await db.query(
        `
        SELECT Id_Asignacion, Placa_Bus, Capacidad, Cantidad_Pasajeros, Guia
        FROM asignacion_buses
        WHERE Id_Tour IN (?) AND DATE(Fecha_Creacion) = DATE(?)
        ORDER BY Id_Asignacion ASC
        `,
        [tours, fecha]
    );

    if (!busesRows.length) {
        return { exists: false, buses: [], reservasSinAsignar: [] };
    }

    const reservas = await obtenerReservasConPlaca(fecha, tours);
    const placasSet = new Set(
        busesRows
            .map(b => (b.Placa_Bus ? String(b.Placa_Bus).trim() : ''))
            .filter(Boolean)
    );

    const reservasPorPlaca = new Map();
    const reservasSinAsignar = [];

    for (const r of reservas) {
        const placa = r.Placa_Bus ? String(r.Placa_Bus).trim() : '';
        if (!placa || !placasSet.has(placa)) {
            reservasSinAsignar.push(r);
            continue;
        }
        if (!reservasPorPlaca.has(placa)) reservasPorPlaca.set(placa, []);
        reservasPorPlaca.get(placa).push(r);
    }

    const buses = busesRows.map((row, index) => {
        const placa = row.Placa_Bus ? String(row.Placa_Bus).trim() : `Bus ${index + 1}`;
        const reservasBus = reservasPorPlaca.get(placa) || [];
        reservasBus.sort((a, b) => (a.Orden_Ruta || 0) - (b.Orden_Ruta || 0));

        const ocupados = reservasBus.reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);

        return {
            id: placa,
            capacidad: Number(row.Capacidad || 0),
            ocupados,
            reservas: reservasBus,
            recorridoKm: 0,
            guia: row.Guia || ''
        };
    });

    return {
        exists: true,
        buses,
        reservasSinAsignar
    };
}

module.exports = {
    generarPlanLogistico,
    generarExcelListadoBus,
    guardarListadoFinal,
    obtenerListadoFinal
};

/**
 * Genera un archivo Excel para un listado de un bus específico.
 * Estructura similar al exportador existente, adaptada a nuestros datos.
 * @param {Object} params
 * @param {string} params.fecha
 * @param {number} params.idTour
 * @param {Object} params.bus - Bus con reservas del plan
 * @param {string} [params.nombreTour]
 * @returns {Promise<Buffer>} Buffer XLSX
 */
async function generarExcelListadoBus({ fecha, idTour, bus, nombreTour }) {
    if (!bus || !Array.isArray(bus.reservas) || bus.reservas.length === 0) {
        throw new Error('El bus no contiene reservas para exportar.');
    }

    const reservaIds = bus.reservas.map(r => r.Id_Reserva).filter(Boolean);
    if (reservaIds.length === 0) throw new Error('No se encontraron Id_Reserva válidos en el bus.');

    // Consulta principal de reservas con datos básicos y conteo de pasajeros
    const reservasSql = `
        SELECT 
            r.Id_Reserva,
            r.Estado,
            r.Tipo_Reserva,
            r.Fecha_Tour,
            r.Idioma_Reserva AS IdiomaReserva,
            r.Nombre_Reportante AS NombreReporta,
            r.Observaciones,
            COUNT(p.Id_Pasajero) AS NumeroPasajeros,
            pt.Nombre_Punto AS PuntoEncuentro
        FROM reservas r
        LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
        WHERE r.Id_Reserva IN (${reservaIds.map(() => '?').join(',')})
        GROUP BY r.Id_Reserva
    `;

    // Consulta de pasajeros agregados por reserva
    const pasajerosSql = `
        SELECT 
            Id_Reserva,
            GROUP_CONCAT(Nombre_Pasajero SEPARATOR ', ') AS Nombre_Pasajero,
            GROUP_CONCAT(DNI SEPARATOR ', ') AS DNI,
            GROUP_CONCAT(Telefono_Pasajero SEPARATOR ', ') AS Telefono_Pasajero
        FROM pasajeros
        WHERE Id_Reserva IN (${reservaIds.map(() => '?').join(',')})
        GROUP BY Id_Reserva
    `;

    let reservasRows = [];
    let pasajerosRows = [];
    try {
        const [rRows] = await db.query(reservasSql, reservaIds);
        reservasRows = rRows || [];
        const [pRows] = await db.query(pasajerosSql, reservaIds);
        pasajerosRows = pRows || [];
    } catch (err) {
        console.error('Error DB al preparar datos de listado:', err);
        throw new Error('Fallo al obtener datos para el listado.');
    }

    const pasajerosIndex = new Map(pasajerosRows.map(x => [x.Id_Reserva, x]));
    const reservasIndex = new Map((reservasRows || []).map(x => [x.Id_Reserva, x]));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('LISTADO');

    const borderThin = { style: 'thin' };

    // Definir columnas similares (solo las que garantizamos)
    const columns = [
        { header: 'NOMBRE DEL PASAJERO', key: 'NombrePasajero', width: 40 },
        { header: 'DNI/PASAPORTE', key: 'IdPas', width: 16 },
        { header: 'TELEFONO', key: 'TelefonoPasajero', width: 18 },
        { header: '# PAX', key: 'NumeroPasajeros', width: 10 },
        { header: 'PUNTO DE ENCUENTRO', key: 'PuntoEncuentro', width: 24 },
        { header: 'OBSERVACIONES', key: 'Observaciones', width: 30 },
        { header: 'IDIOMA', key: 'IdiomaReserva', width: 12 },
        { header: 'TIPO DE RESERVA', key: 'Tipo_Reserva', width: 18 },
        { header: 'ESTADO DE RESERVA', key: 'Estado', width: 18 },
    ];

    worksheet.columns = columns;

    // Fila 1: Fecha y Tour
    const fechaTour = fecha ? `Fecha: ${fecha}` : 'Fecha: N/A';
    const nombre = nombreTour ? nombreTour : 'Tour';
    const headerRowDate = worksheet.getCell(1, 1);
    headerRowDate.value = fechaTour;
    headerRowDate.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRowDate.font = { bold: true };
    headerRowDate.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
    headerRowDate.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

    const richText = [];
    const texto = nombre;
    if (texto.includes('RIO CLARO')) {
        const parts = texto.split('RIO CLARO');
        if (parts[0]) richText.push({ text: parts[0], font: { bold: true } });
        richText.push({ text: 'RIO CLARO', font: { bold: true, color: { argb: 'FF00FF00' } } });
        if (parts[1]) richText.push({ text: parts[1], font: { bold: true } });
    } else {
        richText.push({ text: texto, font: { bold: true } });
    }
    const headerRowTour = worksheet.getCell(1, 2);
    headerRowTour.value = { richText };
    worksheet.mergeCells(1, 2, 1, columns.length);
    headerRowTour.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRowTour.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

    // Fila 2: encabezados
    const headerRow2 = worksheet.getRow(2);
    headerRow2.values = columns.map(col => col.header);
    headerRow2.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    });

    let totalPasajeros = 0;

    // Agregar filas por reserva respetando el orden de bus.reservas (reservaIds)
    for (const id of reservaIds) {
        const r = reservasIndex.get(id);
        if (!r) continue; // Saltar si por alguna razón la reserva no vino en la consulta

        const paxAgg = pasajerosIndex.get(r.Id_Reserva) || {};
        const nombres = paxAgg.Nombre_Pasajero ? String(paxAgg.Nombre_Pasajero).split(', ') : [''];
        const ids = paxAgg.DNI ? String(paxAgg.DNI).split(', ') : [''];
        const tels = paxAgg.Telefono_Pasajero ? String(paxAgg.Telefono_Pasajero).split(', ') : [''];

        const startRow = worksheet.rowCount + 1;
        nombres.forEach((nombre, idx) => {
            const data = {
                NombrePasajero: nombre,
                IdPas: ids[idx] || '',
                TelefonoPasajero: tels[idx] || '',
            };
            if (idx === 0) {
                Object.assign(data, {
                    NumeroPasajeros: r.NumeroPasajeros || 0,
                    PuntoEncuentro: r.PuntoEncuentro || '',
                    Observaciones: r.Observaciones || '',
                    IdiomaReserva: r.IdiomaReserva || '',
                    Tipo_Reserva: r.Tipo_Reserva || '',
                    Estado: r.Estado || '',
                });
            }
            worksheet.addRow(data);
        });
        const endRow = worksheet.rowCount;
        // Merge columnas para datos comunes
        worksheet.mergeCells(`D${startRow}:D${endRow}`);
        worksheet.mergeCells(`E${startRow}:E${endRow}`);
        worksheet.mergeCells(`F${startRow}:F${endRow}`);
        worksheet.mergeCells(`G${startRow}:G${endRow}`);
        worksheet.mergeCells(`H${startRow}:H${endRow}`);
        worksheet.mergeCells(`I${startRow}:I${endRow}`);
        aplicarBordesBloque(worksheet, startRow, endRow, 1, columns.length);

        totalPasajeros += parseInt(r.NumeroPasajeros || 0, 10);
    }

    // Fila total de pasajeros
    const totalRowIndex = worksheet.rowCount + 1;
    const totalRow = worksheet.getRow(totalRowIndex);
    totalRow.getCell(4).value = totalPasajeros;
    totalRow.getCell(4).font = { bold: true };
    totalRow.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
    totalRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    totalRow.getCell(4).border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    totalRow.getCell(1).value = 'Total de Pasajeros';
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    totalRow.getCell(1).border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    totalRow.height = 20;

    worksheet.eachRow(row => { row.alignment = { vertical: 'middle', horizontal: 'center' }; });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}

function aplicarBordesBloque(worksheet, startRow, endRow, startColumn, endColumn) {
    for (let row = startRow; row <= endRow; row++) {
        for (let col = startColumn; col <= endColumn; col++) {
            const cell = worksheet.getCell(row, col);
            cell.border = {
                left: { style: 'thin' },
                right: { style: 'thin' },
                ...(row === startRow ? { top: { style: 'thin' } } : {}),
                ...(row === endRow ? { bottom: { style: 'thin' } } : {}),
            };
        }
    }
}

async function obtenerReservasConPlaca(fecha, idsTours) {
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];

    const sql = `
        SELECT r.Id_Reserva, h.Id_Tour, r.Fecha_Tour, r.Estado, r.Tipo_Reserva,
             r.Placa_Bus, r.Orden_Ruta,
             COUNT(p.Id_Pasajero) AS NumeroPasajeros,
             MIN(p.Id_Punto) AS Id_Punto,
             MIN(pt.Latitud) AS Latitud, MIN(pt.Longitud) AS Longitud, MIN(pt.Nombre_Punto) AS NombrePunto
        FROM reservas r
        LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
        JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
        WHERE r.Fecha_Tour = ? AND h.Id_Tour IN (?)
        AND r.Estado IN ('Pendiente', 'Confirmada', 'PendienteDatos', 'Completada')
        AND r.Tipo_Reserva = 'Grupal'
        GROUP BY r.Id_Reserva
    `;
    try {
        const [rows] = await db.query(sql, [fecha, tours]);
        return rows.map(r => ({
            ...r,
            NumeroPasajeros: parseInt(r.NumeroPasajeros, 10),
            Latitud: r.Latitud ? parseFloat(r.Latitud) : null,
            Longitud: r.Longitud ? parseFloat(r.Longitud) : null,
            Placa_Bus: r.Placa_Bus ? String(r.Placa_Bus).trim() : null,
            Orden_Ruta: r.Orden_Ruta ? Number(r.Orden_Ruta) : null
        }));
    } catch (error) {
        console.error("Error al obtener reservas con placa:", error);
        throw new Error("Fallo al contactar la base de datos de reservas.");
    }
}