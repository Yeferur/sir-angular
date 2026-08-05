const test = require('node:test');
const assert = require('node:assert/strict');

const {
  agruparComisiones,
  buildPassengerQuery,
  validarDatosPago,
  normalizarFormaPago,
} = require('../services/Comisiones/comisiones.service');

test('la consulta usa pasajeros confirmados y nunca la tarifa vigente del tour', () => {
  const { sql, params } = buildPassengerQuery({
    Fecha: '2026-08-04',
    Id_Tour: '2',
    Estado: 'PENDIENTE',
  });

  assert.match(sql, /P\.Confirmacion = 1/);
  assert.match(sql, /P\.Comision > 0/);
  assert.match(sql, /P\.Comision AS Comision_Pasajero/);
  assert.doesNotMatch(sql, /tour_comisiones/i);
  assert.deepEqual(params, ['2026-08-04', 2, 'PENDIENTE']);
});

function passenger(overrides = {}) {
  return {
    Id_Reserva: 'TG10001',
    Fecha_Tour: '2026-08-04',
    Nombre_Reportante: 'Hotel Central',
    Telefono_Reportante: '3000000000',
    Id_Canal: 1,
    Nombre_Canal: 'HOTEL',
    Id_Tour: 2,
    Nombre_Tour: 'Guatapé',
    Id_Pasajero: 1,
    Nombre_Pasajero: 'Ana',
    DNI: '123',
    Tipo_Pasajero: 'ADULTO',
    Comision_Pasajero: 15000,
    Id_Beneficiario: null,
    Tipo_Beneficiario: null,
    Nombre_Beneficiario: null,
    Telefono_Beneficiario: null,
    Forma_Pago_Beneficiario: null,
    Cuenta_Beneficiario: null,
    Estado_Liquidacion: 'PENDIENTE',
    Forma_Pago_Liquidacion: null,
    Cuenta_Liquidacion: null,
    Fecha_Pago: null,
    ...overrides,
  };
}

test('acepta únicamente los tres medios definidos y normaliza el alias histórico', () => {
  assert.equal(normalizarFormaPago('bancolombia'), 'TRANSFERENCIA_BANCOLOMBIA');
  assert.deepEqual(validarDatosPago('BANCOLOMBIA', '12345678901'), {
    Forma_Pago: 'TRANSFERENCIA_BANCOLOMBIA',
    Numero_Cuenta: '12345678901',
  });
  assert.deepEqual(validarDatosPago('NEQUI', '3001234567'), {
    Forma_Pago: 'NEQUI',
    Numero_Cuenta: '3001234567',
  });
  assert.deepEqual(validarDatosPago('EFECTIVO', 'dato ignorado'), {
    Forma_Pago: 'EFECTIVO',
    Numero_Cuenta: null,
  });
});

test('permite registrar una liquidación sin datos bancarios cuando el flujo lo solicita', () => {
  assert.deepEqual(validarDatosPago(null, null, {
    permitirVacio: true,
    permitirCuentaVacia: true,
  }), {
    Forma_Pago: null,
    Numero_Cuenta: null,
  });

  assert.deepEqual(validarDatosPago('BANCOLOMBIA', null, {
    permitirVacio: true,
    permitirCuentaVacia: true,
  }), {
    Forma_Pago: 'TRANSFERENCIA_BANCOLOMBIA',
    Numero_Cuenta: null,
  });
});

test('rechaza números de Bancolombia y Nequi que no cumplen la regla acordada', () => {
  assert.throws(() => validarDatosPago('BANCOLOMBIA', '123'), /11 dígitos/);
  assert.throws(() => validarDatosPago('NEQUI', '2001234567'), /iniciar en 3/);
});

test('calcula la comisión desde el valor histórico de cada pasajero', () => {
  const result = agruparComisiones([
    passenger(),
    passenger({ Id_Pasajero: 2, Nombre_Pasajero: 'Luis', Comision_Pasajero: 23000 }),
    passenger({
      Id_Reserva: 'TG10002',
      Id_Pasajero: 3,
      Nombre_Pasajero: 'Sara',
      Comision_Pasajero: 18000,
      Estado_Liquidacion: 'PAGADO',
    }),
  ]);

  const reportante = result[0].reportantes[0];
  assert.equal(reportante.reservas[0].Total_Comision, 38000);
  assert.equal(reportante.reservas[0].Comision_Minima, 15000);
  assert.equal(reportante.reservas[0].Comision_Maxima, 23000);
  assert.equal(reportante.Total_Reportante, 56000);
  assert.equal(reportante.Pendiente_Reportante, 38000);
  assert.equal(reportante.Pagado_Reportante, 18000);
});

test('usa el identificador centralizado para agrupar y conserva la fuente de pago', () => {
  const result = agruparComisiones([
    passenger({
      Id_Beneficiario: 9,
      Tipo_Beneficiario: 'HOTEL',
      Nombre_Beneficiario: 'Hotel Central Medellín',
      Forma_Pago_Beneficiario: 'NEQUI',
      Cuenta_Beneficiario: '3001234567',
    }),
  ]);

  const reportante = result[0].reportantes[0];
  assert.equal(reportante.Key_Beneficiario, 'beneficiario:9');
  assert.equal(reportante.Centralizado, true);
  assert.equal(reportante.Origen_Datos_Pago, 'CENTRALIZADO');
  assert.equal(reportante.Nombre_Reportante, 'Hotel Central Medellín');
});
