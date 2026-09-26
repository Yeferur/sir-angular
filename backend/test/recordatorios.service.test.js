const test = require('node:test');
const assert = require('node:assert/strict');

const reminders = require('../services/Recordatorios/recordatorios.service');
const db = require('../database/db');

test('normaliza un recordatorio personal con identificador textual de entidad', () => {
  const result = reminders.normalizeInput({
    titulo: ' Revisar reserva ',
    descripcion: 'Confirmar datos',
    fecha: '2026-09-11T20:00:00.000Z',
    entidadTipo: 'RESERVA',
    entidadId: 'CTG11014',
    enviarCorreo: true,
  });

  assert.equal(result.title, 'Revisar reserva');
  assert.equal(result.date, '2026-09-11 15:00:00');
  assert.equal(result.entityId, 'CTG11014');
  assert.equal(result.sendEmail, true);
});

test('el correo queda desactivado salvo que el cliente envíe true explícitamente', () => {
  const base = { titulo: 'Revisar', fecha: '2026-09-11T20:00:00.000Z' };
  assert.equal(reminders.normalizeInput(base).sendEmail, false);
  assert.equal(reminders.normalizeInput({ ...base, enviarCorreo: 'true' }).sendEmail, false);
  assert.equal(reminders.normalizeInput({ ...base, enviarCorreo: true }).sendEmail, true);
});

test('un recordatorio siempre exige título y fecha válida', () => {
  assert.throws(
    () => reminders.normalizeInput({ titulo: '', fecha: '2026-09-11T20:00:00.000Z' }),
    (error) => error.code === 'REMINDER_TITLE_REQUIRED'
  );
  assert.throws(
    () => reminders.normalizeInput({ titulo: 'Revisar', fecha: 'sin-fecha' }),
    (error) => error.code === 'INVALID_REMINDER_DATE'
  );
});

test('completar atiende la ocurrencia y conserva la siguiente recurrencia', async (t) => {
  const originalGetConnection = db.getConnection;
  const queries = [];
  const row = {
    Id_Recordatorio: 8, Id_Usuario: 3, Titulo: 'Seguimiento', Descripcion: null,
    Fecha: new Date(Date.now() - 86_400_000), Recurrencia: 'DIARIA', Intervalo: '1',
    Recordar_Todo_El_Dia: 0, Intervalo_Todo_El_Dia: null, Enviar_Correo: 0,
    Siguiente_Trigger: new Date(Date.now() + 86_400_000), Estado: 'ACTIVO', Activo: 1,
    Suprimido_Hasta: null, Entidad_Tipo: null, Entidad_Id: null,
    Fecha_Creacion: new Date(), Fecha_Actualizacion: new Date(),
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM recordatorios/.test(sql)) return [[row]];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = originalGetConnection; });

  const result = await reminders.complete(3, 8);

  assert.equal(result.estado, 'ACTIVO');
  assert.equal(result.estadoPresentacion, 'PROGRAMADO');
  assert.ok(queries.some(({ sql }) => /Estado = 'ACTIVO', Activo = 1/.test(sql)));
  assert.ok(queries.some(({ sql }) => /UPDATE notificaciones/.test(sql)));
});
