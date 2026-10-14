const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { buscarReservasMercadeo, buildFilters } = require('../services/Mercadeo/mercadeo.service');
const controller = require('../controllers/Mercadeo/mercadeo.controller');

test('Mercadeo construye filtros parametrizados, incluida la combinación completa', () => {
  const fields = [
    ['fechaRegistroDesde', '2026-08-01', 'r.Fecha_Registro >= ?', '2026-08-01 00:00:00'],
    ['fechaRegistroHasta', '2026-08-31', 'r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)', '2026-08-31'],
    ['fechaTour', '2026-09-04', 'r.Fecha_Tour = ?', '2026-09-04'],
    ['codigoReserva', 'BOOK-17', 'r.Id_Reserva = ?', 'BOOK-17'],
    ['categoria', '4', 'r.Id_Canal = ?', 4],
    ['nombrePasajero', 'Ana Pérez', 'p.Nombre_Pasajero LIKE ?', 'Ana Pérez%'],
    ['documento', 'CC-992', 'p.DNI = ?', 'CC-992'],
  ];

  for (const [key, value, expectedSql, expectedParam] of fields) {
    const query = key === 'fechaRegistroDesde'
      ? { fechaRegistroDesde: value, fechaRegistroHasta: '2026-08-31' }
      : key === 'fechaRegistroHasta'
        ? { fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: value }
        : { [key]: value };
    const built = buildFilters(query);
    assert.ok(built.where.includes(expectedSql), key);
    assert.ok([...built.values, ...built.passengerValues].includes(expectedParam), key);
  }

  const malicious = "X' OR 1=1 --";
  const combined = buildFilters({
    fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: '2026-08-31',
    fechaTour: '2026-09-04', codigoReserva: malicious, categoria: '4',
    nombrePasajero: 'Ana', documento: 'CC-992',
  });
  assert.equal(combined.values.length, 5);
  assert.deepEqual(combined.passengerValues, ['Ana%','CC-992']);
  assert.ok(!combined.where.includes(malicious));
  assert.ok(combined.where.includes('EXISTS (SELECT 1 FROM pasajeros'));
  assert.equal(buildFilters({}).where, '');
  assert.throws(() => buildFilters({ fechaRegistroDesde: '2026-08-01' }), e => e.errorCode === 'DATE_RANGE_INVALID');
  assert.throws(() => buildFilters({ fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: '2026-09-01' }),
    e => e.errorCode === 'DATE_RANGE_TOO_LONG');
});

test('Mercadeo devuelve conteos de reservas/pasajeros y agrupa varios pasajeros sin duplicar reservas', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 1, totalPasajeros: 3 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [[{
      Id_Reserva: 'MK-3PAX', Fecha_Registro: '2026-08-10 09:30:00', Fecha_Tour: '2026-09-04',
      NombreReporta: 'Agencia Ejemplo', Telefono: '3001234567', Categoria: 'AGENCIA NACIONAL',
      CreadorId: null, UsuarioCreador: null,
    }]];
    if (sql.includes('SELECT Id_Reserva, Id_Pasajero')) return [[
      { Id_Reserva: 'MK-3PAX', Id_Pasajero: 21, Nombre_Pasajero: 'Ana', DNI: 'CC-1' },
      { Id_Reserva: 'MK-3PAX', Id_Pasajero: 22, Nombre_Pasajero: 'Luis', DNI: 'CC-2' },
      { Id_Reserva: 'MK-3PAX', Id_Pasajero: 23, Nombre_Pasajero: 'Sol', DNI: null },
    ]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const page = await buscarReservasMercadeo({ codigoReserva: 'MK-3PAX' });
  assert.equal(page.totalReservas, 1);
  assert.equal(page.totalPasajeros, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].pasajeros.length, 3);
  assert.equal(page.items[0].UsuarioCreador, null);
  assert.equal(page.pageSize, 25);
  assert.equal(calls.length, 3, 'summary + page + one batched passenger query, never one query per reservation');
  assert.ok(calls[1].sql.includes('LIMIT ? OFFSET ?'));
  assert.deepEqual(calls[1].values.slice(-2), [25, 0]);
  assert.ok(calls[2].sql.includes('Id_Reserva IN (?)'));
});

test('Mercadeo pagina por reserva, usa pageSize 25 y ejecuta un lote de pasajeros', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  const reservations = Array.from({ length: 25 }, (_, index) => ({
    Id_Reserva: `MK-P2-${index}`, CreadorId: null, UsuarioCreador: null,
  }));
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 40, totalPasajeros: 41 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [reservations];
    if (sql.includes('SELECT Id_Reserva, Id_Pasajero')) return [[{ Id_Reserva: reservations[0].Id_Reserva, Id_Pasajero: 1, Nombre_Pasajero: 'X', DNI: null }]];
    throw new Error('Consulta inesperada');
  };
  t.after(() => { db.query = originalQuery; });

  const page = await buscarReservasMercadeo({ page: '2' });
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 25);
  assert.equal(page.totalPages, 2);
  assert.equal(page.items.length, 25);
  assert.deepEqual(calls[1].values.slice(-2), [25, 25]);
  assert.equal(calls.filter((call) => call.sql.includes('SELECT Id_Reserva, Id_Pasajero')).length, 1);
  assert.equal(page.items[0].pasajeros.length, 1);
  assert.equal(page.items[1].pasajeros.length, 0);
});

test('Mercadeo maneja resultados vacíos y propaga errores de consulta', async (t) => {
  const originalQuery = db.query;
  db.query = async (sql) => {
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 0, totalPasajeros: 0 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [[]];
    throw new Error('No debe consultar pasajeros cuando no hay reservas');
  };
  t.after(() => { db.query = originalQuery; });
  const empty = await buscarReservasMercadeo({ codigoReserva: 'SIN-RESULTADO' });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalReservas, 0);
  assert.equal(empty.totalPasajeros, 0);

  db.query = async () => { throw Object.assign(new Error('db unavailable'), { code: 'ECONNREFUSED' }); };
  await assert.rejects(buscarReservasMercadeo({}), /db unavailable/);
});

test('Mercadeo devuelve un error JSON controlado ante fallos de backend', async (t) => {
  const originalQuery = db.query;
  const originalConsoleError = console.error;
  db.query = async () => { throw new Error('private database detail'); };
  console.error = () => {};
  t.after(() => { db.query = originalQuery; console.error = originalConsoleError; });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await controller.listarReservas({ query: {} }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.errorCode, 'INTERNAL_ERROR');
  assert.equal(response.body.message, 'No fue posible completar la consulta de Mercadeo.');
  assert.ok(!response.body.message.includes('private database detail'));
});
