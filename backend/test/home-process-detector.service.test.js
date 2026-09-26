const test = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../services/Pendientes/home-process-detector.service');

test('proyecta una condición de Inicio sin duplicar la lógica del dominio', () => {
  const result = detector.detectionFromProcess({
    id: 'programming',
    label: 'Programación',
    description: 'Dos listados pendientes.',
    count: 2,
    route: '/Programacion/Listado',
    permission: 'PROGRAMACION.LEER',
  });

  assert.deepEqual(result, {
    ruleCode: 'PROGRAMACION_NO_ACTIVA',
    deduplicationKey: 'HOME:programming',
    entityType: 'OPERACION',
    entityId: 'programming',
    audiencePermission: 'PROGRAMACION.LEER',
    title: 'Programación',
    description: 'Dos listados pendientes.',
    data: { count: 2, ruta: '/Programacion/Listado' },
  });
});

test('conserva el período y la identidad operativa cuando el proceso los aporta', () => {
  const result = detector.detectionFromProcess({
    id: 'commissions', label: 'Comisiones', notificationTitle: '2 reservas con comisiones pendientes',
    description: 'Dos reservas pendientes.', count: 2,
    route: '/Comisiones', permission: 'COMISIONES.LEER', periodStart: '2026-09-01',
    periodEnd: '2026-09-20', notificationIdentity: 'firma-operativa',
  });
  assert.deepEqual(result.data, {
    count: 2, ruta: '/Comisiones', periodoDesde: '2026-09-01',
    periodoHasta: '2026-09-20', notificationIdentity: 'firma-operativa',
  });
  assert.equal(result.title, '2 reservas con comisiones pendientes');
});
