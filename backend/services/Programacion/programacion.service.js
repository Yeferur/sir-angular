const db = require('../../database/db'); // Asegúrate de que la ruta a tu conexión de DB sea correcta
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');

// =================================================================
// --- CONFIGURACIÓN Y CACHÉ GLOBAL ---
// =================================================================
const CONFIG = {
    CAPACIDADES_BUSES: [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a,b) => a - b), // Ordenar de menor a mayor
    PUNTO_BASE: { lat: 6.212757856694648, lon: -75.57759200491337, NombrePunto: 'Punto Base' },
    GRAFO_PATH: 'grafo_antioquia.json',
};

const R_TIERRA = 6371;
let grafoCache = null;

// =================================================================
// --- FUNCIONES DE UTILIDAD Y DATOS (Optimizadas) ---
// =================================================================
async function obtenerReservas(fecha, idTour) {
        // Adaptado a la nueva estructura: pasajeros por reserva, puntos por pasajero
        // Se agrupa por reserva y se cuenta el número de pasajeros
        const sql = `
            SELECT r.Id_Reserva, h.Id_Tour, r.Fecha_Tour, r.Estado, r.Tipo_Reserva,
                         COUNT(p.Id_Pasajero) AS NumeroPasajeros,
                         MIN(p.Id_Punto) AS Id_Punto, -- Tomamos el primer punto de los pasajeros
                         MIN(pt.Latitud) AS Latitud, MIN(pt.Longitud) AS Longitud, MIN(pt.Nombre_Punto) AS NombrePunto
            FROM reservas r
            LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
            JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
            LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
            WHERE r.Fecha_Tour = ? AND h.Id_Tour = ?
                AND r.Estado IN ('Pendiente', 'Confirmada', 'PendienteDatos', 'Completada')
                AND r.Tipo_Reserva = 'Grupal'
            GROUP BY r.Id_Reserva
        `;
        try {
                const [rows] = await db.query(sql, [fecha, idTour]);
                return rows.map(r => ({
                        ...r,
                        NumeroPasajeros: parseInt(r.NumeroPasajeros, 10),
                        Latitud: r.Latitud ? parseFloat(r.Latitud) : null,
                        Longitud: r.Longitud ? parseFloat(r.Longitud) : null
                }));
        } catch (error) {
                console.error("Error al obtener reservas:", error);
                throw new Error("Fallo al contactar la base de datos de reservas.");
        }
}

function haversine(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R_TIERRA * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =================================================================
// --- NÚCLEO DE LA LÓGICA DE CLUSTERING ---
// =================================================================

/**
 * Agrupa las reservas en clusters geográficos, donde cada cluster representa la ruta de un bus.
 * @param {Array<Object>} reservas - Todas las reservas a planificar.
 * @returns {Array<Object>} Un array de clusters, cada uno con sus reservas y total de pasajeros.
 */
// En la función crearClustersDeRutas, la corrección es esta:
function dbscan(reservas, epsKm, minPts) {
    const clusters = [];
    const visited = new Set();
    const assigned = new Map();

    function regionQuery(p) {
        const vecinos = [];
        for (const q of reservas) {
            if (haversine(p.Latitud, p.Longitud, q.Latitud, q.Longitud) <= epsKm) {
                vecinos.push(q);
            }
        }
        return vecinos;
    }

    function expandCluster(p, vecinos, cluster) {
        cluster.push(p);
        assigned.set(p, cluster);

        for (let i = 0; i < vecinos.length; i++) {
            const v = vecinos[i];
            if (!visited.has(v)) {
                visited.add(v);
                const vecinosV = regionQuery(v);
                if (vecinosV.length >= minPts) {
                    vecinos.push(...vecinosV.filter(x => !vecinos.includes(x)));
                }
            }
            if (!assigned.has(v)) {
                cluster.push(v);
                assigned.set(v, cluster);
            }
        }
    }

    for (const p of reservas) {
        if (visited.has(p)) continue;
        visited.add(p);

        const vecinos = regionQuery(p);
        if (vecinos.length < minPts) {
            clusters.push([p]);
            assigned.set(p, [p]);
        } else {
            const cluster = [];
            expandCluster(p, vecinos, cluster);
            clusters.push(cluster);
        }
    }

    return clusters;
}

function crearClustersDeRutas(reservas) {
    const zonas = dbscan(reservas, 1.5, 2);
    const clustersFinales = [];

    for (const zona of zonas) {
        const pendientes = new Set(zona);

        while (pendientes.size > 0) {
            let seed = null;
            let minDist = Infinity;

            for (const r of pendientes) {
                const d = haversine(CONFIG.PUNTO_BASE.lat, CONFIG.PUNTO_BASE.lon, r.Latitud, r.Longitud);
                if (d < minDist) {
                    minDist = d;
                    seed = r;
                }
            }

            if (!seed) break;

            const cluster = {
                reservas: [seed],
                totalPasajeros: seed.NumeroPasajeros
            };

            pendientes.delete(seed);
            let ultimo = seed;

            let crecer = true;
            while (crecer && pendientes.size > 0) {
                let siguiente = null;
                let mejorScore = Infinity;

                for (const r of pendientes) {
                    const nuevaCarga = cluster.totalPasajeros + r.NumeroPasajeros;
                    const busDisponible = CONFIG.CAPACIDADES_BUSES.find(c => c >= nuevaCarga);
                    if (!busDisponible) continue;

                    const d = haversine(ultimo.Latitud, ultimo.Longitud, r.Latitud, r.Longitud);
                    const desperdicio = busDisponible - nuevaCarga;
                    const score = d + desperdicio * 0.05;

                    if (score < mejorScore) {
                        mejorScore = score;
                        siguiente = r;
                    }
                }

                if (siguiente) {
                    cluster.reservas.push(siguiente);
                    cluster.totalPasajeros += siguiente.NumeroPasajeros;
                    pendientes.delete(siguiente);
                    ultimo = siguiente;
                } else {
                    crecer = false;
                }
            }

            clustersFinales.push(cluster);
        }
    }

    return clustersFinales;
}



/**
 * Asigna el bus más pequeño y eficiente que pueda manejar la carga de pasajeros de un cluster.
 * @param {number} totalPasajeros - El número de pasajeros en el cluster.
 * @returns {number|null} La capacidad del bus ideal, o null si ninguno es suficientemente grande.
 */
function asignarMejorBus(totalPasajeros) {
    for (const capacidad of CONFIG.CAPACIDADES_BUSES) {
        if (capacidad >= totalPasajeros) {
            return capacidad;
        }
    }
    // Esto solo ocurriría si un solo grupo de reserva excede la capacidad máxima,
    // lo cual debería ser validado en la entrada de datos.
    return null;
}

/**
 * Optimiza el orden de las paradas de un bus usando el algoritmo 2-opt para rutas más cortas.
 * @param {Array<Object>} paradas - Las paradas (reservas) asignadas a un bus.
 * @returns {Array<Object>} Las paradas en un orden de ruta optimizado.
 */
function optimizarRuta2Opt(paradas) {
    if (paradas.length < 3) return paradas;
    
    let rutaActual = [CONFIG.PUNTO_BASE, ...paradas];
    let mejora = true;

    while (mejora) {
        mejora = false;
        for (let i = 1; i < rutaActual.length - 2; i++) {
            for (let k = i + 1; k < rutaActual.length - 1; k++) {
                const p1 = rutaActual[i-1], p2 = rutaActual[i];
                const p3 = rutaActual[k], p4 = rutaActual[k+1];

                const distOriginal = haversine(p1.Latitud, p1.Longitud, p2.Latitud, p2.Longitud) + haversine(p3.Latitud, p3.Longitud, p4.Latitud, p4.Longitud);
                const distNueva = haversine(p1.Latitud, p1.Longitud, p3.Latitud, p3.Longitud) + haversine(p2.Latitud, p2.Longitud, p4.Latitud, p4.Longitud);

                if (distNueva < distOriginal) {
                    const segmentoInvertido = rutaActual.slice(i, k + 1).reverse();
                    rutaActual = [...rutaActual.slice(0, i), ...segmentoInvertido, ...rutaActual.slice(k + 1)];
                    mejora = true;
                }
            }
        }
    }
    return rutaActual.slice(1); // Remover el punto base del inicio
}


async function generarPlanLogistico(fecha, idTour) {
    try {
        const reservas = await obtenerReservas(fecha, idTour);
        if (reservas.length === 0) {
            return { analisis: { fecha, idTour, totalPasajeros: 0, totalReservas: 0 }, sugerencias: [], mensaje: "No hay pasajeros para planificar." };
        }

        const totalPasajeros = reservas.reduce((sum, r) => sum + r.NumeroPasajeros, 0);

        // 1. Agrupar todas las reservas en clusters geográficos
        const clusters = crearClustersDeRutas(reservas);

        // 2. Procesar cada cluster en paralelo para asignarle un bus y optimizar su ruta
        const promesasDeBuses = clusters.map(async (cluster, index) => {
            const capacidadBus = asignarMejorBus(cluster.totalPasajeros);
            if (!capacidadBus) {
                // Devolver un error si un cluster no puede ser atendido
                return { error: `El cluster ${index+1} con ${cluster.totalPasajeros} pasajeros excede la capacidad máxima de los buses.` };
            }

            const rutaOptimizada = optimizarRuta2Opt(cluster.reservas);
            
            let distanciaRuta = 0;
            let puntoAnterior = { lat: CONFIG.PUNTO_BASE.lat, lon: CONFIG.PUNTO_BASE.lon };
            for(const parada of rutaOptimizada) {
                distanciaRuta += haversine(puntoAnterior.lat, puntoAnterior.lon, parada.Latitud, parada.Longitud);
                puntoAnterior = { lat: parada.Latitud, lon: parada.Longitud };
            }
            
            return {
                capacidad: capacidadBus,
                ocupados: cluster.totalPasajeros,
                porcentajeOcupacion: ((cluster.totalPasajeros / capacidadBus) * 100).toFixed(1) + '%',
                reservas: rutaOptimizada,
                distanciaKm: parseFloat(distanciaRuta.toFixed(2))
            };
        });

        const busesListos = await Promise.all(promesasDeBuses);
        
        // Manejar posibles errores de asignación
        const busesConError = busesListos.filter(b => b.error);
        if (busesConError.length > 0) {
            const mensajeError = busesConError.map(b => b.error).join('; ');
            throw new Error(mensajeError);
        }

        // 3. Consolidar los resultados en la sugerencia final
        const sugerenciaFinal = {
            combinacion: busesListos.map(b => b.capacidad).sort((a,b) => a - b),
            buses: busesListos,
            totalBuses: busesListos.length,
            distanciaTotalKm: parseFloat(busesListos.reduce((sum, b) => sum + b.distanciaKm, 0).toFixed(2))
        };
        
        sugerenciaFinal.buses.sort((a,b) => a.distanciaKm - b.distanciaKm);

        return {
            analisis: { fecha, idTour, totalPasajeros, totalReservas: reservas.length },
            sugerencias: [sugerenciaFinal], // Se genera una única solución optimizada
            mensaje: `Se generó un plan logístico óptimo con ${sugerenciaFinal.totalBuses} buses.`
        };

    } catch (error) {
        console.error("Fallo crítico en la generación del plan logístico:", error);
        return { error: true, sugerencias: [], mensaje: error.message || "Ocurrió un error inesperado al procesar la solicitud." };
    }
}

module.exports = {
    generarPlanLogistico,
    generarExcelListadoBus
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