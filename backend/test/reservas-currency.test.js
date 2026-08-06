const test = require('node:test');
const assert = require('node:assert/strict');

const { resolverMonedaReserva } = require('../services/Reservas/reservas.service');

test('acepta una moneda existente y devuelve su identificador normalizado', async () => {
  const connection = {
    async query(_sql, params) {
      assert.deepEqual(params, [2]);
      return [[{ Id_Moneda: 2 }]];
    },
  };

  assert.equal(await resolverMonedaReserva(connection, '2', { required: true }), 2);
});

test('rechaza una moneda inválida antes de consultar la base de datos', async () => {
  const connection = {
    async query() {
      assert.fail('No debe consultar la base de datos para un identificador inválido.');
    },
  };

  await assert.rejects(
    resolverMonedaReserva(connection, 'USD', { required: true }),
    (error) => error?.errorCode === 'INVALID_CURRENCY' && error?.status === 400,
  );
});

test('rechaza una moneda que ya no existe', async () => {
  const connection = {
    async query() {
      return [[]];
    },
  };

  await assert.rejects(
    resolverMonedaReserva(connection, 99, { required: true }),
    (error) => error?.errorCode === 'CURRENCY_NOT_FOUND' && error?.status === 400,
  );
});
