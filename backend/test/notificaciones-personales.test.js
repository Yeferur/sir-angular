const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const service = require('../services/Notificaciones/notificaciones.service');
const { authMiddleware } = require('../middlewares/authMiddleware');
const router = require('../routes/Notificaciones/notificaciones.routes');

function routeHandlers(method, path) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods?.[method]);
  assert.ok(route, `Falta la ruta ${method.toUpperCase()} ${path}`);
  return route.route.stack.map((layer) => layer.handle);
}

test('el centro personal exige sesión, pero no NOTIFICACIONES.LEER', async (t) => {
  const routes = [
    ['get', '/'],
    ['patch', '/leer-todas'],
    ['patch', '/:id/leer'],
  ];
  for (const [method, path] of routes) {
    const handlers = routeHandlers(method, path);
    assert.equal(handlers[0], authMiddleware);
    assert.equal(handlers.length, 2);
  }

  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; },
  };
  let nextCalled = false;
  await authMiddleware({ headers: {} }, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('la consulta personal y el contador solo incluyen filas del usuario autenticado', async (t) => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('COUNT(*)')) return [[{ Total: 1 }]];
    return [[{
      Id_Notificacion: 31,
      Tipo: 'PENDIENTE',
      Titulo: 'Aviso propio',
      Mensaje: 'Revisar',
      Datos: '{}',
      Leida: 0,
      Fecha_Creacion: '2026-09-21 10:00:00',
    }]];
  };
  t.after(() => { db.query = originalQuery; });

  const response = await service.listMine(41);

  assert.equal(response.notificaciones[0].idNotificacion, '31');
  assert.equal(response.noLeidas, 1);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /WHERE Id_Usuario = \?/);
    assert.equal(query.params[0], 41);
  }
});

test('marcar leída limita la actualización al propietario y no modifica avisos ajenos', async (t) => {
  const originalQuery = db.query;
  let captured;
  db.query = async (sql, params) => {
    captured = { sql, params };
    return [{ affectedRows: 0 }];
  };
  t.after(() => { db.query = originalQuery; });

  const updated = await service.markRead(52, '900');

  assert.equal(updated, false);
  assert.match(captured.sql, /WHERE Id_Notificacion = \? AND Id_Usuario = \?/);
  assert.deepEqual(captured.params, ['900', 52]);
});

test('marcar todas como leídas solo actualiza notificaciones propias', async (t) => {
  const originalQuery = db.query;
  let captured;
  db.query = async (sql, params) => { captured = { sql, params }; return [{ affectedRows: 2 }]; };
  t.after(() => { db.query = originalQuery; });

  await service.markAllRead(63);

  assert.match(captured.sql, /WHERE Id_Usuario = \? AND Leida = 0/);
  assert.deepEqual(captured.params, [63]);
});
