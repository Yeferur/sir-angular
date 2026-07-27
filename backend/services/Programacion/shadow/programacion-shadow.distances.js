const { haversineKm } = require('./programacion-shadow.optimizer');

function coordenadasDe(item) {
  const lat = Number(item?.Latitud ?? item?.lat ?? item?.latitude);
  const lon = Number(item?.Longitud ?? item?.lon ?? item?.lng ?? item?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) < 0.0001 || Math.abs(lon) < 0.0001) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function claveCoordenada(item) {
  const punto = coordenadasDe(item);
  return punto ? `${punto.lon.toFixed(6)},${punto.lat.toFixed(6)}` : null;
}

function puntosUnicos(puntos) {
  const mapa = new Map();
  for (const punto of puntos || []) {
    const clave = claveCoordenada(punto);
    if (clave && !mapa.has(clave)) mapa.set(clave, coordenadasDe(punto));
  }
  return Array.from(mapa.entries()).map(([clave, punto]) => ({ clave, ...punto }));
}

function dividir(items, tamano) {
  const grupos = [];
  for (let index = 0; index < items.length; index += tamano) {
    grupos.push(items.slice(index, index + tamano));
  }
  return grupos;
}

function crearContextoMatriz(matriz) {
  return {
    estadisticas: {
      consultas: 0,
      fallbacksHaversine: 0,
    },
    obtenerKm(origen, destino) {
      this.estadisticas.consultas += 1;
      const origenKey = claveCoordenada(origen);
      const destinoKey = claveCoordenada(destino);
      if (!origenKey || !destinoKey) return Number.NaN;
      if (origenKey === destinoKey) return 0;
      return matriz.get(`${origenKey}>${destinoKey}`) ?? Number.NaN;
    },
  };
}

async function solicitarBloque({
  baseUrl,
  perfil,
  origenes,
  destinos,
  fetchImpl,
  timeoutMs,
}) {
  const coordenadas = origenes.concat(destinos);
  const textoCoordenadas = coordenadas
    .map((punto) => `${punto.lon},${punto.lat}`)
    .join(';');
  const fuentes = origenes.map((_, index) => index).join(';');
  const destinosIndices = destinos
    .map((_, index) => origenes.length + index)
    .join(';');
  const url = new URL(
    `/table/v1/${encodeURIComponent(perfil)}/${textoCoordenadas}`,
    `${baseUrl.replace(/\/+$/, '')}/`
  );
  url.searchParams.set('sources', fuentes);
  url.searchParams.set('destinations', destinosIndices);
  url.searchParams.set('annotations', 'distance');
  url.searchParams.set('skip_waypoints', 'true');

  const respuesta = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!respuesta.ok) {
    throw new Error(`OSRM respondió HTTP ${respuesta.status}.`);
  }

  const body = await respuesta.json();
  if (body?.code !== 'Ok' || !Array.isArray(body?.distances)) {
    throw new Error(`OSRM no generó la tabla: ${body?.code || 'respuesta inválida'}.`);
  }
  return body;
}

async function prepararMatrizOSRM({
  puntos,
  baseUrl = process.env.PROGRAMACION_OSRM_URL || '',
  perfil = process.env.PROGRAMACION_OSRM_PROFILE || 'driving',
  tamanoBloque = Number(process.env.PROGRAMACION_OSRM_BATCH_SIZE || 40),
  timeoutMs = Number(process.env.PROGRAMACION_OSRM_TIMEOUT_MS || 5000),
  fetchImpl = global.fetch,
} = {}) {
  const unicos = puntosUnicos(puntos);
  if (!baseUrl) {
    return {
      fuente: 'haversine-local',
      contexto: null,
      metadata: {
        osrmConfigurado: false,
        puntosSolicitados: unicos.length,
        motivoFallback: 'PROGRAMACION_OSRM_URL no está configurada.',
      },
    };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('El runtime no dispone de fetch para consultar OSRM.');
  }

  const bloques = dividir(unicos, Math.max(1, Math.min(50, Math.trunc(tamanoBloque) || 40)));
  const matriz = new Map();
  let llamadas = 0;
  let celdasSinRuta = 0;
  let dataVersion = null;

  try {
    for (const origenes of bloques) {
      for (const destinos of bloques) {
        const body = await solicitarBloque({
          baseUrl,
          perfil,
          origenes,
          destinos,
          fetchImpl,
          timeoutMs: Math.max(250, timeoutMs),
        });
        llamadas += 1;
        dataVersion = dataVersion || body.data_version || null;

        for (let i = 0; i < origenes.length; i += 1) {
          for (let j = 0; j < destinos.length; j += 1) {
            const valor = body.distances?.[i]?.[j];
            const metros = valor === null || valor === undefined ? Number.NaN : Number(valor);
            if (!Number.isFinite(metros)) {
              celdasSinRuta += 1;
              continue;
            }
            matriz.set(`${origenes[i].clave}>${destinos[j].clave}`, metros / 1000);
          }
        }
      }
    }

    return {
      fuente: 'osrm-local',
      contexto: crearContextoMatriz(matriz),
      metadata: {
        osrmConfigurado: true,
        perfil,
        puntosSolicitados: unicos.length,
        llamadas,
        celdas: matriz.size,
        celdasSinRuta,
        dataVersion,
      },
    };
  } catch (error) {
    return {
      fuente: 'haversine-local',
      contexto: null,
      metadata: {
        osrmConfigurado: true,
        perfil,
        puntosSolicitados: unicos.length,
        llamadas,
        motivoFallback: error.message,
      },
    };
  }
}

function distanciaConFallback(contexto, origen, destino) {
  const vial = contexto?.obtenerKm(origen, destino);
  return Number.isFinite(vial) ? vial : haversineKm(origen, destino);
}

module.exports = {
  prepararMatrizOSRM,
  crearContextoMatriz,
  claveCoordenada,
  distanciaConFallback,
};
