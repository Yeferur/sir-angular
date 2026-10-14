const test = require('node:test');
const assert = require('node:assert/strict');
const { sameHistoryValue, changedDetail, reconcilePassengers } = require('../services/Reservas/reserva-auditoria');
const { recordHistorial, isSecretColumn } = require('../services/Historial/logger');

test('comparación de History distingue cambios reales de valores serializados equivalentes', () => {
  assert.ok(sameHistoryValue(null, ''));
  assert.ok(sameHistoryValue('  ', undefined));
  assert.ok(sameHistoryValue('100.00', 100, { numeric: true }));
  assert.ok(sameHistoryValue('["398","397"]', ['397', '398'], { unordered: true }));
  assert.ok(sameHistoryValue('{"b":2,"a":1}', { a: 1, b: 2 }));
  assert.equal(changedDetail('Id_Punto', '397', 397, { numeric: true }), null);
  assert.deepEqual(changedDetail('Estado', 'Pendiente', 'Confirmada'),
    { columna: 'Estado', anterior: 'Pendiente', nuevo: 'Confirmada' });
  assert.equal(sameHistoryValue('00123', '123'), false, 'un documento conserva ceros iniciales');
});

test('reconciliación de pasajeros vincula identidades únicas y evita emparejamientos múltiples ambiguos', () => {
  const previous = [{ Nombre_Pasajero: 'Ana', DNI: 'A1' }, { Nombre_Pasajero: 'Beto', DNI: 'B2' }];
  const next = [{ Nombre_Pasajero: 'Ana Editada', DNI: 'A1' }, { Nombre_Pasajero: 'Beto', DNI: 'B2' },
    { Nombre_Pasajero: 'Clara', DNI: 'C3' }];
  const result = reconcilePassengers(previous, next);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.added.map(({ passenger }) => passenger.Nombre_Pasajero), ['Clara']);
  assert.equal(result.removed.length, 0);
  assert.equal(reconcilePassengers([{ Nombre_Pasajero: 'Uno', DNI: 'X' }],
    [{ Nombre_Pasajero: 'Otro', DNI: 'Y' }]).matches.length, 0);
  const ambiguous = reconcilePassengers([{ Nombre_Pasajero: 'A', DNI: '1' }, { Nombre_Pasajero: 'B', DNI: '2' }],
    [{ Nombre_Pasajero: 'C', DNI: '3' }, { Nombre_Pasajero: 'D', DNI: '4' }]);
  assert.equal(ambiguous.matches.length, 0);
  assert.equal(ambiguous.added.length, 2);
  assert.equal(ambiguous.removed.length, 2);
});

test('reconciliación prioriza IDs persistentes al editar dos pasajeros y no adivina identidades', () => {
  const before = [
    { Id_Pasajero: 11, Nombre_Pasajero: 'Ana', DNI: 'A1' },
    { Id_Pasajero: 12, Nombre_Pasajero: 'Beto', DNI: 'B2' },
  ];
  const after = [
    { Id_Pasajero: 12, Nombre_Pasajero: 'Nuevo Beto', DNI: 'B3' },
    { Id_Pasajero: 11, Nombre_Pasajero: 'Nueva Ana', DNI: 'A3' },
  ];
  const result = reconcilePassengers(before, after);
  assert.deepEqual(result.matches.map(([old, next]) => [old.passenger.Id_Pasajero, next.passenger.Id_Pasajero]),
    [[11, 11], [12, 12]]);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  const unknown = reconcilePassengers(before, [{ Id_Pasajero: 99, Nombre_Pasajero: 'Ana', DNI: 'A1' }]);
  assert.equal(unknown.matches.length, 0);
  const legacy = reconcilePassengers(before, [{ Nombre_Pasajero: 'Ana editada', DNI: 'A1' }]);
  assert.deepEqual(legacy.matches.map(([old]) => old.passenger.Id_Pasajero), [11]);
});

test('logger nunca inserta detalles de columnas que indiquen secretos', async () => {
  for (const column of ['Password', 'Contraseña', 'access_token', 'Session Secret', 'API-Key',
    'Authorization', 'cookie', 'Credenciales']) assert.equal(isSecretColumn(column), true);
  assert.equal(isSecretColumn('DNI'), false);
  const calls = [];
  const connection = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO historial')) return [{ insertId: 99 }];
    if (sql.includes('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
    throw new Error(`Consulta inesperada: ${sql}`);
  } };
  await recordHistorial({ conexion: connection, tabla: 'reservas', id_registro: 'TG12345',
    accion: 'ACTUALIZAR_RESERVA', detalles: [
      { columna: 'API_KEY', anterior: 'old-secret', nuevo: 'new-secret' },
      { columna: 'Contraseña', anterior: 'old-password', nuevo: 'new-password' },
      { columna: 'Estado', anterior: 'Pendiente', nuevo: 'Confirmada' },
    ] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, [99, 'Estado', 'Pendiente', 'Confirmada']);
});
