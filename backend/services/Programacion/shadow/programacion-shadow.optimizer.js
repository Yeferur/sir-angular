const {
  CAPACIDAD_BUS,
  RUTAS_RELACIONADAS,
  PUNTO_BASE,
  PERFILES_BUSQUEDA,
  UMBRALES_COHERENCIA,
} = require('./programacion-shadow.config');

const VERSION_ALGORITMO = 'shadow-node-v1';

function normalizarTexto(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizarRuta(value) {
  const ruta = normalizarTexto(value);
  return ruta && ruta !== 'PENDIENTE' ? ruta : '';
}

function esIdiomaIngles(value) {
  const idioma = normalizarTexto(value);
  return idioma === 'INGLES' || idioma.startsWith('INGLES ');
}

function idiomaDesconocido(value) {
  const idioma = normalizarTexto(value);
  return !idioma || (!idioma.includes('ESPANOL') && !idioma.includes('INGLES'));
}

function numeroFinito(value) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
}

function coordenadasDe(item) {
  const lat = numeroFinito(item?.Latitud ?? item?.lat ?? item?.latitude);
  const lon = numeroFinito(item?.Longitud ?? item?.lon ?? item?.lng ?? item?.longitude);
  if (lat === null || lon === null || Math.abs(lat) < 0.0001 || Math.abs(lon) < 0.0001) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function haversineKm(a, b) {
  const puntoA = coordenadasDe(a);
  const puntoB = coordenadasDe(b);
  if (!puntoA || !puntoB) return Number.POSITIVE_INFINITY;

  const radio = 6371;
  const dLat = (puntoB.lat - puntoA.lat) * Math.PI / 180;
  const dLon = (puntoB.lon - puntoA.lon) * Math.PI / 180;
  const latA = puntoA.lat * Math.PI / 180;
  const latB = puntoB.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  return 2 * radio * Math.asin(Math.sqrt(h));
}

function distanciaEntreKm(a, b, distancias = null) {
  if (distancias && typeof distancias.obtenerKm === 'function') {
    const distanciaVial = distancias.obtenerKm(a, b);
    if (Number.isFinite(distanciaVial)) return distanciaVial;
    if (distancias.estadisticas) distancias.estadisticas.fallbacksHaversine += 1;
  }
  return haversineKm(a, b);
}

function idPunto(punto) {
  const id = punto?.Id_Punto ?? punto?.idPunto ?? punto?.IdPunto;
  if (id !== null && id !== undefined && String(id).trim()) return `id-${id}`;
  return `nombre-${normalizarTexto(punto?.NombrePunto || punto?.Nombre_Punto || 'SIN_PUNTO')}`;
}

function puntosDeReserva(reserva) {
  const originales = Array.isArray(reserva?.puntosReserva) && reserva.puntosReserva.length
    ? reserva.puntosReserva
    : [{
      Id_Punto: reserva?.Id_Punto ?? reserva?.idPunto ?? reserva?.IdPunto ?? null,
      NombrePunto: reserva?.NombrePunto || reserva?.PuntoEncuentro || 'SIN_PUNTO',
      Latitud: reserva?.Latitud ?? null,
      Longitud: reserva?.Longitud ?? null,
      ruta: reserva?.ruta ?? reserva?.Ruta ?? null,
      ordenRuta: reserva?.ordenRuta ?? reserva?.Orden_Ruta ?? reserva?.Posicion ?? null,
      pasajeros: Number(reserva?.NumeroPasajeros || 0),
    }];

  return originales.map((punto) => ({
    id: idPunto(punto),
    Id_Punto: punto?.Id_Punto ?? punto?.idPunto ?? punto?.IdPunto ?? null,
    NombrePunto: punto?.NombrePunto || punto?.Nombre_Punto || 'SIN_PUNTO',
    Latitud: numeroFinito(punto?.Latitud ?? punto?.lat),
    Longitud: numeroFinito(punto?.Longitud ?? punto?.lon ?? punto?.lng),
    ruta: normalizarRuta(punto?.ruta ?? punto?.Ruta),
    ordenRuta: numeroFinito(punto?.ordenRuta ?? punto?.Orden_Ruta ?? punto?.Posicion),
    pasajeros: Math.max(0, Number(punto?.pasajeros || 0)),
  }));
}

function centroide(puntos) {
  const validos = puntos.map(coordenadasDe).filter(Boolean);
  if (!validos.length) return null;
  return {
    lat: validos.reduce((sum, punto) => sum + punto.lat, 0) / validos.length,
    lon: validos.reduce((sum, punto) => sum + punto.lon, 0) / validos.length,
  };
}

function normalizarReservas(reservas) {
  return (reservas || []).map((reserva, index) => {
    const puntos = puntosDeReserva(reserva);
    const pax = Math.max(0, Number(reserva?.NumeroPasajeros || 0));
    const idioma = reserva?.Idioma_Reserva ?? reserva?.IdiomaReserva ?? '';
    const rutas = Array.from(new Set(puntos.map((punto) => punto.ruta).filter(Boolean)));

    return {
      id: String(reserva?.Id_Reserva ?? reserva?.idReserva ?? `SIN_ID_${index}`),
      pax,
      idioma: normalizarTexto(idioma),
      ingles: esIdiomaIngles(idioma),
      idiomaDesconocido: idiomaDesconocido(idioma),
      puntos,
      rutas,
      centroide: centroide(puntos),
      originalIndex: index,
      original: reserva,
    };
  });
}

function rutasRelacionadas(rutaA, rutaB) {
  const a = normalizarRuta(rutaA);
  const b = normalizarRuta(rutaB);
  if (!a || !b || a === b) return true;
  return (RUTAS_RELACIONADAS[a] || []).includes(b)
    || (RUTAS_RELACIONADAS[b] || []).includes(a);
}

function penalizacionRutas(reservas) {
  const rutas = Array.from(new Set(
    reservas.flatMap((reserva) => reserva.rutas).filter(Boolean)
  ));

  let penalizacion = Math.max(0, rutas.length - 1);
  for (let i = 0; i < rutas.length; i += 1) {
    for (let j = i + 1; j < rutas.length; j += 1) {
      if (!rutasRelacionadas(rutas[i], rutas[j])) penalizacion += 3;
    }
  }
  return penalizacion;
}

function puntosUnicos(reservas) {
  const mapa = new Map();
  for (const reserva of reservas) {
    for (const punto of reserva.puntos) {
      if (!mapa.has(punto.id)) mapa.set(punto.id, { ...punto });
    }
  }
  return Array.from(mapa.values());
}

function ordenarPuntosGeograficamente(
  puntos,
  puntoBase = PUNTO_BASE,
  destino = null,
  distancias = null
) {
  const pendientes = [...puntos];
  const ordenados = [];
  let actual = puntoBase;

  while (pendientes.length) {
    let mejorIndice = 0;
    let mejorPuntaje = Number.POSITIVE_INFINITY;

    for (let index = 0; index < pendientes.length; index += 1) {
      const candidato = pendientes[index];
      const distancia = distanciaEntreKm(actual, candidato, distancias);
      const distanciaSegura = Number.isFinite(distancia) ? distancia : 50;
      const ordenActual = numeroFinito(actual?.ordenRuta);
      const ordenCandidato = numeroFinito(candidato?.ordenRuta);
      const mismaRuta = normalizarRuta(actual?.ruta)
        && normalizarRuta(actual?.ruta) === normalizarRuta(candidato?.ruta);
      const rutaActual = normalizarRuta(actual?.ruta);
      const rutaCandidata = normalizarRuta(candidato?.ruta);
      const rutaRelacionada = rutaActual && rutaCandidata
        && !mismaRuta
        && rutasRelacionadas(rutaActual, rutaCandidata);
      const saltoNoRelacionado = rutaActual && rutaCandidata
        && !mismaRuta
        && !rutaRelacionada;
      const continuidad = ordenActual !== null && ordenCandidato !== null
        ? Math.min(10, Math.abs(ordenCandidato - ordenActual)) * 0.04
        : 0;

      let progresoDestino = 0;
      if (destino && coordenadasDe(actual) && coordenadasDe(candidato)) {
        const antes = distanciaEntreKm(actual, destino, distancias);
        const despues = distanciaEntreKm(candidato, destino, distancias);
        if (Number.isFinite(antes) && Number.isFinite(despues)) {
          progresoDestino = (despues - antes) * 0.15;
        }
      }

      const puntaje = distanciaSegura
        - (mismaRuta ? 0.6 : rutaRelacionada ? 0.2 : 0)
        + (saltoNoRelacionado ? 1.5 : 0)
        + continuidad
        + progresoDestino;

      if (puntaje < mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejorIndice = index;
      }
    }

    actual = pendientes.splice(mejorIndice, 1)[0];
    ordenados.push(actual);
  }

  return ordenados;
}

function metricasRecorrido(reservas, puntoBase = PUNTO_BASE, destino = null, distancias = null) {
  const puntos = puntosUnicos(reservas);
  if (!puntos.length) {
    return { distanciaKm: 0, puntosOrdenados: [], puntosSinCoordenadas: 0 };
  }

  const puntosSinCoordenadas = puntos.filter((punto) => !coordenadasDe(punto)).length;
  const puntosOrdenados = ordenarPuntosGeograficamente(puntos, puntoBase, destino, distancias);
  let distanciaKm = 0;
  let actual = puntoBase;

  for (const punto of puntosOrdenados) {
    const distancia = distanciaEntreKm(actual, punto, distancias);
    if (Number.isFinite(distancia)) distanciaKm += distancia;
    actual = punto;
  }

  if (destino) {
    const distanciaDestino = distanciaEntreKm(actual, destino, distancias);
    if (Number.isFinite(distanciaDestino)) distanciaKm += distanciaDestino;
  }

  return {
    distanciaKm: Number(distanciaKm.toFixed(2)),
    puntosOrdenados,
    puntosSinCoordenadas,
  };
}

function anguloDesdeBase(reserva, puntoBase = PUNTO_BASE) {
  if (!reserva.centroide) return Number.POSITIVE_INFINITY;
  return Math.atan2(
    reserva.centroide.lat - puntoBase.lat,
    reserva.centroide.lon - puntoBase.lon
  );
}

function compararReservas(a, b, orden, puntoBase) {
  if (orden === 'ruta-pax') {
    const rutaA = Number(a.rutas[0]);
    const rutaB = Number(b.rutas[0]);
    const rankA = Number.isFinite(rutaA) ? rutaA : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(rutaB) ? rutaB : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (b.pax !== a.pax) return b.pax - a.pax;
  } else if (orden === 'angulo-pax') {
    const anguloA = anguloDesdeBase(a, puntoBase);
    const anguloB = anguloDesdeBase(b, puntoBase);
    if (anguloA !== anguloB) return anguloA - anguloB;
    if (b.pax !== a.pax) return b.pax - a.pax;
  } else {
    if (b.pax !== a.pax) return b.pax - a.pax;
    const rutaA = Number(a.rutas[0]);
    const rutaB = Number(b.rutas[0]);
    const rankA = Number.isFinite(rutaA) ? rutaA : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(rutaB) ? rutaB : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
  }

  return a.originalIndex - b.originalIndex;
}

function crearBus(indice, bilinguePermitido) {
  return {
    indice,
    bilinguePermitido,
    reservas: [],
    ocupados: 0,
  };
}

function costoInsercion(bus, reserva, perfil, puntoBase, destino, distancias) {
  if (bus.ocupados + reserva.pax > CAPACIDAD_BUS) return Number.POSITIVE_INFINITY;
  if (reserva.ingles && !bus.bilinguePermitido) return Number.POSITIVE_INFINITY;

  let incrementoDistancia = 0;
  if (perfil.pesoDistancia > 0) {
    const antes = bus.reservas.length
      ? metricasRecorrido(bus.reservas, puntoBase, destino, distancias).distanciaKm
      : 0;
    const despues = metricasRecorrido(
      bus.reservas.concat(reserva),
      puntoBase,
      destino,
      distancias
    ).distanciaKm;
    incrementoDistancia = Math.max(0, despues - antes);
  }
  const incrementoRuta = Math.max(
    0,
    penalizacionRutas(bus.reservas.concat(reserva)) - penalizacionRutas(bus.reservas)
  );
  const restante = CAPACIDAD_BUS - bus.ocupados - reserva.pax;

  let bonoIdioma = 0;
  if (!reserva.ingles && bus.bilinguePermitido && bus.reservas.some((item) => item.ingles)) {
    bonoIdioma = -0.8;
  }

  return incrementoDistancia * perfil.pesoDistancia
    + incrementoRuta * perfil.pesoRuta
    + restante * perfil.pesoOcupacion
    + bonoIdioma;
}

function asignarReservasAFlota({
  reservas,
  totalBuses,
  maxBusesBilingues,
  perfil,
  puntoBase,
  destino,
  distancias,
}) {
  const buses = Array.from(
    { length: totalBuses },
    (_, index) => crearBus(index, index < maxBusesBilingues)
  );

  const ingles = reservas
    .filter((reserva) => reserva.ingles)
    .sort((a, b) => compararReservas(a, b, perfil.orden, puntoBase));
  const otros = reservas
    .filter((reserva) => !reserva.ingles)
    .sort((a, b) => compararReservas(a, b, perfil.orden, puntoBase));

  for (const reserva of ingles.concat(otros)) {
    let mejorBus = null;
    let mejorCosto = Number.POSITIVE_INFINITY;

    for (const bus of buses) {
      const costo = costoInsercion(bus, reserva, perfil, puntoBase, destino, distancias);
      if (costo < mejorCosto) {
        mejorCosto = costo;
        mejorBus = bus;
      }
    }

    if (!mejorBus) return null;
    mejorBus.reservas.push(reserva);
    mejorBus.ocupados += reserva.pax;
  }

  return buses.filter((bus) => bus.reservas.length);
}

function enriquecerBuses(buses, puntoBase, destino, distancias) {
  return buses.map((bus, index) => {
    const recorrido = metricasRecorrido(bus.reservas, puntoBase, destino, distancias);
    const rutas = Array.from(new Set(bus.reservas.flatMap((reserva) => reserva.rutas).filter(Boolean)));
    const pasajerosIngles = bus.reservas
      .filter((reserva) => reserva.ingles)
      .reduce((sum, reserva) => sum + reserva.pax, 0);

    return {
      ...bus,
      id: `Bus ${index + 1}`,
      capacidad: CAPACIDAD_BUS,
      pasajerosIngles,
      requiereGuiaBilingue: pasajerosIngles > 0,
      rutas,
      penalizacionRutas: penalizacionRutas(bus.reservas),
      distanciaKm: recorrido.distanciaKm,
      puntosSinCoordenadas: recorrido.puntosSinCoordenadas,
      paradas: recorrido.puntosOrdenados.map((punto, orden) => ({
        orden: orden + 1,
        Id_Punto: punto.Id_Punto,
        NombrePunto: punto.NombrePunto,
        ruta: punto.ruta || null,
        ordenRuta: punto.ordenRuta,
        Latitud: punto.Latitud,
        Longitud: punto.Longitud,
      })),
    };
  });
}

function metricasPlan(buses, totalPax, totalReservas) {
  const cargas = buses.map((bus) => bus.ocupados);
  return {
    totalBuses: buses.length,
    busesCompletos: cargas.filter((carga) => carga === CAPACIDAD_BUS).length,
    busesBilingues: buses.filter((bus) => bus.requiereGuiaBilingue).length,
    pasajeros: totalPax,
    reservas: totalReservas,
    sillasVacias: buses.reduce((sum, bus) => sum + CAPACIDAD_BUS - bus.ocupados, 0),
    distanciaTotalKm: Number(buses.reduce((sum, bus) => sum + bus.distanciaKm, 0).toFixed(2)),
    distanciaMaximaKm: Number(Math.max(0, ...buses.map((bus) => bus.distanciaKm)).toFixed(2)),
    penalizacionRutas: buses.reduce((sum, bus) => sum + bus.penalizacionRutas, 0),
    cargas,
  };
}

function compararMismaCantidadBilingue(a, b) {
  if (a.metricas.totalBuses !== b.metricas.totalBuses) {
    return a.metricas.totalBuses - b.metricas.totalBuses;
  }
  if (a.metricas.busesCompletos !== b.metricas.busesCompletos) {
    return b.metricas.busesCompletos - a.metricas.busesCompletos;
  }
  if (a.metricas.penalizacionRutas !== b.metricas.penalizacionRutas) {
    return a.metricas.penalizacionRutas - b.metricas.penalizacionRutas;
  }
  if (a.metricas.distanciaTotalKm !== b.metricas.distanciaTotalKm) {
    return a.metricas.distanciaTotalKm - b.metricas.distanciaTotalKm;
  }
  return a.perfil.localeCompare(b.perfil);
}

function esCoherenteRespectoA(candidato, referencia) {
  const limiteTotal = referencia.metricas.distanciaTotalKm
    * (1 + UMBRALES_COHERENCIA.incrementoDistanciaTotal)
    + UMBRALES_COHERENCIA.toleranciaDistanciaTotalKm;
  const limiteMaximo = referencia.metricas.distanciaMaximaKm
    * (1 + UMBRALES_COHERENCIA.incrementoDistanciaMaxima)
    + UMBRALES_COHERENCIA.toleranciaDistanciaMaximaKm;
  const limiteMezcla = referencia.metricas.penalizacionRutas
    + UMBRALES_COHERENCIA.incrementoMezclaRutas;

  return candidato.metricas.busesCompletos >= referencia.metricas.busesCompletos
    && candidato.metricas.distanciaTotalKm <= limiteTotal
    && candidato.metricas.distanciaMaximaKm <= limiteMaximo
    && candidato.metricas.penalizacionRutas <= limiteMezcla;
}

function validarPlan(buses, reservas) {
  const errores = [];
  const apariciones = new Map();

  for (const bus of buses) {
    if (bus.ocupados > CAPACIDAD_BUS) {
      errores.push(`${bus.id} supera la capacidad: ${bus.ocupados}/${CAPACIDAD_BUS}.`);
    }
    for (const reserva of bus.reservas) {
      apariciones.set(reserva.id, (apariciones.get(reserva.id) || 0) + 1);
    }
  }

  for (const reserva of reservas) {
    const cantidad = apariciones.get(reserva.id) || 0;
    if (cantidad === 0) errores.push(`La reserva ${reserva.id} no fue asignada.`);
    if (cantidad > 1) errores.push(`La reserva ${reserva.id} fue asignada ${cantidad} veces.`);
  }

  return errores;
}

function serializarBus(bus) {
  return {
    id: bus.id,
    capacidad: bus.capacidad,
    ocupados: bus.ocupados,
    pasajerosIngles: bus.pasajerosIngles,
    requiereGuiaBilingue: bus.requiereGuiaBilingue,
    rutas: bus.rutas,
    distanciaKm: bus.distanciaKm,
    penalizacionRutas: bus.penalizacionRutas,
    puntosSinCoordenadas: bus.puntosSinCoordenadas,
    reservas: bus.reservas.map((reserva) => reserva.original),
    paradas: bus.paradas,
  };
}

function generarPlanSombra({
  reservas: reservasEntrada,
  puntoBase = PUNTO_BASE,
  destino = null,
  maxGuiasBilingues = null,
  distancias = null,
  fuenteDistancias = 'haversine-local',
  metadataDistancias = null,
} = {}) {
  const inicio = Date.now();
  const reservas = normalizarReservas(reservasEntrada);
  const alertas = [];
  const reservasValidas = [];

  for (const reserva of reservas) {
    if (!reserva.id || reserva.id.startsWith('SIN_ID_')) {
      alertas.push({ tipo: 'RESERVA_SIN_ID', reserva: reserva.id });
      continue;
    }
    if (!reserva.pax) {
      alertas.push({ tipo: 'RESERVA_SIN_PASAJEROS', reserva: reserva.id });
      continue;
    }
    if (reserva.pax > CAPACIDAD_BUS) {
      alertas.push({
        tipo: 'RESERVA_SUPERA_CAPACIDAD',
        reserva: reserva.id,
        pasajeros: reserva.pax,
      });
      continue;
    }
    if (!reserva.puntos.length || reserva.puntos.every((punto) => !punto.Id_Punto)) {
      alertas.push({ tipo: 'RESERVA_SIN_PUNTO', reserva: reserva.id });
    }
    if (reserva.puntos.some((punto) => !coordenadasDe(punto))) {
      alertas.push({ tipo: 'PUNTO_SIN_COORDENADAS', reserva: reserva.id });
    }
    if (reserva.puntos.some((punto) => !punto.ruta)) {
      alertas.push({ tipo: 'PUNTO_SIN_RUTA', reserva: reserva.id });
    }
    if (reserva.idiomaDesconocido) {
      alertas.push({
        tipo: 'IDIOMA_REQUIERE_REVISION',
        reserva: reserva.id,
        idioma: reserva.idioma || null,
      });
    }
    reservasValidas.push(reserva);
  }

  const totalPax = reservasValidas.reduce((sum, reserva) => sum + reserva.pax, 0);
  const totalIngles = reservasValidas
    .filter((reserva) => reserva.ingles)
    .reduce((sum, reserva) => sum + reserva.pax, 0);
  const minimoTeoricoBuses = totalPax ? Math.ceil(totalPax / CAPACIDAD_BUS) : 0;
  const minimoBilingues = totalIngles ? Math.ceil(totalIngles / CAPACIDAD_BUS) : 0;
  const limiteGuias = maxGuiasBilingues === null || maxGuiasBilingues === undefined
    ? reservasValidas.length
    : Math.max(0, Math.trunc(Number(maxGuiasBilingues) || 0));

  if (minimoBilingues > limiteGuias) {
    alertas.push({
      tipo: 'GUIAS_BILINGUES_INSUFICIENTES',
      requeridosMinimos: minimoBilingues,
      disponibles: limiteGuias,
    });
  }

  if (!reservasValidas.length) {
    return {
      versionAlgoritmo: VERSION_ALGORITMO,
      modo: 'sombra',
      fuenteDistancias,
      metadataDistancias: metadataDistancias || {},
      buses: [],
      metricas: metricasPlan([], 0, 0),
      alternativasIdioma: [],
      alertas,
      duracionMs: Date.now() - inicio,
    };
  }

  const candidatos = [];
  for (let cantidadBuses = minimoTeoricoBuses;
    cantidadBuses <= reservasValidas.length;
    cantidadBuses += 1) {
    const maximoBilinguesEvaluado = Math.min(cantidadBuses, limiteGuias);

    for (let cantidadBilingues = minimoBilingues;
      cantidadBilingues <= maximoBilinguesEvaluado;
      cantidadBilingues += 1) {
      for (const perfil of PERFILES_BUSQUEDA) {
        const busesCrudos = asignarReservasAFlota({
          reservas: reservasValidas,
          totalBuses: cantidadBuses,
          maxBusesBilingues: cantidadBilingues,
          perfil,
          puntoBase,
          destino,
          distancias,
        });
        if (!busesCrudos) continue;

        const buses = enriquecerBuses(busesCrudos, puntoBase, destino, distancias);
        const errores = validarPlan(buses, reservasValidas);
        if (errores.length) continue;

        candidatos.push({
          busesBilinguesPermitidos: cantidadBilingues,
          perfil: perfil.nombre,
          buses,
          metricas: metricasPlan(buses, totalPax, reservasValidas.length),
        });
      }
    }

    if (candidatos.length) break;
  }

  if (!candidatos.length) {
    return {
      versionAlgoritmo: VERSION_ALGORITMO,
      modo: 'sombra',
      fuenteDistancias,
      metadataDistancias: metadataDistancias || {},
      buses: [],
      metricas: metricasPlan([], totalPax, reservasValidas.length),
      alternativasIdioma: [],
      alertas: alertas.concat({
        tipo: 'SIN_SOLUCION_SOMBRA',
        mensaje: 'No se encontró una asignación válida con las restricciones actuales.',
      }),
      duracionMs: Date.now() - inicio,
    };
  }

  const mejoresPorCantidad = Array.from(
    candidatos.reduce((mapa, candidato) => {
      const key = candidato.metricas.busesBilingues;
      const actual = mapa.get(key);
      if (!actual || compararMismaCantidadBilingue(candidato, actual) < 0) {
        mapa.set(key, candidato);
      }
      return mapa;
    }, new Map()).values()
  ).sort((a, b) => a.metricas.busesBilingues - b.metricas.busesBilingues);

  const referenciaGeografica = [...candidatos].sort((a, b) => {
    if (a.metricas.penalizacionRutas !== b.metricas.penalizacionRutas) {
      return a.metricas.penalizacionRutas - b.metricas.penalizacionRutas;
    }
    if (a.metricas.distanciaTotalKm !== b.metricas.distanciaTotalKm) {
      return a.metricas.distanciaTotalKm - b.metricas.distanciaTotalKm;
    }
    return b.metricas.busesCompletos - a.metricas.busesCompletos;
  })[0];

  const coherentes = mejoresPorCantidad.filter((candidato) => (
    esCoherenteRespectoA(candidato, referenciaGeografica)
  ));
  const seleccionado = (coherentes.length ? coherentes : mejoresPorCantidad)
    .sort((a, b) => {
      if (a.metricas.busesBilingues !== b.metricas.busesBilingues) {
        return a.metricas.busesBilingues - b.metricas.busesBilingues;
      }
      return compararMismaCantidadBilingue(a, b);
    })[0];

  const alternativasIdioma = mejoresPorCantidad.map((candidato) => ({
    busesBilingues: candidato.metricas.busesBilingues,
    busesCompletos: candidato.metricas.busesCompletos,
    distanciaTotalKm: candidato.metricas.distanciaTotalKm,
    distanciaMaximaKm: candidato.metricas.distanciaMaximaKm,
    penalizacionRutas: candidato.metricas.penalizacionRutas,
    coherente: esCoherenteRespectoA(candidato, referenciaGeografica),
    perfil: candidato.perfil,
  }));

  return {
    versionAlgoritmo: VERSION_ALGORITMO,
    modo: 'sombra',
    fuenteDistancias,
    metadataDistancias: {
      ...(metadataDistancias || {}),
      consultas: distancias?.estadisticas?.consultas || 0,
      fallbacksHaversine: distancias?.estadisticas?.fallbacksHaversine || 0,
    },
    capacidadBus: CAPACIDAD_BUS,
    minimoTeoricoBuses,
    minimoBuses: seleccionado.metricas.totalBuses,
    minimoBusesBilingues: minimoBilingues,
    decisiones: {
      flota: {
        pasajeros: totalPax,
        limiteTeorico: minimoTeoricoBuses,
        busesSeleccionados: seleccionado.metricas.totalBuses,
        busesCompletos: seleccionado.metricas.busesCompletos,
        cargaResidual: seleccionado.metricas.cargas.find((carga) => carga < CAPACIDAD_BUS) ?? 0,
        respetaIntegridadReserva: true,
      },
      idioma: {
        pasajerosIngles: totalIngles,
        limiteTeoricoBusesBilingues: minimoBilingues,
        busesBilinguesSeleccionados: seleccionado.metricas.busesBilingues,
        usaBusesAdicionalesPorCoherencia: seleccionado.metricas.busesBilingues > minimoBilingues,
      },
      recorrido: {
        origen: puntoBase?.nombre || puntoBase?.NombrePunto || PUNTO_BASE.nombre,
        usaPosicionComoPreferenciaSuave: true,
        usaRutasComoZonificacion: true,
        priorizaMismaRutaORutasRelacionadas: true,
        permiteSalirDeZonaCuandoLaCercaniaCompensa: true,
        ignoraTraficoTiempoReal: true,
        fuenteDistancias,
      },
    },
    buses: seleccionado.buses.map(serializarBus),
    metricas: seleccionado.metricas,
    alternativasIdioma,
    referenciaGeografica: {
      busesBilingues: referenciaGeografica.metricas.busesBilingues,
      distanciaTotalKm: referenciaGeografica.metricas.distanciaTotalKm,
      distanciaMaximaKm: referenciaGeografica.metricas.distanciaMaximaKm,
      penalizacionRutas: referenciaGeografica.metricas.penalizacionRutas,
    },
    alertas,
    duracionMs: Date.now() - inicio,
  };
}

module.exports = {
  VERSION_ALGORITMO,
  generarPlanSombra,
  normalizarReservas,
  metricasRecorrido,
  haversineKm,
};
