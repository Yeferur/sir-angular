const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReservationEntity } = require('../services/EntidadesReportantes/entidades-reportantes.service');

const channels = new Map([
  [1, 'HOTEL'],
  [2, 'AGENCIA NACIONAL'],
  [3, 'AGENCIA INTERNACIONAL'],
  [4, 'FREELANCE'],
  [5, 'DIRECTO'],
]);

const entities = new Map([
  [10, { Id_Entidad_Reportante: 10, Tipo: 'HOTEL', Activo: 1, Estado_Validacion: 'VALIDADA' }],
  [20, { Id_Entidad_Reportante: 20, Tipo: 'AGENCIA_NACIONAL', Activo: 1, Estado_Validacion: 'PENDIENTE_VALIDACION' }],
  [30, { Id_Entidad_Reportante: 30, Tipo: 'AGENCIA_INTERNACIONAL', Activo: 1, Estado_Validacion: 'VALIDADA' }],
]);

const executor = {
  async query(sql, params) {
    if (sql.includes('SELECT Nombre_Canal FROM canales_reservas')) {
      const nombre = channels.get(Number(params[0]));
      return [nombre ? [{ Nombre_Canal: nombre }] : []];
    }
    if (sql.includes('FROM entidades_reportantes WHERE Id_Entidad_Reportante=?')) {
      const entity = entities.get(Number(params[0]));
      return [entity ? [entity] : []];
    }
    throw new Error(`Unexpected query in reservation entity validation test: ${sql}`);
  },
};

test('reservation channels validate entity type against channel type', async () => {
  assert.equal(await validateReservationEntity(executor, 1, 10), 10);
  assert.equal(await validateReservationEntity(executor, 2, 20), 20);
  assert.equal(await validateReservationEntity(executor, 3, 30), 30);
  await assert.rejects(validateReservationEntity(executor, 1, 20),
    error => error.errorCode === 'ENTITY_CHANNEL_MISMATCH');
});

test('mapped channels require an entity and reject inactive or rejected entities', async () => {
  await assert.rejects(validateReservationEntity(executor, 1, null),
    error => error.errorCode === 'ENTITY_REQUIRED');
  entities.set(40, { Id_Entidad_Reportante: 40, Tipo: 'HOTEL', Activo: 0, Estado_Validacion: 'VALIDADA' });
  await assert.rejects(validateReservationEntity(executor, 1, 40),
    error => error.errorCode === 'ENTITY_INVALID');
});

test('Freelance and channels without an entity always normalize the reservation FK to null', async () => {
  assert.equal(await validateReservationEntity(executor, 4, null), null);
  assert.equal(await validateReservationEntity(executor, 4, 10), null);
  assert.equal(await validateReservationEntity(executor, 5, 10), null);
});
