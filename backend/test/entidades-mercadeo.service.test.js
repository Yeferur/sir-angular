const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { filters, detail } = require('../services/EntidadesReportantes/entidades-mercadeo.service');
const { DEFAULT_DIAS_SIN_REPORTAR, resolverDiasSinReportar } = require('../config/entidades-reportantes');

test('actividad de entidades valida el filtro de antigüedad y normaliza el orden', () => {
  const parsed = filters({ diasSinReportarMin: '90', ordenarPor: 'ultima_reserva', orden: 'desc' });
  assert.equal(parsed.daysSinceReportMin, 90);
  assert.equal(parsed.sortBy, 'ultima_reserva');
  assert.equal(parsed.sortDirection, 'DESC');
});

test('actividad de entidades rechaza un umbral de días inválido', () => {
  assert.throws(() => filters({ diasSinReportarMin: '-1' }),
    error => error.errorCode === 'INACTIVITY_DAYS_INVALID');
  assert.throws(() => filters({ diasSinReportarMin: '90.5' }),
    error => error.errorCode === 'INACTIVITY_DAYS_INVALID');
});

test('el umbral de inactividad es configurable y tiene un valor predeterminado', () => {
  assert.equal(DEFAULT_DIAS_SIN_REPORTAR, 90);
  assert.equal(resolverDiasSinReportar({ diasSinReportar: 45 }), 45);
  assert.equal(resolverDiasSinReportar({ diasSinReportar: 'invalido' }), 90);
});

test('el detalle suma transfers y pasajeros al período y calcula el último reporte con ambas fuentes', async t => {
  const originalQuery = db.query;
  const calls = [];
  const activityResults = [
    { Reservas: 2, Transfers: 3, Operaciones: 5, Pasajeros: 14, Ultimo_Reporte: '2026-10-27 10:00:00' },
    { Reservas: 1, Transfers: 2, Operaciones: 3, Pasajeros: 8 },
  ];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT e.*,u.Nombres_Apellidos AS Creador')) {
      return [[{ Id_Entidad_Reportante: 17, Tipo: 'HOTEL', Nombre: 'Hotel de prueba',
        Activo: 0, Estado_Validacion: 'RECHAZADA' }]];
    }
    if (sql.includes('SELECT COALESCE(ra.Reservas,0) AS Reservas')) {
      return [[activityResults.shift()]];
    }
    return [[]];
  };
  t.after(() => { db.query = originalQuery; });

  const result = await detail(17, { desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(result.historic.Reservas, 2);
  assert.equal(result.historic.Transfers, 3);
  assert.equal(result.historic.Operaciones, 5);
  assert.equal(result.historic.Pasajeros, 14);
  assert.equal(result.historic.Ultimo_Reporte, '2026-10-27 10:00:00');
  assert.equal(result.period.Reservas, 1);
  assert.equal(result.period.Transfers, 2);
  assert.equal(result.period.Operaciones, 3);
  assert.equal(result.period.Pasajeros, 8);

  const historicQuery = calls.find(call => call.sql.includes('AS Ultimo_Reporte'));
  const periodQuery = calls.find(call => call.sql.includes('tr.Fecha_Registro>=?'));
  for (const query of [historicQuery, periodQuery]) {
    assert.match(query.sql, /COUNT\(tr\.Id_Transfer\) AS Transfers/);
    assert.match(query.sql, /COALESCE\(SUM\(tr\.Cantidad_Personas\),0\) AS Pasajeros/);
    assert.match(query.sql, /MAX\(tr\.Fecha_Registro\) AS Ultima_Actividad/);
  }
  assert.match(historicQuery.sql, /AS Ultimo_Reporte/);
  assert.deepEqual(periodQuery.params, [17, '2026-10-01 00:00:00', '2026-10-31',
    17, '2026-10-01 00:00:00', '2026-10-31']);
});
