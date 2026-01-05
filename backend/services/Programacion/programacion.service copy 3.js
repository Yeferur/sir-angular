const db = require('../../database/db'); // Asegúrate de que la ruta a tu conexión de DB sea correcta
const fs = require('fs').promises;
const path = require('path');

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
    const sql = `
      SELECT r.Id_Reserva, r.NumeroPasajeros, r.Id_Punto, p.Latitud, p.Longitud, p.NombrePunto
      FROM reservas r
      JOIN puntos p ON p.Id_Punto = r.Id_Punto
      WHERE r.FechaReserva = ? AND r.TourReserva = ? AND r.Estado IN ('Pendiente', 'Confirmada', 'PendienteDatos', 'Completada') AND r.TipoReserva = 'Grupal'
    `;
    try {
        const [rows] = await db.query(sql, [fecha, idTour]);
        return rows.map(r => ({ ...r, NumeroPasajeros: parseInt(r.NumeroPasajeros, 10), Latitud: parseFloat(r.Latitud), Longitud: parseFloat(r.Longitud) }));
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

function crearClustersDeRutas(reservas) {
    const clusters = [];
    const paradasSinAsignar = new Set(reservas);
    const maxCapacidadBus = Math.max(...CONFIG.CAPACIDADES_BUSES);

    // ✅ Inicia con el punto base estandarizado
    let puntoDePartidaSeed = { lat: CONFIG.PUNTO_BASE.lat, lon: CONFIG.PUNTO_BASE.lon };

    while (paradasSinAsignar.size > 0) {
        let seedReserva = null;
        let minSeedDist = Infinity;
        for (const parada of paradasSinAsignar) {
            // Usa el punto de partida estandarizado
            const dist = haversine(puntoDePartidaSeed.lat, puntoDePartidaSeed.lon, parada.Latitud, parada.Longitud);
            if (dist < minSeedDist) {
                minSeedDist = dist;
                seedReserva = parada;
            }
        }
        
        // Si no se encuentra una semilla (caso muy raro), salir para evitar crash
        if (!seedReserva) break;

        const clusterActual = {
            reservas: [seedReserva],
            totalPasajeros: seedReserva.NumeroPasajeros
        };
        paradasSinAsignar.delete(seedReserva);
        let ultimoPuntoDelCluster = seedReserva;

        // ... el resto del bucle interno sigue igual ...
        let seguirAgregando = true;
        while (seguirAgregando && paradasSinAsignar.size > 0) {
            // ... código para agregar paradas cercanas ...
             let paradaMasCercana = null;
            let minParadaDist = Infinity;

            for (const parada of paradasSinAsignar) {
                const dist = haversine(ultimoPuntoDelCluster.Latitud, ultimoPuntoDelCluster.Longitud, parada.Latitud, parada.Longitud);
                if (dist < minParadaDist) {
                    minParadaDist = dist;
                    paradaMasCercana = parada;
                }
            }

            if (paradaMasCercana && clusterActual.totalPasajeros + paradaMasCercana.NumeroPasajeros <= maxCapacidadBus) {
                clusterActual.reservas.push(paradaMasCercana); // Corregido
                clusterActual.totalPasajeros += paradaMasCercana.NumeroPasajeros;
                ultimoPuntoDelCluster = paradaMasCercana;
                paradasSinAsignar.delete(paradaMasCercana);
            } else {
                seguirAgregando = false; 
            }
        }


        clusters.push(clusterActual);
        // ✅ ¡CORRECCIÓN CLAVE! Al actualizar el punto de partida, lo estandarizamos a {lat, lon}
        puntoDePartidaSeed = { lat: seedReserva.Latitud, lon: seedReserva.Longitud };
    }

    return clusters;
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


// =================================================================
// --- ORQUESTADOR PRINCIPAL BASADO EN CLUSTERING ---
// =================================================================

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
    generarPlanLogistico
};