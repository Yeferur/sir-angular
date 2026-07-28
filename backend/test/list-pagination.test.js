const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const { filtrarReservas } = require('../services/Reservas/reservas.service');
const { filtrarTransfersSvc } = require('../services/Transfers/transfers.service');

test('pagina las reservas en el servidor y normaliza páginas fuera de rango', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  t.after(() => {
    db.query = originalQuery;
  });

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) {
      return [[{ total: 51 }]];
    }
    return [[{ Id_Reserva: 'TG00001', Estado: 'Confirmada' }]];
  };

  const result = await filtrarReservas({ page: '99', limit: '25' });

  assert.equal(result.total, 51);
  assert.equal(result.page, 3);
  assert.equal(result.limit, 25);
  assert.equal(result.totalPages, 3);
  assert.equal(result.data.length, 1);
  assert.match(calls[1].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[1].params.slice(-2), [25, 50]);
});

test('pagina los transfers en el servidor usando el mismo total filtrado', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  t.after(() => {
    db.query = originalQuery;
  });

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(DISTINCT tr.Id_Transfer)')) {
      return [[{ total: 45 }]];
    }
    return [[{ Id_Transfer: 1, Estado: 'Confirmado' }]];
  };

  const result = await filtrarTransfersSvc({ page: '2', limit: '20' });

  assert.equal(result.total, 45);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 20);
  assert.equal(result.totalPages, 3);
  assert.equal(result.data.length, 1);
  assert.match(calls[1].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[1].params, [20, 20]);
});
