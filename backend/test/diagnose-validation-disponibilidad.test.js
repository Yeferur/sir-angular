const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseConnection } = require('../scripts/diagnose-validation-disponibilidad');
const { SHARED_TOUR_IDS, SHARED_CAPACITY_SOURCE_ID } = require('../services/Aforos/shared-capacity.service');

const DATE = '2099-04-18';
const [RIO_CLARO_ID, HACIENDA_NAPOLES_ID] = SHARED_TOUR_IDS.map(Number);
const SOURCE_ID = Number(SHARED_CAPACITY_SOURCE_ID);

function makeConnection({ reservationDates, availabilityDates, capacities, occupancy, stored }) {
  const occupancyQueries = [];
  const storedQueries = [];

  return {
    occupancyQueries,
    storedQueries,
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS')) {
        return [[
          { TABLE_NAME: 'aforos', COLUMN_NAME: 'Operacion' },
          { TABLE_NAME: 'reservas', COLUMN_NAME: 'Eliminada_En' },
        ]];
      }
      if (sql.includes('SELECT DISTINCT h.Id_Tour, r.Fecha_Tour')) return [reservationDates];
      if (sql.includes('SELECT DISTINCT Id_Tour, Fecha_Tour FROM disponibilidad')) return [availabilityDates];
      if (sql.includes('FROM tours t WHERE t.Id_Tour=?')) {
        const idTour = Number(params[1]);
        return [[{ Cupo_Base: capacities[idTour] ?? 0, override_capacity: null }]];
      }
      if (sql.includes('AS occupied')) {
        const date = params.at(-1);
        const tours = params.slice(0, -1).map(Number);
        occupancyQueries.push({ tours, date });
        const occupied = tours.reduce((total, idTour) => total + Number(occupancy[`${idTour}:${date}`] || 0), 0);
        return [[{ occupied }]];
      }
      if (sql.includes('SELECT Cupos_Totales,Cupos_Disponibles,Updated_At FROM disponibilidad')) {
        storedQueries.push({ idTour: Number(params[0]), date: params[1] });
        const row = stored[`${Number(params[0])}:${params[1]}`];
        return [row ? [row] : []];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM pasajeros')) return [[{ total: 0 }]];
      throw new Error(`Consulta inesperada en el stub: ${sql}`);
    },
  };
}

function availability(id, total, available) {
  return { Id_Disponibilidad: id, Cupos_Totales: total, Cupos_Disponibles: available, Updated_At: null };
}

test('el preflight suma Río Claro y Nápoles contra el saldo compartido correcto', async () => {
  const connection = makeConnection({
    reservationDates: [
      { Id_Tour: RIO_CLARO_ID, Fecha_Tour: DATE },
      { Id_Tour: HACIENDA_NAPOLES_ID, Fecha_Tour: DATE },
    ],
    availabilityDates: [{ Id_Tour: SOURCE_ID, Fecha_Tour: DATE }],
    capacities: { [SOURCE_ID]: 20 },
    occupancy: { [`${RIO_CLARO_ID}:${DATE}`]: 7, [`${HACIENDA_NAPOLES_ID}:${DATE}`]: 5 },
    stored: { [`${SOURCE_ID}:${DATE}`]: availability(10, 20, 8) },
  });

  const report = await diagnoseConnection(connection, 'test');

  assert.equal(report.findings.length, 0);
  assert.equal(report.examined, 1);
  assert.deepEqual(connection.occupancyQueries, [{ tours: SHARED_TOUR_IDS.map(Number), date: DATE }]);
  assert.deepEqual(connection.storedQueries, [{ idTour: SOURCE_ID, date: DATE }]);
});

test('el preflight reporta un saldo compartido de Nápoles que no cuadra con ambas ocupaciones', async () => {
  const connection = makeConnection({
    reservationDates: [
      { Id_Tour: RIO_CLARO_ID, Fecha_Tour: DATE },
      { Id_Tour: HACIENDA_NAPOLES_ID, Fecha_Tour: DATE },
    ],
    availabilityDates: [{ Id_Tour: SOURCE_ID, Fecha_Tour: DATE }],
    capacities: { [SOURCE_ID]: 20 },
    occupancy: { [`${RIO_CLARO_ID}:${DATE}`]: 7, [`${HACIENDA_NAPOLES_ID}:${DATE}`]: 5 },
    stored: { [`${SOURCE_ID}:${DATE}`]: availability(10, 20, 9) },
  });

  const report = await diagnoseConnection(connection, 'test');

  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0], {
    tour: SOURCE_ID,
    date: DATE,
    sharedTours: SHARED_TOUR_IDS.map(Number),
    period: 'FUTURA',
    capacityCurrentRule: 20,
    capacity: 20,
    occupied: 12,
    expectedAvailable: 8,
    stored: availability(10, 20, 9),
    overCapacity: false,
  });
});

test('el preflight no exige disponibilidad propia para reservas de Río Claro', async () => {
  const connection = makeConnection({
    reservationDates: [{ Id_Tour: RIO_CLARO_ID, Fecha_Tour: DATE }],
    availabilityDates: [{ Id_Tour: SOURCE_ID, Fecha_Tour: DATE }],
    capacities: { [SOURCE_ID]: 20 },
    occupancy: { [`${RIO_CLARO_ID}:${DATE}`]: 4 },
    stored: { [`${SOURCE_ID}:${DATE}`]: availability(12, 20, 16) },
  });

  const report = await diagnoseConnection(connection, 'test');

  assert.equal(report.findings.length, 0);
  assert.deepEqual(connection.occupancyQueries, [{ tours: SHARED_TOUR_IDS.map(Number), date: DATE }]);
  assert.deepEqual(connection.storedQueries, [{ idTour: SOURCE_ID, date: DATE }]);
});
