const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');

const {
  agruparComisiones,
  buildPassengerQuery,
  actualizarLiquidacionesLote,
  claveGrupoReserva,
  guardarPerfilComisionEntidad,
  obtenerPerfilComisionEntidad,
  validarDatosPago,
  validarReceptor,
  detectarTipoDocumento,
  normalizarFormaPago,
} = require('../services/Comisiones/comisiones.service');

function passenger(overrides = {}) {
  return {
    Id_Reserva: 'TG10001',
    Fecha_Tour: '2026-08-04',
    Nombre_Reportante: 'Juan Pérez',
    Telefono_Reportante: '3000000000',
    Id_Canal: 1,
    Nombre_Canal: 'HOTEL',
    Tiene_Comision: 1,
    Id_Entidad_Reportante: 10,
    Tipo_Entidad: 'HOTEL',
    Nombre_Entidad: 'Hotel Central',
    Entidad_Activa: 1,
    Estado_Validacion_Entidad: 'VALIDADA',
    Id_Perfil_Comision: null,
    Forma_Pago_Perfil: null,
    Cuenta_Perfil: null,
    Nombre_Receptor_Perfil: null,
    DNI_Receptor_Perfil: null,
    Id_Tour: 2,
    Nombre_Tour: 'Guatapé',
    Id_Pasajero: 1,
    Nombre_Pasajero: 'Ana',
    DNI: '123',
    Tipo_Pasajero: 'ADULTO',
    Comision_Pasajero: 15000,
    Estado_Liquidacion: 'PENDIENTE',
    Forma_Pago_Liquidacion: null,
    Cuenta_Liquidacion: null,
    Nombre_Receptor_Snap: null,
    DNI_Receptor_Snap: null,
    Fecha_Pago: null,
    Monto_Comision_Pagada: null,
    ...overrides,
  };
}

function eligibleReservation(overrides = {}) {
  const row = passenger({
    Id_Reserva: 'TG10001',
    Monto_Comision: '15000',
    ...overrides,
  });
  delete row.Id_Pasajero;
  delete row.Nombre_Pasajero;
  delete row.Tipo_Pasajero;
  delete row.Comision_Pasajero;
  return row;
}

function mockConnection({ eligible = [], entity = null, profile = null, existingProfile = null } = {}) {
  const calls = [];
  let nextInsertId = 501;
  const connection = {
    async beginTransaction() { calls.push({ kind: 'begin' }); },
    async commit() { calls.push({ kind: 'commit' }); },
    async rollback() { calls.push({ kind: 'rollback' }); },
    release() { calls.push({ kind: 'release' }); },
    async query(sql, params) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ kind: 'query', sql: statement, params });
      if (statement.startsWith('SELECT R.Id_Reserva FROM reservas R')) {
        return [[...new Map(eligible.map((row) => [String(row.Id_Reserva), row])).values()]
          .map((row) => ({ Id_Reserva: row.Id_Reserva }))];
      }
      if (statement.startsWith('SELECT R.Id_Reserva,') && statement.includes('P.Id_Pasajero')) {
        let passengerId = 0;
        const passengerRows = eligible.flatMap((row) => (row.Comisiones_Pasajeros || [row.Monto_Comision]).map((amount) => ({
          ...row,
          Id_Pasajero: ++passengerId,
          Nombre_Pasajero: `Pasajero ${passengerId}`,
          Tipo_Pasajero: 'ADULTO',
          Comision_Pasajero: amount,
        })));
        return [passengerRows];
      }
      if (statement.includes('FROM usuarios u')) return [[{
        Id_Usuario: 42, Actor_Nombre: 'Ana Operaciones', Actor_Rol: 'Administrador',
      }]];
      if (statement.includes('INSERT INTO liquidaciones')) return [{ affectedRows: params?.[0]?.length || 1 }];
      if (statement.includes('INSERT INTO historial')) return [{ insertId: 700 + calls.length }];
      if (statement.includes('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
      if (statement.includes('FROM entidades_reportantes') && statement.includes('FOR UPDATE')) return [[entity].filter(Boolean)];
      if (statement.includes('FROM perfiles_comision_entidad') && statement.includes('LIMIT 1 FOR UPDATE')) {
        return [[existingProfile].filter(Boolean)];
      }
      if (statement.includes('INSERT INTO perfiles_comision_entidad')) return [{ insertId: nextInsertId++ }];
      if (statement.includes('UPDATE perfiles_comision_entidad')) return [{ affectedRows: 1 }];
      throw new Error(`Consulta inesperada: ${statement}`);
    },
  };
  return { connection, calls };
}

function installConnectionMock(t, mocked) {
  const original = db.getConnection;
  db.getConnection = async () => mocked.connection;
  t.after(() => { db.getConnection = original; });
}

test('la consulta comparte elegibilidad por pasajero, canal y excluye Internacional e INFANTE', () => {
  const { sql, params } = buildPassengerQuery({
    Fecha: '2026-08-04', Id_Tour: '2', Estado: 'PENDIENTE',
  });
  assert.match(sql, /P\.Confirmacion = 1/);
  assert.match(sql, /P\.Comision > 0/);
  assert.match(sql, /Tipo_Pasajero, ''\)\)\) <> 'INFANTE'/);
  assert.match(sql, /C\.Tiene_Comision, 0\) = 1/);
  assert.match(sql, /AGENCIA INTERNACIONAL/);
  assert.match(sql, /PC\.Id_Perfil_Comision/);
  assert.doesNotMatch(sql, /beneficiarios_comision|Id_Beneficiario_Comision/);
  assert.doesNotMatch(sql, /tour_comisiones/i);
  assert.deepEqual(params, ['2026-08-04', 2, 'PENDIENTE']);

  const paymentQuery = buildPassengerQuery({ Id_Reserva: ['TG1', 'TG2'] });
  assert.match(paymentQuery.sql, /R\.Id_Reserva IN \(\?,\?\)/);
  assert.match(paymentQuery.sql, /C\.Tiene_Comision/);
  assert.match(paymentQuery.sql, /AGENCIA INTERNACIONAL/);
  assert.match(paymentQuery.sql, /INFANTE/);
  assert.deepEqual(paymentQuery.params, ['TG1', 'TG2']);
});

test('acepta únicamente los medios definidos y normaliza el alias histórico', () => {
  assert.equal(normalizarFormaPago('bancolombia'), 'TRANSFERENCIA_BANCOLOMBIA');
  assert.deepEqual(validarDatosPago('BANCOLOMBIA', '12345678901'), {
    Forma_Pago: 'TRANSFERENCIA_BANCOLOMBIA', Numero_Cuenta: '12345678901',
  });
  assert.deepEqual(validarDatosPago('NEQUI', '3001234567'), {
    Forma_Pago: 'NEQUI', Numero_Cuenta: '3001234567',
  });
  assert.deepEqual(validarDatosPago('EFECTIVO', 'dato ignorado'), {
    Forma_Pago: 'EFECTIVO', Numero_Cuenta: null,
  });
  assert.throws(() => validarDatosPago('BANCOLOMBIA', '123'), /11 dígitos/);
  assert.throws(() => validarDatosPago('NEQUI', '2001234567'), /iniciar en 3/);
  assert.deepEqual(validarReceptor('Agencia Central SAS', '900.123.456-7', 'TRANSFERENCIA_BANCOLOMBIA'), {
    Nombre_Receptor: 'Agencia Central SAS', DNI_Receptor: '900.123.456-7',
  });
  assert.throws(() => validarReceptor('', '', 'NEQUI'), /persona o empresa/);
});

test('valida el contenido real de JPG, PNG y PDF sin confiar solo en la extensión', () => {
  assert.equal(detectarTipoDocumento(Buffer.from([0xff, 0xd8, 0xff, 0x00])).mime, 'image/jpeg');
  assert.equal(detectarTipoDocumento(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).mime, 'image/png');
  assert.equal(detectarTipoDocumento(Buffer.from('%PDF-1.7')).mime, 'application/pdf');
  assert.equal(detectarTipoDocumento(Buffer.from('archivo falso')), null);
});

test('HOTEL agrupa todas las reservas por Id_Entidad_Reportante', () => {
  const result = agruparComisiones([
    passenger({ Id_Reserva: 'H-1', Id_Entidad_Reportante: 10, Nombre_Entidad: 'Hotel Central' }),
    passenger({ Id_Reserva: 'H-2', Id_Pasajero: 2, Id_Entidad_Reportante: 10, Nombre_Entidad: 'Hotel Central', Comision_Pasajero: 23000 }),
  ]);
  assert.equal(result[0].reportantes.length, 1);
  assert.equal(result[0].reportantes[0].Key_Beneficiario, 'entidad:10');
  assert.equal(result[0].reportantes[0].Nombre_Entidad, 'Hotel Central');
  assert.equal(result[0].reportantes[0].Nombre_Beneficiario, 'Hotel Central');
  assert.equal(result[0].reportantes[0].Nombre_Reportante, null);
  assert.equal(result[0].reportantes[0].reservas[0].Nombre_Reportante, 'Juan Pérez');
  assert.deepEqual(result[0].reportantes[0].reservas.map((row) => row.Id_Reserva), ['H-1', 'H-2']);
  assert.equal(result[0].reportantes[0].Total_Reportante, 38000);
});

test('AGENCIA NACIONAL también agrupa por entidad, independientemente del reportante', () => {
  const result = agruparComisiones([
    passenger({ Id_Reserva: 'A-1', Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL', Tipo_Entidad: 'AGENCIA_NACIONAL', Id_Entidad_Reportante: 20, Nombre_Entidad: 'Agencia Andina', Nombre_Reportante: 'Juan' }),
    passenger({ Id_Reserva: 'A-2', Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL', Tipo_Entidad: 'AGENCIA_NACIONAL', Id_Entidad_Reportante: 20, Nombre_Entidad: 'Agencia Andina', Nombre_Reportante: 'María', Id_Pasajero: 2 }),
  ]);
  assert.equal(result[0].reportantes.length, 1);
  assert.equal(result[0].reportantes[0].Key_Beneficiario, 'entidad:20');
  assert.equal(result[0].reportantes[0].reservas.length, 2);
});

test('AGENCIA INTERNACIONAL se omite incluso si un pasajero trae comisión positiva', () => {
  const rows = [passenger({
    Id_Canal: 3, Nombre_Canal: 'AGENCIA INTERNACIONAL', Tiene_Comision: 0,
    Id_Entidad_Reportante: 30, Tipo_Entidad: 'AGENCIA_INTERNACIONAL', Comision_Pasajero: 50000,
  })];
  assert.deepEqual(agruparComisiones(rows), []);
});

test('la revalidación de grupo rechaza explícitamente un canal internacional aunque tenga Tiene_Comision=1', () => {
  assert.throws(() => claveGrupoReserva({
    Id_Reserva: 'I-1', Id_Canal: 3, Nombre_Canal: 'AGENCIA INTERNACIONAL', Tiene_Comision: 1,
    Id_Entidad_Reportante: 30, Tipo_Entidad: 'AGENCIA_INTERNACIONAL',
  }), (error) => error.errorCode === 'CHANNEL_NOT_COMMISSIONABLE');
});

test('dos Freelance con igual nombre son grupos independientes por reserva', () => {
  const result = agruparComisiones([
    passenger({ Id_Reserva: 'F-1', Id_Canal: 4, Nombre_Canal: 'FREELANCE', Id_Entidad_Reportante: null, Tipo_Entidad: null }),
    passenger({ Id_Reserva: 'F-2', Id_Pasajero: 2, Id_Canal: 4, Nombre_Canal: 'FREELANCE', Id_Entidad_Reportante: null, Tipo_Entidad: null }),
  ]);
  assert.equal(result[0].reportantes.length, 2);
  assert.deepEqual(result[0].reportantes.map((row) => row.Key_Beneficiario), ['reserva:F-1', 'reserva:F-2']);
  assert.ok(result[0].reportantes.every((row) => row.Id_Perfil_Comision === null));
});

test('INFANTE no genera comisión aunque Confirmacion y Comision sean positivas', () => {
  assert.deepEqual(agruparComisiones([passenger({ Tipo_Pasajero: 'INFANTE' })]), []);
});

for (const entity of [
  { Id_Entidad_Reportante: 10, Tipo: 'HOTEL', Nombre: 'Hotel Central' },
  { Id_Entidad_Reportante: 20, Tipo: 'AGENCIA_NACIONAL', Nombre: 'Agencia Andina' },
]) {
  test(`crea y actualiza un perfil reutilizable para ${entity.Tipo}`, async (t) => {
    const mocked = mockConnection({ entity, existingProfile: null });
    installConnectionMock(t, mocked);
    const created = await guardarPerfilComisionEntidad({
      Id_Entidad_Reportante: entity.Id_Entidad_Reportante,
      Forma_Pago: 'NEQUI', Numero_Cuenta: '3001234567',
      Nombre_Receptor: 'Entidad receptora SAS', DNI_Receptor: '900123456',
    }, 42);
    assert.equal(created.Id_Entidad_Reportante, entity.Id_Entidad_Reportante);
    assert.equal(created.Tipo_Entidad, entity.Tipo);
    assert.equal(created.created, true);
    assert.ok(mocked.calls.some((call) => call.sql?.includes('INSERT INTO perfiles_comision_entidad')));
    const createHistory = mocked.calls.find((call) => call.sql?.includes('INSERT INTO historial'));
    assert.equal(createHistory.params[2], 'CREAR_PERFIL_COMISION_ENTIDAD');

    const updateMock = mockConnection({ entity, existingProfile: {
      Id_Perfil_Comision: created.Id_Perfil_Comision,
      Forma_Pago: 'NEQUI', Numero_Cuenta: '3001234567',
      Nombre_Receptor: 'Entidad receptora SAS', DNI_Receptor: '900123456',
    } });
    installConnectionMock(t, updateMock);
    const updated = await guardarPerfilComisionEntidad({
      Id_Perfil_Comision: created.Id_Perfil_Comision,
      Id_Entidad_Reportante: entity.Id_Entidad_Reportante,
      Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Entidad receptora SAS', DNI_Receptor: '900123456',
    }, 42);
    assert.equal(updated.created, false);
    assert.ok(updateMock.calls.some((call) => call.sql?.includes('UPDATE perfiles_comision_entidad')));
    assert.equal(updateMock.calls.find((call) => call.sql?.includes('INSERT INTO historial')).params[2], 'ACTUALIZAR_PERFIL_COMISION_ENTIDAD');
  });
}

test('rechaza perfil para Agencia Internacional y para una identidad Freelance', async (t) => {
  for (const entity of [
    { Id_Entidad_Reportante: 30, Tipo: 'AGENCIA_INTERNACIONAL', Nombre: 'Agencia Exterior' },
    { Id_Entidad_Reportante: 40, Tipo: 'FREELANCE', Nombre: 'Nombre libre' },
  ]) {
    const mocked = mockConnection({ entity });
    installConnectionMock(t, mocked);
    await assert.rejects(
      guardarPerfilComisionEntidad({
        Id_Entidad_Reportante: entity.Id_Entidad_Reportante,
        Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Receptor de prueba', DNI_Receptor: 'DOC-1234',
      }, 42),
      (error) => error.errorCode === 'ENTITY_COMMISSION_PROFILE_FORBIDDEN',
    );
    assert.equal(mocked.calls.some((call) => call.sql?.includes('INSERT INTO perfiles_comision_entidad')), false);
  }
});

test('consulta perfiles ligados a entidad y devuelve los datos reutilizables', async (t) => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('FROM entidades_reportantes')) return [[{
      Id_Entidad_Reportante: 10, Tipo: 'HOTEL', Nombre: 'Hotel Central',
    }]];
    if (String(sql).includes('FROM perfiles_comision_entidad')) return [[{
      Id_Perfil_Comision: 8, Id_Entidad_Reportante: 10, Forma_Pago: 'NEQUI',
      Numero_Cuenta: '3001234567', Nombre_Receptor: 'Hotel SAS', DNI_Receptor: '900123456', Activo: 1,
    }]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  t.after(() => { db.query = original; });
  const profile = await obtenerPerfilComisionEntidad(10);
  assert.equal(profile.Id_Perfil_Comision, 8);
  assert.equal(profile.Nombre_Entidad, 'Hotel Central');
  assert.ok(calls.every((call) => call.params[0] === 10));
});

test('pago grupal guarda una liquidación y monto por reserva, prioriza el perfil y conserva snapshots', async (t) => {
  const profile = {
    Id_Perfil_Comision: 88, Forma_Pago_Perfil: 'NEQUI', Cuenta_Perfil: '3001234567',
    Nombre_Receptor_Perfil: 'Hotel Central SAS', DNI_Receptor_Perfil: '900123456',
  };
  const mocked = mockConnection({ eligible: [
    eligibleReservation({ Id_Reserva: 'H-1', Id_Entidad_Reportante: 10, Tipo_Entidad: 'HOTEL', Nombre_Entidad: 'Hotel Central', Monto_Comision: '12000', Comisiones_Pasajeros: ['5000', '7000'], ...profile }),
    eligibleReservation({ Id_Reserva: 'H-2', Id_Entidad_Reportante: 10, Tipo_Entidad: 'HOTEL', Nombre_Entidad: 'Hotel Central', Monto_Comision: '23000', ...profile }),
  ] });
  installConnectionMock(t, mocked);
  const result = await actualizarLiquidacionesLote({ Estado: 'PAGADO', pagos: [{
    reservas: ['H-1', 'H-2'], Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Ignorado por perfil', DNI_Receptor: 'DOC-1234',
  }] }, 42);
  assert.equal(result.updated, 2);
  assert.deepEqual(result.montos, { 'H-1': 12000, 'H-2': 23000 });
  const write = mocked.calls.find((call) => call.sql?.includes('INSERT INTO liquidaciones'));
  const rows = write.params[0];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row[0]), ['H-1', 'H-2']);
  assert.ok(rows.every((row) => row[1] === 'Hotel Central'));
  assert.ok(rows.every((row) => row[2] === 'NEQUI' && row[3] === '3001234567'));
  assert.ok(rows.every((row) => row[4] === 'Hotel Central SAS' && row[5] === '900123456'));
  assert.deepEqual(rows.map((row) => row[8]), [12000, 23000]);
  assert.match(write.sql, /Monto_Comision_Pagada/);
  assert.doesNotMatch(write.sql, /Id_Beneficiario_Comision/);
  const historyDetails = mocked.calls.find((call) => call.sql?.includes('INSERT INTO detalle_historial'));
  assert.ok(historyDetails);
  assert.ok(historyDetails.params.includes('Monto_Comision_Pagada_Total'));
  assert.ok(historyDetails.params.some((value) => String(value).includes('"H-1":12000')));
});

test('el backend rechaza Agencia Internacional para pago aunque el query devuelva accidentalmente una fila', async (t) => {
  const mocked = mockConnection({ eligible: [eligibleReservation({
    Id_Reserva: 'I-1', Id_Canal: 3, Nombre_Canal: 'AGENCIA INTERNACIONAL', Tiene_Comision: 1,
    Id_Entidad_Reportante: 30, Tipo_Entidad: 'AGENCIA_INTERNACIONAL', Nombre_Entidad: 'Agencia Exterior',
  })] });
  installConnectionMock(t, mocked);
  await assert.rejects(
    actualizarLiquidacionesLote({ Estado: 'PAGADO', pagos: [{
      reservas: ['I-1'], Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Receptor', DNI_Receptor: 'DOC-1234',
    }] }, 42),
    (error) => error.errorCode === 'COMMISSION_CHANGED',
  );
  assert.equal(mocked.calls.some((call) => call.sql?.includes('INSERT INTO liquidaciones')), false);
  assert.ok(mocked.calls.some((call) => call.kind === 'rollback'));
});

test('dos Freelance con el mismo nombre no se pueden pagar como un solo grupo', async (t) => {
  const mocked = mockConnection({ eligible: [
    eligibleReservation({ Id_Reserva: 'F-1', Id_Canal: 4, Nombre_Canal: 'FREELANCE', Tiene_Comision: 1, Id_Entidad_Reportante: null, Tipo_Entidad: null, Nombre_Entidad: null }),
    eligibleReservation({ Id_Reserva: 'F-2', Id_Canal: 4, Nombre_Canal: 'FREELANCE', Tiene_Comision: 1, Id_Entidad_Reportante: null, Tipo_Entidad: null, Nombre_Entidad: null }),
  ] });
  installConnectionMock(t, mocked);
  await assert.rejects(
    actualizarLiquidacionesLote({ Estado: 'PAGADO', pagos: [{
      reservas: ['F-1', 'F-2'], Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Juan Pérez', DNI_Receptor: 'DOC-1234',
    }] }, 42),
    (error) => error.errorCode === 'FREELANCE_GROUP_NOT_ALLOWED',
  );
  assert.equal(mocked.calls.some((call) => call.sql?.includes('INSERT INTO liquidaciones')), false);
});

test('pago Freelance guarda los datos manuales en la liquidación de su única reserva', async (t) => {
  const mocked = mockConnection({ eligible: [eligibleReservation({
    Id_Reserva: 'F-1', Id_Canal: 4, Nombre_Canal: 'FREELANCE', Tiene_Comision: 1,
    Id_Entidad_Reportante: null, Tipo_Entidad: null, Nombre_Entidad: null,
    Nombre_Reportante: 'Juan Pérez', Telefono_Reportante: '3000000000', Monto_Comision: '18000',
  })] });
  installConnectionMock(t, mocked);
  const result = await actualizarLiquidacionesLote({ Estado: 'PAGADO', pagos: [{
    reservas: ['F-1'], Forma_Pago: 'BANCOLOMBIA', Cuenta_Bancaria: '12345678901',
    Nombre_Receptor: 'Juan Pérez', DNI_Receptor: '12345678',
  }] }, 42);
  assert.equal(result.updated, 1);
  const write = mocked.calls.find((call) => call.sql?.includes('INSERT INTO liquidaciones'));
  assert.deepEqual(write.params[0][0].slice(1, 6), [
    'Juan Pérez', 'TRANSFERENCIA_BANCOLOMBIA', '12345678901', 'Juan Pérez', '12345678',
  ]);
  assert.equal(write.params[0][0][8], 18000);
});

test('reabrir borra monto y fecha de pago y devuelve cada fila a PENDIENTE', async (t) => {
  const mocked = mockConnection({ eligible: [
    eligibleReservation({ Id_Reserva: 'H-1', Id_Entidad_Reportante: 10, Tipo_Entidad: 'HOTEL', Nombre_Entidad: 'Hotel Central', Estado_Liquidacion: 'PAGADO' }),
    eligibleReservation({ Id_Reserva: 'H-2', Id_Entidad_Reportante: 10, Tipo_Entidad: 'HOTEL', Nombre_Entidad: 'Hotel Central', Estado_Liquidacion: 'PAGADO' }),
  ] });
  installConnectionMock(t, mocked);
  const result = await actualizarLiquidacionesLote({ Estado: 'PENDIENTE', pagos: [{
    reservas: ['H-1', 'H-2'], Forma_Pago: 'NEQUI', Cuenta_Bancaria: '3001234567',
    Nombre_Receptor: 'Hotel Central SAS', DNI_Receptor: '900123456',
  }] }, 42);
  assert.equal(result.updated, 2);
  const write = mocked.calls.find((call) => call.sql?.includes('INSERT INTO liquidaciones'));
  assert.ok(write.params[0].every((row) => row[6] === 'PENDIENTE' && row[7] === null && row[8] === null));
  assert.match(write.sql, /Fecha_Pago = VALUES\(Fecha_Pago\)/);
  assert.match(write.sql, /Monto_Comision_Pagada = VALUES\(Monto_Comision_Pagada\)/);
});
