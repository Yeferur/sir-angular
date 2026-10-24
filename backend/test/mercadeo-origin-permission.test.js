const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeOriginQuery } = require('../controllers/Mercadeo/mercadeo.controller');

const entityPermission = ['ENTIDADES_REPORTANTES.LEER'];
const baseQuery = {
  idEntidadReportante: '17',
  fechaRegistroDesde: '2026-10-01',
  fechaRegistroHasta: '2026-10-31',
};

test('Mercadeo entity-read scope requires entity id and a bounded period', () => {
  assert.throws(() => scopeOriginQuery({}, entityPermission), error => error.errorCode === 'ENTITY_SCOPE_REQUIRED');
  assert.throws(() => scopeOriginQuery({ ...baseQuery, idEntidadReportante: '' }, entityPermission),
    error => error.errorCode === 'ENTITY_SCOPE_REQUIRED');
  assert.throws(() => scopeOriginQuery({ ...baseQuery, fechaRegistroDesde: '' }, entityPermission),
    error => error.errorCode === 'ENTITY_SCOPE_REQUIRED');
  assert.throws(() => scopeOriginQuery({ ...baseQuery, fechaRegistroHasta: '2026-11-01' }, entityPermission),
    error => error.errorCode === 'DATE_RANGE_TOO_LONG');
});

test('Mercadeo entity-read scope limits page size to ten', () => {
  assert.equal(scopeOriginQuery({ ...baseQuery, pageSize: '100' }, entityPermission).pageSize, 10);
  assert.equal(scopeOriginQuery({ ...baseQuery, pageSize: '3' }, entityPermission).pageSize, 3);
  assert.equal(scopeOriginQuery(baseQuery, entityPermission).pageSize, 10);
});

test('Mercadeo read can query the full origin; entity-read cannot bypass the scope', () => {
  const fullQuery = { tipo: 'TODOS', pageSize: '25' };
  assert.deepEqual(scopeOriginQuery(fullQuery, ['MERCADEO.RESERVAS.LEER']), fullQuery);
  assert.throws(() => scopeOriginQuery(fullQuery, []), error => error.status === 403);
});
