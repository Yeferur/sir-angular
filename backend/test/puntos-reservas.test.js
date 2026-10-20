const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const service = require('../services/Puntos/puntos-reservas.service');

test('exige un período completo y acotado', () => {
  assert.throws(() => service.buildFilters(3, { desde: '', hasta: '' }), /período completo/);
  assert.throws(() => service.buildFilters(3, { desde: '2026-10-15', hasta: '2026-10-14' }), /fecha inicial/);
  assert.throws(() => service.buildFilters(3, { desde: '2025-01-01', hasta: '2026-10-14' }), /período máximo/);
});

test('consulta ambos vínculos reales con el punto y pagina sin multiplicar reservas', async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('COUNT(*) AS total')) return [[{ total: 27 }]];
    return [[{ Id_Reserva: 'RSV1', Fecha_Tour: '2026-10-14', Nombre_Tour: 'Tour',
      Pasajeros: 3, Estado: 'Activa' }]];
  };
  try {
    const result = await service.consultarReservasPunto(12, {
      desde: '2026-10-14', hasta: '2026-10-16', estado: 'Confirmada', page: 2, limit: 25,
    });
    assert.equal(result.total, 27);
    assert.equal(result.page, 2);
    assert.equal(result.data[0].Estado, 'Confirmada');
    assert.match(calls[0].sql, /h\.Id_Punto = \? OR EXISTS/);
    assert.match(calls[0].sql, /asociado\.Id_Punto = \?/);
    assert.match(calls[0].sql, /COUNT\(\*\) AS total/);
    assert.doesNotMatch(calls[0].sql, /JOIN pasajeros/);
    assert.deepEqual(calls[1].params.slice(-2), [25, 25]);
    assert.ok(calls[0].params.includes('Activa'));
  } finally {
    db.query = original;
  }
});

test('exporta todo el conjunto con la misma condición y sin LIMIT', async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return [[{ Id_Reserva: 'RSV2', Fecha_Tour: '2026-10-14', Nombre_Tour: 'Tour',
      Pasajeros: 1, Estado: 'Pendiente' }]];
  };
  try {
    const rows = await service.consultarReservasPunto(12, {
      desde: '2026-10-14', hasta: '2026-10-14', estado: 'Pendiente',
    }, { exportAll: true });
    assert.equal(rows.length, 1);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, /LIMIT \?/);
    assert.deepEqual(calls[0].params, ['2026-10-14', '2026-10-14', 12, 12,
      'Pendiente', 'Pendiente de datos', 'PendienteDatos', 'Pendiente de pago']);
  } finally {
    db.query = original;
  }
});

test('devuelve vacío sin reservas y normaliza estados reales sin catálogo paralelo', async () => {
  const original = db.query;
  db.query = async (sql) => {
    if (sql.includes('SELECT DISTINCT r.Estado')) return [[
      { Estado: 'Activa' }, { Estado: 'Confirmada' }, { Estado: 'Pendiente' },
    ]];
    if (sql.includes('COUNT(*) AS total')) return [[{ total: 0 }]];
    return [[]];
  };
  try {
    assert.deepEqual(await service.obtenerEstadosReservaPunto(),
      ['Pendiente', 'Confirmada', 'Completada', 'Cancelada']);
    const result = await service.consultarReservasPunto(12, {
      desde: '2026-10-14', hasta: '2026-10-14', page: 3,
    });
    assert.deepEqual(result, { data: [], total: 0, page: 1, limit: 25, totalPages: 1 });
  } finally {
    db.query = original;
  }
});
