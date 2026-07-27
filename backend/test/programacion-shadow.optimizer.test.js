const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generarPlanSombra,
} = require('../services/Programacion/shadow/programacion-shadow.optimizer');

function crearReserva({
  id,
  pax,
  idioma = 'ESPAÑOL',
  ruta = '1',
  lat = 6.22,
  lon = -75.58,
  puntos = null,
}) {
  return {
    Id_Reserva: id,
    NumeroPasajeros: pax,
    Idioma_Reserva: idioma,
    puntosReserva: puntos || [{
      Id_Punto: id * 10,
      NombrePunto: `PUNTO ${id}`,
      Latitud: lat,
      Longitud: lon,
      ruta,
      ordenRuta: id,
      pasajeros: pax,
    }],
  };
}

function idsAsignados(plan) {
  return plan.buses
    .flatMap((bus) => bus.reservas.map((reserva) => String(reserva.Id_Reserva)))
    .sort();
}

test('usa el mínimo de buses y prioriza dejar llenos todos salvo el residual', () => {
  const reservas = [
    crearReserva({ id: 1, pax: 20 }),
    crearReserva({ id: 2, pax: 18 }),
    crearReserva({ id: 3, pax: 20 }),
    crearReserva({ id: 4, pax: 18 }),
    crearReserva({ id: 5, pax: 20 }),
    crearReserva({ id: 6, pax: 18 }),
    crearReserva({ id: 7, pax: 20 }),
    crearReserva({ id: 8, pax: 18 }),
    crearReserva({ id: 9, pax: 1 }),
  ];

  const plan = generarPlanSombra({ reservas });

  assert.equal(plan.minimoBuses, 5);
  assert.equal(plan.metricas.totalBuses, 5);
  assert.equal(plan.metricas.busesCompletos, 4);
  assert.deepEqual([...plan.metricas.cargas].sort((a, b) => b - a), [38, 38, 38, 38, 1]);
});

test('asigna cada reserva una sola vez y nunca supera 38 pasajeros', () => {
  const reservas = Array.from({ length: 27 }, (_, index) => crearReserva({
    id: index + 1,
    pax: (index % 6) + 1,
    ruta: String((index % 5) + 1),
    lat: 6.20 + index * 0.001,
    lon: -75.60 + index * 0.001,
  }));

  const plan = generarPlanSombra({ reservas });

  assert.deepEqual(idsAsignados(plan), reservas.map((reserva) => String(reserva.Id_Reserva)).sort());
  assert.ok(plan.buses.every((bus) => bus.ocupados <= 38));
  assert.equal(plan.metricas.pasajeros, reservas.reduce((sum, reserva) => sum + reserva.NumeroPasajeros, 0));
});

test('agrega un bus cuando el límite teórico no es factible sin dividir reservas', () => {
  const reservas = [
    crearReserva({ id: 1, pax: 20 }),
    crearReserva({ id: 2, pax: 20 }),
    crearReserva({ id: 3, pax: 20 }),
  ];

  const plan = generarPlanSombra({ reservas });

  assert.equal(plan.minimoTeoricoBuses, 2);
  assert.equal(plan.minimoBuses, 3);
  assert.equal(plan.metricas.totalBuses, 3);
  assert.deepEqual(plan.metricas.cargas, [20, 20, 20]);
});

test('mantiene juntos todos los puntos de una reserva multipunto', () => {
  const multipunto = crearReserva({
    id: 50,
    pax: 6,
    puntos: [
      {
        Id_Punto: 501,
        NombrePunto: 'HOTEL A',
        Latitud: 6.21,
        Longitud: -75.58,
        ruta: '1',
        pasajeros: 2,
      },
      {
        Id_Punto: 502,
        NombrePunto: 'HOTEL B',
        Latitud: 6.23,
        Longitud: -75.57,
        ruta: '2',
        pasajeros: 4,
      },
    ],
  });
  const reservas = [
    multipunto,
    crearReserva({ id: 51, pax: 32, ruta: '2' }),
    crearReserva({ id: 52, pax: 10, ruta: '3' }),
  ];

  const plan = generarPlanSombra({ reservas });
  const busesConReserva = plan.buses.filter((bus) => (
    bus.reservas.some((reserva) => reserva.Id_Reserva === 50)
  ));

  assert.equal(busesConReserva.length, 1);
  const idsParadas = busesConReserva[0].paradas.map((parada) => parada.Id_Punto);
  assert.ok(idsParadas.includes(501));
  assert.ok(idsParadas.includes(502));
});

test('concentra inglés y permite completar esos buses con reservas en español', () => {
  const reservas = [
    crearReserva({ id: 1, pax: 20, idioma: 'INGLÉS', ruta: '1' }),
    crearReserva({ id: 3, pax: 15, idioma: 'INGLÉS', ruta: '2' }),
    crearReserva({ id: 2, pax: 3, idioma: 'ESPAÑOL', ruta: '1' }),
    crearReserva({ id: 4, pax: 38, idioma: 'ESPAÑOL', ruta: '2' }),
    crearReserva({ id: 5, pax: 38, idioma: 'ESPAÑOL', ruta: '3' }),
  ];

  const plan = generarPlanSombra({ reservas });
  const bilingues = plan.buses.filter((bus) => bus.requiereGuiaBilingue);

  assert.equal(plan.minimoBusesBilingues, 1);
  assert.equal(bilingues.length, 1);
  assert.ok(bilingues[0].reservas.some((reserva) => reserva.Idioma_Reserva === 'ESPAÑOL'));
  assert.equal(bilingues[0].pasajerosIngles, 35);
});

test('usa otro bus bilingüe cuando concentrar inglés rompe la coherencia o la flota mínima', () => {
  const reservas = [
    crearReserva({ id: 1, pax: 10, idioma: 'INGLÉS', ruta: '1' }),
    crearReserva({ id: 2, pax: 10, idioma: 'INGLÉS', ruta: '13' }),
    crearReserva({ id: 3, pax: 28, idioma: 'ESPAÑOL', ruta: '1' }),
    crearReserva({ id: 4, pax: 28, idioma: 'ESPAÑOL', ruta: '13' }),
  ];

  const plan = generarPlanSombra({ reservas });

  assert.equal(plan.minimoBusesBilingues, 1);
  assert.equal(plan.metricas.totalBuses, 2);
  assert.equal(plan.metricas.busesBilingues, 2);
  assert.equal(plan.decisiones.idioma.usaBusesAdicionalesPorCoherencia, true);
});

test('es determinista para la misma entrada', () => {
  const reservas = Array.from({ length: 20 }, (_, index) => crearReserva({
    id: index + 1,
    pax: (index % 4) + 2,
    idioma: index < 6 ? 'INGLÉS' : 'ESPAÑOL',
    ruta: String((index % 4) + 1),
    lat: 6.20 + index * 0.002,
    lon: -75.60 + index * 0.001,
  }));

  const primero = generarPlanSombra({ reservas });
  const segundo = generarPlanSombra({ reservas });

  assert.deepEqual(primero.metricas, segundo.metricas);
  assert.deepEqual(primero.buses, segundo.buses);
});

test('alerta datos incompletos sin ocultarlos', () => {
  const reservas = [
    crearReserva({
      id: 1,
      pax: 4,
      idioma: 'POR DEFINIR',
      ruta: '',
      lat: null,
      lon: null,
    }),
  ];

  const plan = generarPlanSombra({ reservas });
  const tipos = plan.alertas.map((alerta) => alerta.tipo);

  assert.ok(tipos.includes('IDIOMA_REQUIERE_REVISION'));
  assert.ok(tipos.includes('PUNTO_SIN_COORDENADAS'));
  assert.ok(tipos.includes('PUNTO_SIN_RUTA'));
});

test('no ignora un límite insuficiente de guías bilingües', () => {
  const plan = generarPlanSombra({
    maxGuiasBilingues: 0,
    reservas: [
      crearReserva({ id: 1, pax: 5, idioma: 'INGLÉS' }),
      crearReserva({ id: 2, pax: 5, idioma: 'ESPAÑOL' }),
    ],
  });
  const tipos = plan.alertas.map((alerta) => alerta.tipo);

  assert.equal(plan.buses.length, 0);
  assert.ok(tipos.includes('GUIAS_BILINGUES_INSUFICIENTES'));
  assert.ok(tipos.includes('SIN_SOLUCION_SOMBRA'));
});
