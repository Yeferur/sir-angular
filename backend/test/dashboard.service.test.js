const test = require('node:test');
const assert = require('node:assert/strict');

const {
  previousPeriod,
  percentageChange,
  getPassengerDistributionSvc,
} = require('../services/Dashboard/dashboard.service');
const db = require('../database/db');

test('calcula un periodo anterior de la misma duración sin solaparlo', () => {
  assert.deepEqual(
    previousPeriod({ startDate: '2026-06-30', endDate: '2026-07-06' }),
    { startDate: '2026-06-23', endDate: '2026-06-29' },
  );
});

test('calcula variaciones y evita porcentajes engañosos sin base anterior', () => {
  assert.equal(percentageChange(120, 100), 20);
  assert.equal(percentageChange(80, 100), -20);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(50, 0), null);
});

test('agrupa la confirmación por la expresión calculada y no por Estado de la reserva', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });

  db.query = async (sql) => {
    assert.match(sql, /GROUP BY 1/);
    assert.doesNotMatch(sql, /GROUP BY estado/i);
    return [[
      { estado: 'Viajaron', cantidad: 4 },
      { estado: 'Pendientes', cantidad: 2 },
    ]];
  };

  assert.deepEqual(await getPassengerDistributionSvc({}), [
    { estado: 'Viajaron', cantidad: 4 },
    { estado: 'Pendientes', cantidad: 2 },
  ]);
});
