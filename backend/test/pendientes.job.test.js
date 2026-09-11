const test = require('node:test');
const assert = require('node:assert/strict');
const job = require('../jobs/pendientes.job');

test('el intervalo del detector es configurable pero conserva límites operativos', () => {
  assert.equal(job.getInterval({}), job.DEFAULT_INTERVAL_MS);
  assert.equal(job.getInterval({ PENDIENTES_JOB_INTERVAL_MS: '1000' }), 60_000);
  assert.equal(job.getInterval({ PENDIENTES_JOB_INTERVAL_MS: '99999999' }), 3_600_000);
});
