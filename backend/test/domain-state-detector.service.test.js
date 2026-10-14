const test = require('node:test');
const assert = require('node:assert/strict');
const detector = require('../services/Pendientes/domain-state-detector.service');
const db = require('../database/db');
const policy = require('../services/Pendientes/pendientes-policy.service');
const pendingService = require('../services/Pendientes/pendientes.service');
const schema = require('../services/schema-capabilities');

test('los textos consumen el estado calculado existente sin redefinir sus validaciones', () => {
  assert.match(detector.descriptionFor('La reserva', 'Pendiente de datos'), /información operativa/);
  assert.match(detector.descriptionFor('El transfer', 'Pendiente de pago'), /pago/);
  assert.equal(detector.PENDING_STATES.includes('Completada'), false);
});

test('el detector de reservas usa SQL legacy cuando el esquema no tiene soft-delete', async () => {
  await schema.initializeSchemaCapabilities({
    async query(sql) {
      if (sql.includes('SELECT DATABASE()')) return [[{ databaseName: 'fixture_legacy' }], []];
      if (sql.includes('information_schema.COLUMNS')) return [[], []];
      if (sql.includes('information_schema.TABLES')) return [[], []];
      throw new Error(`Consulta inesperada de capacidades: ${sql}`);
    },
  });

  const previous = {
    dbQuery: db.query,
    getRuleByCode: policy.getRuleByCode,
    activeKeysForRule: pendingService.activeKeysForRule,
    upsertCondition: pendingService.upsertCondition,
    resolveCondition: pendingService.resolveCondition,
  };
  let sqlSeen = '';
  try {
    policy.getRuleByCode = async (codigo) => ({ codigo, activa: true, configuracion: {} });
    pendingService.activeKeysForRule = async () => [];
    pendingService.upsertCondition = async () => {};
    pendingService.resolveCondition = async () => true;
    db.query = async (sql) => {
      sqlSeen = sql;
      return [[], []];
    };
    assert.equal(await detector.syncReservationPendings(), 0);
    assert.match(sqlSeen, /FROM reservas r/);
    assert.doesNotMatch(sqlSeen, /Eliminada_En/);
  } finally {
    db.query = previous.dbQuery;
    policy.getRuleByCode = previous.getRuleByCode;
    pendingService.activeKeysForRule = previous.activeKeysForRule;
    pendingService.upsertCondition = previous.upsertCondition;
    pendingService.resolveCondition = previous.resolveCondition;
  }
});
