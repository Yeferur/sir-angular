const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bogotaDate,
  hasAnyPermission,
  normalizeOverview,
} = require('../services/Home/home.service');

test('detecta capacidades usando permisos efectivos y no el nombre del rol', () => {
  const permissions = ['RESERVAS.LEER', 'INFORMES.LEER'];

  assert.equal(hasAnyPermission(permissions, 'INFORMES.LEER', 'USUARIOS.LEER'), true);
  assert.equal(hasAnyPermission(permissions, 'TRANSFERS.LEER'), false);
  assert.equal(hasAnyPermission(null, 'INFORMES.LEER'), false);
});

test('normaliza hoy y mañana aun cuando uno de los días no tiene operación', () => {
  const dates = { today: '2026-08-05', tomorrow: '2026-08-06' };
  const result = normalizeOverview([
    {
      Fecha: dates.today,
      Reservas: '3',
      Pasajeros: '8',
      Privadas: '1',
      Transfers: '2',
      Pasajeros_Transfer: '5',
    },
  ], dates);

  assert.deepEqual(result.today, {
    date: dates.today,
    reservations: 3,
    passengers: 8,
    privateReservations: 1,
    transfers: 2,
    transferPassengers: 5,
  });
  assert.deepEqual(result.tomorrow, {
    date: dates.tomorrow,
    reservations: 0,
    passengers: 0,
    privateReservations: 0,
    transfers: 0,
    transferPassengers: 0,
  });
});

test('genera fechas de Bogotá en formato estable y respeta el desplazamiento', () => {
  const today = bogotaDate(0);
  const tomorrow = bogotaDate(1);

  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
  const difference = new Date(`${tomorrow}T12:00:00Z`) - new Date(`${today}T12:00:00Z`);
  assert.equal(difference, 24 * 60 * 60 * 1000);
});
