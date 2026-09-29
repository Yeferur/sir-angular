const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/Programacion/programacion-transfers-novedades.service');
const { assertTestDestination } = require('../scripts/migrate-programacion-transfers');

function transfer(extra = {}) {
  return { Id_Transfer: 8, Fecha_Transfer: '2026-10-15', Hora_Recogida: '6:30 AM', Estado: 'Confirmado',
    Punto_Salida: 'Hotel', Punto_Destino: 'Aeropuerto', Cantidad_Personas: 3,
    Nombre_Servicio: 'Aeropuerto', Rango_Descripcion: '1 a 3 pasajeros', Nombre_Titular: 'Titular',
    Telefono_Titular: '555', Vuelo: 'AB12', TipoVuelo: 'Salida', Observaciones: 'Equipaje', ...extra };
}

test('Transfer preparado sin cambios y horarios equivalentes no generan novedad', () => {
  const snapshot = { Id_Transfer: 8, Datos_Snapshot: service.operationalSnapshot(transfer()) };
  assert.deepEqual(service.changedTransfer(snapshot, transfer()), []);
  assert.deepEqual(service.changedTransfer(snapshot, transfer({ Hora_Recogida: '06:30:00' })), []);
});

test('los campos administrativos se excluyen de snapshot y comparación', () => {
  const row = transfer({ DNI: '1', Valor: 100, Id_Moneda: 1, Nombre_Reportante: 'A' });
  const data = service.operationalSnapshot(row);
  for (const field of ['DNI', 'Valor', 'Id_Moneda', 'Nombre_Reportante', 'Telefono_Reportante', 'Fecha_Registro', 'Actualizado_Por']) assert.equal(field in data, false);
  assert.deepEqual(service.changedTransfer({ Datos_Snapshot: data }, { ...row, DNI: '2', Valor: 200, Id_Moneda: 2, Nombre_Reportante: 'B' }), []);
});

test('cada dato operativo usado por el listado se compara con el estado preparado', () => {
  const snapshot = { Datos_Snapshot: service.operationalSnapshot(transfer()) };
  for (const [field, label] of service.FIELDS) {
    const value = field === 'Cantidad_Personas' ? 4 : field === 'Fecha_Transfer' ? '2026-10-16' : 'Cambiado';
    const changes = service.changedTransfer(snapshot, transfer({ [field]: value }));
    assert.equal(changes.length, 1, field);
    assert.equal(changes[0].campo, label);
  }
});

test('cancelación, eliminación y reversión tienen diferencias verificables', () => {
  const snapshot = { Datos_Snapshot: JSON.stringify(service.operationalSnapshot(transfer())) };
  assert.equal(service.changedTransfer(snapshot, transfer({ Estado: 'Cancelado' }))[0].campo, 'Estado');
  assert.equal(service.changedTransfer(snapshot, null)[0].actual, 'Ya no está disponible');
  assert.deepEqual(service.changedTransfer(snapshot, transfer()), []);
});

test('se rechaza migración en producción o fuera de la base local de pruebas', () => {
  assert.doesNotThrow(() => assertTestDestination({ DB_HOST: '127.0.0.1' }, 'sir_test_local'));
  for (const [env, db] of [[{ DB_HOST: '127.0.0.1', NODE_ENV: 'production' }, 'sir_test'],
    [{ DB_HOST: 'externo' }, 'sir_test'], [{ DB_HOST: '127.0.0.1' }, 'sir_operativa']]) {
    assert.throws(() => assertTestDestination(env, db), /base MySQL local/);
  }
});
