const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const service = require('../services/AppUpdates/app-updates.service');

test('publica una versión para usuarios internos con deduplicación por usuario y versión', async (t) => {
  const originalQuery = db.query;
  let captured;
  db.query = async (sql, params) => {
    captured = { sql, params };
    return [{ affectedRows: 2 }];
  };
  t.after(() => { db.query = originalQuery; });

  const result = await service.publishCurrentRelease({
    version: 'v9.9.9', title: 'Nueva versión', message: 'Cambios', publishedAt: '2026-09-22',
  });

  assert.equal(result.version, 'v9.9.9');
  assert.equal(result.delivered, 2);
  assert.match(captured.sql, /LOWER\(TRIM\(r\.Nombre_Rol\)\) <> 'cliente'/);
  assert.match(captured.sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(captured.params.at(-1), 'APP_UPDATE:v9.9.9');
});
