const db = require('../../database/db'); // Asegúrate de que la ruta a tu conexión de DB sea correcta
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { recordHistorial } = require('../Historial/logger');
const {
    generarPlanSombra,
    normalizarReservas: normalizarReservasSombra,
} = require('./shadow/programacion-shadow.optimizer');
const {
    prepararMatrizOSRM,
} = require('./shadow/programacion-shadow.distances');
const {
    obtenerReservasSinAsignar,
} = require('./programacion-reconciliation');
const {
    reconcilePrivateBuses,
    validatePrivateAssignments,
} = require('./programacion-private');

// =================================================================
// --- CONFIGURACIÓN Y CACHÉ GLOBAL ---
// =================================================================
const CAPACIDAD_BUS_GENERACION = 38;

const CONFIG = {
    CAPACIDADES_BUSES: [CAPACIDAD_BUS_GENERACION],
    PUNTO_BASE: { lat: 6.212757856694648, lon: -75.57759200491337, NombrePunto: 'Punto Base' },
    GRAFO_PATH: 'grafo_antioquia.json',
};

const RUTA_ADJACENCY = {
    "0": new Set(["5", "2"]),
    "1": new Set(["2", "3", "4", "5"]),
    "2": new Set(["1", "4", "5", "3"]),
    "3": new Set(["1", "2", "4"]),
    "4": new Set(["2", "1", "3", "5"]),
    "5": new Set(["2", "4", "1", "0"]),
    "6": new Set(["7", "12", "8"]),
    "7": new Set(["8", "12", "6"]),
    "8": new Set(["7", "12", "10", "9"]),
    "9": new Set(["10", "12", "8"]),
    "10": new Set(["9", "12", "8"]),
    "12": new Set(["7", "8", "10", "9", "6"]),
    "13": new Set(["14", "6"]),
    "14": new Set(["12", "13", "6"]),
};

function rutasAdyacentes(rutaA, rutaB) {
    const a = normalizeRoute(rutaA);
    const b = normalizeRoute(rutaB);

    if (!a || !b) return true;
    if (a === b) return true;

    const vecinos = RUTA_ADJACENCY[a];
    return vecinos ? vecinos.has(b) : false;
}

const GRAPH_STATE = {
    loaded: false,
    available: false,
    graph: null,
    nodes: [],
    nearestNodeCache: new Map(),
    distanceCache: new Map(),
    warned: false
};

const GRAPH_LIMITS = {
    MAX_NEAREST_CACHE: 3000,
    MAX_DISTANCE_CACHE: 5000,
    MAX_ASTAR_ITERATIONS: 12000,
    MAX_GRAPH_DISTANCE_CALLS_PER_PLAN: Number(process.env.PROGRAMACION_GRAPH_MAX_CALLS || 18),
    MAX_GRAPH_DISTANCE_MS_PER_PLAN: Number(process.env.PROGRAMACION_GRAPH_MAX_MS || 2500),
    MAX_STOPS_PER_BUS_FOR_GRAPH: Number(process.env.PROGRAMACION_GRAPH_MAX_STOPS_PER_BUS || 8)
};

const ESTADOS_RESERVA_ACTIVOS = ['ACTIVA', 'ACTIVO', 'PENDIENTE', 'PENDIENTEDATOS', 'CONFIRMADA', 'COMPLETADA'];

// =================================================================
// --- FUNCIONES DE UTILIDAD Y DATOS (Optimizadas) ---
// =================================================================
async function obtenerReservas(fecha, idsTours) {
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];

    const sql = `
        SELECT
            r.Id_Reserva,
            h.Id_Tour,
            r.Fecha_Tour,
            r.Estado,
            r.Tipo_Reserva,
            r.Nombre_Reportante,
            r.Idioma_Reserva,
            r.Observaciones,
            p.Id_Pasajero,
            p.Id_Punto,
            pt.Nombre_Punto AS NombrePunto,
            pt.Latitud,
            pt.Longitud,
            pt.ruta,
            pt.posicion AS ordenRuta,
            pt.posicion AS Posicion,
            pc.NumeroPasajeros
        FROM reservas r
        INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
        INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
        INNER JOIN (
            SELECT Id_Reserva, COUNT(Id_Pasajero) AS NumeroPasajeros
            FROM pasajeros
            GROUP BY Id_Reserva
        ) pc ON pc.Id_Reserva = r.Id_Reserva
        WHERE r.Fecha_Tour = ?
          AND h.Id_Tour IN (?)
          AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_RESERVA_ACTIVOS.map(() => '?').join(',')})
          AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
        ORDER BY
            r.Id_Reserva ASC,
            COALESCE(CAST(pt.ruta AS UNSIGNED), 999999) ASC,
            COALESCE(pt.posicion, 999999) ASC,
            p.Id_Pasajero ASC
    `;

    try {
        const [rows] = await db.query(sql, [fecha, tours, ...ESTADOS_RESERVA_ACTIVOS]);
        return construirReservasDesdeFilasPasajeros(rows || []);
    } catch (error) {
        console.error("Error al obtener reservas:", error);
        throw new Error("Fallo al contactar la base de datos de reservas.");
    }
}

function construirReservasDesdeFilasPasajeros(rows) {
    const reservasMap = new Map();

    for (const row of rows) {
        if (!reservasMap.has(row.Id_Reserva)) {
            reservasMap.set(row.Id_Reserva, {
                Id_Reserva: row.Id_Reserva,
                Id_Tour: row.Id_Tour,
                Fecha_Tour: row.Fecha_Tour,
                Estado: row.Estado,
                Tipo_Reserva: row.Tipo_Reserva,
                Nombre_Reportante: row.Nombre_Reportante || null,
                NombreReporta: row.Nombre_Reportante || null,
                Idioma_Reserva: row.Idioma_Reserva || null,
                IdiomaReserva: row.Idioma_Reserva || null,
                Observaciones: row.Observaciones || null,
                NumeroPasajeros: Number(row.NumeroPasajeros || 0),
                pasajeros: []
            });
        }

        const reserva = reservasMap.get(row.Id_Reserva);
        reserva.pasajeros.push({
            Id_Pasajero: row.Id_Pasajero,
            Id_Punto: row.Id_Punto || null,
            NombrePunto: row.NombrePunto || 'SIN_PUNTO',
            Latitud: row.Latitud !== null && row.Latitud !== undefined ? Number(row.Latitud) : null,
            Longitud: row.Longitud !== null && row.Longitud !== undefined ? Number(row.Longitud) : null,
            ruta: row.ruta || null,
            ordenRuta: row.ordenRuta !== null && row.ordenRuta !== undefined ? Number(row.ordenRuta) : null,
            Posicion: row.Posicion !== null && row.Posicion !== undefined ? Number(row.Posicion) : null
        });
    }

    return Array.from(reservasMap.values()).map(resolverPuntoPrincipalReserva);
}

function resolverPuntoPrincipalReserva(reserva) {
    const puntosMap = new Map();

    for (const pasajero of reserva.pasajeros || []) {
        const key = pasajero.Id_Punto ? `punto-${pasajero.Id_Punto}` : `sin-punto-${pasajero.NombrePunto}`;
        if (!puntosMap.has(key)) {
            puntosMap.set(key, {
                Id_Punto: pasajero.Id_Punto || null,
                NombrePunto: pasajero.NombrePunto || 'SIN_PUNTO',
                Latitud: pasajero.Latitud,
                Longitud: pasajero.Longitud,
                ruta: pasajero.ruta || null,
                ordenRuta: pasajero.ordenRuta,
                Posicion: pasajero.Posicion,
                pasajeros: 0
            });
        }

        puntosMap.get(key).pasajeros += 1;
    }

    const puntos = Array.from(puntosMap.values());
    const puntosConRuta = puntos.map(p => normalizeRoute(p.ruta)).filter(Boolean);
    const rutasUnicas = new Set(puntosConRuta);

    let puntoPrincipal = puntos[0] || {
        Id_Punto: null,
        NombrePunto: 'SIN_PUNTO',
        Latitud: null,
        Longitud: null,
        ruta: null,
        ordenRuta: null,
        Posicion: null,
        pasajeros: 0
    };

    let requiereRevision = false;
    let motivoRevision = null;

    if (puntos.length > 1) {
        if (rutasUnicas.size <= 1) {
            puntoPrincipal = puntos
                .slice()
                .sort((a, b) => {
                    const posA = getRouteOrder(a);
                    const posB = getRouteOrder(b);
                    if (posA !== null && posB !== null && posA !== posB) return posA - posB;
                    if (posA !== null && posB === null) return -1;
                    if (posA === null && posB !== null) return 1;
                    return Number(a.Id_Punto || 0) - Number(b.Id_Punto || 0);
                })[0];
        } else {
            requiereRevision = true;
            motivoRevision = 'Reserva con pasajeros en puntos de rutas distintas.';
            puntoPrincipal = puntos
                .slice()
                .sort((a, b) => {
                    if (b.pasajeros !== a.pasajeros) return b.pasajeros - a.pasajeros;
                    const rutaA = getRouteRank(a.ruta);
                    const rutaB = getRouteRank(b.ruta);
                    if (rutaA !== rutaB) return rutaA - rutaB;
                    const posA = getRouteOrder(a);
                    const posB = getRouteOrder(b);
                    return (posA ?? Number.MAX_SAFE_INTEGER) - (posB ?? Number.MAX_SAFE_INTEGER);
                })[0];
        }
    }

    return {
        ...reserva,
        Id_Punto: puntoPrincipal.Id_Punto,
        NombrePunto: puntoPrincipal.NombrePunto,
        Latitud: puntoPrincipal.Latitud,
        Longitud: puntoPrincipal.Longitud,
        ruta: puntoPrincipal.ruta || null,
        ordenRuta: puntoPrincipal.ordenRuta !== null && puntoPrincipal.ordenRuta !== undefined ? Number(puntoPrincipal.ordenRuta) : null,
        Orden_Ruta: puntoPrincipal.ordenRuta !== null && puntoPrincipal.ordenRuta !== undefined ? Number(puntoPrincipal.ordenRuta) : null,
        Posicion: puntoPrincipal.Posicion !== null && puntoPrincipal.Posicion !== undefined ? Number(puntoPrincipal.Posicion) : null,
        puntosReserva: puntos,
        requiereRevision,
        motivoRevision
    };
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


function getCoordLat(item) {
    return Number(item?.Latitud ?? item?.lat ?? item?.latitude);
}

function getCoordLon(item) {
    return Number(item?.Longitud ?? item?.lon ?? item?.lng ?? item?.longitude);
}

function createGraphUsageContext(tourDestinos = {}) {
    const disabled = String(process.env.PROGRAMACION_GRAPH_DISTANCE || '').trim() === '0';
    return {
        enabled: !disabled,
        startedAt: Date.now(),
        deadlineAt: Date.now() + GRAPH_LIMITS.MAX_GRAPH_DISTANCE_MS_PER_PLAN,
        maxCalls: GRAPH_LIMITS.MAX_GRAPH_DISTANCE_CALLS_PER_PLAN,
        calls: 0,
        nearestLookups: 0,
        astarRuns: 0,
        fallbacks: 0,
        graphLoaded: false,
        disabledByBudget: false,
        // Mapa de Id_Tour → { Latitud, Longitud } para orientar el orden de recogida.
        // Solo se puebla cuando el tour tiene coordenadas definidas en la DB.
        // Si un tour no tiene coordenadas, su Id_Tour no estará en este mapa
        // y el algoritmo de ordenamiento se comporta igual que antes.
        tourDestinos: tourDestinos || {}
    };
}

function hasGraphBudget(context) {
    if (!context?.enabled) return false;
    if (context.calls >= context.maxCalls) {
        context.disabledByBudget = true;
        return false;
    }
    if (Date.now() > context.deadlineAt) {
        context.disabledByBudget = true;
        return false;
    }
    return true;
}

function resolveGraphPath() {
    const candidates = [
        path.join(__dirname, CONFIG.GRAFO_PATH),
        path.join(__dirname, 'route_engine', CONFIG.GRAFO_PATH),
        path.join(__dirname, '..', '..', CONFIG.GRAFO_PATH),
        path.join(__dirname, '..', '..', 'data', CONFIG.GRAFO_PATH),
        path.join(process.cwd(), CONFIG.GRAFO_PATH),
        path.join(process.cwd(), 'backend', CONFIG.GRAFO_PATH),
        path.join(process.cwd(), 'backend', 'services', 'Programacion', CONFIG.GRAFO_PATH),
        path.join(process.cwd(), 'backend', 'services', 'Programacion', 'route_engine', CONFIG.GRAFO_PATH)
    ];

    return candidates.find(candidate => fsSync.existsSync(candidate)) || null;
}

function normalizeGraph(rawGraph) {
    const rawNodes = rawGraph?.nodes || rawGraph;
    if (!rawNodes || typeof rawNodes !== 'object') return null;

    const nodes = new Map();

    for (const [id, node] of Object.entries(rawNodes)) {
        const lat = Number(node.lat ?? node.Latitud ?? node.latitude);
        const lon = Number(node.lon ?? node.lng ?? node.Longitud ?? node.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const rawNeighbors = node.neighbors || node.vecinos || [];
        const neighbors = Array.isArray(rawNeighbors)
            ? rawNeighbors.map(neighbor => ({
                id: String(neighbor.id ?? neighbor.node ?? neighbor.to ?? neighbor.target ?? ''),
                distance: Number(neighbor.distance ?? neighbor.distancia ?? neighbor.weight ?? neighbor.metros ?? 0)
            })).filter(neighbor => neighbor.id && Number.isFinite(neighbor.distance) && neighbor.distance > 0)
            : Object.entries(rawNeighbors || {}).map(([neighborId, distance]) => ({
                id: String(neighborId),
                distance: Number(distance)
            })).filter(neighbor => neighbor.id && Number.isFinite(neighbor.distance) && neighbor.distance > 0);

        nodes.set(String(id), { id: String(id), lat, lon, neighbors });
    }

    return nodes.size ? { nodes, nodesArray: Array.from(nodes.values()) } : null;
}

function getGraph(context = null) {
    if (GRAPH_STATE.loaded) return GRAPH_STATE.available ? GRAPH_STATE.graph : null;

    GRAPH_STATE.loaded = true;
    const graphPath = resolveGraphPath();
    if (!graphPath) {
        if (!GRAPH_STATE.warned) {
            console.warn(`[PROGRAMACION] No se encontró ${CONFIG.GRAFO_PATH}. Se usará Haversine como fallback.`);
            GRAPH_STATE.warned = true;
        }
        return null;
    }

    try {
        const raw = JSON.parse(fsSync.readFileSync(graphPath, 'utf8'));
        const graph = normalizeGraph(raw);
        if (!graph) throw new Error('El grafo no tiene una estructura válida.');

        GRAPH_STATE.graph = graph;
        GRAPH_STATE.nodes = graph.nodesArray;
        GRAPH_STATE.available = true;
        if (context) context.graphLoaded = true;
        console.log(`[PROGRAMACION] Grafo cargado para distancias controladas: ${graphPath} (${GRAPH_STATE.nodes.length} nodos).`);
        return graph;
    } catch (error) {
        console.error('[PROGRAMACION] Error cargando grafo local. Se usará Haversine como fallback:', error.message);
        return null;
    }
}

function getNearestCacheKey(point) {
    const lat = getCoordLat(point);
    const lon = getCoordLon(point);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function findNearestGraphNodeId(point, context) {
    const graph = getGraph(context);
    if (!graph || !hasValidCoords(point) || !hasGraphBudget(context)) return null;

    const cacheKey = getNearestCacheKey(point);
    if (cacheKey && GRAPH_STATE.nearestNodeCache.has(cacheKey)) {
        return GRAPH_STATE.nearestNodeCache.get(cacheKey);
    }

    let nearestId = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const target = { Latitud: getCoordLat(point), Longitud: getCoordLon(point) };

    for (let index = 0; index < GRAPH_STATE.nodes.length; index++) {
        if (index > 0 && index % 5000 === 0 && !hasGraphBudget(context)) return null;
        const node = GRAPH_STATE.nodes[index];
        const distance = haversineKm(target, { Latitud: node.lat, Longitud: node.lon });
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestId = node.id;
        }
    }

    context.nearestLookups += 1;

    if (cacheKey && GRAPH_STATE.nearestNodeCache.size < GRAPH_LIMITS.MAX_NEAREST_CACHE) {
        GRAPH_STATE.nearestNodeCache.set(cacheKey, nearestId);
    }

    return nearestId;
}

class MinHeap {
    constructor() {
        this.items = [];
    }

    push(item) {
        this.items.push(item);
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (this.items.length === 0) return null;
        if (this.items.length === 1) return this.items.pop();
        const root = this.items[0];
        this.items[0] = this.items.pop();
        this.bubbleDown(0);
        return root;
    }

    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.items[parent].priority <= this.items[index].priority) break;
            [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
            index = parent;
        }
    }

    bubbleDown(index) {
        const length = this.items.length;
        while (true) {
            let smallest = index;
            const left = index * 2 + 1;
            const right = index * 2 + 2;

            if (left < length && this.items[left].priority < this.items[smallest].priority) smallest = left;
            if (right < length && this.items[right].priority < this.items[smallest].priority) smallest = right;
            if (smallest === index) break;

            [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
            index = smallest;
        }
    }

    get size() {
        return this.items.length;
    }
}

function graphHeuristicMeters(nodeA, nodeB) {
    if (!nodeA || !nodeB) return 0;
    return haversineKm(
        { Latitud: nodeA.lat, Longitud: nodeA.lon },
        { Latitud: nodeB.lat, Longitud: nodeB.lon }
    ) * 1000;
}

function aStarDistanceMeters(startId, goalId, context) {
    const graph = getGraph(context);
    if (!graph || !startId || !goalId || !hasGraphBudget(context)) return null;
    if (startId === goalId) return 0;

    const cacheKey = startId < goalId ? `${startId}|${goalId}` : `${goalId}|${startId}`;
    if (GRAPH_STATE.distanceCache.has(cacheKey)) return GRAPH_STATE.distanceCache.get(cacheKey);

    const startNode = graph.nodes.get(String(startId));
    const goalNode = graph.nodes.get(String(goalId));
    if (!startNode || !goalNode) return null;

    const open = new MinHeap();
    const gScore = new Map([[startNode.id, 0]]);
    const visited = new Set();
    let iterations = 0;

    context.astarRuns += 1;
    open.push({ id: startNode.id, priority: graphHeuristicMeters(startNode, goalNode) });

    while (open.size > 0 && iterations < GRAPH_LIMITS.MAX_ASTAR_ITERATIONS) {
        iterations += 1;
        if (iterations % 500 === 0 && !hasGraphBudget(context)) return null;

        const current = open.pop();
        if (!current || visited.has(current.id)) continue;
        if (current.id === goalNode.id) {
            const result = gScore.get(current.id);
            if (GRAPH_STATE.distanceCache.size < GRAPH_LIMITS.MAX_DISTANCE_CACHE) {
                GRAPH_STATE.distanceCache.set(cacheKey, result);
            }
            return result;
        }

        visited.add(current.id);
        const currentNode = graph.nodes.get(current.id);
        if (!currentNode) continue;

        for (const neighbor of currentNode.neighbors) {
            if (visited.has(neighbor.id)) continue;
            const neighborNode = graph.nodes.get(neighbor.id);
            if (!neighborNode) continue;

            const tentative = (gScore.get(current.id) ?? Number.POSITIVE_INFINITY) + neighbor.distance;
            if (tentative < (gScore.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
                gScore.set(neighbor.id, tentative);
                open.push({
                    id: neighbor.id,
                    priority: tentative + graphHeuristicMeters(neighborNode, goalNode)
                });
            }
        }
    }

    context.fallbacks += 1;
    return null;
}

function getGraphDistanceKmBetweenStops(a, b, context) {
    if (!hasGraphBudget(context) || !hasValidCoords(a) || !hasValidCoords(b)) return Number.POSITIVE_INFINITY;

    const startId = findNearestGraphNodeId(a, context);
    const goalId = findNearestGraphNodeId(b, context);
    if (!startId || !goalId) return Number.POSITIVE_INFINITY;

    const meters = aStarDistanceMeters(startId, goalId, context);
    if (!Number.isFinite(meters)) return Number.POSITIVE_INFINITY;

    context.calls += 1;
    return meters / 1000;
}

function shouldUseGraphForOrderingPair(a, b) {
    if (!hasValidCoords(a) || !hasValidCoords(b)) return false;

    const rutaA = normalizeRoute(a?.ruta);
    const rutaB = normalizeRoute(b?.ruta);
    const ordenA = getRouteOrder(a);
    const ordenB = getRouteOrder(b);

    const aTieneOrdenOperativo = Boolean(rutaA) && ordenA !== null;
    const bTieneOrdenOperativo = Boolean(rutaB) && ordenB !== null;

    if (!aTieneOrdenOperativo || !bTieneOrdenOperativo) return true;
    if (rutaA && rutaB && rutaA === rutaB && ordenA === ordenB) return true;

    return false;
}

function getDistanceKmForOrdering(a, b, context, { allowGraph = true } = {}) {
    if (allowGraph && shouldUseGraphForOrderingPair(a, b) && hasGraphBudget(context)) {
        const graphDistance = getGraphDistanceKmBetweenStops(a, b, context);
        if (Number.isFinite(graphDistance)) return graphDistance;
    }

    const fallback = haversineKm(a, b);
    if (!Number.isFinite(fallback) && context) context.fallbacks += 1;
    return fallback;
}

function estimateRouteKmWithControlledGraph(stops, context) {
    const ordenadas = sortStopsByRouteThenGeo(stops || [], context);
    if (ordenadas.length <= 1) return 0;

    const edgeCount = ordenadas.length - 1;
    if (edgeCount > GRAPH_LIMITS.MAX_STOPS_PER_BUS_FOR_GRAPH) {
        context.fallbacks += edgeCount;
        return estimateRouteKm(ordenadas);
    }

    let total = 0;
    let usedGraph = false;

    for (let i = 1; i < ordenadas.length; i++) {
        let distancia = Number.POSITIVE_INFINITY;
        if (hasGraphBudget(context)) {
            distancia = getGraphDistanceKmBetweenStops(ordenadas[i - 1], ordenadas[i], context);
            usedGraph = usedGraph || Number.isFinite(distancia);
        }

        if (!Number.isFinite(distancia)) {
            distancia = haversineKm(ordenadas[i - 1], ordenadas[i]);
            context.fallbacks += 1;
        }

        if (Number.isFinite(distancia)) total += distancia;
    }

    return {
        km: Number(total.toFixed(2)),
        source: usedGraph ? 'grafo_controlado' : 'haversine'
    };
}

function updateBusesWithControlledGraphKm(buses, context = null) {
    const localContext = context || createGraphUsageContext();
    if (!localContext.enabled || !Array.isArray(buses) || buses.length === 0) return buses;

    const updated = buses.map((bus) => {
        const stops = bus.__stops || groupReservationsByPoint(bus.reservas || []);
        const result = estimateRouteKmWithControlledGraph(stops, localContext);
        if (!result || typeof result !== 'object') return bus;

        return {
            ...bus,
            recorridoKm: Number.isFinite(result.km) ? result.km : bus.recorridoKm,
            distanciaFuente: result.source
        };
    });

    if (localContext.graphLoaded || localContext.calls > 0 || localContext.disabledByBudget) {
        console.log(
            `[PROGRAMACION] Grafo controlado en programacion: calls=${localContext.calls}/${localContext.maxCalls}, ` +
            `nearest=${localContext.nearestLookups}, astar=${localContext.astarRuns}, fallbacks=${localContext.fallbacks}, ` +
            `ms=${Date.now() - localContext.startedAt}, limited=${localContext.disabledByBudget ? 'si' : 'no'}.`
        );
    }

    return updated;
}

function normalizeRoute(value) {
    const ruta = String(value ?? '').trim().toUpperCase();
    return ruta && ruta !== 'PENDIENTE' ? ruta : '';
}

function getRouteRank(ruta) {
    const raw = String(ruta ?? '').trim();
    if (!raw) return Number.MAX_SAFE_INTEGER;

    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function getRouteDistanceRank(a, b) {
    const ra = getRouteRank(a?.ruta ?? a);
    const rb = getRouteRank(b?.ruta ?? b);

    if (ra === Number.MAX_SAFE_INTEGER || rb === Number.MAX_SAFE_INTEGER) {
        return Number.MAX_SAFE_INTEGER;
    }
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

function groupReservationsByPoint(reservas) {
    const stopsMap = new Map();

    for (let index = 0; index < reservas.length; index++) {
        const reserva = reservas[index];

        // Si la reserva tiene múltiples puntos (puntosReserva), expandirla en una entrada por punto.
        // Esto ocurre cuando distintos pasajeros de la misma reserva tienen distintos Id_Punto
        // pero todos comparten la misma ruta de puntos (restricción de negocio).
        // La reserva sigue siendo la unidad de asignación de bus; aquí solo separamos las PARADAS.
        const puntos = reserva.puntosReserva && reserva.puntosReserva.length
            ? reserva.puntosReserva
            : [{
                Id_Punto: reserva.Id_Punto || reserva.idPunto || reserva.IdPunto || null,
                NombrePunto: reserva.NombrePunto || reserva.PuntoEncuentro || 'SIN_PUNTO',
                Latitud: reserva.Latitud !== null && reserva.Latitud !== undefined ? Number(reserva.Latitud) : null,
                Longitud: reserva.Longitud !== null && reserva.Longitud !== undefined ? Number(reserva.Longitud) : null,
                ruta: reserva.ruta ?? reserva.Ruta ?? null,
                ordenRuta: getRouteOrder(reserva),
                Posicion: reserva.Posicion ?? null,
                pasajeros: getReservationPax(reserva)
            }];

        for (const punto of puntos) {
            const key = punto.Id_Punto
                ? `punto-${punto.Id_Punto}`
                : `nombre-${String(punto.NombrePunto || 'SIN_PUNTO').trim().toUpperCase()}`;

            if (!stopsMap.has(key)) {
                stopsMap.set(key, {
                    key,
                    Id_Punto: punto.Id_Punto || null,
                    NombrePunto: punto.NombrePunto || 'SIN_PUNTO',
                    ruta: normalizeRoute(punto.ruta),
                    ordenRuta: punto.ordenRuta !== null && punto.ordenRuta !== undefined
                        ? Number(punto.ordenRuta)
                        : (punto.Posicion !== null && punto.Posicion !== undefined ? Number(punto.Posicion) : null),
                    Latitud: punto.Latitud !== null && punto.Latitud !== undefined ? Number(punto.Latitud) : null,
                    Longitud: punto.Longitud !== null && punto.Longitud !== undefined ? Number(punto.Longitud) : null,
                    reservas: [],
                    totalPax: 0,
                    originalIndex: index
                });
            }

            const stop = stopsMap.get(key);
            // __paxEnEstePunto: pasajeros de ESTA reserva que suben en ESTE punto específico.
            // Usado en buildBusFromStops para el campo reservasEnEstePunto de cada parada.
            stop.reservas.push({ ...reserva, __ordenOriginal: index, __paxEnEstePunto: Number(punto.pasajeros || 0) });
            stop.totalPax += Number(punto.pasajeros || 0);
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

function nearestNeighborOrder(stops, context = null, tourDestino = null) {
    const pendientes = [...stops].sort(stableStopCompare);
    const ordenadas = [];
    let actual = pendientes.shift();

    // tourDestino válido: objeto con Latitud y Longitud numéricos.
    // Si el tour no tiene coordenadas en la DB, tourDestino llega null
    // y progresoScore = 0 para todos los candidatos → sin cambio de comportamiento.
    const destinoValido = tourDestino && hasValidCoords(tourDestino) ? tourDestino : null;

    while (actual) {
        ordenadas.push(actual);
        if (!pendientes.length) break;

        let mejorIdx = 0;
        let mejorScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pendientes.length; i++) {
            const candidata = pendientes[i];
            const distancia = getDistanceKmForOrdering(actual, candidata, context, { allowGraph: true });
            const mismaRuta = normalizeRoute(actual.ruta) && normalizeRoute(actual.ruta) === normalizeRoute(candidata.ruta);
            const distanciaRuta = getRouteDistanceRank(actual, candidata);
            const ordenActual = getRouteOrder(actual);
            const ordenCandidato = getRouteOrder(candidata);
            const continuidad = ordenActual !== null && ordenCandidato !== null ? Math.abs(ordenCandidato - ordenActual) : 99;

            // Progreso hacia el destino del tour.
            // Si la parada candidata nos acerca al tour → score negativo (bueno).
            // Si nos aleja → score positivo (malo).
            // El peso 1.2 es intencionalmente menor que la bonificación de mismaRuta (8)
            // para no romper la lógica de rutas operativas existente.
            let progresoScore = 0;
            if (destinoValido && hasValidCoords(actual) && hasValidCoords(candidata)) {
                const distActualATour = haversineKm(actual, destinoValido);
                const distCandidataATour = haversineKm(candidata, destinoValido);
                progresoScore = (distCandidataATour - distActualATour) * 1.2;
            }

            const score =
                (Number.isFinite(distancia) ? distancia : 20) -
                (mismaRuta ? 8 : 0) +
                Math.min(distanciaRuta, 10) * 0.75 +
                Math.min(continuidad, 10) * 0.2 +
                progresoScore;

            if (score < mejorScore) {
                mejorScore = score;
                mejorIdx = i;
            }
        }

        actual = pendientes.splice(mejorIdx, 1)[0];
    }

    return ordenadas;
}

function sortStopsByRouteThenGeo(stops, context = null, tourDestino = null) {
    if (!Array.isArray(stops) || stops.length <= 1) return stops || [];

    // Resolver tourDestino desde el contexto si no se pasa directamente.
    // Se usa el Id_Tour de la primera parada con tour asignado para buscar
    // las coordenadas destino en context.tourDestinos.
    let destino = tourDestino;
    if (!destino && context && context.tourDestinos) {
        for (const stop of stops) {
            const idTour = stop.Id_Tour || (stop.reservas && stop.reservas[0] && stop.reservas[0].Id_Tour);
            if (idTour && context.tourDestinos[String(idTour)]) {
                destino = context.tourDestinos[String(idTour)];
                break;
            }
        }
    }

    const conRutaOrden = [];
    const conRutaSinOrden = [];
    const sinRuta = [];

    for (const stop of stops) {
        const ruta = normalizeRoute(stop.ruta);
        const orden = getRouteOrder(stop);

        if (!ruta) {
            sinRuta.push(stop);
        } else if (orden === null) {
            conRutaSinOrden.push(stop);
        } else {
            conRutaOrden.push(stop);
        }
    }

    const ordenadasConRuta = conRutaOrden.sort(stableStopCompare);

    const pendientesPorRuta = new Map();
    for (const stop of conRutaSinOrden) {
        const ruta = normalizeRoute(stop.ruta);
        if (!pendientesPorRuta.has(ruta)) pendientesPorRuta.set(ruta, []);
        pendientesPorRuta.get(ruta).push(stop);
    }

    const bloquesSinOrden = Array.from(pendientesPorRuta.keys())
        .sort((a, b) => getRouteRank(a) - getRouteRank(b))
        .flatMap(ruta => nearestNeighborOrder(pendientesPorRuta.get(ruta), context, destino));

    return ordenadasConRuta
        .concat(bloquesSinOrden)
        .concat(nearestNeighborOrder(sinRuta, context, destino));
}

function sortBusReservations(bus, context = null) {
    const stops = sortStopsByRouteThenGeo(groupReservationsByPoint(bus.reservas || []), context);
    // Deduplicar: una reserva multi-punto aparece en varias paradas; solo se incluye una vez.
    const seen = new Set();
    const result = [];
    for (const stop of stops) {
        for (const r of stop.reservas.sort((a, b) => (a.__ordenOriginal || 0) - (b.__ordenOriginal || 0))) {
            if (!seen.has(r.Id_Reserva)) {
                seen.add(r.Id_Reserva);
                result.push(r);
            }
        }
    }
    return result;
}

function estimateRouteKm(stops, context = null) {
    const ordenadas = sortStopsByRouteThenGeo(stops || [], context);
    let total = 0;

    for (let i = 1; i < ordenadas.length; i++) {
        const distancia = getDistanceKmForOrdering(ordenadas[i - 1], ordenadas[i], context, { allowGraph: false });
        if (Number.isFinite(distancia)) total += distancia;
    }

    return Number(total.toFixed(2));
}

function minDistanceToGroup(stop, groupStops, context = null) {
    let min = Number.POSITIVE_INFINITY;
    for (const groupStop of groupStops) {
        const distancia = getDistanceKmForOrdering(stop, groupStop, context, { allowGraph: true });
        if (distancia < min) min = distancia;
    }
    return min;
}

function scoreCandidateStop({ stop, groupStops, totalPax, maxCapacity, context = null }) {
    const lastStop = groupStops[groupStops.length - 1];
    const distanceToLast = getDistanceKmForOrdering(lastStop, stop, context, { allowGraph: true });
    const minDistance = minDistanceToGroup(stop, groupStops, context);
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
            // Para reservas multi-punto, el pax relevante en ESTA parada es __paxEnEstePunto,
            // no NumeroPasajeros total (que incluiría pax de otras paradas).
            const pax = reserva.__paxEnEstePunto !== undefined
                ? Number(reserva.__paxEnEstePunto)
                : getReservationPax(reserva);

            if (pax > maxCapacity) {
                reservasSinAsignar.push({
                    ...reserva,
                    motivoNoAsignacion: 'Reserva supera la capacidad de 38 pasajeros.'
                });
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

function buildBusFromStops(stops, contadorBus, context = null) {
    const ordenadas = sortStopsByRouteThenGeo(stops, context);

    // Deduplicar reservas: una reserva multi-punto aparece en varias paradas de `ordenadas`
    // pero debe contarse UNA SOLA VEZ en bus.reservas (la unidad de asignación es la reserva completa).
    const reservasVistas = new Set();
    const reservas = [];
    for (const stop of ordenadas) {
        const enOrden = stop.reservas.slice().sort((a, b) => (a.__ordenOriginal || 0) - (b.__ordenOriginal || 0));
        for (const r of enOrden) {
            if (!reservasVistas.has(r.Id_Reserva)) {
                reservasVistas.add(r.Id_Reserva);
                const { __ordenOriginal, __paxEnEstePunto, ...reservaLimpia } = r;
                reservas.push(reservaLimpia);
            }
        }
    }

    // ocupados se calcula desde NumeroPasajeros total de cada reserva única (sin doble-conteo).
    const ocupados = reservas.reduce((sum, r) => sum + getReservationPax(r), 0);

    return {
        id: `Bus ${contadorBus}`,
        capacidad: CAPACIDAD_BUS_GENERACION,
        ocupados,
        reservas,
        recorridoKm: estimateRouteKm(ordenadas, context),
        guia: '',
        paradas: ordenadas.map((stop, index) => ({
            orden: index + 1,
            Id_Punto: stop.Id_Punto || null,
            NombrePunto: stop.NombrePunto || 'SIN_PUNTO',
            Latitud: stop.Latitud !== null && stop.Latitud !== undefined ? Number(stop.Latitud) : null,
            Longitud: stop.Longitud !== null && stop.Longitud !== undefined ? Number(stop.Longitud) : null,
            ruta: normalizeRoute(stop.ruta) || null,
            ordenRuta: getRouteOrder(stop),
            totalPax: Number(stop.totalPax || 0),
            // Sub-conteo por reserva en esta parada: útil para el frontend y el Excel.
            // Una reserva con 10 pax repartidos 5+5 en dos puntos aparece aquí con pax=5 en cada parada.
            reservasEnEstePunto: stop.reservas.map(r => ({
                Id_Reserva: r.Id_Reserva,
                pax: r.__paxEnEstePunto !== undefined ? Number(r.__paxEnEstePunto) : getReservationPax(r)
            }))
        })),
        __stops: ordenadas
    };
}

function generarBusesPrivados(reservas) {
    if (!Array.isArray(reservas) || reservas.length === 0) return [];

    const buses = [];
    let consecutivoGlobal = 1;

    for (const reserva of reservas) {
        const totalPax = Math.max(0, Number(reserva?.NumeroPasajeros || 0));
        const totalBuses = Math.max(1, Math.ceil(totalPax / CAPACIDAD_BUS_GENERACION));
        let paxPendientes = totalPax;

        for (let indice = 1; indice <= totalBuses; indice++) {
            const ocupados = totalPax > 0
                ? Math.min(CAPACIDAD_BUS_GENERACION, paxPendientes)
                : 0;

            buses.push({
                id: `Bus ${consecutivoGlobal++}`,
                capacidad: CAPACIDAD_BUS_GENERACION,
                ocupados,
                guia: '',
                indice,
                totalBuses,
                Id_Reserva_Privada: reserva.Id_Reserva,
                Id_Reserva: reserva.Id_Reserva,
                Id_Tour: reserva.Id_Tour,
                Nombre_Tour: reserva.Nombre_Tour || '',
                Nombre_Reportante: reserva.Nombre_Reportante || '',
                Idioma_Reserva: reserva.Idioma_Reserva || '',
                Observaciones: reserva.Observaciones || '',
                NumeroPasajeros: totalPax,
                reservas: [{
                    Id_Reserva: reserva.Id_Reserva,
                    Id_Tour: reserva.Id_Tour,
                    Nombre_Tour: reserva.Nombre_Tour || '',
                    Nombre_Reportante: reserva.Nombre_Reportante || '',
                    Idioma_Reserva: reserva.Idioma_Reserva || '',
                    Observaciones: reserva.Observaciones || '',
                    NumeroPasajeros: ocupados
                }]
            });

            paxPendientes = Math.max(0, paxPendientes - ocupados);
        }
    }

    return buses;
}


function getStopRoutes(stops) {
    return new Set((stops || []).map(stop => normalizeRoute(stop.ruta)).filter(Boolean));
}

function getStopsFromBus(bus) {
    return bus.__stops || groupReservationsByPoint(bus.reservas || []);
}

function getMinRouteDistanceBetweenStops(stopsA, stopsB) {
    let min = Number.MAX_SAFE_INTEGER;

    for (const stopA of stopsA || []) {
        for (const stopB of stopsB || []) {
            const distance = getRouteDistanceRank(stopA, stopB);
            if (distance < min) min = distance;
        }
    }

    return min;
}

function getMinGeoDistanceBetweenStops(stopsA, stopsB, context = null) {
    let min = Number.POSITIVE_INFINITY;

    for (const stopA of stopsA || []) {
        for (const stopB of stopsB || []) {
            const distancia = getDistanceKmForOrdering(stopA, stopB, context, { allowGraph: true });
            if (distancia < min) min = distancia;
        }
    }

    return min;
}

function canMixStopWithStops(stop, targetStops, { extended = false, context = null } = {}) {
    if (!targetStops.length) return true;

    const stopRoute = normalizeRoute(stop.ruta);
    const targetRoutes = getStopRoutes(targetStops);

    if (!stopRoute) return true;
    if (!targetRoutes.size) return true;

    for (const targetRoute of targetRoutes) {
        if (!rutasAdyacentes(stopRoute, targetRoute)) return false;
    }

    const geoDistance = getMinGeoDistanceBetweenStops([stop], targetStops, context);
    if (!Number.isFinite(geoDistance)) return true;

    const mismaRuta = targetRoutes.has(stopRoute);
    if (mismaRuta) return geoDistance <= 4;

    if (extended) return geoDistance <= 3.5;
    return geoDistance <= 2.5;
}

function canMergeOperationalBuses(stopsA, stopsB, { extended = false, context = null } = {}) {
    if (!stopsA.length || !stopsB.length) return true;

    const rutasA = getStopRoutes(stopsA);
    const rutasB = getStopRoutes(stopsB);

    if (!rutasA.size || !rutasB.size) return true;

    for (const rutaA of rutasA) {
        for (const rutaB of rutasB) {
            if (!rutasAdyacentes(rutaA, rutaB)) return false;
        }
    }

    if (!extended) {
        const distancia = getMinGeoDistanceBetweenStops(stopsA, stopsB, context);
        if (!Number.isFinite(distancia)) return true;
        return distancia <= 3;
    }

    return true;
}

function normalizeBusList(buses) {
    return (buses || [])
        .filter(bus => bus && Number(bus.ocupados || 0) > 0)
        .map((bus, index) => ({
            ...bus,
            id: `Bus ${index + 1}`
        }));
}

function tryMergeSmallBuses(buses, context = null) {
    const maxCapacity = CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1];
    let changed = true;

    while (changed) {
        changed = false;
        const orderedIndexes = buses
            .map((bus, index) => ({ index, ocupados: Number(bus.ocupados || 0) }))
            .sort((a, b) => a.ocupados - b.ocupados)
            .map(item => item.index);

        outer:
        for (const i of orderedIndexes) {
            if (!buses[i]) continue;

            for (let j = 0; j < buses.length; j++) {
                if (i === j || !buses[j]) continue;

                const a = buses[i];
                const b = buses[j];
                const totalPax = Number(a.ocupados || 0) + Number(b.ocupados || 0);
                if (totalPax > maxCapacity) continue;

                const stopsA = getStopsFromBus(a);
                const stopsB = getStopsFromBus(b);
                const verySmallBus = Number(a.ocupados || 0) <= Math.floor(maxCapacity * 0.45) || Number(b.ocupados || 0) <= Math.floor(maxCapacity * 0.45);
                if (!canMergeOperationalBuses(stopsA, stopsB, { extended: verySmallBus, context })) continue;

                const targetIndex = Number(a.ocupados || 0) >= Number(b.ocupados || 0) ? i : j;
                const sourceIndex = targetIndex === i ? j : i;
                const targetStops = getStopsFromBus(buses[targetIndex]);
                const sourceStops = getStopsFromBus(buses[sourceIndex]);
                buses[targetIndex] = buildBusFromStops(targetStops.concat(sourceStops), targetIndex + 1, context);
                buses.splice(sourceIndex, 1);
                changed = true;
                break outer;
            }
        }
    }

    return normalizeBusList(buses);
}

function getRouteBlockKey(stop) {
    const ruta = normalizeRoute(stop.ruta);
    return ruta || 'SIN_RUTA';
}

function buildRouteFirstBuses(stops, maxCapacity, context = null) {
    const orderedStops = sortStopsByRouteThenGeo(stops || [], context);
    const buses = [];
    let currentStops = [];
    let currentPax = 0;
    let currentRouteKey = null;

    const closeCurrentBus = () => {
        if (!currentStops.length) return;
        buses.push(buildBusFromStops(currentStops, buses.length + 1, context));
        currentStops = [];
        currentPax = 0;
        currentRouteKey = null;
    };

    for (const stop of orderedStops) {
        const routeKey = getRouteBlockKey(stop);
        const startsDifferentRoute = currentRouteKey !== null && routeKey !== currentRouteKey;
        const wouldOverflow = currentPax + stop.totalPax > maxCapacity;

        if (currentStops.length && (startsDifferentRoute || wouldOverflow)) {
            closeCurrentBus();
        }

        currentStops.push(stop);
        currentPax += stop.totalPax;
        currentRouteKey = routeKey;

        if (currentPax >= maxCapacity) {
            closeCurrentBus();
        }
    }

    closeCurrentBus();
    return buses;
}

function scoreTargetBusForStop(stop, bus, maxCapacity, { extended = false, context = null } = {}) {
    const targetStops = getStopsFromBus(bus);
    if (!canMixStopWithStops(stop, targetStops, { extended, context })) return Number.POSITIVE_INFINITY;

    const ocupados = Number(bus.ocupados || 0);
    const remainingAfter = maxCapacity - (ocupados + Number(stop.totalPax || 0));
    if (remainingAfter < 0) return Number.POSITIVE_INFINITY;

    const routeDistance = Math.min(...targetStops.map(targetStop => getRouteDistanceRank(stop, targetStop)));
    const geoDistance = getMinGeoDistanceBetweenStops([stop], targetStops, context);
    const sameRoute = targetStops.some(targetStop => normalizeRoute(targetStop.ruta) && normalizeRoute(targetStop.ruta) === normalizeRoute(stop.ruta));

    let score = remainingAfter;
    if (sameRoute) score -= 8;
    if (Number.isFinite(routeDistance)) score += Math.min(routeDistance, 10) * 2;
    if (Number.isFinite(geoDistance)) score += Math.min(geoDistance, 10) * 0.6;
    if (extended) score -= 2;

    return score;
}

function moveStopBetweenBuses(buses, sourceIndex, targetIndex, stopToMove, maxCapacity, context = null) {
    const sourceStops = getStopsFromBus(buses[sourceIndex]).filter(stop => stop.key !== stopToMove.key);
    const targetStops = getStopsFromBus(buses[targetIndex]).concat([stopToMove]);

    buses[targetIndex] = buildBusFromStops(targetStops, targetIndex + 1, context);

    if (sourceStops.length) {
        buses[sourceIndex] = buildBusFromStops(sourceStops, sourceIndex + 1, context);
    } else {
        buses.splice(sourceIndex, 1);
    }

    return normalizeBusList(buses);
}

function compactBusesByMovingStops(buses, context = null) {
    const maxCapacity = CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1];
    const hardLowOccupancy = Math.floor(maxCapacity * 0.65);
    let result = normalizeBusList(buses);
    let changed = true;
    let safety = 0;

    while (changed && safety < 250) {
        safety += 1;
        changed = false;

        const sourceIndexes = result
            .map((bus, index) => ({ index, ocupados: Number(bus.ocupados || 0) }))
            .filter(item => item.ocupados > 0 && item.ocupados < hardLowOccupancy)
            .sort((a, b) => a.ocupados - b.ocupados)
            .map(item => item.index);

        outer:
        for (const sourceIndex of sourceIndexes) {
            const sourceBus = result[sourceIndex];
            if (!sourceBus) continue;

            const sourceStops = getStopsFromBus(sourceBus)
                .slice()
                .sort((a, b) => Number(b.totalPax || 0) - Number(a.totalPax || 0));

            for (const stop of sourceStops) {
                let bestTargetIndex = -1;
                let bestScore = Number.POSITIVE_INFINITY;
                const sourceIsVerySmall = Number(sourceBus.ocupados || 0) <= Math.floor(maxCapacity * 0.45);

                for (let targetIndex = 0; targetIndex < result.length; targetIndex++) {
                    if (targetIndex === sourceIndex) continue;
                    const targetBus = result[targetIndex];
                    if (!targetBus) continue;
                    if (Number(targetBus.ocupados || 0) + Number(stop.totalPax || 0) > maxCapacity) continue;

                    const extended = sourceIsVerySmall || Number(targetBus.ocupados || 0) <= Math.floor(maxCapacity * 0.5);
                    const score = scoreTargetBusForStop(stop, targetBus, maxCapacity, { extended, context });
                    if (score < bestScore) {
                        bestScore = score;
                        bestTargetIndex = targetIndex;
                    }
                }

                if (bestTargetIndex !== -1 && Number.isFinite(bestScore)) {
                    result = moveStopBetweenBuses(result, sourceIndex, bestTargetIndex, stop, maxCapacity, context);
                    changed = true;
                    break outer;
                }
            }
        }
    }

    return normalizeBusList(result);
}

function bestFitRouteAwareBuses(stops, maxCapacity, context = null) {
    const orderedStops = sortStopsByRouteThenGeo(stops || [], context);
    const buses = [];

    for (const stop of orderedStops) {
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;

        for (let index = 0; index < buses.length; index++) {
            const bus = buses[index];
            if (Number(bus.ocupados || 0) + Number(stop.totalPax || 0) > maxCapacity) continue;

            const score = scoreTargetBusForStop(stop, bus, maxCapacity, { extended: false, context });
            if (score < bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }

        if (bestIndex === -1) {
            buses.push(buildBusFromStops([stop], buses.length + 1, context));
        } else {
            const targetStops = getStopsFromBus(buses[bestIndex]).concat([stop]);
            buses[bestIndex] = buildBusFromStops(targetStops, bestIndex + 1, context);
        }
    }

    return normalizeBusList(buses);
}

function getBusCountWithPayload(buses) {
    return {
        count: buses.length,
        totalEmptySeats: buses.reduce((sum, bus) => sum + Math.max(0, Number(bus.capacidad || 0) - Number(bus.ocupados || 0)), 0),
        minOccupancy: buses.reduce((min, bus) => Math.min(min, Number(bus.ocupados || 0)), Number.POSITIVE_INFINITY)
    };
}

function chooseBestBusPlan(plans) {
    return plans
        .filter(plan => Array.isArray(plan.buses) && plan.buses.length)
        .sort((a, b) => {
            const scoreA = getBusCountWithPayload(a.buses);
            const scoreB = getBusCountWithPayload(b.buses);
            if (scoreA.count !== scoreB.count) return scoreA.count - scoreB.count;
            if (scoreA.totalEmptySeats !== scoreB.totalEmptySeats) return scoreA.totalEmptySeats - scoreB.totalEmptySeats;
            return scoreB.minOccupancy - scoreA.minOccupancy;
        })[0]?.buses || [];
}

function optimizeBusesCapacity(stops, maxCapacity, context = null) {
    const routeFirst = buildRouteFirstBuses(stops, maxCapacity, context);
    const routeFirstCompacted = compactBusesByMovingStops(tryMergeSmallBuses(routeFirst, context), context);
    const bestFit = compactBusesByMovingStops(tryMergeSmallBuses(bestFitRouteAwareBuses(stops, maxCapacity, context), context), context);

    return chooseBestBusPlan([
        { name: 'routeFirst', buses: routeFirst },
        { name: 'routeFirstCompacted', buses: routeFirstCompacted },
        { name: 'bestFit', buses: bestFit }
    ]);
}

// Distancia pública conservada por compatibilidad. Para programación interna se usa getDistanceKmForOrdering().
async function getDistanceKmBetweenStops(a, b) {
    return haversineKm(a, b);
}

async function obtenerCoordenadasTours(tours) {
    // Consulta las coordenadas de destino por tour.
    // Devuelve { "Id_Tour": { Latitud, Longitud } } solo para tours con coordenadas válidas.
    // Tours sin coordenadas (ej: Tour de Compras, Tour de Luces) no aparecen en el mapa
    // y el algoritmo de ordenamiento se comporta igual que antes para ellos.
    try {
        const estacionPobladoId = Number(process.env.PUNTOS_ESTACION_POBLADO_ID || 6);
        const [rows] = await db.query(
            `
            SELECT
                t.Id_Tour,
                t.Nombre_Tour,
                t.Latitud,
                t.Longitud,
                (
                    SELECT h.Hora_Salida
                    FROM horarios h
                    WHERE h.Id_Tour = t.Id_Tour
                      AND h.Id_Punto = ?
                    ORDER BY h.Id_Horario DESC
                    LIMIT 1
                ) AS Hora_Salida_Base
            FROM tours t
            WHERE t.Id_Tour IN (?)
              AND t.Latitud IS NOT NULL
              AND t.Longitud IS NOT NULL
            `,
            [estacionPobladoId, tours]
        );
        const mapa = {};
        for (const row of rows || []) {
            const lat = Number(row.Latitud);
            const lon = Number(row.Longitud);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                mapa[String(row.Id_Tour)] = {
                    Id_Tour: Number(row.Id_Tour),
                    Nombre_Tour: row.Nombre_Tour || null,
                    Latitud: lat,
                    Longitud: lon,
                    Hora_Salida_Base: row.Hora_Salida_Base || null
                };
            }
        }
        return mapa;
    } catch (err) {
        // No es crítico: si falla, el algoritmo funciona igual que antes sin attraction point.
        console.warn('[PROGRAMACION] No se pudieron obtener coordenadas de tours para orientación de ruta:', err.message);
        return {};
    }
}

function resolverDestinoTour(tours, tourDestinos = {}) {
    const ids = Array.isArray(tours) ? tours.map((id) => Number(id)).filter((id) => id > 0) : [Number(tours)].filter((id) => id > 0);
    if (!ids.length) return null;

    const primaryTourId = ids.includes(5) ? 5 : ids[0];
    const destino = tourDestinos[String(primaryTourId)] || tourDestinos[String(ids[0])];
    if (!destino) return null;

    const lat = Number(destino.Latitud);
    const lng = Number(destino.Longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
        idTour: Number(destino.Id_Tour || primaryTourId),
        lat,
        lng,
        nombre: destino.Nombre_Tour || `Tour ${primaryTourId}`,
        horaSalidaBase: destino.Hora_Salida_Base || null
    };
}

async function generarPlanLogistico(fecha, idsTours) {
    try {
        const tours = Array.isArray(idsTours) ? idsTours : [idsTours];
        const reservas = await obtenerReservas(fecha, tours);
        const tourDestinos = await obtenerCoordenadasTours(tours);
        const destinoTour = resolverDestinoTour(tours, tourDestinos);
        if (reservas.length === 0) return { buses: [], reservasSinAsignar: [], alertas: [], destinoTour };

        const maxCapacity = CONFIG.CAPACIDADES_BUSES[CONFIG.CAPACIDADES_BUSES.length - 1];
        const reservasSinAsignar = [];
        const alertas = reservas
            .filter(reserva => reserva.requiereRevision)
            .map(reserva => ({
                tipo: 'RESERVA_MULTIPUNTO_RUTAS_DISTINTAS',
                Id_Reserva: reserva.Id_Reserva,
                mensaje: reserva.motivoRevision || 'Reserva con puntos de recogida que requieren revisión.'
            }));

        // Cargar coordenadas de destino por tour para orientar el orden de recogida.
        // Solo afecta tours con Latitud/Longitud definidas en la tabla tours.
        const toursConDestino = Object.keys(tourDestinos);
        if (toursConDestino.length > 0) {
            console.log(`[PROGRAMACION] Attraction points cargados para tours: ${toursConDestino.join(', ')}`);
        }

        const graphContext = createGraphUsageContext(tourDestinos);
        const stopsIniciales = groupReservationsByPoint(reservas);
        const stops = sortStopsByRouteThenGeo(splitOversizedStops(stopsIniciales, maxCapacity, reservasSinAsignar), graphContext);
        const busesConDistancias = updateBusesWithControlledGraphKm(optimizeBusesCapacity(stops, maxCapacity, graphContext), graphContext);
        const busesOptimizados = busesConDistancias
            .map(({ __stops, ...bus }) => ({
                ...bus,
                reservas: sortBusReservations(bus, graphContext).map(({ __ordenOriginal, __paxEnEstePunto, ...reserva }) => reserva),
            }));

        const busesResumen = busesOptimizados.map((bus, index) => ({
            bus: bus.id || `Bus ${index + 1}`,
            ocupados: bus.ocupados,
            capacidad: bus.capacidad,
            reservas: Array.isArray(bus.reservas) ? bus.reservas.length : 0,
            paradas: Array.isArray(bus.paradas)
                ? bus.paradas.map((parada) => ({
                    orden: parada.orden,
                    NombrePunto: parada.NombrePunto,
                    ruta: parada.ruta,
                    totalPax: parada.totalPax
                }))
                : []
        }));

        console.log(`[PROGRAMACION] Plan logístico generado: fecha=${fecha}, tours=${tours.join(',')}, buses=${busesOptimizados.length}, reservasSinAsignar=${reservasSinAsignar.length}, alertas=${alertas.length}, graphCalls=${graphContext.calls}, graphLookups=${graphContext.nearestLookups}, graphAstar=${graphContext.astarRuns}, graphFallbacks=${graphContext.fallbacks}, ms=${Date.now() - graphContext.startedAt}`);
        console.log('[PROGRAMACION] Resumen de buses:', JSON.stringify(busesResumen, null, 2));
        return { buses: busesOptimizados, reservasSinAsignar, alertas, destinoTour };

    } catch (error) {
        console.error("Fallo crítico en la generación del plan logístico:", error);
        throw new Error(error.message || "Ocurrió un error inesperado al procesar la solicitud.");
    }
}


function normalizeDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function createValidationError(message, errores = []) {
    const error = new Error(message);
    error.statusCode = 400;
    error.errorCode = 'LISTADO_VALIDATION_ERROR';
    error.details = errores;
    return error;
}

function getEstadoReservaNormalizado(estado) {
    return String(estado || '').trim().toLowerCase();
}

async function validarIntegridadBuses(conn, { fecha, tours, buses }) {
    const errores = [];
    const reservasPlan = [];
    const reservasPorBus = new Map();
    const reservasDuplicadas = new Set();

    for (let i = 0; i < buses.length; i++) {
        const bus = buses[i] || {};
        const placa = String(bus.id || '').trim() || `Bus ${i + 1}`;
        const reservasBus = Array.isArray(bus.reservas) ? bus.reservas : [];

        for (let r = 0; r < reservasBus.length; r++) {
            const idReserva = reservasBus[r]?.Id_Reserva ? String(reservasBus[r].Id_Reserva).trim() : '';
            if (!idReserva) {
                errores.push(`El ${placa} contiene una reserva sin Id_Reserva.`);
                continue;
            }

            if (reservasPorBus.has(idReserva)) {
                reservasDuplicadas.add(idReserva);
                errores.push(`La reserva ${idReserva} aparece en más de un bus.`);
                continue;
            }

            reservasPorBus.set(idReserva, { placa, orden: r + 1, busIndex: i });
            reservasPlan.push(idReserva);
        }
    }

    if (errores.length) {
        throw createValidationError('El listado contiene reservas inválidas o duplicadas.', errores);
    }

    if (!reservasPlan.length && buses.length > 0) {
        throw createValidationError('No se encontraron reservas válidas dentro de los buses enviados.', [
            'Cada bus debe incluir reservas con Id_Reserva.'
        ]);
    }

    const reservasDb = new Map();

    if (reservasPlan.length) {
        const [rows] = await conn.query(
            `
            SELECT
                r.Id_Reserva,
                h.Id_Tour,
                r.Fecha_Tour,
                r.Estado,
                r.Tipo_Reserva,
                COUNT(p.Id_Pasajero) AS NumeroPasajeros
            FROM reservas r
            INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
            LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
            WHERE r.Id_Reserva IN (?)
            GROUP BY r.Id_Reserva, h.Id_Tour, r.Fecha_Tour, r.Estado, r.Tipo_Reserva
            `,
            [reservasPlan]
        );

        for (const row of rows || []) {
            reservasDb.set(String(row.Id_Reserva), {
                ...row,
                NumeroPasajeros: Number(row.NumeroPasajeros || 0)
            });
        }
    }

    for (const idReserva of reservasPlan) {
        const reserva = reservasDb.get(String(idReserva));
        if (!reserva) {
            errores.push(`La reserva ${idReserva} no existe en la base de datos.`);
            continue;
        }

        if (normalizeDateOnly(reserva.Fecha_Tour) !== normalizeDateOnly(fecha)) {
            errores.push(`La reserva ${idReserva} no pertenece a la fecha ${fecha}.`);
        }

        if (!tours.map(String).includes(String(reserva.Id_Tour))) {
            errores.push(`La reserva ${idReserva} no pertenece a los tours del listado.`);
        }

        const estado = getEstadoReservaNormalizado(reserva.Estado);
        if (estado === 'cancelada' || estado === 'rechazada') {
            errores.push(`La reserva ${idReserva} está ${reserva.Estado} y no puede asignarse.`);
        }

        if (reserva.Tipo_Reserva !== 'Grupal') {
            errores.push(`La reserva ${idReserva} no es de tipo Grupal.`);
        }

        if (!reserva.NumeroPasajeros || reserva.NumeroPasajeros <= 0) {
            errores.push(`La reserva ${idReserva} no tiene pasajeros registrados.`);
        }
    }

    if (errores.length) {
        throw createValidationError('El listado no coincide con las reservas reales de la base de datos.', errores);
    }

    const busesValidados = buses.map((bus, index) => {
        const placa = String(bus?.id || '').trim() || `Bus ${index + 1}`;
        const capacidadFrontend = Number(bus?.capacidad || 0);
        const capacidad = Number.isFinite(capacidadFrontend) && capacidadFrontend > 0
            ? capacidadFrontend
            : CAPACIDAD_BUS_GENERACION;

        const reservasBus = Array.isArray(bus?.reservas) ? bus.reservas : [];
        const reservasValidadas = reservasBus.map((reserva, reservaIndex) => {
            const idReserva = String(reserva.Id_Reserva).trim();
            const reservaDb = reservasDb.get(idReserva);
            return {
                idReserva,
                placa,
                orden: reservaIndex + 1,
                pasajeros: reservaDb.NumeroPasajeros
            };
        });

        const ocupados = reservasValidadas.reduce((sum, reserva) => sum + reserva.pasajeros, 0);

        if (ocupados > capacidad) {
            errores.push(`${placa} supera la capacidad permitida: ${ocupados}/${capacidad}.`);
        }

        return {
            placa,
            capacidad,
            ocupados,
            guia: bus?.guia ? String(bus.guia).trim() : null,
            reservas: reservasValidadas
        };
    });

    if (errores.length) {
        throw createValidationError('Uno o más buses superan la capacidad o tienen datos inválidos.', errores);
    }

    await validarAsignacionesOperativasFecha(conn, {
        fecha,
        tipoProgramacion: 'grupal',
        buses: busesValidados
    });

    return {
        buses: busesValidados,
        totalReservas: reservasPlan.length
    };
}

function normalizarAsignacionOperativa(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function esIdentificadorGenericoBus(value) {
    return /^(BUS|PRIVADO|VEHICULO|VEHÍCULO)\s*\d+$/i.test(String(value || '').trim());
}

function normalizarPlaca(value) {
    return normalizarAsignacionOperativa(value).replace(/[^A-Z0-9]/g, '');
}

function detectarDuplicadosAsignacion(buses) {
    const errores = [];
    const placas = new Map();
    const guias = new Map();

    for (let index = 0; index < (buses || []).length; index += 1) {
        const bus = buses[index] || {};
        const label = String(bus.placa || '').trim() || `Bus ${index + 1}`;
        const placa = esIdentificadorGenericoBus(bus.placa) ? '' : normalizarPlaca(bus.placa);
        const guia = normalizarAsignacionOperativa(bus.guia);

        if (placa) {
            if (placas.has(placa)) errores.push(`La placa ${label} también está asignada a ${placas.get(placa)}.`);
            else placas.set(placa, label);
        }
        if (guia) {
            if (guias.has(guia)) errores.push(`El guía ${bus.guia} también está asignado a ${guias.get(guia)}.`);
            else guias.set(guia, label);
        }
    }

    return errores;
}

async function validarAsignacionesOperativasFecha(conn, { fecha, tipoProgramacion, buses }) {
    const errores = detectarDuplicadosAsignacion(buses);
    const [activeBuses] = await conn.query(
        `
        SELECT pb.Placa_Display, pb.Guia, pb.Orden_Bus, COALESCE(pb.Tipo_Bus, 'grupal') AS Tipo_Bus,
               COALESCE(p.Tipo_Programacion, 'grupal') AS Tipo_Programacion
        FROM programacion_buses pb
        INNER JOIN programaciones p ON p.Id_Programacion = pb.Id_Programacion
        WHERE p.Fecha_Tour = ?
          AND p.Estado = 'activa'
        ORDER BY pb.Id_Bus_Prog ASC
        FOR UPDATE
        `,
        [fecha]
    );
    const existingBuses = (activeBuses || []).filter(bus => bus.Tipo_Programacion !== tipoProgramacion);

    for (let index = 0; index < (buses || []).length; index += 1) {
        const bus = buses[index] || {};
        const label = String(bus.placa || '').trim() || `Bus ${index + 1}`;
        const placa = esIdentificadorGenericoBus(bus.placa) ? '' : normalizarPlaca(bus.placa);
        const guia = normalizarAsignacionOperativa(bus.guia);

        for (const existing of existingBuses || []) {
            const existingLabel = String(existing.Placa_Display || '').trim()
                || `${existing.Tipo_Bus === 'privado' ? 'Privado' : 'Bus'} ${existing.Orden_Bus}`;
            if (placa && !esIdentificadorGenericoBus(existing.Placa_Display)
                && placa === normalizarPlaca(existing.Placa_Display)) {
                errores.push(`La placa ${label} ya está asignada a ${existingLabel} en esta fecha.`);
            }
            if (guia && guia === normalizarAsignacionOperativa(existing.Guia)) {
                errores.push(`El guía ${bus.guia} ya está asignado a ${existingLabel} en esta fecha.`);
            }
        }
    }

    if (errores.length) {
        throw createValidationError(
            'No se puede guardar la programación porque hay placas o guías repetidos en la misma fecha.',
            [...new Set(errores)]
        );
    }
}

function toNullableNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function getSnapshotPointRowsFromReservas(reservas) {
    const pointsMap = new Map();
    let originalIndex = 0;

    for (const reserva of reservas || []) {
        for (const punto of reserva.puntosReserva || []) {
            const key = punto.Id_Punto ? `punto-${punto.Id_Punto}` : `nombre-${String(punto.NombrePunto || 'SIN_PUNTO').trim().toUpperCase()}`;
            if (!pointsMap.has(key)) {
                pointsMap.set(key, {
                    key,
                    Id_Punto: punto.Id_Punto || null,
                    NombrePunto: punto.NombrePunto || 'SIN_PUNTO',
                    Latitud: punto.Latitud !== null && punto.Latitud !== undefined ? Number(punto.Latitud) : null,
                    Longitud: punto.Longitud !== null && punto.Longitud !== undefined ? Number(punto.Longitud) : null,
                    ruta: normalizeRoute(punto.ruta),
                    ordenRuta: punto.ordenRuta !== null && punto.ordenRuta !== undefined ? Number(punto.ordenRuta) : null,
                    Posicion: punto.Posicion !== null && punto.Posicion !== undefined ? Number(punto.Posicion) : null,
                    totalPax: 0,
                    reservas: [],
                    originalIndex: originalIndex++
                });
            }

            const snapPoint = pointsMap.get(key);
            snapPoint.totalPax += Number(punto.pasajeros || 0);
            snapPoint.reservas.push(reserva);
        }
    }

    return sortStopsByRouteThenGeo(Array.from(pointsMap.values()));
}

async function obtenerReservasSnapshotPorIds(conn, reservaIds) {
    if (!Array.isArray(reservaIds) || !reservaIds.length) return new Map();

    const [rows] = await conn.query(
        `
        SELECT
            r.Id_Reserva,
            h.Id_Tour,
            r.Fecha_Tour,
            r.Estado,
            r.Tipo_Reserva,
            r.Nombre_Reportante,
            r.Idioma_Reserva,
            r.Observaciones,
            p.Id_Pasajero,
            p.Id_Punto,
            pt.Nombre_Punto AS NombrePunto,
            pt.Latitud,
            pt.Longitud,
            pt.ruta,
            pt.posicion AS ordenRuta,
            pt.posicion AS Posicion,
            pc.NumeroPasajeros
        FROM reservas r
        INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
        INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
        INNER JOIN (
            SELECT Id_Reserva, COUNT(Id_Pasajero) AS NumeroPasajeros
            FROM pasajeros
            WHERE Id_Reserva IN (?)
            GROUP BY Id_Reserva
        ) pc ON pc.Id_Reserva = r.Id_Reserva
        WHERE r.Id_Reserva IN (?)
        ORDER BY
            r.Id_Reserva ASC,
            COALESCE(CAST(pt.ruta AS UNSIGNED), 999999) ASC,
            COALESCE(pt.posicion, 999999) ASC,
            p.Id_Pasajero ASC
        `,
        [reservaIds, reservaIds]
    );

    return new Map(
        construirReservasDesdeFilasPasajeros(rows || []).map(reserva => [String(reserva.Id_Reserva), reserva])
    );
}

async function guardarSnapshotProgramacion(conn, { fecha, tours, primaryTourId, busesValidados, userId = null }) {
    const reservaIds = busesValidados.flatMap(bus => bus.reservas.map(reserva => reserva.idReserva));
    const reservasSnapshotMap = await obtenerReservasSnapshotPorIds(conn, reservaIds);

    await conn.query(
        `
        UPDATE programaciones p
        INNER JOIN programacion_tours pt ON pt.Id_Programacion = p.Id_Programacion
        SET
            p.Estado = 'anulada',
            p.Anulada_En = NOW(),
            p.Anulada_Por = ?,
            p.Motivo_Anulacion = 'Reemplazada por una nueva confirmación del listado.'
        WHERE p.Fecha_Tour = ?
          AND p.Estado = 'activa'
          AND p.Tipo_Programacion = 'grupal'
          AND pt.Id_Tour IN (?)
        `,
        [userId || null, fecha, tours]
    );

    const [programacionResult] = await conn.query(
        `
        INSERT INTO programaciones
        (Fecha_Tour, Id_Tour, Confirmado_Por, Estado, Tipo_Programacion)
        VALUES (?, ?, ?, 'activa', 'grupal')
        `,
        [fecha, primaryTourId, userId || null]
    );

    const idProgramacion = programacionResult.insertId;

    for (const idTour of tours) {
        await conn.query(
            `
            INSERT INTO programacion_tours (Id_Programacion, Id_Tour)
            VALUES (?, ?)
            `,
            [idProgramacion, idTour]
        );
    }

    for (let busIndex = 0; busIndex < busesValidados.length; busIndex++) {
        const bus = busesValidados[busIndex];
        const reservasBusSnapshot = bus.reservas
            .map(reserva => reservasSnapshotMap.get(String(reserva.idReserva)))
            .filter(Boolean);

        const paradas = getSnapshotPointRowsFromReservas(reservasBusSnapshot);
        const recorridoKm = estimateRouteKm(paradas);

        const [busResult] = await conn.query(
            `
            INSERT INTO programacion_buses
            (Id_Programacion, Placa_Display, Capacidad, Pasajeros_Total, Guia, Recorrido_Km, Orden_Bus)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [idProgramacion, bus.placa, bus.capacidad, bus.ocupados, bus.guia || null, recorridoKm, busIndex + 1]
        );

        const idBusProg = busResult.insertId;

        for (const reserva of bus.reservas) {
            const snap = reservasSnapshotMap.get(String(reserva.idReserva));
            if (!snap) {
                throw createValidationError('No se pudo crear el snapshot del listado.', [
                    `No se encontró información congelable para la reserva ${reserva.idReserva}.`
                ]);
            }

            await conn.query(
                `
                INSERT INTO programacion_reservas
                (
                    Id_Bus_Prog,
                    Id_Reserva,
                    Orden_En_Bus,
                    Num_Pasajeros_Snap,
                    Id_Tour_Snap,
                    Fecha_Tour_Snap,
                    Estado_Snap,
                    Tipo_Reserva_Snap,
                    Nombre_Reportante_Snap,
                    Idioma_Reserva_Snap,
                    Observaciones_Snap,
                    Id_Punto_Principal_Snap,
                    Nombre_Punto_Principal_Snap,
                    Latitud_Principal_Snap,
                    Longitud_Principal_Snap,
                    Ruta_Principal_Snap,
                    Posicion_Principal_Snap,
                    Requiere_Revision,
                    Motivo_Revision
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    idBusProg,
                    snap.Id_Reserva,
                    reserva.orden,
                    snap.NumeroPasajeros,
                    snap.Id_Tour,
                    normalizeDateOnly(snap.Fecha_Tour),
                    snap.Estado || null,
                    snap.Tipo_Reserva || null,
                    snap.Nombre_Reportante || snap.NombreReporta || null,
                    snap.Idioma_Reserva || snap.IdiomaReserva || null,
                    snap.Observaciones || null,
                    snap.Id_Punto || null,
                    snap.NombrePunto || null,
                    toNullableNumber(snap.Latitud),
                    toNullableNumber(snap.Longitud),
                    snap.ruta || null,
                    getRouteOrder(snap),
                    snap.requiereRevision ? 1 : 0,
                    snap.motivoRevision || null
                ]
            );
        }

        for (let paradaIndex = 0; paradaIndex < paradas.length; paradaIndex++) {
            const parada = paradas[paradaIndex];
            await conn.query(
                `
                INSERT INTO programacion_paradas
                (
                    Id_Bus_Prog,
                    Orden_Parada,
                    Id_Punto_Snap,
                    Nombre_Snap,
                    Latitud_Snap,
                    Longitud_Snap,
                    Ruta_Snap,
                    Posicion_Snap,
                    Pasajeros_Total_Snap
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    idBusProg,
                    paradaIndex + 1,
                    parada.Id_Punto || null,
                    parada.NombrePunto || 'SIN_PUNTO',
                    toNullableNumber(parada.Latitud),
                    toNullableNumber(parada.Longitud),
                    parada.ruta || null,
                    getRouteOrder(parada),
                    Number(parada.totalPax || 0)
                ]
            );
        }
    }

    return idProgramacion;
}

async function obtenerListadoSnapshot({ fecha, idsTours }) {
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];

    const [programacionesRows] = await db.query(
        `
        SELECT DISTINCT p.Id_Programacion, p.Fecha_Tour, p.Id_Tour, p.Confirmado_En, p.Confirmado_Por
        FROM programaciones p
        INNER JOIN programacion_tours pt ON pt.Id_Programacion = p.Id_Programacion
        WHERE p.Fecha_Tour = ?
          AND p.Estado = 'activa'
          AND p.Tipo_Programacion = 'grupal'
          AND pt.Id_Tour IN (?)
        ORDER BY p.Confirmado_En DESC, p.Id_Programacion DESC
        LIMIT 1
        `,
        [fecha, tours]
    );

    const programacion = programacionesRows?.[0];
    if (!programacion) return null;

    const [busesRows] = await db.query(
        `
        SELECT Id_Bus_Prog, Placa_Display, Capacidad, Pasajeros_Total, Guia, Recorrido_Km, Orden_Bus
        FROM programacion_buses
        WHERE Id_Programacion = ?
        ORDER BY Orden_Bus ASC, Id_Bus_Prog ASC
        `,
        [programacion.Id_Programacion]
    );

    const busIds = (busesRows || []).map(bus => bus.Id_Bus_Prog);
    if (!busIds.length) {
        return {
            exists: true,
            fromSnapshot: true,
            idProgramacion: programacion.Id_Programacion,
            buses: [],
            reservasSinAsignar: []
        };
    }

    const [reservasRows] = await db.query(
        `
        SELECT *
        FROM programacion_reservas
        WHERE Id_Bus_Prog IN (?)
        ORDER BY Id_Bus_Prog ASC, Orden_En_Bus ASC
        `,
        [busIds]
    );

    const [paradasRows] = await db.query(
        `
        SELECT *
        FROM programacion_paradas
        WHERE Id_Bus_Prog IN (?)
        ORDER BY Id_Bus_Prog ASC, Orden_Parada ASC
        `,
        [busIds]
    );

    const reservasPorBus = new Map();
    for (const row of reservasRows || []) {
        if (!reservasPorBus.has(row.Id_Bus_Prog)) reservasPorBus.set(row.Id_Bus_Prog, []);
        reservasPorBus.get(row.Id_Bus_Prog).push({
            Id_Reserva: row.Id_Reserva,
            Id_Tour: row.Id_Tour_Snap,
            Fecha_Tour: row.Fecha_Tour_Snap,
            Estado: row.Estado_Snap,
            Tipo_Reserva: row.Tipo_Reserva_Snap,
            Nombre_Reportante: row.Nombre_Reportante_Snap,
            NombreReporta: row.Nombre_Reportante_Snap,
            Idioma_Reserva: row.Idioma_Reserva_Snap,
            IdiomaReserva: row.Idioma_Reserva_Snap,
            Observaciones: row.Observaciones_Snap,
            NumeroPasajeros: Number(row.Num_Pasajeros_Snap || 0),
            Id_Punto: row.Id_Punto_Principal_Snap,
            NombrePunto: row.Nombre_Punto_Principal_Snap || 'SIN_PUNTO',
            Latitud: row.Latitud_Principal_Snap !== null && row.Latitud_Principal_Snap !== undefined ? Number(row.Latitud_Principal_Snap) : null,
            Longitud: row.Longitud_Principal_Snap !== null && row.Longitud_Principal_Snap !== undefined ? Number(row.Longitud_Principal_Snap) : null,
            ruta: row.Ruta_Principal_Snap || null,
            ordenRuta: row.Posicion_Principal_Snap !== null && row.Posicion_Principal_Snap !== undefined ? Number(row.Posicion_Principal_Snap) : null,
            Posicion: row.Posicion_Principal_Snap !== null && row.Posicion_Principal_Snap !== undefined ? Number(row.Posicion_Principal_Snap) : null,
            Orden_Ruta: row.Orden_En_Bus !== null && row.Orden_En_Bus !== undefined ? Number(row.Orden_En_Bus) : null,
            Placa_Bus: null,
            requiereRevision: Boolean(row.Requiere_Revision),
            motivoRevision: row.Motivo_Revision || null,
            snapshot: true
        });
    }

    const paradasPorBus = new Map();
    for (const row of paradasRows || []) {
        if (!paradasPorBus.has(row.Id_Bus_Prog)) paradasPorBus.set(row.Id_Bus_Prog, []);
        paradasPorBus.get(row.Id_Bus_Prog).push({
            orden: Number(row.Orden_Parada || 0),
            Id_Punto: row.Id_Punto_Snap || null,
            NombrePunto: row.Nombre_Snap || 'SIN_PUNTO',
            Latitud: row.Latitud_Snap !== null && row.Latitud_Snap !== undefined ? Number(row.Latitud_Snap) : null,
            Longitud: row.Longitud_Snap !== null && row.Longitud_Snap !== undefined ? Number(row.Longitud_Snap) : null,
            ruta: row.Ruta_Snap || null,
            ordenRuta: row.Posicion_Snap !== null && row.Posicion_Snap !== undefined ? Number(row.Posicion_Snap) : null,
            totalPax: Number(row.Pasajeros_Total_Snap || 0)
        });
    }

    const buses = (busesRows || []).map((bus, index) => {
        const placa = bus.Placa_Display ? String(bus.Placa_Display).trim() : `Bus ${index + 1}`;
        const paradasBus = paradasPorBus.get(bus.Id_Bus_Prog) || [];
        const reservas = (reservasPorBus.get(bus.Id_Bus_Prog) || []).map(reserva => ({
            ...reserva,
            Placa_Bus: placa,
            // Reconstruir puntosReserva desde el snapshot de paradas.
            // El snapshot guarda el puntoPrincipal en la reserva, no los puntos individuales.
            // Al cargar, propagamos ese punto como el único punto conocido de la reserva
            // para que el frontend pueda agrupar correctamente en la vista de paradas.
            puntosReserva: reserva.Id_Punto
                ? [{
                    Id_Punto: reserva.Id_Punto,
                    NombrePunto: reserva.NombrePunto || 'SIN_PUNTO',
                    Latitud: reserva.Latitud,
                    Longitud: reserva.Longitud,
                    ruta: reserva.ruta || null,
                    ordenRuta: reserva.ordenRuta,
                    Posicion: reserva.Posicion,
                    pasajeros: reserva.NumeroPasajeros
                }]
                : []
        }));

        return {
            id: placa,
            capacidad: Number(bus.Capacidad || 0),
            ocupados: Number(bus.Pasajeros_Total || 0),
            reservas,
            recorridoKm: bus.Recorrido_Km !== null && bus.Recorrido_Km !== undefined ? Number(bus.Recorrido_Km) : estimateRouteKm(groupReservationsByPoint(reservas)),
            guia: bus.Guia || '',
            paradas: paradasBus
        };
    });

    return {
        exists: true,
        fromSnapshot: true,
        idProgramacion: programacion.Id_Programacion,
        confirmadoEn: programacion.Confirmado_En,
        buses,
        reservasSinAsignar: []
    };
}

function resumirPlanParaComparacion(plan, reservasEsperadas = []) {
    const buses = Array.isArray(plan?.buses) ? plan.buses : [];
    const apariciones = new Map();

    for (const bus of buses) {
        for (const reserva of bus?.reservas || []) {
            const id = String(reserva?.Id_Reserva || '').trim();
            if (!id) continue;
            apariciones.set(id, (apariciones.get(id) || 0) + 1);
        }
    }

    const idsEsperados = new Set(
        (reservasEsperadas || [])
            .map(reserva => String(reserva?.Id_Reserva || '').trim())
            .filter(Boolean)
    );
    const reservasDuplicadas = Array.from(apariciones.values()).filter(cantidad => cantidad > 1).length;
    const reservasOmitidas = Array.from(idsEsperados).filter(id => !apariciones.has(id)).length;
    const cargas = buses.map(bus => Number(bus?.ocupados || 0));
    const busesBilingues = buses.filter(bus => (
        (bus?.reservas || []).some(reserva => {
            const idioma = String(reserva?.Idioma_Reserva || reserva?.IdiomaReserva || '')
                .trim()
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
            return idioma.includes('INGLES');
        })
    )).length;

    return {
        totalBuses: buses.length,
        busesCompletos: cargas.filter(carga => carga === CAPACIDAD_BUS_GENERACION).length,
        busesBilingues,
        cargas,
        pasajeros: cargas.reduce((sum, carga) => sum + carga, 0),
        sillasVacias: buses.reduce(
            (sum, bus) => sum + Math.max(0, CAPACIDAD_BUS_GENERACION - Number(bus?.ocupados || 0)),
            0
        ),
        distanciaTotalKm: Number(
            buses.reduce((sum, bus) => sum + Number(bus?.recorridoKm || 0), 0).toFixed(2)
        ),
        reservasDuplicadas,
        reservasOmitidas,
        reservasSinAsignar: Array.isArray(plan?.reservasSinAsignar)
            ? plan.reservasSinAsignar.length
            : 0,
    };
}

/**
 * Banco de pruebas lógico. No persiste ni reemplaza la programación actual.
 * Ejecuta ambos motores sobre la misma fecha y devuelve métricas comparables.
 */
async function generarComparacionLogisticaShadow(fecha, idsTours, opciones = {}) {
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];
    const [planActual, reservas, tourDestinos] = await Promise.all([
        generarPlanLogistico(fecha, tours),
        obtenerReservas(fecha, tours),
        obtenerCoordenadasTours(tours),
    ]);
    const destinoTour = resolverDestinoTour(tours, tourDestinos);
    const reservasNormalizadas = normalizarReservasSombra(reservas);
    const puntosMatriz = [
        CONFIG.PUNTO_BASE,
        destinoTour,
        ...reservasNormalizadas.flatMap(reserva => reserva.puntos),
    ].filter(Boolean);
    const matrizDistancias = await prepararMatrizOSRM({ puntos: puntosMatriz });
    const planSombra = generarPlanSombra({
        reservas,
        puntoBase: CONFIG.PUNTO_BASE,
        destino: destinoTour,
        maxGuiasBilingues: opciones?.maxGuiasBilingues ?? null,
        distancias: matrizDistancias.contexto,
        fuenteDistancias: matrizDistancias.fuente,
        metadataDistancias: matrizDistancias.metadata,
    });
    if (matrizDistancias.metadata?.motivoFallback
        && matrizDistancias.metadata?.osrmConfigurado) {
        planSombra.alertas.push({
            tipo: 'OSRM_NO_DISPONIBLE',
            mensaje: matrizDistancias.metadata.motivoFallback,
        });
    }
    const actual = resumirPlanParaComparacion(planActual, reservas);
    const sombra = planSombra.metricas;

    return {
        modo: 'sombra',
        fecha,
        tours,
        persisteCambios: false,
        actual,
        sombra: planSombra,
        diferencia: {
            buses: sombra.totalBuses - actual.totalBuses,
            busesCompletos: sombra.busesCompletos - actual.busesCompletos,
            busesBilingues: sombra.busesBilingues - actual.busesBilingues,
            sillasVacias: sombra.sillasVacias - actual.sillasVacias,
            distanciaKm: null,
            distanciasComparables: false,
            motivoDistanciaNoComparable: 'Los motores pueden usar fuentes y criterios de recorrido distintos; compare cada fuente por separado.',
        },
    };
}

/**
 * Genera el listado operativo con el optimizador geográfico nuevo.
 * Usa OSRM cuando está disponible y conserva el fallback local por Haversine.
 */
async function generarPlanLogisticoOptimizado(fecha, idsTours, opciones = {}) {
    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];
    const [reservas, tourDestinos] = await Promise.all([
        obtenerReservas(fecha, tours),
        obtenerCoordenadasTours(tours),
    ]);
    const destinoTour = resolverDestinoTour(tours, tourDestinos);
    const reservasNormalizadas = normalizarReservasSombra(reservas);
    const puntosMatriz = [
        CONFIG.PUNTO_BASE,
        destinoTour,
        ...reservasNormalizadas.flatMap(reserva => reserva.puntos),
    ].filter(Boolean);
    const matrizDistancias = await prepararMatrizOSRM({ puntos: puntosMatriz });
    const plan = generarPlanSombra({
        reservas,
        puntoBase: CONFIG.PUNTO_BASE,
        destino: destinoTour,
        maxGuiasBilingues: opciones?.maxGuiasBilingues ?? null,
        distancias: matrizDistancias.contexto,
        fuenteDistancias: matrizDistancias.fuente,
        metadataDistancias: matrizDistancias.metadata,
    });

    if (matrizDistancias.metadata?.motivoFallback
        && matrizDistancias.metadata?.osrmConfigurado) {
        plan.alertas.push({
            tipo: 'OSRM_NO_DISPONIBLE',
            mensaje: matrizDistancias.metadata.motivoFallback,
        });
    }

    return {
        ...plan,
        fecha,
        tours,
        destinoTour,
        reservasSinAsignar: obtenerReservasSinAsignar(plan.buses, reservas),
    };
}

async function guardarListadoFinal({ fecha, idsTours, buses, userId = null }) {
    if (!fecha || !idsTours || !Array.isArray(buses)) {
        throw createValidationError('Datos inválidos para guardar el listado.', [
            'Se requiere fecha, idsTours/idTour y buses.'
        ]);
    }

    const tours = Array.isArray(idsTours) ? idsTours : [idsTours];
    const primaryTourId = tours.includes(5) ? 5 : tours[0];
    const reservasEsperadas = await obtenerReservas(fecha, tours);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const validacion = await validarIntegridadBuses(conn, { fecha, tours, buses });
        const busesValidados = validacion.buses;
        const idsAsignados = new Set(
            busesValidados
                .flatMap(bus => bus.reservas || [])
                .map(reserva => String(reserva?.idReserva || '').trim())
                .filter(Boolean)
        );
        const reservasFaltantes = (reservasEsperadas || [])
            .map(reserva => String(reserva?.Id_Reserva || '').trim())
            .filter(idReserva => idReserva && !idsAsignados.has(idReserva));

        if (reservasFaltantes.length) {
            throw createValidationError(
                'Todas las reservas activas deben quedar asignadas antes de guardar el listado.',
                reservasFaltantes.map(idReserva => `La reserva ${idReserva} no está asignada a ningún bus.`)
            );
        }

        const idProgramacion = await guardarSnapshotProgramacion(conn, {
            fecha,
            tours,
            primaryTourId,
            busesValidados,
            userId
        });

        await recordHistorial({
            conexion: conn,
            tabla: 'programacion',
            id_registro: `${fecha}|${tours.join(',')}`,
            accion: 'GUARDAR_LISTADO',
            id_usuario: userId,
            detalles: [
                { columna: 'Fecha', anterior: null, nuevo: fecha },
                { columna: 'Tours', anterior: null, nuevo: tours.join(',') },
                { columna: 'Buses', anterior: null, nuevo: String(busesValidados.length) },
                { columna: 'Reservas_Actualizadas', anterior: null, nuevo: String(validacion.totalReservas || 0) },
                { columna: 'Id_Programacion', anterior: null, nuevo: String(idProgramacion) }
            ]
        });

        await conn.commit();
        return { ok: true, buses: busesValidados.length, reservas: validacion.totalReservas || 0, idProgramacion };
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
    const tourDestinos = await obtenerCoordenadasTours(tours);
    const destinoTour = resolverDestinoTour(tours, tourDestinos);

    const snapshot = await obtenerListadoSnapshot({ fecha, idsTours: tours });
    if (snapshot) {
        const reservasActuales = await obtenerReservas(fecha, tours);
        const reservasSinAsignar = obtenerReservasSinAsignar(snapshot.buses, reservasActuales);

        return {
            ...snapshot,
            reservasSinAsignar,
            destinoTour
        };
    }
    return { exists: false, buses: [], reservasSinAsignar: [], destinoTour };
}


async function obtenerReservasPrivadasActivas(fecha, idsTours = null, connection = db) {
    const tours = Array.isArray(idsTours) ? idsTours : (idsTours ? [idsTours] : null);
    const params = [fecha];
    let tourFilter = '';
    if (tours?.length) {
        tourFilter = 'AND h.Id_Tour IN (?) ';
        params.push(tours);
    }

    const sql = `
        SELECT
            r.Id_Reserva,
            h.Id_Tour,
            t.Nombre_Tour,
            r.Nombre_Reportante,
            r.Idioma_Reserva,
            r.Observaciones,
            COUNT(p.Id_Pasajero) AS NumeroPasajeros
        FROM reservas r
        INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
        INNER JOIN tours t ON t.Id_Tour = h.Id_Tour
        LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
        WHERE r.Fecha_Tour = ?
          ${tourFilter}
          AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA'
          AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_RESERVA_ACTIVOS.map(() => '?').join(',')})
        GROUP BY r.Id_Reserva, h.Id_Tour, t.Nombre_Tour,
                 r.Nombre_Reportante, r.Idioma_Reserva, r.Observaciones
        ORDER BY h.Id_Tour ASC, r.Id_Reserva ASC
    `;
    params.push(...ESTADOS_RESERVA_ACTIVOS);

    const [rows] = await connection.query(sql, params);
    return rows || [];
}

async function obtenerAsignacionesPrivadasGuardadas(fecha, connection = db) {
    const [programaciones] = await connection.query(
        `
        SELECT Id_Programacion, Confirmado_En
        FROM programaciones
        WHERE Fecha_Tour = ?
          AND Estado = 'activa'
          AND Tipo_Programacion = 'privada'
        ORDER BY Confirmado_En DESC, Id_Programacion DESC
        LIMIT 1
        `,
        [fecha]
    );

    const programacion = programaciones?.[0];
    if (!programacion) return { idProgramacion: null, confirmadoEn: null, buses: [] };

    const [buses] = await connection.query(
        `
        SELECT Id_Bus_Prog, Placa_Display, Capacidad, Pasajeros_Total, Guia,
               Orden_Bus, Id_Reserva_Privada
        FROM programacion_buses
        WHERE Id_Programacion = ?
          AND Tipo_Bus = 'privado'
        ORDER BY Orden_Bus ASC, Id_Bus_Prog ASC
        `,
        [programacion.Id_Programacion]
    );

    return {
        idProgramacion: programacion.Id_Programacion,
        confirmadoEn: programacion.Confirmado_En,
        buses: buses || []
    };
}

async function construirResumenPrivados(fecha, idsTours = null, connection = db) {
    const reservas = await obtenerReservasPrivadasActivas(fecha, idsTours, connection);
    const generatedBuses = generarBusesPrivados(reservas);
    const saved = await obtenerAsignacionesPrivadasGuardadas(fecha, connection);
    const buses = reconcilePrivateBuses(generatedBuses, saved.buses);

    return {
        totalReservas: reservas.length,
        totalBuses: buses.length,
        totalPax: buses.reduce((sum, bus) => sum + Number(bus.ocupados || 0), 0),
        idProgramacion: saved.idProgramacion,
        confirmadoEn: saved.confirmadoEn,
        privados: buses
    };
}

async function resumenPrivadosDia(fecha, idsTours) {
    // Los errores reales deben llegar al controller (500) para que la UI pueda
    // mostrar “Reintentar”; devolver ceros ocultaría reservas operativas.
    return construirResumenPrivados(fecha, idsTours);
}

async function guardarProgramacionPrivada({ fecha, buses, userId = null }) {
    if (!fecha || !Array.isArray(buses)) {
        throw createValidationError('Datos inválidos para guardar la programación privada.', [
            'Se requiere fecha y la lista completa de vehículos privados.'
        ]);
    }

    const conn = await db.getConnection();
    let committed = false;
    try {
        await conn.beginTransaction();

        const reservas = await obtenerReservasPrivadasActivas(fecha, null, conn);
        const expectedBuses = generarBusesPrivados(reservas);
        if (!expectedBuses.length) {
            throw createValidationError('No hay reservas privadas activas para esta fecha.');
        }

        const normalizedBuses = validatePrivateAssignments(buses, expectedBuses);
        await validarAsignacionesOperativasFecha(conn, {
            fecha,
            tipoProgramacion: 'privada',
            buses: normalizedBuses
        });
        const tourIds = [...new Set(reservas.map((reserva) => Number(reserva.Id_Tour)).filter(Number.isFinite))];
        const primaryTourId = tourIds[0];
        if (!primaryTourId) {
            throw createValidationError('No fue posible identificar el tour de las reservas privadas.');
        }

        await conn.query(
            `
            UPDATE programaciones
            SET Estado = 'anulada',
                Anulada_En = NOW(),
                Anulada_Por = ?,
                Motivo_Anulacion = 'Reemplazada por una nueva asignación privada.'
            WHERE Fecha_Tour = ?
              AND Estado = 'activa'
              AND Tipo_Programacion = 'privada'
            `,
            [userId || null, fecha]
        );

        const [programacionResult] = await conn.query(
            `
            INSERT INTO programaciones
            (Fecha_Tour, Id_Tour, Confirmado_Por, Estado, Tipo_Programacion)
            VALUES (?, ?, ?, 'activa', 'privada')
            `,
            [fecha, primaryTourId, userId || null]
        );
        const idProgramacion = programacionResult.insertId;

        for (const idTour of tourIds) {
            await conn.query(
                'INSERT INTO programacion_tours (Id_Programacion, Id_Tour) VALUES (?, ?)',
                [idProgramacion, idTour]
            );
        }

        for (let index = 0; index < normalizedBuses.length; index += 1) {
            const bus = normalizedBuses[index];
            await conn.query(
                `
                INSERT INTO programacion_buses
                (Id_Programacion, Placa_Display, Capacidad, Pasajeros_Total, Guia,
                 Recorrido_Km, Orden_Bus, Tipo_Bus, Id_Reserva_Privada)
                VALUES (?, ?, ?, ?, ?, NULL, ?, 'privado', ?)
                `,
                [
                    idProgramacion,
                    bus.placa,
                    bus.capacidad,
                    bus.ocupados,
                    bus.guia,
                    index + 1,
                    bus.idReserva
                ]
            );
        }

        await recordHistorial({
            conexion: conn,
            tabla: 'programacion',
            id_registro: `${fecha}|privados`,
            accion: 'GUARDAR_PROGRAMACION_PRIVADA',
            id_usuario: userId,
            detalles: [
                { columna: 'Fecha', anterior: null, nuevo: fecha },
                { columna: 'Reservas', anterior: null, nuevo: String(reservas.length) },
                { columna: 'Vehiculos', anterior: null, nuevo: String(normalizedBuses.length) },
                { columna: 'Id_Programacion', anterior: null, nuevo: String(idProgramacion) }
            ]
        });

        await conn.commit();
        committed = true;
    } catch (error) {
        if (!committed) await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    return construirResumenPrivados(fecha);
}

async function calcularRutaVisualOSRM(coordenadas) {
    if (!Array.isArray(coordenadas) || coordenadas.length < 2) {
        const error = new Error('Se requieren al menos dos coordenadas válidas.');
        error.statusCode = 400;
        error.errorCode = 'INVALID_ROUTE_POINTS';
        throw error;
    }

    const puntos = coordenadas
        .map((punto) => ({ lat: Number(punto?.lat), lng: Number(punto?.lng) }))
        .filter((punto) =>
            Number.isFinite(punto.lat) &&
            Number.isFinite(punto.lng) &&
            punto.lat >= -90 && punto.lat <= 90 &&
            punto.lng >= -180 && punto.lng <= 180
        );

    if (puntos.length !== coordenadas.length || puntos.length > 50) {
        const error = new Error('La ruta contiene coordenadas inválidas o supera el máximo de 50 puntos.');
        error.statusCode = 400;
        error.errorCode = 'INVALID_ROUTE_POINTS';
        throw error;
    }

    const baseUrl = String(process.env.PROGRAMACION_OSRM_URL || '').replace(/\/+$/, '');
    if (!baseUrl) {
        const error = new Error('OSRM no está configurado para calcular la ruta visual.');
        error.statusCode = 503;
        error.errorCode = 'OSRM_NOT_CONFIGURED';
        throw error;
    }

    const perfil = process.env.PROGRAMACION_OSRM_PROFILE || 'driving';
    const textoCoordenadas = puntos.map((punto) => `${punto.lng},${punto.lat}`).join(';');
    const url = new URL(`/route/v1/${encodeURIComponent(perfil)}/${textoCoordenadas}`, `${baseUrl}/`);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('alternatives', 'false');

    let response;
    try {
        response = await fetch(url, {
            signal: AbortSignal.timeout(Number(process.env.PROGRAMACION_OSRM_TIMEOUT_MS || 8000)),
            headers: { accept: 'application/json' }
        });
    } catch (cause) {
        const error = new Error('No fue posible conectar con OSRM para dibujar la ruta.');
        error.statusCode = 503;
        error.errorCode = 'OSRM_UNAVAILABLE';
        error.cause = cause;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(`OSRM respondió HTTP ${response.status}.`);
        error.statusCode = 503;
        error.errorCode = 'OSRM_UNAVAILABLE';
        throw error;
    }

    const body = await response.json();
    const route = body?.routes?.[0];
    if (body?.code !== 'Ok' || !route?.geometry?.coordinates) {
        const error = new Error('OSRM no encontró un recorrido para los puntos indicados.');
        error.statusCode = 422;
        error.errorCode = 'ROUTE_NOT_FOUND';
        throw error;
    }

    return {
        source: 'osrm-local',
        coordinates: route.geometry.coordinates,
        distance: Number(route.distance || 0),
        duration: Number(route.duration || 0),
        legs: Array.isArray(route.legs)
            ? route.legs.map((leg) => ({
                distance: Number(leg?.distance || 0),
                duration: Number(leg?.duration || 0)
            }))
            : []
    };
}

async function generarZipListados({ fecha, idTour, buses, nombreTour }) {
    if (!fecha || !idTour || !Array.isArray(buses) || buses.length === 0) {
        const error = new Error('Se requiere fecha, idTour y al menos un bus para exportar.');
        error.statusCode = 400;
        error.errorCode = 'MISSING_PARAMS';
        throw error;
    }

    const safeName = (value, fallback) => {
        const normalized = String(value || fallback)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        return normalized || fallback;
    };

    const zip = new JSZip();
    const tourName = safeName(nombreTour, 'Tour');
    const usedNames = new Set();

    for (let index = 0; index < buses.length; index += 1) {
        const bus = buses[index];
        const buffer = await generarExcelListadoBus({ fecha, idTour, bus, nombreTour });
        const baseName = `${String(index + 1).padStart(2, '0')}_${safeName(bus?.id, `Bus_${index + 1}`)}`;
        let fileName = `${baseName}.xlsx`;
        let suffix = 2;
        while (usedNames.has(fileName.toLowerCase())) {
            fileName = `${baseName}_${suffix}.xlsx`;
            suffix += 1;
        }
        usedNames.add(fileName.toLowerCase());
        zip.file(fileName, buffer);
    }

    return {
        buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
        fileName: `${fecha}_${tourName}_listados.zip`
    };
}

function safeExportName(value, fallback) {
    const normalized = String(value || fallback)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

async function generarZipPrivados({ fecha, buses }) {
    if (!fecha || !Array.isArray(buses) || buses.length === 0) {
        const error = new Error('Se requiere fecha y al menos un vehículo privado para exportar.');
        error.statusCode = 400;
        error.errorCode = 'MISSING_PARAMS';
        throw error;
    }

    const reservas = await obtenerReservasPrivadasActivas(fecha);
    const expectedBuses = generarBusesPrivados(reservas);
    const normalizedBuses = validatePrivateAssignments(buses, expectedBuses);
    const busesByReservation = new Map();

    for (const bus of normalizedBuses) {
        if (!busesByReservation.has(bus.idReserva)) busesByReservation.set(bus.idReserva, []);
        busesByReservation.get(bus.idReserva).push(bus);
    }

    const reservationById = new Map(reservas.map((reserva) => [String(reserva.Id_Reserva), reserva]));
    const zip = new JSZip();
    const usedNames = new Set();
    let fileIndex = 1;

    for (const [idReserva, reservationBuses] of busesByReservation.entries()) {
        const reserva = reservationById.get(String(idReserva)) || {};
        const buffer = await generarExcelReservaPrivada({
            fecha,
            idReserva,
            idTour: reserva.Id_Tour,
            nombreTour: reserva.Nombre_Tour || 'Privado',
            nombreReportante: reserva.Nombre_Reportante || '',
            buses: reservationBuses,
        });

        const baseName = `${String(fileIndex).padStart(2, '0')}_${safeExportName(idReserva, `Reserva_${fileIndex}`)}_${safeExportName(reserva.Nombre_Tour, 'Privado')}`;
        let fileName = `${baseName}.xlsx`;
        let suffix = 2;
        while (usedNames.has(fileName.toLowerCase())) {
            fileName = `${baseName}_${suffix}.xlsx`;
            suffix += 1;
        }
        usedNames.add(fileName.toLowerCase());
        zip.file(fileName, buffer);
        fileIndex += 1;
    }

    return {
        buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
        fileName: `${fecha}_programacion_privada.zip`
    };
}

module.exports = {
    generarPlanLogistico,
    generarPlanLogisticoOptimizado,
    generarComparacionLogisticaShadow,
    resumenPrivadosDia,
    guardarProgramacionPrivada,
    generarExcelReservaPrivada,
    generarExcelListadoBus,
    guardarListadoFinal,
    obtenerListadoFinal,
    calcularRutaVisualOSRM,
    generarZipListados,
    generarZipPrivados,
    detectarDuplicadosAsignacion
};

async function generarExcelReservaPrivada({ fecha, idReserva, buses, nombreTour, nombreReportante, idTour }) {
    if (!idReserva) {
        throw new Error('Se requiere el Id_Reserva para exportar la reserva privada.');
    }
    if (!Array.isArray(buses) || buses.length === 0) {
        throw createValidationError('La reserva privada no tiene vehículos para exportar.');
    }
    const missingGuides = buses.filter((bus) => !String(bus?.guia || '').trim());
    if (missingGuides.length) {
        throw createValidationError('Asigna una guía antes de exportar la reserva privada.', [
            `La reserva ${idReserva} tiene ${missingGuides.length} vehículo${missingGuides.length === 1 ? '' : 's'} sin guía.`
        ]);
    }

    const workbook = new ExcelJS.Workbook();
    const resumen = workbook.addWorksheet('Resumen');
    const detalle = workbook.addWorksheet('Pasajeros');
    const borderThin = { style: 'thin' };

    let reservaRow = null;
    let pasajerosRows = [];

    try {
        const [reservasRows] = await db.query(
            `
            SELECT
                r.Id_Reserva,
                r.Fecha_Tour,
                r.Estado,
                r.Tipo_Reserva,
                r.Idioma_Reserva,
                r.Nombre_Reportante AS NombreReporta,
                r.Telefono_Reportante,
                r.Observaciones,
                h.Id_Tour,
                t.Nombre_Tour,
                COUNT(p.Id_Pasajero) AS NumeroPasajeros
            FROM reservas r
            LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
            LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
            LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
            WHERE r.Id_Reserva = ?
              AND r.Fecha_Tour = ?
            GROUP BY
                r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, r.Idioma_Reserva,
                r.Nombre_Reportante, r.Telefono_Reportante, r.Observaciones, h.Id_Tour, t.Nombre_Tour
            LIMIT 1
            `,
            [idReserva, fecha]
        );

        reservaRow = reservasRows?.[0] || null;

        const [pasRows] = await db.query(
            `
            SELECT
                p.Id_Pasajero,
                p.Nombre_Pasajero,
                p.DNI,
                p.Telefono_Pasajero,
                p.Tipo_Pasajero,
                pt.Nombre_Punto AS PuntoEncuentro
            FROM pasajeros p
            LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
            WHERE p.Id_Reserva = ?
            ORDER BY p.Id_Pasajero ASC
            `,
            [idReserva]
        );

        pasajerosRows = pasRows || [];
    } catch (error) {
        console.error('Error DB al preparar exportación privada:', error);
        throw new Error('Fallo al obtener los datos de la reserva privada.');
    }

    const tourLabel = reservaRow?.Nombre_Tour || nombreTour || 'Privado';
    const reportanteLabel = reservaRow?.NombreReporta || nombreReportante || 'Sin responsable';
    const paxTotal = Number(reservaRow?.NumeroPasajeros || pasajerosRows.length || 0);

    resumen.columns = [
        { header: 'BUS', key: 'Bus', width: 14 },
        { header: 'PLACA', key: 'Placa', width: 18 },
        { header: 'GUIA', key: 'Guia', width: 24 },
        { header: 'PAX', key: 'Pax', width: 10 },
        { header: 'CAPACIDAD', key: 'Capacidad', width: 12 },
    ];

    resumen.getCell(1, 1).value = `Reserva: ${idReserva}`;
    resumen.getCell(1, 2).value = `Fecha: ${fecha}`;
    resumen.getCell(2, 1).value = `Tour: ${tourLabel}`;
    resumen.getCell(2, 2).value = `Responsable: ${reportanteLabel}`;
    resumen.getCell(3, 1).value = `Total Pax: ${paxTotal}`;
    resumen.getCell(3, 2).value = `Total Buses: ${Array.isArray(buses) ? buses.length : 0}`;

    for (let row = 1; row <= 3; row++) {
        for (let col = 1; col <= 2; col++) {
            const cell = resumen.getCell(row, col);
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
            cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
        }
    }

    const resumenHeaderRow = resumen.getRow(5);
    resumenHeaderRow.values = resumen.columns.map(col => col.header);
    resumenHeaderRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    });

    (buses || []).forEach((bus, index) => {
        const row = resumen.addRow({
            Bus: `Bus ${Number(bus?.indice || index + 1)}/${Number(bus?.totalBuses || buses.length || 1)}`,
            Placa: String(bus?.id || '').trim() || `Bus ${index + 1}`,
            Guia: String(bus?.guia || '').trim(),
            Pax: Number(bus?.ocupados || 0),
            Capacidad: Number(bus?.capacidad || 0),
        });
        row.eachCell(cell => {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
        });
    });

    detalle.columns = [
        { header: 'NOMBRE DEL PASAJERO', key: 'NombrePasajero', width: 36 },
        { header: 'DNI/PASAPORTE', key: 'Dni', width: 18 },
        { header: 'TELEFONO', key: 'Telefono', width: 18 },
        { header: 'TIPO', key: 'TipoPasajero', width: 12 },
        { header: 'PUNTO DE ENCUENTRO', key: 'PuntoEncuentro', width: 26 },
        { header: 'RESERVA', key: 'Reserva', width: 16 },
        { header: 'TOUR', key: 'Tour', width: 28 },
        { header: 'RESPONSABLE', key: 'Responsable', width: 28 },
        { header: 'OBSERVACIONES', key: 'Observaciones', width: 34 },
    ];

    detalle.getCell(1, 1).value = `Reserva privada ${idReserva}`;
    detalle.mergeCells(1, 1, 1, detalle.columns.length);
    detalle.getCell(1, 1).font = { bold: true };
    detalle.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'center' };
    detalle.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
    detalle.getCell(1, 1).border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

    const detalleHeaderRow = detalle.getRow(2);
    detalleHeaderRow.values = detalle.columns.map(col => col.header);
    detalleHeaderRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    });

    for (const pasajero of pasajerosRows) {
        const row = detalle.addRow({
            NombrePasajero: pasajero.Nombre_Pasajero || '',
            Dni: pasajero.DNI || '',
            Telefono: pasajero.Telefono_Pasajero || '',
            TipoPasajero: pasajero.Tipo_Pasajero || '',
            PuntoEncuentro: pasajero.PuntoEncuentro || '',
            Reserva: String(idReserva),
            Tour: tourLabel,
            Responsable: reportanteLabel,
            Observaciones: reservaRow?.Observaciones || '',
        });
        row.eachCell(cell => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
        });
    }

    if (pasajerosRows.length === 0) {
        const row = detalle.addRow({
            NombrePasajero: 'Sin pasajeros asociados',
            Reserva: String(idReserva),
            Tour: tourLabel,
            Responsable: reportanteLabel,
            Observaciones: reservaRow?.Observaciones || '',
        });
        row.eachCell(cell => {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
        });
    }

    if (idTour || reservaRow?.Id_Tour) {
        resumen.getCell(3, 3).value = `Id Tour: ${idTour || reservaRow?.Id_Tour}`;
        const cell = resumen.getCell(3, 3);
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    }

    return workbook.xlsx.writeBuffer();
}

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

