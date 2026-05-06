const db = require('../../database/db'); // Asegúrate de que la ruta a tu conexión de DB sea correcta
const fs = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');
const { recordHistorial } = require('../Historial/logger');

// =================================================================
// --- CONFIGURACIÓN Y CACHÉ GLOBAL ---
// =================================================================
const CONFIG = {
    CAPACIDADES_BUSES: [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b), // Ordenar de menor a mayor
    PUNTO_BASE: { lat: 6.212757856694648, lon: -75.57759200491337, NombrePunto: 'Punto Base' },
    GRAFO_PATH: 'grafo_antioquia.json',
};
const ORDEN_RUTAS_EMPRESA = [0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 7, 8, 9, 14];

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
            MIN(pt.Longitud) AS Longitud,
            MIN(pt.ruta) AS ruta,
            MIN(pt.posicion) AS ordenRuta,
            MIN(pt.posicion) AS Posicion
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
            ruta: r.ruta || null,
            ordenRuta: r.ordenRuta !== null && r.ordenRuta !== undefined ? Number(r.ordenRuta) : null,
            Orden_Ruta: r.ordenRuta !== null && r.ordenRuta !== undefined ? Number(r.ordenRuta) : null,
            Posicion: r.Posicion !== null && r.Posicion !== undefined ? Number(r.Posicion) : null,
        }));
    } catch (error) {
        console.error("Error al obtener reservas:", error);
        throw new Error("Fallo al contactar la base de datos de reservas.");
    }
}

function getPointKey(reserva) {
    const id = reserva.Id_Punto || reserva.idPunto || reserva.IdPunto;
    if (id) return `punto-${id}`;
    const nombre = String(reserva.NombrePunto || reserva.PuntoEncuentro || 'SIN_PUNTO').trim().toUpperCase();
    return `nombre-${nombre || 'SIN_PUNTO'}`;
}

function hasValidCoords(item) {
    const lat = Number(item.Latitud);
    const lon = Number(item.Longitud);
    return Number.isFinite(lat) && Number.isFinite(lon);
}

function haversineKm(a, b) {
    if (!hasValidCoords(a) || !hasValidCoords(b)) return Number.POSITIVE_INFINITY;

    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const lat1 = Number(a.Latitud);
    const lon1 = Number(a.Longitud);
    const lat2 = Number(b.Latitud);
    const lon2 = Number(b.Longitud);
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
}

function normalizeRoute(value) {
    const ruta = String(value ?? '').trim().toUpperCase();
    return ruta && ruta !== 'PENDIENTE' ? ruta : '';
}

function getRouteRank(ruta) {
    const raw = String(ruta ?? '').trim();
    if (!raw) return Number.MAX_SAFE_INTEGER;

    const match = raw.match(/\d+/);
    const routeNumber = match ? Number(match[0]) : Number(raw);
    if (!Number.isFinite(routeNumber)) return Number.MAX_SAFE_INTEGER;

    const idx = ORDEN_RUTAS_EMPRESA.indexOf(routeNumber);
    return idx === -1 ? Number.MAX_SAFE_INTEGER - 1 : idx;
}

function getRouteDistanceRank(a, b) {
    const ra = getRouteRank(a?.ruta ?? a);
    const rb = getRouteRank(b?.ruta ?? b);
    const unknownLimit = Number.MAX_SAFE_INTEGER - 1;

    if (ra >= unknownLimit || rb >= unknownLimit) return 999;
    return Math.abs(ra - rb);
}

function getRouteOrder(reserva) {
    const raw = reserva.Orden_Ruta ?? reserva.ordenRuta ?? reserva.Posicion ?? reserva.Orden ?? null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function getReservationPax(reserva) {
    const n = Number(reserva.NumeroPasajeros || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function chooseSmallestCapacity(totalPax) {
    return CONFIG.CAPACIDADES_BUSES.find(capacidad => totalPax <= capacidad) || null;
}

function groupReservationsByPoint(reservas) {
    const stopsMap = new Map();

    for (let index = 0; index < reservas.length; index++) {
        const reserva = reservas[index];
        const key = getPointKey(reserva);
        if (!stopsMap.has(key)) {
            stopsMap.set(key, {
                key,
                Id_Punto: reserva.Id_Punto || reserva.idPunto || reserva.IdPunto || null,
                NombrePunto: reserva.NombrePunto || reserva.PuntoEncuentro || 'SIN_PUNTO',
                ruta: normalizeRoute(reserva.ruta ?? reserva.Ruta),
                ordenRuta: getRouteOrder(reserva),
                Latitud: reserva.Latitud !== null && reserva.Latitud !== undefined ? Number(reserva.Latitud) : null,
                Longitud: reserva.Longitud !== null && reserva.Longitud !== undefined ? Number(reserva.Longitud) : null,
                reservas: [],
                totalPax: 0,
                originalIndex: index
            });
        }

        const stop = stopsMap.get(key);
        stop.reservas.push({ ...reserva, __ordenOriginal: index });
        stop.totalPax += getReservationPax(reserva);

        if (!stop.ruta) stop.ruta = normalizeRoute(reserva.ruta ?? reserva.Ruta);
        if (stop.ordenRuta === null) stop.ordenRuta = getRouteOrder(reserva);
        if (!hasValidCoords(stop) && hasValidCoords(reserva)) {
            stop.Latitud = Number(reserva.Latitud);
            stop.Longitud = Number(reserva.Longitud);
        }
    }

    return Array.from(stopsMap.values());
}

function stableStopCompare(a, b) {
    const rutaA = normalizeRoute(a.ruta);
    const rutaB = normalizeRoute(b.ruta);
    const rankA = getRouteRank(rutaA);
    const rankB = getRouteRank(rutaB);

    if (rankA !== rankB) return rankA - rankB;

    const ordenA = getRouteOrder(a);
    const ordenB = getRouteOrder(b);
    if (ordenA !== null && ordenB !== null && ordenA !== ordenB) return ordenA - ordenB;
    if (ordenA !== null && ordenB === null) return -1;
    if (ordenA === null && ordenB !== null) return 1;

    return (a.originalIndex || 0) - (b.originalIndex || 0);
}

function nearestNeighborOrder(stops) {
    const pendientes = [...stops].sort(stableStopCompare);
    const ordenadas = [];
    let actual = pendientes.shift();

    while (actual) {
        ordenadas.push(actual);
        if (!pendientes.length) break;

        let mejorIdx = 0;
        let mejorScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pendientes.length; i++) {
            const candidata = pendientes[i];
            const distancia = haversineKm(actual, candidata);
            const mismaRuta = normalizeRoute(actual.ruta) && normalizeRoute(actual.ruta) === normalizeRoute(candidata.ruta);
            const distanciaRuta = getRouteDistanceRank(actual, candidata);
            const ordenActual = getRouteOrder(actual);
            const ordenCandidato = getRouteOrder(candidata);
            const continuidad = ordenActual !== null && ordenCandidato !== null ? Math.abs(ordenCandidato - ordenActual) : 99;
            const score =
                (Number.isFinite(distancia) ? distancia : 20) -
                (mismaRuta ? 8 : 0) +
                Math.min(distanciaRuta, 10) * 0.75 +
                Math.min(continuidad, 10) * 0.2;
            if (score < mejorScore) {
                mejorScore = score;
                mejorIdx = i;
            }
        }

        actual = pendientes.splice(mejorIdx, 1)[0];
    }

    return ordenadas;
}

function sortStopsByRouteThenGeo(stops) {
    if (!Array.isArray(stops) || stops.length <= 1) return stops || [];

    const ordered = [...stops].sort(stableStopCompare);
    const todasConRutaOrden = ordered.every(stop => normalizeRoute(stop.ruta) && getRouteOrder(stop) !== null);
    const rutas = new Set(ordered.map(stop => normalizeRoute(stop.ruta)).filter(Boolean));

    if (todasConRutaOrden && rutas.size === 1) return ordered;

    const porRuta = new Map();
    const sinRuta = [];
    for (const stop of ordered) {
        const ruta = normalizeRoute(stop.ruta);
        if (!ruta) {
            sinRuta.push(stop);
            continue;
        }
        if (!porRuta.has(ruta)) porRuta.set(ruta, []);
        porRuta.get(ruta).push(stop);
    }

    const bloques = Array.from(porRuta.keys())
        .sort((a, b) => getRouteRank(a) - getRouteRank(b))
        .map(ruta => {
            const bloque = porRuta.get(ruta);
            const conOrden = bloque.every(stop => getRouteOrder(stop) !== null);
            return conOrden ? bloque.sort(stableStopCompare) : nearestNeighborOrder(bloque);
        });

    return bloques.flat().concat(nearestNeighborOrder(sinRuta));
}

function sortBusReservations(bus) {
    const stops = sortStopsByRouteThenGeo(groupReservationsByPoint(bus.reservas || []));
    return stops.flatMap(stop => stop.reservas.sort((a, b) => (a.__ordenOriginal || 0) - (b.__ordenOriginal || 0)));
}

function estimateRouteKm(stops) {
    const ordenadas = sortStopsByRouteThenGeo(stops || []);
    let total = 0;

    for (let i = 1; i < ordenadas.length; i++) {
        const distancia = haversineKm(ordenadas[i - 1], ordenadas[i]);
        if (Number.isFinite(distancia)) total += distancia;
    }

    return Number(total.toFixed(2));
}

function minDistanceToGroup(stop, groupStops) {
    let min = Number.POSITIVE_INFINITY;
    for (const groupStop of groupStops) {
        const distancia = haversineKm(stop, groupStop);
        if (distancia < min) min = distancia;
    }
    return min;
}

function scoreCandidateStop({ stop, groupStops, totalPax, maxCapacity }) {
    const lastStop = groupStops[groupStops.length - 1];
    const distanceToLast = haversineKm(lastStop, stop);
    const minDistance = minDistanceToGroup(stop, groupStops);
    const distancia = Number.isFinite(distanceToLast) ? distanceToLast : minDistance;
    const rutaStop = normalizeRoute(stop.ruta);
    const rutasGrupo = new Set(groupStops.map(s => normalizeRoute(s.ruta)).filter(Boolean));
    const mismaRuta = rutaStop && rutasGrupo.has(rutaStop);
    const mezclaRutas = rutaStop && rutasGrupo.size > 0 && !mismaRuta;
    const routeDistance = Math.min(...groupStops.map(groupStop => getRouteDistanceRank(stop, groupStop)));
    const ordenStop = getRouteOrder(stop);
    const ordenLast = getRouteOrder(lastStop);
    const continuidad = ordenStop !== null && ordenLast !== null ? Math.abs(ordenStop - ordenLast) : null;
    const ocupacion = (totalPax + stop.totalPax) / maxCapacity;

    let score = Number.isFinite(distancia) ? distancia : 10;
    if (distancia > 2 && distancia <= 5) score += 2;
    if (distancia > 6) score += 10;
    if (!Number.isFinite(distancia)) score += 6;
    if (mismaRuta) {
        score -= 100;
    } else if (routeDistance <= 1) {
        score += 8;
    } else if (routeDistance <= 3) {
        score += 18;
    } else if (routeDistance < 999) {
        score += 35;
    }
    if (mismaRuta && continuidad !== null) score -= Math.max(0, 5 - Math.min(continuidad, 5));
    if (mezclaRutas) score += 5;
    score -= ocupacion * 3;

    return {
        score,
        distancia: Number.isFinite(distancia) ? distancia : null,
        mismaRuta,
        mezclaRutas,
        routeDistance
    };
}

function canMixStop({ stop, groupStops, scoreInfo }) {
    if (scoreInfo.mismaRuta) return true;
    if (scoreInfo.routeDistance <= 1) return true;
    if (scoreInfo.distancia === null) return true;
    if (scoreInfo.routeDistance <= 3 && scoreInfo.distancia <= 6) return true;
    if (scoreInfo.distancia <= 2) return true;

    const hasRouteContext = normalizeRoute(stop.ruta) && groupStops.some(s => normalizeRoute(s.ruta));
    return !hasRouteContext && scoreInfo.distancia <= 8;
}

function splitOversizedStops(stops, maxCapacity, reservasSinAsignar) {
    const result = [];
    for (const stop of stops) {
        if (stop.totalPax <= maxCapacity) {
            result.push(stop);
            continue;
        }

        let chunk = { ...stop, key: `${stop.key}-chunk-1`, reservas: [], totalPax: 0 };
        let chunkIndex = 1;

        for (const reserva of stop.reservas) {
            const pax = getReservationPax(reserva);
            if (pax > maxCapacity) {
                reservasSinAsignar.push({ ...reserva, motivoNoAsignacion: 'SUPERA_CAPACIDAD_MAXIMA' });
                continue;
            }

            if (chunk.reservas.length && chunk.totalPax + pax > maxCapacity) {
                result.push(chunk);
                chunkIndex += 1;
                chunk = { ...stop, key: `${stop.key}-chunk-${chunkIndex}`, reservas: [], totalPax: 0 };
            }

            chunk.reservas.push(reserva);
            chunk.totalPax += pax;
        }

        if (chunk.reservas.length) result.push(chunk);
    }

    return result;
}

function buildBusFromStops(stops, contadorBus) {
    const ordenadas = sortStopsByRouteThenGeo(stops);
    const reservas = ordenadas.flatMap(stop => stop.reservas.sort((a, b) => (a.__ordenOriginal || 0) - (b.__ordenOriginal || 0)));
    const ocupados = reservas.reduce((sum, r) => sum + getReservationPax(r), 0);
    return {
        id: `Bus ${contadorBus}`,
        capacidad: chooseSmallestCapacity(ocupados) || CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1],
        ocupados,
        reservas: reservas.map(({ __ordenOriginal, ...reserva }) => reserva),
        recorridoKm: estimateRouteKm(ordenadas),
        guia: '',
        __stops: ordenadas
    };
}

function tryMergeSmallBuses(buses) {
    const maxCapacity = CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1];
    let changed = true;

    while (changed) {
        changed = false;
        outer:
        for (let i = 0; i < buses.length; i++) {
            for (let j = i + 1; j < buses.length; j++) {
                const a = buses[i];
                const b = buses[j];
                const totalPax = a.ocupados + b.ocupados;
                if (totalPax > maxCapacity) continue;

                const stopsA = a.__stops || groupReservationsByPoint(a.reservas);
                const stopsB = b.__stops || groupReservationsByPoint(b.reservas);
                const distancia = Math.min(...stopsB.map(stop => minDistanceToGroup(stop, stopsA)));
                const compartenRuta = stopsA.some(sa => stopsB.some(sb => normalizeRoute(sa.ruta) && normalizeRoute(sa.ruta) === normalizeRoute(sb.ruta)));
                const distanciaRuta = Math.min(...stopsB.map(stopB => Math.min(...stopsA.map(stopA => getRouteDistanceRank(stopA, stopB)))));
                const puedeFusionar = compartenRuta || distanciaRuta <= 1 || !Number.isFinite(distancia) || distancia <= 5;
                if (!puedeFusionar) continue;

                const fusionado = buildBusFromStops(stopsA.concat(stopsB), i + 1);
                buses[i] = fusionado;
                buses.splice(j, 1);
                changed = true;
                break outer;
            }
        }
    }

    return buses.map((bus, index) => ({ ...bus, id: `Bus ${index + 1}` }));
}

// TODO: integrar routeEngine cuando /ruta-optima exponga una funcion estable para distancia entre puntos.
// TODO: reemplazar Haversine por distancia de grafo cuando graph JSON este listo y no sea obligatorio para generar listados.
async function getDistanceKmBetweenStops(a, b) {
    return haversineKm(a, b);
}

async function generarPlanLogistico(fecha, idsTours) {
    try {
        const reservas = await obtenerReservas(fecha, idsTours);
        if (reservas.length === 0) return { buses: [], reservasSinAsignar: [] };

        const maxCapacity = CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1];
        const reservasSinAsignar = [];
        const stopsIniciales = groupReservationsByPoint(reservas);
        const stops = sortStopsByRouteThenGeo(splitOversizedStops(stopsIniciales, maxCapacity, reservasSinAsignar));
        const pendientes = [...stops];
        const buses = [];

        while (pendientes.length > 0) {
            const semilla = pendientes.shift();
            const groupStops = [semilla];
            let totalPax = semilla.totalPax;

            while (totalPax < maxCapacity && pendientes.length > 0) {
                let mejorIdx = -1;
                let mejorScore = Number.POSITIVE_INFINITY;

                for (let i = 0; i < pendientes.length; i++) {
                    const stop = pendientes[i];
                    if (totalPax + stop.totalPax > maxCapacity) continue;

                    const scoreInfo = scoreCandidateStop({ stop, groupStops, totalPax, maxCapacity });
                    if (!canMixStop({ stop, groupStops, scoreInfo })) continue;
                    if (scoreInfo.score < mejorScore) {
                        mejorScore = scoreInfo.score;
                        mejorIdx = i;
                    }
                }

                if (mejorIdx === -1 || mejorScore > 18) break;

                const [seleccionado] = pendientes.splice(mejorIdx, 1);
                groupStops.push(seleccionado);
                totalPax += seleccionado.totalPax;
            }

            buses.push(buildBusFromStops(groupStops, buses.length + 1));
        }

        const busesOptimizados = tryMergeSmallBuses(buses)
            .map(({ __stops, ...bus }) => ({
                ...bus,
                reservas: sortBusReservations(bus).map(({ __ordenOriginal, ...reserva }) => reserva),
            }));

        return { buses: busesOptimizados, reservasSinAsignar };

    } catch (error) {
        console.error("Fallo crítico en la generación del plan logístico:", error);
        throw new Error(error.message || "Ocurrió un error inesperado al procesar la solicitud.");
    }
}

async function guardarListadoFinal({ fecha, idsTours, buses, userId = null }) {
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

        await recordHistorial({
            conexion: conn,
            tabla: 'programacion',
            id_registro: `${fecha}|${tours.join(',')}`,
            accion: 'GUARDAR_LISTADO',
            id_usuario: userId,
            detalles: [
                { columna: 'Fecha', anterior: null, nuevo: fecha },
                { columna: 'Tours', anterior: null, nuevo: tours.join(',') },
                { columna: 'Buses', anterior: null, nuevo: String(buses.length) },
                { columna: 'Reservas_Actualizadas', anterior: null, nuevo: String(reservasActualizadas) }
            ]
        });

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
        reservasBus.sort((a, b) => {
            const ordenA = a.Orden_Ruta !== null && a.Orden_Ruta !== undefined ? Number(a.Orden_Ruta) : Number.MAX_SAFE_INTEGER;
            const ordenB = b.Orden_Ruta !== null && b.Orden_Ruta !== undefined ? Number(b.Orden_Ruta) : Number.MAX_SAFE_INTEGER;
            if (ordenA !== ordenB) return ordenA - ordenB;
            return 0;
        });
        const stopsBus = groupReservationsByPoint(reservasBus);

        const ocupados = reservasBus.reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);

        return {
            id: placa,
            capacidad: Number(row.Capacidad || 0),
            ocupados,
            reservas: reservasBus,
            recorridoKm: estimateRouteKm(stopsBus),
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
             MIN(pt.Latitud) AS Latitud,
             MIN(pt.Longitud) AS Longitud,
             MIN(pt.Nombre_Punto) AS NombrePunto,
             MIN(pt.ruta) AS ruta,
             MIN(pt.posicion) AS ordenRuta,
             MIN(pt.posicion) AS Posicion
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
            Orden_Ruta: r.Orden_Ruta ? Number(r.Orden_Ruta) : null,
            ruta: r.ruta || null,
            ordenRuta: r.ordenRuta !== null && r.ordenRuta !== undefined ? Number(r.ordenRuta) : null,
            Posicion: r.Posicion !== null && r.Posicion !== undefined ? Number(r.Posicion) : null
        }));
    } catch (error) {
        console.error("Error al obtener reservas con placa:", error);
        throw new Error("Fallo al contactar la base de datos de reservas.");
    }
}
