const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const { recordHistorial } = require('../services/Historial/logger');
const { actualizarLiquidacionesLote } = require('../services/Comisiones/comisiones.service');
const { insertarCabeceraProgramacion } = require('../services/Programacion/programacion.service');

test('History conserva FK y snapshot del actor y valores de detalle', async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM usuarios u')) return [[{
        Id_Usuario: 42, Actor_Nombre: 'Ana Operaciones', Actor_Rol: 'Administrador',
      }]];
      if (String(sql).includes('INSERT INTO historial')) return [{ insertId: 91 }];
      if (String(sql).includes('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };

  await recordHistorial({ conexion: connection, tabla: 'tours', id_registro: 7,
    accion: 'ACTUALIZAR_TOUR', id_usuario: 42,
    detalles: [{ columna: 'Nombre_Tour', anterior: 'Anterior', nuevo: 'Nuevo' }] });

  const event = calls.find(call => call.sql.includes('INSERT INTO historial'));
  assert.match(event.sql, /Id_Usuario, Actor_Nombre, Actor_Rol/);
  assert.deepEqual(event.params, ['tours', '7', 'ACTUALIZAR_TOUR', 42, 'Ana Operaciones', 'Administrador']);
  const detail = calls.find(call => call.sql.includes('INSERT INTO detalle_historial'));
  assert.deepEqual(detail.params, [91, 'Nombre_Tour', 'Anterior', 'Nuevo']);
});

test('History conserva el detalle sin inventar snapshot para un actor no resoluble', async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM usuarios u')) return [[]];
      if (String(sql).includes('INSERT INTO historial')) return [{ insertId: 92 }];
      if (String(sql).includes('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  await recordHistorial({ conexion: connection, tabla: 'puntos', id_registro: 8,
    accion: 'CAMBIO', id_usuario: 404, detalles: [{ columna: 'ruta', anterior: 'A', nuevo: 'B' }] });
  const event = calls.find(call => call.sql.includes('INSERT INTO historial'));
  assert.deepEqual(event.params.slice(3), [null, null, null]);
});

test('Liquidaciones usan el actor autenticado al crear y al hacer upsert', async (t) => {
  const original = db.getConnection;
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (/SELECT\s+R\.Id_Reserva/.test(statement)) return [[{
        Id_Reserva: 'R-AUDIT-1', Id_Canal: 1, Id_Beneficiario_Comision: null,
        Nombre_Beneficiario: 'Hotel de prueba',
      }]];
      if (statement.includes('FROM usuarios u')) return [[{
        Id_Usuario: 42, Actor_Nombre: 'Ana Operaciones', Actor_Rol: 'Administrador',
      }]];
      if (statement.includes('INSERT INTO liquidaciones')) return [{ affectedRows: 1 }];
      if (statement.includes('INSERT INTO historial')) return [{ insertId: 93 }];
      if (statement.includes('INSERT INTO detalle_historial')) return [{ affectedRows: 2 }];
      throw new Error(`Consulta inesperada: ${statement}`);
    },
  };
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = original; });

  const result = await actualizarLiquidacionesLote({ Estado: 'PENDIENTE', pagos: [{
    reservas: ['R-AUDIT-1'], Forma_Pago: 'EFECTIVO', Nombre_Receptor: 'Receptor prueba', DNI_Receptor: 'DOC-1234',
  }] }, 42);
  assert.deepEqual(result, { updated: 1 });
  const write = calls.find(call => call.sql.includes('INSERT INTO liquidaciones'));
  assert.match(write.sql, /Creado_Por, Actualizado_Por/);
  assert.deepEqual(write.params[0][0].slice(-2), [42, 42]);
  assert.match(write.sql, /Actualizado_Por = VALUES\(Actualizado_Por\)/);
});

test('programación conserva el creador humano sin reemplazar Confirmado_Por', async () => {
  let captured;
  const connection = { async query(sql, params) {
    captured = { sql: String(sql), params };
    return [{ insertId: 17 }];
  } };
  const id = await insertarCabeceraProgramacion(connection, {
    fecha: '2026-10-14', tourId: 5, userId: 42, tipo: 'privada',
  });
  assert.equal(id, 17);
  assert.match(captured.sql, /Confirmado_Por, Creado_Por/);
  assert.deepEqual(captured.params, ['2026-10-14', 5, 42, 42, 'privada']);
});

test('desactivación de tours y puntos conserva History junto con el actor de edición', async (t) => {
  const original = db.getConnection;
  const statements = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: statement, params });
      if (statement.includes('SELECT Nombre_Tour, Abreviacion, Activo FROM tours')) {
        return [[{ Nombre_Tour: 'Tour', Abreviacion: 'T', Activo: 1 }]];
      }
      if (statement.includes('COUNT(DISTINCT r.Id_Reserva)')) return [[{ total: 1 }]];
      if (statement.includes('SELECT Id_Punto, Nombre_Punto, Sector, Direccion, ruta, Activo FROM puntos')) {
        return [[{ Id_Punto: 8, Nombre_Punto: 'Punto', Sector: 'S', Direccion: 'D', ruta: 'R', Activo: 1 }]];
      }
      if (statement.includes('COUNT(DISTINCT Id_Reserva) AS total FROM pasajeros')) return [[{ total: 1 }]];
      if (statement.includes('FROM usuarios u')) return [[{
        Id_Usuario: 42, Actor_Nombre: 'Ana Operaciones', Actor_Rol: 'Administrador',
      }]];
      if (statement.includes('INSERT INTO historial')) return [{ insertId: 94 + statements.filter(x => x.sql.includes('INSERT INTO historial')).length }];
      if (statement.includes('INSERT INTO detalle_historial')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = original; });

  const tours = require('../services/Tours/tours.service');
  const points = require('../services/Puntos/puntos.service');
  const tourResult = await tours.eliminarTour(5, 42);
  const pointResult = await points.eliminarPunto(8, 42);
  assert.equal(tourResult.accion, 'DESACTIVADO');
  assert.equal(pointResult.accion, 'DESACTIVADO');
  assert.ok(statements.some(call => call.sql.includes('UPDATE tours SET Activo = 0, Actualizado_Por')));
  assert.ok(statements.some(call => call.sql.includes('UPDATE puntos SET Activo = 0, posicion = 0, Actualizado_Por')));
  assert.ok(statements.some(call => call.sql.includes('INSERT INTO historial') && call.params[2] === 'DESACTIVAR_TOUR'));
  assert.ok(statements.some(call => call.sql.includes('INSERT INTO historial') && call.params[2] === 'DESACTIVAR_PUNTO'));
});
