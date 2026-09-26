const test = require('node:test');
const assert = require('node:assert/strict');
const { nextReminder, pendingNotificationKey } = require('../services/Pendientes/pendientes-trigger.service');

test('la próxima notificación usa la recurrencia configurada por la regla', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');
  assert.equal(nextReminder(90, now), '2026-09-11 08:30:00');
  assert.equal(nextReminder(null, now), null);
});

test('la identidad de la notificación no cambia por un conteo variable', () => {
  const row = { Id_Pendiente: 8, Ciclo_Notificacion: 14 };
  assert.equal(
    pendingNotificationKey(row, { count: 3, notificationIdentity: 'situacion-a' }),
    pendingNotificationKey(row, { count: 9, notificationIdentity: 'situacion-a' })
  );
  assert.notEqual(
    pendingNotificationKey(row, { notificationIdentity: 'situacion-a' }),
    pendingNotificationKey(row, { notificationIdentity: 'situacion-b' })
  );
  assert.notEqual(
    pendingNotificationKey(row, { notificationIdentity: 'situacion-a' }),
    pendingNotificationKey({ ...row, Ciclo_Notificacion: 15 }, { notificationIdentity: 'situacion-a' })
  );
});
