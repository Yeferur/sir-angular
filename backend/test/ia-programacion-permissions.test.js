const test = require('node:test');
const assert = require('node:assert/strict');

const permissionsService = require('../services/Permisos/permisos.service');
const programacionService = require('../services/Programacion/programacion.service');
const permissionsMiddleware = require('../middlewares/permissionsMiddleware');

const originalVerifyPermission = permissionsService.verificarPermiso;
const originalGetPermissions = permissionsService.obtenerPermisosPorUsuario;
const originalGenerate = programacionService.generarPlanLogistico;
const originalGetSaved = programacionService.obtenerListadoFinal;
const originalSaveList = programacionService.guardarListadoFinal;
const originalSavePrivate = programacionService.guardarProgramacionPrivada;

const rolePermissionsByUser = new Map();
const overridesByUser = new Map();
const generationCalls = [];
const savedReads = [];
const savedWrites = [];

function effectivePermissions(userId) {
  const effective = new Set(rolePermissionsByUser.get(Number(userId)) || []);
  const overrides = overridesByUser.get(Number(userId)) || new Map();
  for (const [permission, type] of overrides) {
    if (type === 'DENY') effective.delete(permission);
    if (type === 'ALLOW') effective.add(permission);
  }
  return effective;
}

permissionsService.verificarPermiso = async (userId, permission) => (
  effectivePermissions(userId).has(permission)
);
permissionsService.obtenerPermisosPorUsuario = async (userId) => (
  [...effectivePermissions(userId)].map((Codigo_Permiso) => ({ Codigo_Permiso }))
);
programacionService.generarPlanLogistico = async (fecha, idsTours) => {
  generationCalls.push({ fecha, idsTours });
  return {
    buses: [{ Id_Bus: 1, capacidad: 20, ocupados: 3, reservas: [{ Id_Reserva: 1 }] }],
    reservasSinAsignar: [],
    alertas: [],
  };
};
programacionService.obtenerListadoFinal = async (...args) => {
  savedReads.push(args);
  return { exists: false, buses: [] };
};
programacionService.guardarListadoFinal = async (...args) => {
  savedWrites.push(['guardarListadoFinal', args]);
};
programacionService.guardarProgramacionPrivada = async (...args) => {
  savedWrites.push(['guardarProgramacionPrivada', args]);
};

const { getIaToolByName } = require('../services/IA/ia-tool-registry.service');
const { executeTool } = require('../services/IA/ia-tool-executor.service');
const { authMiddleware } = require('../middlewares/authMiddleware');
const iaRouter = require('../routes/IA/ia.routes');
const programacionRouter = require('../routes/Programacion/programacion.routes');

function findEndpoint(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  assert.ok(layer, `Falta la ruta ${method.toUpperCase()} ${path}`);
  return layer.route.stack.map((entry) => entry.handle);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('la simulación de Programación por IA exige CREAR y sigue siendo de solo lectura', async (t) => {
  t.after(() => {
    permissionsService.verificarPermiso = originalVerifyPermission;
    permissionsService.obtenerPermisosPorUsuario = originalGetPermissions;
    programacionService.generarPlanLogistico = originalGenerate;
    programacionService.obtenerListadoFinal = originalGetSaved;
    programacionService.guardarListadoFinal = originalSaveList;
    programacionService.guardarProgramacionPrivada = originalSavePrivate;
  });

  const simulate = (user) => executeTool({
    toolName: 'simular_listado_buses',
    input: { fecha: '2026-09-20', idsTours: [37] },
    user,
    context: {},
  });

  await t.test('solo LEER no permite generar una propuesta', async () => {
    rolePermissionsByUser.set(701, new Set(['PROGRAMACION.LEER']));
    const result = await simulate({ id: 701 });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'IA_PERMISSION_DENIED');
    assert.equal(generationCalls.length, 0);
  });

  await t.test('CREAR efectivo permite ejecutar la simulación sin guardar', async () => {
    rolePermissionsByUser.set(702, new Set(['PROGRAMACION.CREAR']));
    const result = await simulate({ id: 702 });
    assert.equal(result.success, true);
    assert.equal(result.data.resumen.totalBuses, 1);
    assert.deepEqual(generationCalls, [{ fecha: '2026-09-20', idsTours: [37] }]);
    assert.deepEqual(savedReads, []);
    assert.deepEqual(savedWrites, []);
  });

  await t.test('DENY individual de CREAR prevalece sobre el permiso del rol', async () => {
    rolePermissionsByUser.set(703, new Set(['PROGRAMACION.LEER', 'PROGRAMACION.CREAR']));
    overridesByUser.set(703, new Map([['PROGRAMACION.CREAR', 'DENY']]));
    const callsBefore = generationCalls.length;
    const result = await simulate({ id: 703 });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'IA_PERMISSION_DENIED');
    assert.equal(generationCalls.length, callsBefore);
  });

  await t.test('sin usuario autenticado, el guard de la herramienta deniega la ejecución', async () => {
    const result = await simulate(null);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'IA_PERMISSION_DENIED');
  });

  await t.test('la consulta de listados guardados conserva el permiso de lectura', () => {
    assert.equal(getIaToolByName('simular_listado_buses').requiredPermission, 'PROGRAMACION.CREAR');
    assert.equal(getIaToolByName('consultar_listado_generado').requiredPermission, 'PROGRAMACION.LEER');
  });

  await t.test('la ruta de generación normal mantiene PROGRAMACION.CREAR', async () => {
    const handlers = findEndpoint(programacionRouter, 'post', '/plan-logistico');
    assert.equal(handlers[0], authMiddleware);
    const userId = 704;
    const req = { user: { id: userId, isClient: false } };
    const response = makeResponse();
    let nextCalled = false;

    rolePermissionsByUser.set(userId, new Set(['PROGRAMACION.LEER']));
    permissionsMiddleware.invalidarCacheUsuario(userId);
    await handlers[1](req, response, () => { nextCalled = true; });
    assert.equal(response.statusCode, 403);
    assert.equal(nextCalled, false);

    rolePermissionsByUser.set(userId, new Set(['PROGRAMACION.CREAR']));
    permissionsMiddleware.invalidarCacheUsuario(userId);
    await handlers[1](req, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    permissionsMiddleware.invalidarCacheUsuario(userId);
  });

  await t.test('la ruta de chat sigue exigiendo autenticación antes del controlador', async () => {
    const handlers = findEndpoint(iaRouter, 'post', '/chat');
    assert.equal(handlers[0], authMiddleware);
    const response = makeResponse();
    let nextCalled = false;
    await handlers[0]({ headers: {} }, response, () => { nextCalled = true; });
    assert.equal(response.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});
