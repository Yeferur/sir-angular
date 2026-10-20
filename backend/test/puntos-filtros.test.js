const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { obtenerPuntos } = require('../services/Puntos/puntos.service');

const originalQuery = db.query;
test.afterEach(() => { db.query = originalQuery; });

async function queryFor(filters) {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('COUNT(*)')) return [[{ total: 0 }]];
    return [[]];
  };
  const result = await obtenerPuntos(filters);
  assert.equal(result.total, 0);
  assert.match(calls[1].sql, /LIMIT \? OFFSET \?/);
  return calls;
}

test('sin criterios mantiene consulta paginada de puntos activos', async () => {
  const calls = await queryFor({ page: 1, limit: 10 });
  assert.match(calls[0].sql, /p\.Activo = 1/);
  assert.deepEqual(calls[0].params, []);
  assert.deepEqual(calls[1].params, [10, 0]);
});

test('texto, ruta y pendientes se aplican individualmente y con AND', async () => {
  const text = await queryFor({ q: 'Centro' });
  assert.match(text[0].sql, /p\.Nombre_Punto LIKE \?/);
  assert.deepEqual(text[0].params, ['%Centro%', '%Centro%', '%Centro%']);
  const route = await queryFor({ ruta: '2' });
  assert.match(route[0].sql, /p\.ruta = \?/);
  assert.deepEqual(route[0].params, ['2']);
  const missingRoute = await queryFor({ pendientes: ['sin-ruta'] });
  assert.match(missingRoute[0].sql, /p\.ruta IS NULL[\s\S]*PENDIENTE/);
  const missingSchedule = await queryFor({ pendientes: ['sin-horario'] });
  assert.match(missingSchedule[0].sql, /NOT EXISTS[\s\S]*EXISTS[\s\S]*Hora_Salida/);
  const missingCoordinates = await queryFor({ pendientes: ['sin-coordenadas'] });
  assert.match(missingCoordinates[0].sql, /p\.Latitud IS NULL[\s\S]*p\.Longitud NOT BETWEEN/);
  const combined = await queryFor({ ruta: '2', pendientes: ['sin-horario', 'sin-coordenadas'], page: 2 });
  assert.match(combined[0].sql, /p\.ruta = \? AND \([\s\S]*Hora_Salida[\s\S]* OR [\s\S]*Latitud/);
  assert.deepEqual(combined[0].params, ['2']);
});

test('rechaza condiciones pendientes desconocidas', async () => {
  await assert.rejects(() => obtenerPuntos({ pendientes: ['inexistente'] }), /no reconocido/);
});

test('Ruta PENDIENTE usa el mismo criterio Sin ruta sin duplicarlo', async () => {
  const calls = await queryFor({ ruta: 'PENDIENTE', pendientes: ['sin-ruta'] });
  assert.doesNotMatch(calls[0].sql, /p\.ruta = \?/);
  assert.match(calls[0].sql, /p\.ruta IS NULL[\s\S]*PENDIENTE/);
  assert.deepEqual(calls[0].params, []);
});
