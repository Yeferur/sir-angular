const test = require('node:test');
const assert = require('node:assert/strict');
const { toMysqlDateTime } = require('../utils/dateTime');

test('guarda instantes ISO como hora operativa de Bogotá sin doble desplazamiento', () => {
  assert.equal(toMysqlDateTime('2026-09-11T08:05:00.000Z'), '2026-09-11 03:05:00');
});
