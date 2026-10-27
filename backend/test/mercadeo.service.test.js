const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { buscarReservasMercadeo, buildFilters } = require('../services/Mercadeo/mercadeo.service');
const controller = require('../controllers/Mercadeo/mercadeo.controller');
const mercadeoEntidades = require('../services/EntidadesReportantes/entidades-mercadeo.service');

test('Mercadeo construye filtros parametrizados, incluida la combinación completa', () => {
  const fields = [
    ['fechaRegistroDesde', '2026-08-01', 'r.Fecha_Registro >= ?', '2026-08-01 00:00:00'],
    ['fechaRegistroHasta', '2026-08-31', 'r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)', '2026-08-31'],
    ['fechaTour', '2026-09-04', 'r.Fecha_Tour = ?', '2026-09-04'],
    ['codigoReserva', 'BOOK-17', 'r.Id_Reserva = ?', 'BOOK-17'],
    ['categoria', '4', 'r.Id_Canal = ?', 4],
    ['idEntidadReportante', '7', 'r.Id_Entidad_Reportante = ?', 7],
    ['creadorIds', ['101', '202'], 'r.Creado_Por IN (?,?)', 101],
  ];

  for (const [key, value, expectedSql, expectedParam] of fields) {
    const query = key === 'fechaRegistroDesde'
      ? { fechaRegistroDesde: value, fechaRegistroHasta: '2026-08-31' }
      : key === 'fechaRegistroHasta'
        ? { fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: value }
        : { [key]: value };
    const built = buildFilters(query);
    assert.ok(built.where.includes(expectedSql), key);
    assert.ok(built.values.some(value => value === expectedParam), key);
  }

  const malicious = "X' OR 1=1 --";
  const combined = buildFilters({
    fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: '2026-08-31',
    fechaTour: '2026-09-04', codigoReserva: malicious, categoria: '4',
  });
  assert.equal(combined.values.length, 5);
  assert.ok(!combined.where.includes(malicious));
  assert.equal(buildFilters({}).where, '');
  assert.throws(() => buildFilters({ fechaRegistroDesde: '2026-08-01' }), e => e.errorCode === 'DATE_RANGE_INVALID');
  assert.throws(() => buildFilters({ fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: '2026-09-01' }),
    e => e.errorCode === 'DATE_RANGE_TOO_LONG');
  assert.throws(() => buildFilters({ idEntidadReportante: '0' }),
    e => e.errorCode === 'ENTITY_ID_INVALID');
});

test('Mercadeo devuelve conteos de reservas/pasajeros y agrupa varios pasajeros sin duplicar reservas', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 1, totalPasajeros: 3 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [[{
      Id_Reserva: 'MK-3PAX', Fecha_Registro: '2026-08-10 09:30:00', Fecha_Tour: '2026-09-04',
      NombreReporta: 'Juan Pérez', Telefono: '3001234567', Id_Canal: 2,
      Id_Entidad_Reportante: 7, Nombre_Entidad_Reportante: 'Hotel Dann',
      Tipo_Entidad_Reportante: 'HOTEL', Categoria: 'AGENCIA NACIONAL',
      Cantidad_Pasajeros: 3,
      CreadorId: null, UsuarioCreador: null,
    }]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const page = await buscarReservasMercadeo({ codigoReserva: 'MK-3PAX' });
  assert.equal(page.totalReservas, 1);
  assert.equal(page.totalPasajeros, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].Cantidad_Pasajeros, 3);
  assert.equal(page.items[0].UsuarioCreador, null);
  assert.equal(page.items[0].Id_Entidad_Reportante, 7);
  assert.equal(page.items[0].Nombre_Entidad_Reportante, 'Hotel Dann');
  assert.equal(page.items[0].Tipo_Entidad_Reportante, 'HOTEL');
  assert.equal(page.items[0].NombreReporta, 'Juan Pérez');
  assert.equal(page.pageSize, 25);
  assert.equal(calls.length, 2, 'summary y página; la cantidad de pasajeros viene en la consulta de reservas');
  assert.ok(calls[1].sql.includes('LIMIT ? OFFSET ?'));
  assert.match(calls[1].sql, /LEFT JOIN entidades_reportantes er ON er\.Id_Entidad_Reportante = r\.Id_Entidad_Reportante/);
  assert.match(calls[1].sql, /er\.Nombre AS Nombre_Entidad_Reportante/);
  assert.match(calls[1].sql, /er\.Tipo AS Tipo_Entidad_Reportante/);
  assert.deepEqual(calls[1].values.slice(-2), [25, 0]);
  assert.match(calls[1].sql, /SELECT COUNT\(\*\) FROM pasajeros p_count WHERE p_count\.Id_Reserva = r\.Id_Reserva/);
});

test('Mercadeo filtra por entidad mediante la FK de la reserva', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 1, totalPasajeros: 1 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [[{
      Id_Reserva: 'MK-ENTITY', Id_Entidad_Reportante: 7,
      Nombre_Entidad_Reportante: 'Hotel Dann', Tipo_Entidad_Reportante: 'HOTEL',
      NombreReporta: 'Juan Pérez', Telefono: '3001234567',
    }]];
    if (sql.includes('SELECT Id_Reserva, Id_Pasajero')) return [[{
      Id_Reserva: 'MK-ENTITY', Id_Pasajero: 1, Nombre_Pasajero: 'Ana', DNI: 'CC-1',
    }]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const page = await buscarReservasMercadeo({
    idEntidadReportante: '7',
  });
  assert.equal(page.items[0].NombreReporta, 'Juan Pérez');
  assert.equal(page.items[0].Nombre_Entidad_Reportante, 'Hotel Dann');
  assert.match(calls[0].sql, /r\.Id_Entidad_Reportante = \?/);
  assert.match(calls[1].sql, /er\.Id_Entidad_Reportante = r\.Id_Entidad_Reportante/);
  assert.ok(calls[0].values.includes(7));
});

test('Mercadeo Entidades limita el universo a hoteles/agencias y calcula actividad por FK', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT COUNT(*) AS Total_Entidades')) return [[{
      Total_Entidades: 1, Con_Reservas: 1, Sin_Reservas: 0, Pendientes: 0,
      Total_Reservas: 2, Total_Pasajeros: 3,
    }]];
    if (sql.includes('SELECT e.Id_Entidad_Reportante')) return [[{
      Id_Entidad_Reportante: 7, Tipo: 'HOTEL', Nombre: 'Hotel Dann', Activo: 0,
      Estado_Validacion: 'RECHAZADA', Reservas: 2, Pasajeros: 3,
      Primera_Actividad: '2026-08-01', Ultima_Actividad: '2026-08-10',
    }]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const page = await mercadeoEntidades.listActivity({});
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].Id_Entidad_Reportante, 7);
  assert.equal(page.items[0].Reservas, 2);
  assert.equal(page.items[0].Activo, 0);
  assert.equal(page.items[0].Estado_Validacion, 'RECHAZADA');
  for (const call of calls) {
    assert.match(call.sql, /e\.Tipo IN \(\?, \?, \?\)/);
    assert.match(call.sql, /r\.Id_Entidad_Reportante/);
    assert.match(call.sql, /GROUP BY r\.Id_Entidad_Reportante/);
    assert.ok(call.values.includes('HOTEL'));
    assert.ok(call.values.includes('AGENCIA_NACIONAL'));
    assert.ok(call.values.includes('AGENCIA_INTERNACIONAL'));
    assert.match(call.sql, /WHERE e\.Tipo IN \(\?, \?, \?\)\s*(?:ORDER BY|$)/i);
  }
});

test('el detalle de entidad relaciona histórico, contactos y actividad solo por Id_Entidad_Reportante', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT e.*')) return [[{ Id_Entidad_Reportante: 7, Tipo: 'HOTEL', Nombre: 'Hotel Dann' }]];
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{
      Reservas: 2, Pasajeros: 3, Primera_Actividad: '2026-08-01', Ultima_Actividad: '2026-08-10',
    }]];
    if (sql.includes('SELECT r.Nombre_Reportante AS Nombre')) return [[
      { Nombre: 'Juan Pérez', Telefono: '3001', Reservas: 1 },
      { Nombre: 'María Gómez', Telefono: '3002', Reservas: 1 },
    ]];
    if (sql.includes('SELECT p.Id_Punto')) return [[]];
    if (sql.includes('SELECT ep.Id_Punto')) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = originalQuery; });

  const detail = await mercadeoEntidades.detail(7);
  assert.equal(detail.entity.Id_Entidad_Reportante, 7);
  assert.equal(detail.contacts.length, 2);
  for (const call of calls.slice(1, 5)) {
    assert.match(call.sql, /r\.Id_Entidad_Reportante=\?/);
    assert.ok(call.values.includes(7));
    assert.doesNotMatch(call.sql, /Nombre_Reportante\s*=/);
  }
  assert.match(calls[5].sql, /ep\.Id_Entidad_Reportante=\?/);
  assert.ok(calls[5].values.includes(7));
});

test('Mercadeo pagina por reserva, usa pageSize 25 y ejecuta un lote de pasajeros', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  const reservations = Array.from({ length: 25 }, (_, index) => ({
    Id_Reserva: `MK-P2-${index}`, Cantidad_Pasajeros: index === 0 ? 1 : 0,
    CreadorId: null, UsuarioCreador: null,
  }));
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ totalReservas: 40, totalPasajeros: 41 }]];
    if (sql.includes('SELECT r.Id_Reserva')) return [reservations];
    throw new Error('Consulta inesperada');
  };
  t.after(() => { db.query = originalQuery; });

  const page = await buscarReservasMercadeo({ page: '2' });
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 25);
  assert.equal(page.totalPages, 2);
  assert.equal(page.items.length, 25);
  assert.deepEqual(calls[1].values.slice(-2), [25, 25]);
  assert.equal(calls.length, 2, 'solo ejecuta el conteo y la consulta paginada de reservas');
  assert.equal(page.items[0].Cantidad_Pasajeros, 1);
  assert.equal(page.items[1].Cantidad_Pasajeros, 0);
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
