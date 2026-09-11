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
