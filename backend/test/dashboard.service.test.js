const test = require('node:test');
const assert = require('node:assert/strict');

const {
  previousPeriod,
  percentageChange,
  buildCancelledReservationsSql,
  buildReservationStatusesSql,
  buildPassengerAgeSql,
  getPassengerDistributionSvc,
  getDailyPassengersSvc,
  getTourOccupancySvc,
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

test('las reservas canceladas se cuentan por Fecha_Tour sin mezclarse con activas', () => {
  const sql = buildCancelledReservationsSql('AND r.Fecha_Tour BETWEEN ? AND ? AND h.Id_Tour = ?');

  assert.match(sql, /COUNT\(DISTINCT r\.Id_Reserva\)/);
  assert.match(sql, /r\.Fecha_Tour BETWEEN \? AND \?/);
  assert.match(sql, /h\.Id_Tour = \?/);
  assert.match(sql, /CANCELADA.*CANCELADO.*ELIMINADA.*ELIMINADO/);
  assert.doesNotMatch(sql, /NOT IN \('CANCELADA'/);
});

test('construye el resumen separado por estado de reserva', () => {
  const sql = buildReservationStatusesSql('AND r.Fecha_Tour >= ? AND h.Id_Tour = ?');

  assert.match(sql, /COALESCE\(NULLIF\(UPPER\(TRIM\(r\.Estado\)/);
  assert.match(sql, /COUNT\(DISTINCT r\.Id_Reserva\)/);
  assert.match(sql, /GROUP BY Estado_Reserva/);
  assert.match(sql, /COMPLETADA.*CONFIRMADA.*PENDIENTEDATOS.*CANCELADA/s);
});

test('devuelve pasajeros diarios separados por tour', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });

  db.query = async (sql, params) => {
    assert.match(sql, /JOIN tours t ON h\.Id_Tour = t\.Id_Tour/);
    assert.match(sql, /GROUP BY DATE\(r\.Fecha_Tour\), t\.Id_Tour, t\.Nombre_Tour/);
    assert.deepEqual(params, ['2026-08-01', '2026-08-03']);
    return [[
      { fecha: '2026-08-01', tour: 'GUATAPE', pasajeros: '4' },
      { fecha: '2026-08-01', tour: 'CITY TOUR', pasajeros: '2' },
    ]];
  };

  assert.deepEqual(await getDailyPassengersSvc({ startDate: '2026-08-01', endDate: '2026-08-03' }), [
    { fecha: '2026-08-01', tour: 'GUATAPE', pasajeros: 4 },
    { fecha: '2026-08-01', tour: 'CITY TOUR', pasajeros: 2 },
  ]);
});

test('construye la composición de pasajeros por edad sin incluir canceladas', () => {
  const sql = buildPassengerAgeSql('AND r.Fecha_Tour BETWEEN ? AND ?');

  assert.match(sql, /Tipo_Pasajero/);
  assert.match(sql, /UPPER\(TRIM\(p\.Tipo_Pasajero\)\)/);
  assert.match(sql, /NOT IN \('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO'\)/);
  assert.match(sql, /GROUP BY Tipo_Pasajero/);
  assert.match(sql, /ADULTO.*NINO.*INFANTE/s);
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

test('desglosa un tour con varios planes sin atribuir pasajeros sin plan a otro plan', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });

  let queryIndex = 0;
  db.query = async (sql, params) => {
    queryIndex += 1;

    if (queryIndex === 1) {
      assert.match(sql, /FROM planes_tours/);
      assert.deepEqual(params, [5]);
      return [[
        { Id_Plan: 36, Nombre_Plan: 'Pasaporte Básico' },
        { Id_Plan: 37, Nombre_Plan: 'Pasaporte Safari' },
      ]];
    }

    assert.match(sql, /'Sin plan' AS nombre/);
    assert.match(sql, /assigned_plan\.Id_Plan IS NULL/);
    assert.doesNotMatch(sql, /plan_resuelto|ORDER BY\s+CASE WHEN pt2\.Fecha_Inicio/i);
    assert.deepEqual(params, [5, '2026-06-01', '2026-06-30', 5, 5, '2026-06-01', '2026-06-30']);
    return [[
      { Id_Plan: 36, nombre: 'Pasaporte Básico', reservas: '4', pasajeros: '10', adultos: '7', ninos: '2', infantes: '1', sin_plan: 0 },
      { Id_Plan: 37, nombre: 'Pasaporte Safari', reservas: '3', pasajeros: '8', adultos: '5', ninos: '3', infantes: '0', sin_plan: 0 },
      { Id_Plan: null, nombre: 'Sin plan', reservas: '1', pasajeros: '2', adultos: '2', ninos: '0', infantes: '0', sin_plan: 1 },
    ]];
  };

  assert.deepEqual(await getTourOccupancySvc({
    tourId: 5,
    startDate: '2026-06-01',
    endDate: '2026-06-30',
  }), [
    { idPlan: 36, nombre: 'Pasaporte Básico', reservas: 4, pasajeros: 10, adultos: 7, ninos: 2, infantes: 1, sinPlan: false },
    { idPlan: 37, nombre: 'Pasaporte Safari', reservas: 3, pasajeros: 8, adultos: 5, ninos: 3, infantes: 0, sinPlan: false },
    { idPlan: null, nombre: 'Sin plan', reservas: 1, pasajeros: 2, adultos: 2, ninos: 0, infantes: 0, sinPlan: true },
  ]);
  assert.equal(queryIndex, 2);
});

test('no crea un desglose por plan para tours con un único plan', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });

  let queryCount = 0;
  db.query = async () => {
    queryCount += 1;
    return [[{ Id_Plan: 32, Nombre_Plan: 'Plan básico' }]];
  };

  assert.deepEqual(await getTourOccupancySvc({ tourId: 1 }), []);
  assert.equal(queryCount, 1);
});
