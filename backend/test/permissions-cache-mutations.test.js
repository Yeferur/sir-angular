const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../database/db');
const permissionsService = require('../services/Permisos/permisos.service');
const { createPermissionCache } = require('../middlewares/permissionsMiddleware');

test('una revocación de rol se comparte entre cachés y un fallo revierte permiso y revisión', async (t) => {
  const originalGetConnection = pool.getConnection;
  const originalPoolQuery = pool.query;
  const state = { hasPermission: true, roleRevision: 0, failRevisionWrite: false };

  pool.query = async (sql) => {
    assert.match(sql, /permisos_cache_revision/);
    return [[{
      Id_Rol: 5,
      Revision_Usuario: 0,
      Revision_Rol: state.roleRevision,
    }], []];
  };
  pool.getConnection = async () => {
    let transactionState;
    return {
      async beginTransaction() {
        transactionState = { hasPermission: state.hasPermission, roleRevision: state.roleRevision };
      },
      async query(sql) {
        if (sql.includes('SELECT Nombre_Rol FROM roles')) {
          return [[{ Nombre_Rol: 'Operador' }], []];
        }
        if (sql.includes('DELETE FROM rol_permisos')) {
          const affectedRows = transactionState.hasPermission ? 1 : 0;
          transactionState.hasPermission = false;
          return [{ affectedRows }, []];
        }
        if (sql.includes('INSERT INTO permisos_cache_revision')) {
          if (state.failRevisionWrite) throw new Error('fallo simulado al guardar revisión');
          transactionState.roleRevision += 1;
          return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('SELECT r.Id_Rol, r.Nombre_Rol')) {
          return [[{ Id_Rol: 5, Nombre_Rol: 'Operador' }], []];
        }
        if (sql.includes('SELECT DISTINCT')) {
          return [state.hasPermission ? [{ Codigo_Permiso: 'PROGRAMACION.EXPORTAR' }] : [], []];
        }
        throw new Error(`Consulta inesperada de la prueba: ${sql}`);
      },
      async commit() {
        state.hasPermission = transactionState.hasPermission;
        state.roleRevision = transactionState.roleRevision;
      },
      async rollback() {},
      release() {},
    };
  };
  t.after(() => {
    pool.getConnection = originalGetConnection;
    pool.query = originalPoolQuery;
  });

  const processA = createPermissionCache(permissionsService);
  const processB = createPermissionCache(permissionsService);
  assert.deepEqual(await processA.obtenerPermisosUsuario(55), ['PROGRAMACION.EXPORTAR']);
  assert.deepEqual(await processB.obtenerPermisosUsuario(55), ['PROGRAMACION.EXPORTAR']);

  state.failRevisionWrite = true;
  await assert.rejects(
    permissionsService.revocarPermisoDeRol(5, 91),
    /fallo simulado al guardar revisión/
  );
  assert.equal(state.hasPermission, true);
  assert.equal(state.roleRevision, 0);
  assert.deepEqual(await processB.obtenerPermisosUsuario(55), ['PROGRAMACION.EXPORTAR']);

  state.failRevisionWrite = false;
  await permissionsService.revocarPermisoDeRol(5, 91);
  assert.equal(state.hasPermission, false);
  assert.equal(state.roleRevision, 1);
  assert.deepEqual(await processB.obtenerPermisosUsuario(55), []);
});
