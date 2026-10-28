const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database/db');
const service = require('../services/Historial/historial.service');
const { TIPOS_ACTIVIDAD, ACCIONES_CONOCIDAS, tipoActividadDeAccion } = require('../services/Historial/catalogos');

const originalQuery = db.query;
test.afterEach(() => { db.query = originalQuery; });

test('mapping único cubre creaciones, modificaciones, cancelaciones, accesos, operación, validaciones y Otros', () => {
  const examples = {
    CREAR_RESERVA: 'creaciones', ACTUALIZAR_RESERVA: 'modificaciones',
    AGREGAR_PASAJERO: 'creaciones', ACTUALIZAR_PASAJERO: 'modificaciones',
    ELIMINAR_PASAJERO: 'cancelaciones',
    CANCELAR_TRANSFER: 'cancelaciones', LOGIN: 'accesos',
    ACTUALIZAR_ASIGNACION_SEGUROS: 'operacion', VALIDAR: 'validaciones',
    EXPORTAR_EXCEL_LISTADO: 'otros', ACCION_FUTURA: 'otros',
  };
  for (const [action, expected] of Object.entries(examples)) assert.equal(tipoActividadDeAccion(action), expected);
  assert.equal(TIPOS_ACTIVIDAD.length, 7);
  assert.equal(new Set(ACCIONES_CONOCIDAS).size, ACCIONES_CONOCIDAS.length);
  assert.equal(require('../services/Historial/catalogos').etiquetaAccion('AGREGAR_PASAJERO'), 'Pasajero agregado');
  assert.equal(require('../services/Historial/catalogos').etiquetaAccion('ACTUALIZAR_PASAJERO'), 'Pasajero actualizado');
  assert.equal(require('../services/Historial/catalogos').etiquetaAccion('ELIMINAR_PASAJERO'), 'Pasajero eliminado');
});

test('filtra un tipo o varios con IDs estables y Otros incluye acciones futuras', () => {
  const filters = { fechaInicio: '2026-10-13', fechaFin: '2026-10-13' };
  for (const [activity, action] of [
    ['creaciones', 'CREAR_RESERVA'], ['modificaciones', 'ACTUALIZAR_RESERVA'],
    ['cancelaciones', 'ELIMINAR_RESERVA'], ['accesos', 'LOGIN'],
    ['operacion', 'GUARDAR_LISTADO'], ['validaciones', 'VALIDAR'],
  ]) {
    const where = service.buildWhere({ ...filters, actividad: [activity] });
    assert.match(where.sql, /h\.Accion IN \(/);
    assert.ok(where.params.includes(action));
  }
  const combined = service.buildWhere({ ...filters, actividad: ['creaciones', 'modificaciones'] });
  assert.ok(combined.params.includes('CREAR_RESERVA'));
  assert.ok(combined.params.includes('ACTUALIZAR_RESERVA'));
  const other = service.buildWhere({ ...filters, actividad: ['otros'] });
  assert.match(other.sql, /h\.Accion NOT IN \(/);
  assert.equal(other.params.includes('ACCION_FUTURA'), false);
  assert.equal(other.params.includes('LOGIN'), true);
  const mixed = service.buildWhere({ ...filters, actividad: ['accesos', 'otros'] });
  assert.match(mixed.sql, /h\.Accion IN \([\s\S]+ OR h\.Accion NOT IN \(/);
  assert.throws(() => service.buildWhere({ ...filters, actividad: ['inexistente'] }), /actividad no reconocido/);
});

test('Historial combina periodo calendario, usuarios, acciones y módulos sin búsqueda libre', () => {
  const where = service.buildWhere({
    fechaInicio: '2026-10-13', fechaFin: '2026-10-15', usuarios: ['3', '7'],
    acciones: ['LOGIN', 'CREAR_USUARIO'], modulos: ['usuarios', 'programacion'],
  });
  assert.match(where.sql, /h\.Id_Usuario IN \(\?,\?\)/);
  assert.match(where.sql, /h\.Accion IN \(\?,\?\)/);
  assert.match(where.sql, /h\.Tabla IN \(\?,\?,\?,\?\)/);
  assert.match(where.sql, /h\.Fecha_Hora_Registro >= \?/);
  assert.match(where.sql, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.deepEqual(where.params, [3, 7, 'LOGIN', 'CREAR_USUARIO', 'usuarios', 'sesiones', 'programacion', 'programacion_buses', '2026-10-13 00:00:00', '2026-10-15 00:00:00']);
  assert.equal(where.sql.includes('search'), false);
});

test('Historial acepta un solo día e incluye otros registros sin revelar tablas técnicas', async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('COUNT(*)')) return [[{ total: 2 }]];
    if (String(sql).includes('SELECT h.Id_Historial')) return [[{
      Id_Historial: 99, Id_Usuario: 5, Usuario_Nombre: 'Ana Snapshot', Actor_Nombre: 'Ana Snapshot', Actor_Rol: 'Operadora',
      Tipo_Accion: 'LOGIN', Tabla_Afectada: 'sesiones', Id_Registro: 'USR-5/A', Fecha_Accion: '2026-10-13 08:00:00',
    }, {
      Id_Historial: 98, Id_Usuario: 8, Usuario_Nombre: 'Elena Actual', Actor_Nombre: null, Actor_Rol: null,
      Tipo_Accion: 'LOGIN', Tabla_Afectada: 'sesiones', Id_Registro: 'USR-8', Fecha_Accion: '2026-10-12 08:00:00',
    }]];
    if (String(sql).includes('FROM detalle_historial')) return [[
      { Id_Historial: 99, Columna: 'Usuario', Valor_Anterior: null, Valor_Nuevo: 'ana' },
      { Id_Historial: 99, Columna: 'Contrasena', Valor_Anterior: 'old-secret', Valor_Nuevo: 'new-secret' },
      { Id_Historial: 99, Columna: 'Token', Valor_Anterior: null, Valor_Nuevo: 'abc-secret' },
    ]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  const result = await service.getHistorial({ fechaInicio: '2026-10-13', fechaFin: '2026-10-13', page: 1, limit: 10 });
  assert.equal(result.total, 2);
  assert.equal(result.data[0].Usuario_Nombre, 'Ana Snapshot');
  assert.equal(result.data[0].Actor_Rol, 'Operadora');
  assert.equal(result.data[0].Modulo, 'Usuarios');
  assert.equal(result.data[0].Id_Registro, null);
  assert.deepEqual(result.data[0].Detalles, []);
  assert.equal(result.data[0].Descripcion, 'Inició sesión');
  assert.equal(result.data[1].Actor_Nombre, null);
  assert.equal(result.data[1].Usuario_Nombre, 'Elena Actual');
  assert.match(calls[0].sql, /h\.Fecha_Hora_Registro >= \?/);
  assert.match(calls[0].sql, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
});

test('resuelve referencias y arma un resumen natural sin filtrar valores técnicos desconocidos', async () => {
  db.query = async (sql) => {
    const statement = String(sql);
    if (statement.includes('COUNT(*)')) return [[{ total: 2 }]];
    if (statement.includes('SELECT h.Id_Historial')) return [[
      { Id_Historial: 91, Id_Usuario: 8, Usuario_Nombre: 'Ana', Actor_Nombre: 'Ana', Actor_Rol: null,
        Tipo_Accion: 'CREAR_RESERVA', Tabla_Afectada: 'reservas', Id_Registro: 'COF50183', Fecha_Accion: '2026-10-20 09:00:00' },
      { Id_Historial: 90, Id_Usuario: 8, Usuario_Nombre: 'Ana', Actor_Nombre: 'Ana', Actor_Rol: null,
        Tipo_Accion: 'ACCION_INTERNA_DESCONOCIDA', Tabla_Afectada: 'entidades_reportantes', Id_Registro: '3', Fecha_Accion: '2026-10-20 08:00:00' },
    ]];
    if (statement.includes('FROM detalle_historial')) return [[
      { Id_Historial: 91, Columna: 'Id_Tour', Valor_Anterior: null, Valor_Nuevo: '4' },
      { Id_Historial: 91, Columna: 'Id_Moneda', Valor_Anterior: null, Valor_Nuevo: '1' },
      { Id_Historial: 91, Columna: 'Id_Canal', Valor_Anterior: null, Valor_Nuevo: '2' },
      { Id_Historial: 91, Columna: 'Id_Usuario', Valor_Anterior: null, Valor_Nuevo: '8' },
      { Id_Historial: 91, Columna: 'Fecha_Tour', Valor_Anterior: null, Valor_Nuevo: '2026-11-21' },
      { Id_Historial: 91, Columna: 'Pasajeros iniciales', Valor_Anterior: null, Valor_Nuevo: 'Ana Pérez · Luis Gómez' },
      { Id_Historial: 90, Columna: 'Campo_Tecnico', Valor_Anterior: null, Valor_Nuevo: 'valor' },
    ]];
    if (statement.includes('FROM tours')) return [[{ id: 4, nombre: 'Coffee Tour' }]];
    if (statement.includes('FROM monedas')) return [[{ id: 1, nombre: 'COP' }]];
    if (statement.includes('FROM canales_origen')) return [[{ id: 2, nombre: 'Hotel' }]];
    if (statement.includes('FROM usuarios WHERE')) return [[{ id: 8, nombre: 'Ana Pérez' }]];
    throw new Error(`Consulta inesperada: ${statement}`);
  };
  const result = await service.getHistorial({ fechaInicio: '2026-10-20', fechaFin: '2026-10-20' });
  assert.equal(result.data[0].Descripcion, 'Creó la reserva COF50183 · Coffee Tour · 21 nov · 2 pax');
  assert.deepEqual(result.data[0].Detalles.slice(0, 4).map((item) => item.nuevo),
    ['Coffee Tour', 'COP', 'Hotel', 'Ana Pérez']);
  assert.equal(result.data[1].Descripcion, 'Se registró actividad en Entidades reportantes');
  assert.equal(require('../services/Historial/catalogos').etiquetaAccion('ACCION_INTERNA_DESCONOCIDA'), 'Otra actividad');
});

test('Historial rechaza periodos inválidos e identificadores de usuario manipulados', () => {
  assert.throws(() => service.buildWhere({ fechaInicio: '2026-02-30' }), /fechaInicio/);
  assert.throws(() => service.buildWhere({ fechaInicio: '2026-10-14', fechaFin: '2026-10-13' }), /posterior/);
  assert.throws(() => service.buildWhere({}), /al menos un filtro/);
  assert.throws(() => service.buildWhere({ fechaInicio: '2026-10-13', fechaFin: '2026-10-13', usuarios: ['1 OR 1=1'] }), /identificadores válidos/);
  assert.throws(() => service.buildWhere({ fechaInicio: '2026-10-13', fechaFin: '2026-10-13', modulos: ['tabla_inventada'] }), /módulo no reconocido/);
  assert.equal(service.sanitizeValue('{"Estado":"Activo","contrasena":"secreta","nested":{"access_token":"privado"}}'),
    '{"Estado":"Activo","contrasena":"[Oculto]","nested":{"access_token":"[Oculto]"}}');
  assert.equal(service.sanitizeValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-value-123456'), '[Oculto]');
});

test('cada criterio funciona sin período y las combinaciones se unen mediante AND', () => {
  const cases = [
    [{ usuarios: [3] }, /h\.Id_Usuario IN \(\?\)/],
    [{ actividad: ['modificaciones'] }, /h\.Accion IN \(/],
    [{ modulos: ['reservas'] }, /h\.Tabla IN \(/],
    [{ fechaInicio: '2026-10-01', fechaFin: '2026-10-13' }, /h\.Fecha_Hora_Registro >= \?/],
    [{ referencia: 'TG82673' }, /h\.Id_Registro = \?/],
  ];
  for (const [filters, condition] of cases) {
    const where = service.buildWhere(filters);
    assert.match(where.sql, condition);
  }
  const combined = service.buildWhere({ usuarios: [3], modulos: ['reservas'] });
  assert.match(combined.sql, /h\.Id_Usuario IN \(\?\)[\s\S]* AND [\s\S]*h\.Tabla IN/);
  const mixedModules = service.buildWhere({ usuarios: [3], modulos: ['reservas', 'otros'] });
  assert.match(mixedModules.sql, /h\.Id_Usuario IN \(\?\) AND \(\(h\.Tabla IN \([\s\S]*\) OR \(h\.Tabla NOT IN \(/);
  const activityPeriod = service.buildWhere({ actividad: ['modificaciones'], fechaInicio: '2026-10-01', fechaFin: '2026-10-13' });
  assert.match(activityPeriod.sql, /h\.Accion IN \([\s\S]* AND h\.Fecha_Hora_Registro >= \?/);
  const codePeriod = service.buildWhere({ referencia: 'TG82673', fechaInicio: '2026-10-01', fechaFin: '2026-10-13' });
  assert.match(codePeriod.sql, /h\.Id_Registro = \?[\s\S]* AND h\.Fecha_Hora_Registro >= \?/);
});

test('página dos usa COUNT y LIMIT/OFFSET sin traer todo el historial', async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('COUNT(*)')) return [[{ total: 24 }]];
    if (String(sql).includes('SELECT h.Id_Historial')) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  const result = await service.getHistorial({ usuarios: [3], page: 2, limit: 10 });
  assert.equal(result.total, 24);
  assert.equal(result.totalPages, 3);
  assert.equal(result.page, 2);
  assert.deepEqual(calls[0].params, [3]);
  assert.match(calls[1].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[1].params, [3, 10, 10]);
});

test('búsqueda por reserva usa el código exacto, admite eventos directos y relaciones técnicas seguras sin fecha', () => {
  const where = service.buildWhere({ referencia: 'tg82673' });
  assert.match(where.sql, /h\.Tabla = 'reservas' AND h\.Id_Registro = \?/);
  assert.match(where.sql, /h\.Tabla = 'pasajeros'.*p\.Id_Pasajero = h\.Id_Registro AND p\.Id_Reserva = \?/s);
  assert.match(where.sql, /h\.Tabla = 'pagos_reservas'.*pr\.Id_Pago = h\.Id_Registro AND pr\.Id_Reserva = \?/s);
  assert.match(where.sql, /h\.Tabla = 'programacion'.*h\.Id_Registro LIKE CONCAT\('%\|', \?\)/s);
  assert.deepEqual(where.params, ['TG82673', null, 'TG82673', 'TG82673', null, 'TG82673']);
});

test('búsqueda por transfer acepta los prefijos vigentes y filtra sus eventos relacionados', () => {
  const where = service.buildWhere({ referencia: 'TRC76739' });
  assert.match(where.sql, /h\.Tabla = 'transfers' AND h\.Id_Registro = \?/);
  assert.match(where.sql, /h\.Tabla = 'pagos_transfers'.*pt\.Id_Pago = h\.Id_Registro AND pt\.Id_Transfer = \?/s);
  assert.match(where.sql, /h\.Tabla = 'programacion'/);
  assert.deepEqual(where.params, ['TRC76739', '76739', 'TRC76739', 'TRC76739', 76739, 'TRC76739']);
  assert.equal(service.buildWhere({ referencia: 'TRS76739' }).params[1], '76739');
});

test('código inexistente produce un resultado vacío normal y nunca exige período', async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (String(sql).includes('COUNT(*)')) return [[{ total: 0 }]];
    if (String(sql).includes('SELECT h.Id_Historial')) return [[]];
    throw new Error(`Consulta inesperada: ${sql}`);
  };
  const result = await service.getHistorial({ referencia: 'CTG96620' });
  assert.deepEqual(result.data, []);
  assert.equal(result.total, 0);
  assert.equal(calls[0].sql.includes('Fecha_Hora_Registro >='), false);
});

test('un período explícito se combina con referencia y un formato inválido se rechaza', () => {
  const where = service.buildWhere({ referencia: 'TG82673', fechaInicio: '2026-10-01', fechaFin: '2026-10-13' });
  assert.match(where.sql, /h\.Fecha_Hora_Registro >= \?/);
  assert.match(where.sql, /DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.throws(() => service.buildWhere({ referencia: 'usuario TG82673' }), /referencia.*código válido/);
  assert.throws(() => service.buildWhere({ referencia: 'TG82673', fechaInicio: '2026-10-01' }), /período/);
});

test('catálogos incluyen todos los usuarios, inactivos y actores históricos sin usuario vigente', async () => {
  const statements = [];
  db.query = async (sql) => {
    const statement = String(sql);
    statements.push(statement);
    if (statement.includes('FROM usuarios u') && statement.includes('UNION ALL')) return [[
      { id: 12, label: 'Julieta' }, { id: 13, label: 'María (inactivo)' }, { id: 14, label: 'Actor histórico' },
    ]];
    if (statement.includes('DISTINCT Tabla')) return [[{ tabla: 'sesiones' }, { tabla: 'tabla_nueva' }]];
    if (statement.includes('DISTINCT Accion')) return [[{ accion: 'ACCION_HEREDADA' }]];
    throw new Error(`Consulta inesperada: ${statement}`);
  };
  const options = await service.getFilterOptions();
  assert.equal(statements.some((sql) => /FROM usuarios u[\s\S]*UNION ALL[\s\S]*FROM historial h/.test(sql)), true);
  assert.deepEqual(options.usuarios, [
    { id: 12, label: 'Julieta' }, { id: 13, label: 'María (inactivo)' }, { id: 14, label: 'Actor histórico' },
  ]);
  assert.ok(options.acciones.some((action) => action.value === 'LOGIN' && action.label === 'Inicio de sesión'));
  assert.ok(options.acciones.some((action) => action.value === 'ACCION_HEREDADA' && action.actividad === 'otros'));
  assert.deepEqual(options.actividades.map((activity) => activity.value), TIPOS_ACTIVIDAD.map((activity) => activity.value));
  assert.ok(options.modulos.some((module) => module.value === 'usuarios' && module.label === 'Usuarios'));
  assert.ok(options.modulos.some((module) => module.value === 'otros' && module.label === 'Otros registros'));
  assert.ok(!options.modulos.some((module) => module.label === 'tabla_nueva'));
});

test('exportación recorre todas las páginas y conserva todos los registros filtrados', async () => {
  let countCalls = 0;
  const offsets = [];
  db.query = async (sql, params) => {
    const statement = String(sql);
    if (statement.includes('COUNT(*)')) { countCalls += 1; return [[{ total: 205 }]]; }
    if (statement.includes('SELECT h.Id_Historial')) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      offsets.push(offset);
      return [Array.from({ length: Math.min(limit, 205 - offset) }, (_, index) => ({
        Id_Historial: offset + index + 1, Id_Usuario: 2, Usuario_Nombre: 'Usuario', Actor_Nombre: 'Snapshot', Actor_Rol: null,
        Tipo_Accion: 'LOGIN', Tabla_Afectada: 'sesiones', Id_Registro: String(offset + index + 1), Fecha_Accion: '2026-10-13 08:00:00',
      }))];
    }
    if (statement.includes('FROM detalle_historial')) return [[]];
    throw new Error(`Consulta inesperada: ${statement}`);
  };
  const rows = await service.exportarHistorial({ fechaInicio: '2026-10-13', fechaFin: '2026-10-13', usuarios: [2] });
  assert.equal(rows.length, 205);
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.equal(countCalls, 3);
});
