const test = require('node:test');
const assert = require('node:assert/strict');

const permissionsService = require('../services/Permisos/permisos.service');
const {
  checkPermission,
  obtenerPermisosUsuario,
  invalidarCacheUsuario,
  createPermissionCache,
} = require('../middlewares/permissionsMiddleware');

test('refresca un permiso recién concedido antes de responder 403', async (t) => {
  const original = permissionsService.obtenerPermisosPorUsuario;
  const originalRevision = permissionsService.obtenerRevisionPermisosUsuario;
  const userId = 987654321;
  t.after(() => {
    permissionsService.obtenerPermisosPorUsuario = original;
    permissionsService.obtenerRevisionPermisosUsuario = originalRevision;
    invalidarCacheUsuario(userId);
  });

  permissionsService.obtenerRevisionPermisosUsuario = async () => ({ idRol: '1', usuario: '0', rol: '0' });
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

test('falla cerrado si MySQL no permite comprobar la revisión de permisos', async (t) => {
  const originalPermissions = permissionsService.obtenerPermisosPorUsuario;
  const originalRevision = permissionsService.obtenerRevisionPermisosUsuario;
  const userId = 987654322;
  t.after(() => {
    permissionsService.obtenerPermisosPorUsuario = originalPermissions;
    permissionsService.obtenerRevisionPermisosUsuario = originalRevision;
    invalidarCacheUsuario(userId);
  });

  permissionsService.obtenerRevisionPermisosUsuario = async () => ({ idRol: '9', usuario: '1', rol: '2' });
  permissionsService.obtenerPermisosPorUsuario = async () => ([
    { Codigo_Permiso: 'PROGRAMACION.EXPORTAR' },
  ]);
  await obtenerPermisosUsuario(userId, { forceRefresh: true });

  for (const failure of [
    Object.assign(new Error('MySQL no disponible'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('Falló la consulta de revisión'), { code: 'ER_QUERY_INTERRUPTED' }),
    Object.assign(new Error('No existe la tabla de migración'), { code: 'ER_NO_SUCH_TABLE' }),
  ]) {
    permissionsService.obtenerRevisionPermisosUsuario = async () => { throw failure; };
    let nextCalled = false;
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    await checkPermission('PROGRAMACION.EXPORTAR')(
      { user: { id: userId, isClient: false } },
      response,
      () => { nextCalled = true; }
    );

    assert.equal(response.statusCode, 500);
    assert.equal(nextCalled, false);
    assert.match(response.body.error, /Error al verificar permisos/);
  }
});

test('dos comprobaciones protegidas en una petición consultan dos veces la revisión, no la lista de permisos', async (t) => {
  const originalPermissions = permissionsService.obtenerPermisosPorUsuario;
  const originalRevision = permissionsService.obtenerRevisionPermisosUsuario;
  const userId = 987654323;
  let revisionReads = 0;
  let permissionReads = 0;
  t.after(() => {
    permissionsService.obtenerPermisosPorUsuario = originalPermissions;
    permissionsService.obtenerRevisionPermisosUsuario = originalRevision;
    invalidarCacheUsuario(userId);
  });

  permissionsService.obtenerRevisionPermisosUsuario = async () => {
    revisionReads += 1;
    return { idRol: '9', usuario: '1', rol: '2' };
  };
  permissionsService.obtenerPermisosPorUsuario = async () => {
    permissionReads += 1;
    return [
      { Codigo_Permiso: 'PROGRAMACION.LEER' },
      { Codigo_Permiso: 'PROGRAMACION.EXPORTAR' },
    ];
  };
  await obtenerPermisosUsuario(userId, { forceRefresh: true });
  revisionReads = 0;
  permissionReads = 0;

  const req = { user: { id: userId, isClient: false } };
  for (const code of ['PROGRAMACION.LEER', 'PROGRAMACION.EXPORTAR']) {
    let nextCalled = false;
    const response = { status() { return this; }, json() { return this; } };
    await checkPermission(code)(req, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }

  assert.equal(revisionReads, 2);
  assert.equal(permissionReads, 0);
});

test('una segunda instancia detecta la revocación publicada por la primera', async () => {
  const shared = {
    roles: new Map([[101, 7], [202, 8]]),
    roleRevisions: new Map([[7, 0], [8, 0]]),
    userRevision: new Map(),
    permissions: new Map([[101, ['PROGRAMACION.EXPORTAR']], [202, ['PROGRAMACION.EXPORTAR']]]),
    permissionReads: new Map(),
  };
  const service = {
    async obtenerRevisionPermisosUsuario(userId) {
      return {
        idRol: String(shared.roles.get(userId)),
        usuario: String(shared.userRevision.get(userId) || 0),
        rol: String(shared.roleRevisions.get(shared.roles.get(userId)) || 0),
      };
    },
    async obtenerPermisosPorUsuario(userId) {
      shared.permissionReads.set(userId, (shared.permissionReads.get(userId) || 0) + 1);
      return (shared.permissions.get(userId) || []).map((Codigo_Permiso) => ({ Codigo_Permiso }));
    },
  };
  const processA = createPermissionCache(service);
  const processB = createPermissionCache(service);

  assert.deepEqual(await processA.obtenerPermisosUsuario(101), ['PROGRAMACION.EXPORTAR']);
  assert.deepEqual(await processB.obtenerPermisosUsuario(101), ['PROGRAMACION.EXPORTAR']);
  assert.deepEqual(await processB.obtenerPermisosUsuario(202), ['PROGRAMACION.EXPORTAR']);

  shared.permissions.set(101, []);
  shared.roleRevisions.set(7, 1);

  assert.deepEqual(await processB.obtenerPermisosUsuario(101), []);
  assert.deepEqual(await processB.obtenerPermisosUsuario(202), ['PROGRAMACION.EXPORTAR']);
  assert.equal(shared.permissionReads.get(101), 3);
  assert.equal(shared.permissionReads.get(202), 1);
});

test('un cambio individual de usuario o de rol invalida solo su entrada y refresca el cambio de rol', async () => {
  const state = {
    users: new Map([
      [11, { roleId: 1, revision: 0, permissions: ['A.LEER'] }],
      [22, { roleId: 1, revision: 0, permissions: ['A.LEER'] }],
    ]),
    roleRevisions: new Map([[1, 0], [2, 0]]),
    reads: new Map(),
  };
  const service = {
    async obtenerRevisionPermisosUsuario(userId) {
      const user = state.users.get(userId);
      return {
        idRol: String(user.roleId),
        usuario: String(user.revision),
        rol: String(state.roleRevisions.get(user.roleId) || 0),
      };
    },
    async obtenerPermisosPorUsuario(userId) {
      state.reads.set(userId, (state.reads.get(userId) || 0) + 1);
      return state.users.get(userId).permissions.map((Codigo_Permiso) => ({ Codigo_Permiso }));
    },
  };
  const processCache = createPermissionCache(service);

  assert.deepEqual(await processCache.obtenerPermisosUsuario(11), ['A.LEER']);
  assert.deepEqual(await processCache.obtenerPermisosUsuario(22), ['A.LEER']);

  state.users.get(11).permissions = ['B.LEER'];
  state.users.get(11).revision += 1;
  assert.deepEqual(await processCache.obtenerPermisosUsuario(11), ['B.LEER']);
  assert.deepEqual(await processCache.obtenerPermisosUsuario(22), ['A.LEER']);

  state.users.get(11).roleId = 2;
  state.users.get(11).permissions = ['C.LEER'];
  assert.deepEqual(await processCache.obtenerPermisosUsuario(11), ['C.LEER']);
  assert.equal(state.reads.get(11), 3);
  assert.equal(state.reads.get(22), 1);
});

test('DENY sigue prevaleciendo sobre el rol y ALLOW conserva el permiso al revocarse el rol', async () => {
  const code = 'PROGRAMACION.EXPORTAR';
  const state = {
    roleRevision: 0,
    rolePermissions: new Set([code]),
    users: new Map([
      [31, { overrides: new Map() }],
      [32, { overrides: new Map([[code, 'DENY']]) }],
      [33, { overrides: new Map([[code, 'ALLOW']]) }],
    ]),
  };
  const service = {
    async obtenerRevisionPermisosUsuario(userId) {
      return { idRol: '9', usuario: '0', rol: String(state.roleRevision) };
    },
    async obtenerPermisosPorUsuario(userId) {
      const effective = new Set(state.rolePermissions);
      for (const [permission, type] of state.users.get(userId).overrides) {
        if (type === 'DENY') effective.delete(permission);
        if (type === 'ALLOW') effective.add(permission);
      }
      return [...effective].map((Codigo_Permiso) => ({ Codigo_Permiso }));
    },
  };
  const cache = createPermissionCache(service);

  assert.deepEqual(await cache.obtenerPermisosUsuario(31), [code]);
  assert.deepEqual(await cache.obtenerPermisosUsuario(32), []);
  assert.deepEqual(await cache.obtenerPermisosUsuario(33), [code]);

  state.rolePermissions.delete(code);
  state.roleRevision += 1;

  assert.deepEqual(await cache.obtenerPermisosUsuario(31), []);
  assert.deepEqual(await cache.obtenerPermisosUsuario(32), []);
  assert.deepEqual(await cache.obtenerPermisosUsuario(33), [code]);
});
