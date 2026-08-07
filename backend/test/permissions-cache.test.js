const test = require('node:test');
const assert = require('node:assert/strict');

const permissionsService = require('../services/Permisos/permisos.service');
const {
  checkPermission,
  obtenerPermisosUsuario,
  invalidarCacheUsuario,
} = require('../middlewares/permissionsMiddleware');

test('refresca un permiso recién concedido antes de responder 403', async (t) => {
  const original = permissionsService.obtenerPermisosPorUsuario;
  const userId = 987654321;
  t.after(() => {
    permissionsService.obtenerPermisosPorUsuario = original;
    invalidarCacheUsuario(userId);
  });

  permissionsService.obtenerPermisosPorUsuario = async () => [];
  await obtenerPermisosUsuario(userId, { forceRefresh: true });

  let databaseReads = 0;
  permissionsService.obtenerPermisosPorUsuario = async () => {
    databaseReads += 1;
    return [{ Codigo_Permiso: 'TURNOS.LEER' }];
  };

  let nextCalled = false;
  const response = {
    status() { return this; },
    json() { return this; },
  };
  await checkPermission('TURNOS.LEER')(
    { user: { id: userId, isClient: false } },
    response,
    () => { nextCalled = true; }
  );

  assert.equal(nextCalled, true);
  assert.equal(databaseReads, 1);
});
