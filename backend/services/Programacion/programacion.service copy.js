// backend/services/listado.service.js
const db = require('../../database/db');

const CAPACIDADES_BUSES = [18,23,25,27,38,39,40,41,43];
const MAX_DESVIO_KM = 3; // configurable

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ordenarPorDistanciaIncremental(reservas) {
  if (reservas.length <= 1) return reservas;
  const resultado = [];
  const sinVisitar = [...reservas];
  let actual = sinVisitar.shift();
  resultado.push(actual);

  while (sinVisitar.length > 0) {
    const siguienteIndex = sinVisitar.reduce((minIdx, r, i) => {
      const distMin = calcularDistancia(
        actual.Latitud, actual.Longitud,
        sinVisitar[minIdx].Latitud, sinVisitar[minIdx].Longitud
      );
      const distActual = calcularDistancia(
        actual.Latitud, actual.Longitud,
        r.Latitud, r.Longitud
      );
      return distActual < distMin ? i : minIdx;
    }, 0);
    actual = sinVisitar.splice(siguienteIndex, 1)[0];
    resultado.push(actual);
  }
  return resultado;
}

async function obtenerReservas(fecha, idTour) {
  const sql = `
    SELECT r.Id_Reserva, r.NumeroPasajeros, r.Id_Punto, r.TourReserva, r.Ruta,
           p.Posicion, p.Latitud, p.Longitud, p.NombrePunto
    FROM reservas r
    JOIN puntos p ON p.Id_Punto = r.Id_Punto
    WHERE r.FechaReserva = ?
      AND r.TourReserva = ?
      AND r.Estado IN ('Pendiente','PendienteDatos','Confirmada','Completada')
      AND r.TipoReserva = 'Grupal'
  `;
  const [rows] = await db.query(sql, [fecha, idTour]);
  return rows.map(r => ({ ...r, NumeroPasajeros: parseInt(r.NumeroPasajeros, 10) }));
}

function generarCombinaciones(capacidades, total) {
  const resultados = [];
  const backtrack = (comb, start) => {
    const suma = comb.reduce((a, b) => a + b, 0);
    if (suma >= total) {
      resultados.push([...comb]);
      return;
    }
    for (let i = start; i < capacidades.length; i++) {
      comb.push(capacidades[i]);
      backtrack(comb, i); // permitir repetir buses
      comb.pop();
    }
  };
  backtrack([], 0);
  resultados.sort((a, b) => (
    a.length - b.length || // priorizar menos buses
    a.reduce((x, y) => x + y) - b.reduce((x, y) => x + y) // luego menor capacidad total
  ));
  return resultados;
}


function asignarReservasInicial(reservas, combinacion) {
  const buses = combinacion.map(cap => ({ capacidad: cap, ocupados: 0, reservas: [] }));
  const sinAsignar = [];
  for (const reserva of reservas) {
    let asignado = false;
    for (const bus of buses) {
      if (bus.ocupados + reserva.NumeroPasajeros <= bus.capacidad) {
        bus.reservas.push(reserva);
        bus.ocupados += reserva.NumeroPasajeros;
        asignado = true;
        break;
      }
    }
    if (!asignado) sinAsignar.push(reserva);
  }
  return { buses, sinAsignar };
}

function intentarReubicarPorCercania(sinAsignar, buses) {
  const reubicadas = [];
  const sinAsignarFinal = [];

  for (const reserva of sinAsignar) {
    let mejorOpcion = null;
    let minDistancia = Infinity;
    for (const bus of buses) {
      if (bus.ocupados + reserva.NumeroPasajeros > bus.capacidad) continue;
      const ultima = bus.reservas[bus.reservas.length - 1];
      const dist = calcularDistancia(
        ultima.Latitud, ultima.Longitud,
        reserva.Latitud, reserva.Longitud
      );
      if (dist < minDistancia) {
        minDistancia = dist;
        mejorOpcion = bus;
      }
    }
    if (mejorOpcion && minDistancia <= MAX_DESVIO_KM) {
      mejorOpcion.reservas.push(reserva);
      mejorOpcion.ocupados += reserva.NumeroPasajeros;
      reubicadas.push({ reserva, bus: mejorOpcion, distanciaExtraKm: minDistancia });
    } else {
      sinAsignarFinal.push({ reserva, sugerencias: mejorOpcion ? { bus: mejorOpcion, distanciaExtraKm: minDistancia } : null });
    }
  }
  return { reubicadas, sinAsignarFinal };
}

async function generarListados(fecha, idsTour, maxOpciones = 5) {
  const idTour = idsTour[0];
  let reservas = await obtenerReservas(fecha, idTour);
  reservas.sort((a, b) => a.Posicion - b.Posicion);
  reservas = ordenarPorDistanciaIncremental(reservas);
  const totalPasajeros = reservas.reduce((sum, r) => sum + r.NumeroPasajeros, 0);
  const combinaciones = generarCombinaciones(CAPACIDADES_BUSES, totalPasajeros);

  const sugerencias = [];

  for (const combinacion of combinaciones) {
    const { buses, sinAsignar } = asignarReservasInicial(reservas, combinacion);
    const { reubicadas, sinAsignarFinal } = intentarReubicarPorCercania(sinAsignar, buses);

    if (sinAsignarFinal.length > 0) continue; // ❌ ignorar combinaciones incompletas

    const totalDesvio = reubicadas.reduce((sum, r) => sum + r.distanciaExtraKm, 0);
    const totalAsignadas = reservas.length;

    sugerencias.push({
      combinacion,
      buses,
      totalBuses: combinacion.length,
      totalDesvioKm: totalDesvio,
      porcentajeAsignado: 100,
      reubicadas,
      sinAsignar: [],
    });

    if (sugerencias.length >= maxOpciones) break; // ✅ ya tenemos suficientes buenas opciones
  }

  sugerencias.sort((a, b) => (
    a.totalBuses - b.totalBuses ||
    a.totalDesvioKm - b.totalDesvioKm
  ));

  return {
    fecha,
    tour: idTour,
    totalPasajeros,
    sugerencias,
    mensaje: sugerencias.length > 0
      ? 'Se encontraron combinaciones óptimas sin reservas sin asignar.'
      : 'No se encontraron combinaciones que asignen todas las reservas. Intenta manualmente.'
  };
}


async function generarListadoManual(fecha, tour, combinacionManual) {
  const reservas = await obtenerReservas(fecha, tour);

  // Ordenar reservas por algún criterio (p. ej., ubicación)
  const reservasOrdenadas = ordenarPorDistanciaIncremental(reservas);

  const buses = combinacionManual.map((bus, i) => ({
    id: i + 1,
    placa: bus.placa,
    capacidad: bus.capacidad,
    guia: bus.guia,
    reservas: [],
    ocupados: 0
  }));

  const sinAsignar = [];

  for (const reserva of reservasOrdenadas) {
    const cupo = reserva.NumeroPasajeros;

    // Buscar el primer bus que tenga espacio suficiente
    const busDisponible = buses.find(b => b.capacidad - b.ocupados >= cupo);

    if (busDisponible) {
      busDisponible.reservas.push(reserva);
      busDisponible.ocupados += cupo;
    } else {
      sinAsignar.push({ reserva, motivo: 'Sin cupo en buses manuales' });
    }
  }

  const totalPasajeros = reservas.reduce((acc, r) => acc + r.NumeroPasajeros, 0);

  return {
    fecha,
    tour,
    totalPasajeros,
    combinacionUsada: combinacionManual.map(b => b.capacidad),
    buses,
    sinAsignar
  };
}


module.exports = {
  generarListados,
  generarListadoManual
};