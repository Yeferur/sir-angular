const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissionCache, checkPermission, checkAnyPermission, requireAdmin } = require('../middlewares/permissionsMiddleware');
const service = require('../services/Permisos/permisos.service');
const { assertLocalTestDatabase, assertRevisionSchema } = require('../scripts/permissions-cache-safety');

test('cache hit, TTL exacto y limpieza conservan la caché solo cinco minutos', async (t) => {
  let now = 1000;
  let reads = 0;
  let revisionReads = 0;
  t.mock.method(Date, 'now', () => now);
  const cache = createPermissionCache({
    async obtenerRevisionPermisosUsuario() { revisionReads++; return { idRol: '1', usuario: '0', rol: '0' }; },
    async obtenerPermisosPorUsuario() { reads++; return [{ Codigo_Permiso: 'A.LEER' }]; },
  });
  await cache.obtenerPermisosUsuario(1);
  now += 299999;
  assert.deepEqual(await cache.obtenerPermisosUsuario('1'), ['A.LEER']);
  assert.equal(reads, 1);
  assert.equal(revisionReads, 3); // dos al cargar, una en cache hit.
  now++;
  await cache.obtenerPermisosUsuario(1);
  assert.equal(reads, 2);
  now += 300000;
  cache.limpiarCacheExpirado();
  await cache.obtenerPermisosUsuario(1);
  assert.equal(reads, 3);
  cache.invalidarCacheUsuario('1');
  await cache.obtenerPermisosUsuario(1);
  assert.equal(reads, 4);
});

test('un commit durante el recálculo descarta la lectura anterior y vuelve a consultar', async () => {
  let revision = 0;
  let reads = 0;
  const cache = createPermissionCache({
    async obtenerRevisionPermisosUsuario() { return { idRol: '1', usuario: '0', rol: String(revision) }; },
    async obtenerPermisosPorUsuario() {
      reads++;
      if (reads === 1) { revision++; return [{ Codigo_Permiso: 'A.LEER' }]; }
      return [];
    },
  });
  assert.deepEqual(await cache.obtenerPermisosUsuario(1), []);
  assert.equal(reads, 2);
  assert.deepEqual(await cache.obtenerPermisosUsuario(1), []);
  assert.equal(reads, 2);
});

test('cambios concurrentes repetidos fallan cerrado con 503 y no guardan ALLOW', async () => {
  let revision = 0;
  let unstable = true;
  const cache = createPermissionCache({
    async obtenerRevisionPermisosUsuario() { return { idRol: '1', usuario: '0', rol: String(revision) }; },
    async obtenerPermisosPorUsuario() {
      if (unstable) { revision++; return [{ Codigo_Permiso: 'A.LEER' }]; }
      return [];
    },
  });
  await assert.rejects(cache.obtenerPermisosUsuario(1), { status: 503 });
  unstable = false;
  assert.deepEqual(await cache.obtenerPermisosUsuario(1), []);
});

test('un error al recalcular no recupera el ALLOW de la entrada vieja', async () => {
  let revision = 0;
  const cache = createPermissionCache({
    async obtenerRevisionPermisosUsuario() { return { idRol: '1', usuario: '0', rol: String(revision) }; },
    async obtenerPermisosPorUsuario() {
      if (revision) throw new Error('Error leyendo permisos');
      return [{ Codigo_Permiso: 'A.LEER' }];
    },
  });
  await cache.obtenerPermisosUsuario(1);
  revision++;
  await assert.rejects(cache.obtenerPermisosUsuario(1), /Error leyendo permisos/);
});

test('solicitudes simultáneas posteriores a una revocación no reciben permisos viejos', async () => {
  let revision = 0;
  const cache = createPermissionCache({
    async obtenerRevisionPermisosUsuario() { return { idRol: '1', usuario: '0', rol: String(revision) }; },
    async obtenerPermisosPorUsuario() { return revision ? [] : [{ Codigo_Permiso: 'A.LEER' }]; },
  });
  await cache.obtenerPermisosUsuario(1);
  revision++;
  const results = await Promise.all(Array.from({ length: 12 }, () => cache.obtenerPermisosUsuario(1)));
  results.forEach((result) => assert.deepEqual(result, []));
});

test('los tres guards fallan cerrado; Cliente conserva su plantilla autenticada', async (t) => {
  t.mock.method(service, 'obtenerRevisionPermisosUsuario', async () => { throw new Error('MySQL indisponible'); });
  t.mock.method(console, 'error', () => {});
  for (const guard of [checkPermission('USUARIOS.LEER'), checkAnyPermission(['USUARIOS.LEER']), requireAdmin()]) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json() { return this; } };
    let authorized = false;
    await guard({ user: { id: 1 } }, res, () => { authorized = true; });
    assert.equal(authorized, false);
    assert.equal(res.code, 500);
  }
  let authorized = false;
  await checkPermission('RESERVAS.LEER')(
    { user: { id: 1, isClient: true }, userPermissions: ['RESERVAS.LEER'] },
    { status() { return this; }, json() { return this; } },
    () => { authorized = true; }
  );
  assert.equal(authorized, true); // authMiddleware comprueba MySQL antes del guard.
});

test('la migración rechaza producción, destino remoto y tabla parcial sin mutar datos', async () => {
  assert.doesNotThrow(() => assertLocalTestDatabase({ DB_HOST: '127.0.0.1' }, 'sir_test_local'));
  for (const [env, database] of [
    [{ DB_HOST: '127.0.0.1', NODE_ENV: 'production' }, 'sir_test'],
    [{ DB_HOST: 'servidor-remoto' }, 'sir_test'],
    [{ DB_HOST: '127.0.0.1' }, 'sir_operativa'],
    [{ DB_HOST: '127.0.0.1' }, 'sir_prod_test'],
  ]) assert.throws(() => assertLocalTestDatabase(env, database), /base local/);
  const responses = [[{ ENGINE: 'InnoDB' }], [{ COLUMN_NAME: 'Tipo' }], []];
  await assert.rejects(assertRevisionSchema({ async query(sql) {
    assert.match(sql, /^SELECT/);
    return [responses.shift()];
  } }), /incompatible\/parcial/);
});
