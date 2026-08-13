const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERIC_MESSAGE,
  createPasswordResetRateLimit,
} = require('../middlewares/password-reset-rate-limit');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('limita por IP sin revelar si el correo existe', () => {
  let current = 1_000_000;
  const limiter = createPasswordResetRateLimit({
    store: new Map(),
    now: () => current,
    policy: { maxRequests: 2, windowMs: 60_000 },
  });
  const request = { ip: '203.0.113.10' };
  let passed = 0;

  limiter(request, createResponse(), () => { passed += 1; });
  limiter(request, createResponse(), () => { passed += 1; });
  const blocked = createResponse();
  limiter(request, blocked, () => { passed += 1; });

  assert.equal(passed, 2);
  assert.equal(blocked.statusCode, 200);
  assert.equal(blocked.body.success, true);
  assert.equal(blocked.body.message, GENERIC_MESSAGE);

  current += 60_001;
  limiter(request, createResponse(), () => { passed += 1; });
  assert.equal(passed, 3);
});

test('una IP no bloquea a otra dentro de la misma ventana', () => {
  const limiter = createPasswordResetRateLimit({
    store: new Map(),
    now: () => 1_000_000,
    policy: { maxRequests: 1, windowMs: 60_000 },
  });
  let passed = 0;
  limiter({ ip: '203.0.113.10' }, createResponse(), () => { passed += 1; });
  limiter({ ip: '203.0.113.11' }, createResponse(), () => { passed += 1; });
  assert.equal(passed, 2);
});
