const test = require('node:test');
const assert = require('node:assert/strict');

const loginService = require('../services/Login/login.service');
const db = require('../database/db');

test('el cooldown por cuenta cubre por defecto toda la vigencia de diez minutos', () => {
  assert.equal(loginService.getPasswordResetCooldownSeconds({}), 600);
});

test('permite encolar el reset dentro de la misma transacción que crea el token', async (t) => {
  const originalGetConnection = db.getConnection;
  const calls = [];
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      if (/FROM usuarios/.test(sql)) {
        return [[{
          Id_Usuario: 21,
          Nombres_Apellidos: 'Asesor Uno',
          Correo: 'asesor@example.com',
          Activo: 1,
        }]];
      }
      if (/SELECT id FROM password_reset_tokens/.test(sql)) return [[]];
      return [{ insertId: 88, affectedRows: 1 }];
    },
  };
  db.getConnection = async () => conn;
  t.after(() => { db.getConnection = originalGetConnection; });

  let callbackConnection = null;
  const result = await loginService.createPasswordResetTokenForEmail('asesor@example.com', {
    async onCreated(created, executor) {
      callbackConnection = executor;
      calls.push(`enqueue:${created.user.Id_Usuario}`);
    },
  });

  assert.equal(callbackConnection, conn);
  assert.equal(result.user.Id_Usuario, 21);
  assert.ok(calls.indexOf('enqueue:21') < calls.indexOf('commit'));
  assert.equal(calls.includes('rollback'), false);
});

test('si la cola falla se revierte el token y no queda una recuperación huérfana', async (t) => {
  const originalGetConnection = db.getConnection;
  const calls = [];
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      if (/FROM usuarios/.test(sql)) {
        return [[{
          Id_Usuario: 21,
          Nombres_Apellidos: 'Asesor Uno',
          Correo: 'asesor@example.com',
          Activo: 1,
        }]];
      }
      if (/SELECT id FROM password_reset_tokens/.test(sql)) return [[]];
      return [{ insertId: 88, affectedRows: 1 }];
    },
  };
  db.getConnection = async () => conn;
  t.after(() => { db.getConnection = originalGetConnection; });

  await assert.rejects(() => loginService.createPasswordResetTokenForEmail('asesor@example.com', {
    async onCreated() { throw new Error('email_outbox unavailable'); },
  }), /email_outbox unavailable/);

  assert.equal(calls.includes('commit'), false);
  assert.equal(calls.includes('rollback'), true);
  assert.equal(calls.at(-1), 'release');
});

test('el cooldown persistente conserva el enlace anterior y no encola otro correo', async (t) => {
  const originalGetConnection = db.getConnection;
  const calls = [];
  const conn = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      calls.push(sql);
      if (/FROM usuarios/.test(sql)) {
        return [[{
          Id_Usuario: 21,
          Nombres_Apellidos: 'Asesor Uno',
          Correo: 'asesor@example.com',
          Activo: 1,
        }]];
      }
      if (/SELECT id FROM password_reset_tokens/.test(sql)) return [[{ id: 77 }]];
      throw new Error('no debe reemplazar el token durante el cooldown');
    },
  };
  db.getConnection = async () => conn;
  t.after(() => { db.getConnection = originalGetConnection; });

  let enqueued = false;
  const result = await loginService.createPasswordResetTokenForEmail('asesor@example.com', {
    env: { PASSWORD_RESET_COOLDOWN_SECONDS: '300' },
    async onCreated() { enqueued = true; },
  });

  assert.equal(result.rateLimited, true);
  assert.equal(result.rawToken, null);
  assert.equal(enqueued, false);
  assert.equal(calls.some((sql) => /DELETE FROM password_reset_tokens/.test(sql)), false);
  assert.equal(calls.some((sql) => /FROM usuarios[\s\S]*FOR UPDATE/.test(sql)), true);
  assert.equal(calls.includes('rollback'), false);
});
