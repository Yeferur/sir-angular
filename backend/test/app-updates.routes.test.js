const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('../routes/AppUpdates/app-updates.routes');
const { CURRENT_RELEASE } = require('../services/AppUpdates/app-updates.service');

test('la metadata de versión vigente responde sin caché', async (t) => {
  const app = express();
  app.use('/api/app-updates', router);
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/app-updates/current`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { version: CURRENT_RELEASE.version });
});
