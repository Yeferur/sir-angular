const fs = require('fs');
const path = require('path');

// Coordenadas de referencia (Estación Poblado)
const puntoBase = { lat: 6.21362087702617, lon: -75.57835125972284 };

// Cargar grafo JSON
const rutaGrafo = path.join(process.cwd(), 'grafo_antioquia.json');
const grafo = JSON.parse(fs.readFileSync(rutaGrafo, 'utf8'));

// DESPUÉS (Correcto)
const R = 6371000; // Radio de la Tierra en metros

// ============================
// Haversine
// ============================
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================
// Encontrar nodo más cercano
// ============================
function encontrarNodoMasCercano(lat, lon) {
  let minDist = Infinity;
  let nodoCercano = null;

  for (const [id, nodo] of Object.entries(grafo.nodes)) {
    const dist = haversine(lat, lon, nodo.lat, nodo.lon);
    if (dist < minDist) {
      minDist = dist;
      nodoCercano = id;
    }
  }

  // Comprobar si la distancia en METROS es mayor a 5 KM (5000 metros)
  if (minDist > 5000) { 
    // Corregir el mensaje para mostrar la distancia en KM
    console.warn(`⚠️ Punto muy alejado del grafo (${(minDist / 1000).toFixed(2)} km): { lat: ${lat}, lon: ${lon} }`);
    return null;
  }

  return nodoCercano;
}

// ============================
// A* pathfinding
// ============================
function buscarRuta(latInicio, lonInicio, latDestino, lonDestino) {
  const inicio = encontrarNodoMasCercano(latInicio, lonInicio);
  const destino = encontrarNodoMasCercano(latDestino, lonDestino);

  if (!inicio || !destino) {
    console.error(`❌ Nodo inválido: inicio=${inicio}, destino=${destino}`);
    return null;
  }

  if (!grafo.nodes[inicio]?.neighbors?.length) {
    console.warn(`⚠️ Nodo de inicio sin vecinos: ${inicio}`);
    return null;
  }

  if (!grafo.nodes[destino]?.neighbors?.length) {
    console.warn(`⚠️ Nodo de destino sin vecinos: ${destino}`);
    return null;
  }

  const abiertos = new Set([inicio]);
  const cerrados = new Set();
  const g = { [inicio]: 0 };
  const f = { [inicio]: haversine(latInicio, lonInicio, latDestino, lonDestino) };
  const padres = {};

  while (abiertos.size > 0) {
    const actual = [...abiertos].reduce((a, b) => f[a] < f[b] ? a : b);

    if (actual === destino) {
      const ruta = [];
      let nodo = actual;
      while (nodo) {
        ruta.unshift(grafo.nodes[nodo]);
        nodo = padres[nodo];
      }
      return ruta;
    }

    abiertos.delete(actual);
    cerrados.add(actual);

    for (const vecino of grafo.nodes[actual].neighbors || []) {
      if (cerrados.has(vecino.id)) continue;

      const tentativeG = g[actual] + vecino.distance;
      if (!g[vecino.id] || tentativeG < g[vecino.id]) {
        padres[vecino.id] = actual;
        g[vecino.id] = tentativeG;

        const heur = haversine(
          grafo.nodes[vecino.id].lat,
          grafo.nodes[vecino.id].lon,
          latDestino,
          lonDestino
        );
        f[vecino.id] = tentativeG + heur;
        abiertos.add(vecino.id);
      }
    }
  }

  return null;
}

// ============================
// Ruta completa entre varios puntos
// ============================
async function calcularRutaEntrePuntos(puntos) {
  const rutaCompleta = [];

  let origen = puntoBase;

  for (const punto of puntos) {
    if (!punto.lat || (!punto.lon && punto.lng === undefined)) {
      console.warn("❌ Punto inválido:", punto);
      continue;
    }

    const destino = {
      lat: parseFloat(punto.lat),
      lon: parseFloat(punto.lon || punto.lng)
    };

    const subruta = buscarRuta(origen.lat, origen.lon, destino.lat, destino.lon);

    if (!subruta) {
      console.warn("❌ No se encontró subruta entre:", origen, destino);
      continue;
    }

    if (rutaCompleta.length > 0) subruta.shift(); // Evita duplicar nodo anterior
    rutaCompleta.push(...subruta);
    origen = destino;
  }

  return rutaCompleta;
}

module.exports = {
  calcularRutaEntrePuntos,
};