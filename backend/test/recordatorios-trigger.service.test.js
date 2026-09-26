const test = require('node:test');
const assert = require('node:assert/strict');
const { nextTrigger, processDueReminders } = require('../services/Recordatorios/recordatorios-trigger.service');

test('un recordatorio sin recurrencia notifica una vez', () => {
  assert.equal(nextTrigger({ Recurrencia: null, Intervalo: null }), null);
});

test('la recurrencia diaria y semanal conserva un intervalo acotado', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  assert.equal(nextTrigger({ Recurrencia: 'DIARIA', Intervalo: '2' }, now), '2026-09-13 07:00:00');
  assert.equal(nextTrigger({ Recurrencia: 'SEMANAL', Intervalo: '1' }, now), '2026-09-18 07:00:00');
});

function triggerDependencies(row, { enqueueError = null } = {}) {
  const queries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT r\.Id_Recordatorio/.test(sql)) return [[row]];
      return [{ affectedRows: 1 }];
    },
  };
  const enqueued = [];
  const notifications = [];
  const websocket = [];
  return {
    queries, enqueued, notifications, websocket,
    dependencies: {
      db: { async getConnection() { return connection; } },
      notifications: { async createNotification(_connection, input) { notifications.push(input); return '501'; } },
      emailOutbox: {
        isSingleMailbox: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')),
        async enqueueReminderEmail(...args) {
          if (enqueueError) throw enqueueError;
          enqueued.push(args);
          return { idEmail: '88', deduplicated: false };
        },
      },
      websocketManager: { sendToUser(userId, event) { websocket.push({ userId, event }); } },
    },
  };
}

test('encola el correo para el propietario y la ocurrencia sin reemplazar la notificación interna', async () => {
  const row = {
    Id_Recordatorio: 9, Id_Usuario: 44, Titulo: 'Llamar al cliente', Descripcion: 'Confirmar llegada',
    Recurrencia: 'DIARIA', Intervalo: '1', Siguiente_Trigger: new Date('2026-09-22T15:00:00.000Z'),
    Enviar_Correo: 1, Nombres_Apellidos: 'Usuario SIR', Correo: 'propietario@example.com',
  };
  const state = triggerDependencies(row);
  const result = await processDueReminders({}, state.dependencies);

  assert.equal(result.processed, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].deduplicationKey, 'RECORDATORIO:9:2026-09-22 10:00:00');
  assert.equal(state.notifications[0].data.recordatorioId, '9');
  assert.equal(state.enqueued.length, 1);
  assert.equal(state.enqueued[0][0].to, 'propietario@example.com');
  assert.equal(state.enqueued[0][1], 9);
  assert.equal(state.enqueued[0][2], '2026-09-22 10:00:00');
  assert.equal(state.websocket.length, 1);
});

test('un correo inválido o un fallo de cola no impide el recordatorio interno', async () => {
  const base = {
    Id_Recordatorio: 10, Id_Usuario: 45, Titulo: 'Revisar', Descripcion: null,
    Recurrencia: null, Intervalo: null, Siguiente_Trigger: new Date('2026-09-22T15:00:00.000Z'),
    Enviar_Correo: 1, Nombres_Apellidos: 'Usuario', Correo: 'correo-invalido',
  };
  const invalid = triggerDependencies(base);
  await processDueReminders({}, invalid.dependencies);
  assert.equal(invalid.enqueued.length, 0);
  assert.equal(invalid.notifications.length, 1);

  const failing = triggerDependencies({ ...base, Correo: 'usuario@example.com' }, { enqueueError: new Error('outbox temporal') });
  await processDueReminders({}, failing.dependencies);
  assert.equal(failing.notifications.length, 1);
  assert.equal(failing.websocket.length, 1);
});
