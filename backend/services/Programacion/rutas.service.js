const fs = require('fs');
const path = require('path');
const { ordenarParadas } = require('./routeEngine.service');

const GRAFO = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'grafo_antioquia.json'), 'utf8')
);

const PUNTO_BASE = { lat: 6.212757856694648, lon: -75.57759200491337 };

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nodoCercano(lat, lon) {
  let min = Infinity;
  let best = null;
  for (const id in GRAFO.nodes) {
    const n = GRAFO.nodes[id];
    const d = haversine(lat, lon, n.lat, n.lon);
    if (d < min) {
      min = d;
      best = id;
    }
  }
  return best;
}

function aStar(inicio, fin) {
  const start = nodoCercano(inicio.lat, inicio.lon);
  const goal = nodoCercano(fin.lat, fin.lng ?? fin.lon);

  const open = new Set([start]);
  const came = {};
  const g = { [start]: 0 };
  const f = { [start]: 0 };

  while (open.size) {
    const current = [...open].reduce((a, b) => f[a] < f[b] ? a : b);
    if (current === goal) {
      const path = [];
      let c = current;
      while (c) {
        path.unshift(GRAFO.nodes[c]);
        c = came[c];
      }
      return path;
    }

    open.delete(current);
    for (const n of GRAFO.nodes[current].neighbors) {
      const t = g[current] + n.distance;
      if (g[n.id] === undefined || t < g[n.id]) {
        came[n.id] = current;
        g[n.id] = t;
        f[n.id] = t;
        open.add(n.id);
      }
    }
  }
  return [];
}

async function generarRuta(puntos, tour) {
  if (!tour?.Latitud || !tour?.Longitud) {
    throw new Error('El tour no tiene coordenadas');
  }

  const ordenadas = await ordenarParadas({
    puntos,
    destino: { lat: tour.Latitud, lng: tour.Longitud }
  });

  const ruta = [];
  let actual = { lat: PUNTO_BASE.lat, lon: PUNTO_BASE.lon };

  for (const p of ordenadas) {
    const tramo = aStar(actual, p);
    if (ruta.length) tramo.shift();
    ruta.push(...tramo);
    actual = { lat: p.lat, lon: p.lng };
  }

  const tramoFinal = aStar(actual, {
    lat: tour.Latitud,
    lon: tour.Longitud
  });

  tramoFinal.shift();
  ruta.push(...tramoFinal);

  return ruta;
}

module.exports = { generarRuta };
