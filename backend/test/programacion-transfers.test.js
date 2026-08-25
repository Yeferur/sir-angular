const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resumirTransfersPorServicio,
  normalizarHoraProgramacionTransfer,
} = require('../services/Programacion/programacion.service');

test('resume transfers por servicio con pasajeros, pendientes y ventana horaria', () => {
  const resultado = resumirTransfersPorServicio([
    { Nombre_Servicio: 'Aeropuerto', Cantidad_Personas: 3, Hora_Recogida: '08:30:00', Estado: 'Confirmado' },
    { Nombre_Servicio: 'Aeropuerto', Cantidad_Personas: 2, Hora_Recogida: '06:15:00', Estado: 'Pendiente' },
    { Nombre_Servicio: 'Hotel', Cantidad_Personas: 4, Hora_Recogida: '12:00:00', Estado: 'Confirmado' },
  ]);

  assert.deepEqual(resultado, [
    {
      servicio: 'Aeropuerto',
      totalTransfers: 2,
      totalPasajeros: 5,
      pendientes: 1,
      primeraRecogida: '06:15',
      ultimaRecogida: '08:30',
    },
    {
      servicio: 'Hotel',
      totalTransfers: 1,
      totalPasajeros: 4,
      pendientes: 0,
      primeraRecogida: '12:00',
      ultimaRecogida: '12:00',
    },
  ]);
});

test('normaliza horas de 12 y 24 horas para ordenar la operación correctamente', () => {
  assert.deepEqual(normalizarHoraProgramacionTransfer('6:30 AM'), { display: '06:30', minutes: 390 });
  assert.deepEqual(normalizarHoraProgramacionTransfer('12:30 PM'), { display: '12:30', minutes: 750 });
  assert.deepEqual(normalizarHoraProgramacionTransfer('8:00 PM'), { display: '20:00', minutes: 1200 });
  assert.deepEqual(normalizarHoraProgramacionTransfer('00:15'), { display: '00:15', minutes: 15 });
});

test('mantiene visibles los registros sin servicio y normaliza cantidades inválidas', () => {
  const [resultado] = resumirTransfersPorServicio([
    { Nombre_Servicio: '', Cantidad_Personas: -2, Hora_Recogida: null, Estado: 'PENDIENTE DE CONFIRMAR' },
  ]);

  assert.equal(resultado.servicio, 'Sin servicio');
  assert.equal(resultado.totalPasajeros, 0);
  assert.equal(resultado.pendientes, 1);
  assert.equal(resultado.primeraRecogida, null);
  assert.equal(resultado.ultimaRecogida, null);
});
