const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const service = require('../services/Comisiones/comisiones-grupos.service');

const PDF = Buffer.from('%PDF-1.7 comprobante');

function createConnectionMock({ entity, reservations = [], journeys = [], groups = [], profile = null, members = [] } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ kind: 'begin' }); },
    async commit() { calls.push({ kind: 'commit' }); },
    async rollback() { calls.push({ kind: 'rollback' }); },
    release() { calls.push({ kind: 'release' }); },
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ kind: 'query', sql: statement, params });
      if (statement.includes('FROM entidades_reportantes WHERE Id_Entidad_Reportante = ? FOR UPDATE')) return [[entity].filter(Boolean)];
      if (statement.includes('FROM comisiones_grupos_pago') && statement.includes('ORDER BY Numero_Lote FOR UPDATE')) return [groups];
      if (statement.startsWith('SELECT R.Id_Reserva FROM reservas R')) return [reservations.map((row) => ({ Id_Reserva: row.Id_Reserva }))];
      if (statement.includes('COUNT(DISTINCT P.Id_Pasajero) AS Cantidad_Pasajeros') && statement.includes('GROUP BY R.Id_Reserva')) return [reservations];
      if (statement.includes('MAX(CJ.Total_Pasajeros) AS Total_Pasajeros_Confirmados')) return [journeys];
      if (statement.includes('FROM perfiles_comision_entidad')) return [[profile].filter(Boolean)];
      if (statement.startsWith('INSERT INTO comisiones_grupos_pago (')) return [{ insertId: 701 }];
      if (statement.startsWith('INSERT INTO comisiones_grupos_pago_reservas')) return [{ affectedRows: params?.[0]?.length || 1 }];
      if (statement.startsWith('INSERT INTO liquidaciones')) return [{ affectedRows: params?.[0]?.length || 1 }];
      if (statement.includes('FROM comisiones_grupos_pago WHERE Id_Grupo_Comision = ? FOR UPDATE')) return [[{
        Id_Grupo_Comision: 701, Estado: 'PAGADO', Id_Entidad_Reportante: 20,
        Monto_Pagado: 15000, Cantidad_Reservas_Pagadas: 1, Fecha_Pago: '2026-10-25',
      }]];
      if (statement.includes('FROM comisiones_grupos_pago_reservas WHERE Id_Grupo_Comision = ? FOR UPDATE')) return [members];
      if (statement.startsWith('UPDATE comisiones_grupos_pago') && statement.includes("Estado = 'ANULADO'")) return [{ affectedRows: 1 }];
      if (statement.startsWith('UPDATE liquidaciones') && statement.includes('Id_Grupo_Comision = NULL')) return [{ affectedRows: members.length }];
      if (statement.includes('FROM usuarios u')) return [[{
        Id_Usuario: 42, Actor_Nombre: 'Ana Operaciones', Actor_Rol: 'Administrador',
      }]];
      if (statement.startsWith('INSERT INTO historial')) return [{ insertId: 901 }];
      if (statement.startsWith('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
      throw new Error(`Consulta inesperada: ${statement}`);
    },
  };
  return { connection, calls };
}

function installConnection(t, mocked) {
  const original = db.getConnection;
  db.getConnection = async () => mocked.connection;
  t.after(() => { db.getConnection = original; });
}

test('normaliza filtros de grupos y valida el orden del período', () => {
  const filters = service.parsearFiltros({
    desde: '2026-10-01', hasta: '2026-10-31', tipo: 'agencia nacional', estado: 'pagada', limit: 200,
  });
  assert.equal(filters.tipo, 'AGENCIA_NACIONAL');
  assert.equal(filters.estado, 'PAGADO');
  assert.equal(filters.limit, 100);
  assert.throws(() => service.parsearFiltros({ desde: '2026-11-01', hasta: '2026-10-01' }),
    (error) => error.errorCode === 'INVALID_DATE_RANGE');
});

test('la referencia entidad-día es estable y separa reservas sin entidad del agrupamiento', () => {
  const key = service.groupReference(42, '2026-10-05');
  assert.equal(key, 'e42~2026-10-05');
  assert.deepEqual(service.parseGroupReference(key), { Id_Entidad_Reportante: 42, Fecha_Tour: '2026-10-05' });
  const { listSql: groupSql } = service.buildGroupListQueries(service.parsearFiltros({}));
  const { listSql: unlinkedSql } = service.buildUnlinkedQueries(service.parsearFiltros({}));
  assert.match(groupSql, /Id_Entidad_Reportante, Fecha_Tour/);
  assert.match(unlinkedSql, /R\.Id_Entidad_Reportante IS NULL/);
  assert.match(unlinkedSql, /GROUP BY R\.Id_Reserva, R\.Fecha_Tour/);
});

test('grupos incluyen entidades inactivas e impiden incluir entidades rechazadas', () => {
  const { countSql, listSql } = service.buildGroupListQueries(service.parsearFiltros({}));
  assert.match(countSql, /E\.Estado_Validacion <> 'RECHAZADA'/);
  assert.doesNotMatch(countSql, /E\.Activo = 1/);
  assert.match(listSql, /Tiene_Ajuste_Pendiente/);
});

test('el comprobante valida MIME declarado, firma real y límite de 5 MB', () => {
  assert.equal(service.comprobanteDesdeRequest({ buffer: PDF, mimetype: 'application/pdf', originalname: 'pago.pdf' }).mime,
    'application/pdf');
  assert.throws(() => service.comprobanteDesdeRequest({ buffer: PDF, mimetype: 'image/png', originalname: 'pago.png' }),
    (error) => error.errorCode === 'INVALID_DOCUMENT_CONTENT');
  assert.throws(() => service.comprobanteDesdeRequest({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'application/pdf' }),
    (error) => error.errorCode === 'DOCUMENT_TOO_LARGE');
});

test('no marca pagado una entidad pendiente de validación', async (t) => {
  const mocked = createConnectionMock({ entity: {
    Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1,
    Estado_Validacion: 'PENDIENTE_VALIDACION',
  } });
  installConnection(t, mocked);
  await assert.rejects(service.marcarGrupoPagado('e42~2026-10-05', {
    Monto_Pendiente_Esperado: 15000, Cantidad_Reservas_Pendientes_Esperada: 1,
  }, 42),
    (error) => error.errorCode === 'ENTITY_VALIDATION_REQUIRED');
  assert.equal(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO comisiones_grupos_pago')), false);
  assert.ok(mocked.calls.some((call) => call.kind === 'rollback'));
});

test('no marca pagado si Control de viaje no está cerrado', async (t) => {
  const mocked = createConnectionMock({
    entity: { Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1, Estado_Validacion: 'VALIDADA' },
    reservations: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-05', Id_Tour: 2, Nombre_Tour: 'Guatapé', Cantidad_Pasajeros: 1, Monto_Comision: 15000 }],
    journeys: [{ Id_Tour: 2, Fecha_Tour: '2026-10-05', Nombre_Tour: 'Guatapé', Confirmada_En: null,
      Total_Pasajeros_Confirmados: 0, Total_Pasajeros_Actuales: 1 }],
  });
  installConnection(t, mocked);
  await assert.rejects(service.marcarGrupoPagado('e42~2026-10-05', {
    Monto_Pendiente_Esperado: 15000, Cantidad_Reservas_Pendientes_Esperada: 1,
  }, 42),
    (error) => error.errorCode === 'TRIP_CONTROL_NOT_CLOSED');
  assert.equal(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO comisiones_grupos_pago')), false);
});

test('marca pagado un lote con snapshots y detalle inmutable por reserva', async (t) => {
  const mocked = createConnectionMock({
    entity: { Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1, Estado_Validacion: 'VALIDADA' },
    reservations: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-05', Id_Tour: 2, Nombre_Tour: 'Guatapé', Cantidad_Pasajeros: 1, Monto_Comision: 15000 }],
    journeys: [{ Id_Tour: 2, Fecha_Tour: '2026-10-05', Nombre_Tour: 'Guatapé', Confirmada_En: '2026-10-05 12:00:00',
      Total_Pasajeros_Confirmados: 1, Total_Pasajeros_Actuales: 1 }],
    profile: { Forma_Pago: 'NEQUI', Numero_Cuenta: '3001234567', Nombre_Receptor: 'Hotel Sur SAS', DNI_Receptor: '900123456' },
  });
  installConnection(t, mocked);
  const result = await service.marcarGrupoPagado('e42~2026-10-05', {
    Monto_Pendiente_Esperado: 15000, Cantidad_Reservas_Pendientes_Esperada: 1,
  }, 42);
  assert.equal(result.Id_Grupo_Comision, '701');
  assert.equal(result.Monto_Pagado, 15000);
  const childInsert = mocked.calls.find((call) => call.sql?.startsWith('INSERT INTO comisiones_grupos_pago_reservas'));
  assert.deepEqual(childInsert.params[0], [['701', 'R-1', 15000]]);
  const liquidationInsert = mocked.calls.find((call) => call.sql?.startsWith('INSERT INTO liquidaciones'));
  assert.match(liquidationInsert.sql, /Id_Grupo_Comision/);
  assert.equal(liquidationInsert.params[0][0][1], '701');
  assert.ok(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO historial')));
  assert.ok(mocked.calls.some((call) => call.kind === 'commit'));
});

test('responde 409 con el total y cantidad actuales si el grupo cambió desde la confirmación', async (t) => {
  const mocked = createConnectionMock({
    entity: { Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1, Estado_Validacion: 'VALIDADA' },
    reservations: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-05', Id_Tour: 2, Nombre_Tour: 'Guatapé', Cantidad_Pasajeros: 1, Monto_Comision: 15000 }],
    journeys: [],
  });
  installConnection(t, mocked);
  await assert.rejects(
    service.marcarGrupoPagado('e42~2026-10-05', {
      Monto_Pendiente_Esperado: 14000, Cantidad_Reservas_Pendientes_Esperada: 1,
    }, 42),
    (error) => error.status === 409
      && error.errorCode === 'GROUP_TOTAL_CHANGED'
      && error.details.Monto_Pendiente_Actual === 15000
      && error.details.Cantidad_Reservas_Pendientes_Actual === 1,
  );
  assert.equal(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO comisiones_grupos_pago (')), false);
  assert.ok(mocked.calls.some((call) => call.kind === 'rollback'));
});

test('responde 409 si cambió la cantidad aunque el total siga igual', async (t) => {
  const mocked = createConnectionMock({
    entity: { Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1, Estado_Validacion: 'VALIDADA' },
    reservations: [{ Id_Reserva: 'R-1', Fecha_Tour: '2026-10-05', Id_Tour: 2, Nombre_Tour: 'Guatapé', Cantidad_Pasajeros: 1, Monto_Comision: 15000 }],
    journeys: [],
  });
  installConnection(t, mocked);
  await assert.rejects(
    service.marcarGrupoPagado('e42~2026-10-05', {
      Monto_Pendiente_Esperado: 15000, Cantidad_Reservas_Pendientes_Esperada: 2,
    }, 42),
    (error) => error.status === 409
      && error.errorCode === 'GROUP_TOTAL_CHANGED'
      && error.details.Monto_Pendiente_Actual === 15000
      && error.details.Cantidad_Reservas_Pendientes_Actual === 1,
  );
  assert.equal(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO comisiones_grupos_pago (')), false);
});

test('el drawer obtiene una página de pendientes y no carga miembros de todos los lotes', async (t) => {
  const calls = [];
  const connection = {
    async release() {},
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: statement, params });
      if (statement.includes('FROM entidades_reportantes WHERE Id_Entidad_Reportante = ?')) return [[{
        Id_Entidad_Reportante: 42, Tipo: 'HOTEL', Nombre: 'Hotel Sur', Activo: 1, Estado_Validacion: 'VALIDADA',
      }]];
      if (statement.includes('ORDER BY R.Id_Reserva LIMIT ? OFFSET ?')) return [[{
        Id_Reserva: 'R-3', Fecha_Tour: '2026-10-05', Id_Tour: 2, Nombre_Tour: 'Guatapé',
        Cantidad_Pasajeros: 1, Monto_Comision: 15000,
      }]];
      if (statement.includes('FROM comisiones_grupos_pago') && statement.includes('ORDER BY Numero_Lote DESC')) return [[]];
      if (statement.includes('SELECT COUNT(*) AS Total FROM (') && statement.includes('AS E')) return [[{ Total: 3 }]];
      throw new Error(`Consulta inesperada: ${statement}`);
    },
  };
  const original = db.getConnection;
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = original; });
  const detail = await service.obtenerDetalleGrupo('e42~2026-10-05', { page: 2, limit: 2 });
  assert.equal(detail.reservasPendientes.length, 1);
  assert.deepEqual(detail.paginacionReservasPendientes, { pagina: 2, limite: 2, total: 3, paginas: 2 });
  assert.equal(calls.some((call) => call.sql.includes('FROM comisiones_grupos_pago_reservas')), false);
  assert.ok(calls.some((call) => call.sql.includes('LIMIT ? OFFSET ?') && call.params.slice(-2).join(',') === '2,2'));
});

test('anula el lote y libera liquidaciones conservando monto y pago en el lote histórico', async (t) => {
  const mocked = createConnectionMock({ members: [{ Id_Reserva: 'R-1' }] });
  installConnection(t, mocked);
  const result = await service.anularPago('701', { Motivo: 'Pago duplicado' }, 42);
  assert.equal(result.Estado, 'ANULADO');
  assert.equal(result.Reservas_Liberadas, 1);
  const detach = mocked.calls.find((call) => call.sql?.startsWith('UPDATE liquidaciones'));
  assert.match(detach.sql, /Id_Grupo_Comision = NULL/);
  assert.match(detach.sql, /Estado = 'PENDIENTE'/);
  const groupUpdate = mocked.calls.find((call) => call.sql?.startsWith('UPDATE comisiones_grupos_pago'));
  assert.doesNotMatch(groupUpdate.sql, /Monto_Pagado\s*=|Fecha_Pago\s*=|Comprobante_Ruta\s*=/);
  assert.ok(mocked.calls.some((call) => call.sql?.startsWith('INSERT INTO historial')));
});
