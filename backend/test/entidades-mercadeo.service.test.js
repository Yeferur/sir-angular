const test = require('node:test');
const assert = require('node:assert/strict');
const { filters } = require('../services/EntidadesReportantes/entidades-mercadeo.service');
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
