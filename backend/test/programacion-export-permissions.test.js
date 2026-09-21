const test = require('node:test');
const assert = require('node:assert/strict');

const permissionsService = require('../services/Permisos/permisos.service');
const {
  invalidarCacheUsuario,
} = require('../middlewares/permissionsMiddleware');
const { authMiddleware } = require('../middlewares/authMiddleware');
const router = require('../routes/Programacion/programacion.routes');

const EXPORT_ENDPOINTS = [
  { method: 'post', path: '/exportar-listado-bus' },
  { method: 'post', path: '/exportar-listados-zip' },
  { method: 'post', path: '/exportar-reserva-privada' },
  { method: 'post', path: '/exportar-privados-zip' },
  { method: 'get', path: '/exportar-transfers-dia' },
];

let nextUserId = 870000000;

function findEndpoint(method, path) {
  const layer = router.stack.find((entry) => (
    entry.route?.path === path && entry.route.methods?.[method]
  ));
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} to be registered`);
  return layer.route.stack.map((entry) => entry.handle);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runMiddleware(middleware, req) {
  const res = makeResponse();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { statusCode: res.statusCode, body: res.body, nextCalled };
}

async function withEffectivePermissions(codes, callback) {
  const userId = ++nextUserId;
  const original = permissionsService.obtenerPermisosPorUsuario;
  invalidarCacheUsuario(userId);
  permissionsService.obtenerPermisosPorUsuario = async () => (
    codes.map((Codigo_Permiso) => ({ Codigo_Permiso }))
  );

  try {
    await callback(userId);
  } finally {
    permissionsService.obtenerPermisosPorUsuario = original;
    invalidarCacheUsuario(userId);
  }
}

async function runEndpointAuthorization(handlers, userId, effectivePermissions) {
  // The first route handler is authMiddleware. The tests invoke the installed
  // authorization middleware directly so controllers never touch operational data.
  assert.equal(handlers.length, 4);
  const req = { user: { id: userId, isClient: false } };

  for (const middleware of handlers.slice(1, 3)) {
    const result = await runMiddleware(middleware, req);
    if (!result.nextCalled) return result;
  }

  assert.deepEqual(req.userPermissions, effectivePermissions);
  return { statusCode: 200, body: null, nextCalled: true };
}

test('all five direct export endpoint routes require authentication, read, and export', async (t) => {
  for (const endpoint of EXPORT_ENDPOINTS) {
    await t.test(`${endpoint.method.toUpperCase()} ${endpoint.path}`, async (t) => {
      const handlers = findEndpoint(endpoint.method, endpoint.path);

      await t.test('rejects a request without authentication', async () => {
        const result = await runMiddleware(authMiddleware, { headers: {} });
        assert.equal(result.statusCode, 401);
        assert.equal(result.nextCalled, false);
      });

      await t.test('allows effective READ + EXPORT', async () => {
        const permissions = ['PROGRAMACION.LEER', 'PROGRAMACION.EXPORTAR'];
        await withEffectivePermissions(permissions, async (userId) => {
          const result = await runEndpointAuthorization(handlers, userId, permissions);
          assert.equal(result.statusCode, 200);
          assert.equal(result.nextCalled, true);
        });
      });

      await t.test('rejects READ without EXPORT', async () => {
        await withEffectivePermissions(['PROGRAMACION.LEER'], async (userId) => {
          const result = await runEndpointAuthorization(handlers, userId, ['PROGRAMACION.LEER']);
          assert.equal(result.statusCode, 403);
          assert.equal(result.nextCalled, false);
          assert.equal(result.body.permisoRequerido, 'PROGRAMACION.EXPORTAR');
        });
      });

      await t.test('rejects EXPORT without READ', async () => {
        await withEffectivePermissions(['PROGRAMACION.EXPORTAR'], async (userId) => {
          const result = await runEndpointAuthorization(handlers, userId, ['PROGRAMACION.EXPORTAR']);
          assert.equal(result.statusCode, 403);
          assert.equal(result.nextCalled, false);
          assert.equal(result.body.permisoRequerido, 'PROGRAMACION.LEER');
        });
      });

      await t.test('allows update permissions without granting export', async () => {
        const permissions = ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'];
        await withEffectivePermissions(permissions, async (userId) => {
          const result = await runEndpointAuthorization(handlers, userId, permissions);
          assert.equal(result.statusCode, 403);
          assert.equal(result.nextCalled, false);
          assert.equal(result.body.permisoRequerido, 'PROGRAMACION.EXPORTAR');
        });
      });

      await t.test('an effective individual DENY blocks inherited EXPORT', async () => {
        const inheritedPermissions = ['PROGRAMACION.LEER', 'PROGRAMACION.EXPORTAR'];
        const explicitDenies = new Set(['PROGRAMACION.EXPORTAR']);
        const effectivePermissions = inheritedPermissions.filter((permission) => !explicitDenies.has(permission));

        await withEffectivePermissions(effectivePermissions, async (userId) => {
          const result = await runEndpointAuthorization(handlers, userId, effectivePermissions);
          assert.equal(result.statusCode, 403);
          assert.equal(result.nextCalled, false);
          assert.equal(result.body.permisoRequerido, 'PROGRAMACION.EXPORTAR');
        });
      });
    });
  }
});
