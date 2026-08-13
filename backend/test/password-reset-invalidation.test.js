const test = require('node:test');
const assert = require('node:assert/strict');

const {
  invalidatePendingPasswordResets,
} = require('../services/Login/password-reset-invalidation.service');

test('invalida token y correo pendiente dentro del mismo ejecutor transaccional', async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };

  await invalidatePendingPasswordResets(
    executor,
    21,
    ' ANTERIOR@Example.com ',
    'Credenciales actualizadas.'
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /DELETE FROM password_reset_tokens/);
  assert.deepEqual(calls[0].params, [21]);
  assert.match(calls[1].sql, /Estado IN \('pendiente', 'procesando'\)/);
  assert.deepEqual(calls[1].params, ['Credenciales actualizadas.', 'anterior@example.com']);
  assert.equal(calls[1].sql.includes('Payload = JSON_OBJECT()'), true);
});
