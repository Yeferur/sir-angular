const test = require('node:test');
const assert = require('node:assert/strict');

const loginService = require('../services/Login/login.service');
const loginController = require('../controllers/Login/login.controller');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

test('forgot-password nunca expone el token ni diferencia una cuenta conocida', async (t) => {
  const originalCreate = loginService.createPasswordResetTokenForEmail;
  const originalNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    loginService.createPasswordResetTokenForEmail = originalCreate;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  process.env.NODE_ENV = 'development';
  const responses = [];
  for (const rawToken of ['TOKEN_QUE_NUNCA_DEBE_SALIR', null]) {
    loginService.createPasswordResetTokenForEmail = async () => ({
      user: null,
      rawToken,
    });
    const res = responseRecorder();
    await loginController.forgotPassword({ body: { email: 'persona@example.com' } }, res);
    responses.push(res.body);
  }

  loginService.createPasswordResetTokenForEmail = async () => {
    throw new Error('fallo interno simulado');
  };
  const failedRes = responseRecorder();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await loginController.forgotPassword({ body: { email: 'persona@example.com' } }, failedRes);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[0], failedRes.body);
  assert.equal(JSON.stringify(responses[0]).includes('TOKEN_QUE_NUNCA_DEBE_SALIR'), false);
  assert.equal(Object.hasOwn(responses[0].data || {}, 'resetUrl'), false);
});

test('reset-password rechaza contraseñas débiles antes de consultar el token', async (t) => {
  const originalReset = loginService.resetPasswordWithToken;
  let called = false;
  loginService.resetPasswordWithToken = async () => { called = true; };
  t.after(() => { loginService.resetPasswordWithToken = originalReset; });

  const res = responseRecorder();
  await loginController.resetPassword({
    body: { token: 'token-opaco', password: 'aaaaaaaa' },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errorCode, 'WEAK_PASSWORD');
  assert.equal(called, false);
});
test('el enlace de recuperación mantiene el token fuera de la query HTTP', () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.FRONTEND_URL = 'https://sir.example.com';
  process.env.NODE_ENV = 'production';
  try {
    const value = loginController._private.buildPasswordResetUrl('TOKEN sensible');
    const url = new URL(value);
    assert.equal(url.pathname, '/reset-password');
    assert.equal(url.search, '');
    assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), 'TOKEN sensible');
  } finally {
    if (previousFrontendUrl == null) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    if (previousNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('forgot-password no imprime SQL ni token ante un fallo de la cola', async (t) => {
  const originalCreate = loginService.createPasswordResetTokenForEmail;
  const originalConsoleError = console.error;
  const logged = [];
  t.after(() => {
    loginService.createPasswordResetTokenForEmail = originalCreate;
    console.error = originalConsoleError;
  });
  loginService.createPasswordResetTokenForEmail = async () => {
    const error = new Error('fallo controlado');
    error.code = 'ER_BAD_FIELD_ERROR';
    error.sql = "INSERT ... reset-password#token=TOKEN_SECRETO";
    throw error;
  };
  console.error = (...values) => logged.push(values.join(' '));

  const res = responseRecorder();
  await loginController.forgotPassword({ body: { email: 'persona@example.com' } }, res);

  assert.equal(logged.some(value => value.includes('TOKEN_SECRETO')), false);
  assert.equal(logged.some(value => value.includes('INSERT')), false);
  assert.equal(logged.some(value => value.includes('ER_BAD_FIELD_ERROR')), true);
  assert.equal(res.statusCode, 200);
});
