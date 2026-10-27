const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');

const {
  normalizarCambios,
  normalizarEstadoJornadas,
  jornadaConfirmada,
  validarFiltros,
} = require('../services/Confirmacion/confirmacion.service');

test('normaliza confirmaciones, elimina duplicados y conserva el último valor', () => {
  const cambios = normalizarCambios([
    { Id_Pasajero: 10, Confirmacion: 0 },
    { Id_Pasajero: 11, Confirmacion: 1 },
    { Id_Pasajero: 10, Confirmacion: 1 },
  ]);

  assert.deepEqual(cambios, [
    { Id_Pasajero: 10, Confirmacion: 1 },
    { Id_Pasajero: 11, Confirmacion: 1 },
  ]);
});

test('rechaza estados ambiguos e identificadores inválidos', () => {
  assert.throws(
    () => normalizarCambios([{ Id_Pasajero: 1, Confirmacion: 2 }]),
    /confirmación inválida/,
  );
  assert.throws(
    () => normalizarCambios([{ Id_Pasajero: 'abc', Confirmacion: 1 }]),
    /confirmación inválida/,
  );
});

test('exige un tour positivo y una fecha ISO', () => {
  assert.deepEqual(validarFiltros('14', '2026-06-30'), {
    Id_Tour: 14,
    Fecha: '2026-06-30',
  });
  assert.throws(() => validarFiltros('', '2026-06-30'), /tour y una fecha válidos/);
  assert.throws(() => validarFiltros(14, '30/06/2026'), /tour y una fecha válidos/);
});

test('distingue una jornada pendiente de una jornada confirmada aunque nadie viajara', () => {
  const pendiente = normalizarEstadoJornadas([{
    Id_Tour: 14,
    Nombre_Tour: 'Guatapé',
    Total_Pasajeros: 3,
    Total_Comisionables: 2,
    Total_Viajaron: 0,
    Confirmada_En: null,
  }], '2026-06-30');
  assert.equal(pendiente.Jornadas_Pendientes, 1);
  assert.equal(pendiente.jornadas[0].Requiere_Confirmacion, true);
  assert.equal(pendiente.jornadas[0].Total_Comisionables, 2);

  const confirmada = normalizarEstadoJornadas([{
    Id_Tour: 14,
    Nombre_Tour: 'Guatapé',
    Total_Pasajeros: 3,
    Total_Viajaron: 0,
    Total_Pasajeros_Confirmados: 3,
    Confirmada_En: '2026-06-30 18:00:00',
  }], '2026-06-30');
  assert.equal(confirmada.Jornadas_Pendientes, 0);
  assert.equal(confirmada.jornadas[0].Confirmada, true);
  assert.equal(confirmada.jornadas[0].Total_No_Viajaron, 3);
});

test('solicita reconfirmar cuando cambia la cantidad de pasajeros de la jornada', () => {
  const estado = normalizarEstadoJornadas([{
    Id_Tour: 14,
    Nombre_Tour: 'Guatapé',
    Total_Pasajeros: 4,
    Total_Viajaron: 2,
    Total_Pasajeros_Confirmados: 3,
    Confirmada_En: '2026-06-30 18:00:00',
  }], '2026-06-30');

  assert.equal(estado.jornadas[0].Cambio_Cantidad, true);
  assert.equal(estado.jornadas[0].Requiere_Confirmacion, true);
});

async function withConfirmationRow(row, callback) {
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    assert.match(sql, /confirmaciones_jornada/);
    assert.deepEqual(params, [14, '2026-06-30']);
    return [[row]];
  };
  try {
    return await callback();
  } finally {
    db.query = originalQuery;
  }
}

test('jornadaConfirmada: sin fila de cierre devuelve false', async () => {
  const result = await withConfirmationRow({
    Id_Tour: 14,
    Total_Pasajeros: 3,
    Total_Pasajeros_Confirmados: null,
    Confirmada_En: null,
  }, () => jornadaConfirmada(14, '2026-06-30'));
  assert.equal(result, false);
});

test('jornadaConfirmada: con cierre y el mismo total devuelve true', async () => {
  const result = await withConfirmationRow({
    Id_Tour: 14,
    Total_Pasajeros: 3,
    Total_Pasajeros_Confirmados: 3,
    Confirmada_En: '2026-06-30 18:00:00',
  }, () => jornadaConfirmada(14, '2026-06-30'));
  assert.equal(result, true);
});

test('jornadaConfirmada: el cambio de pasajeros después del cierre invalida la jornada', async () => {
  const result = await withConfirmationRow({
    Id_Tour: 14,
    Total_Pasajeros: 4,
    Total_Pasajeros_Confirmados: 3,
    Confirmada_En: '2026-06-30 18:00:00',
  }, () => jornadaConfirmada(14, '2026-06-30'));
  assert.equal(result, false);
});
