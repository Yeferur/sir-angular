const test = require('node:test');
const assert = require('node:assert/strict');

const {
    detectarDuplicadosAsignacion,
    normalizarCapacidadProgramacion,
} = require('../services/Programacion/programacion.service');

test('rechaza placas y guías repetidos dentro del listado de la misma fecha', () => {
    const errores = detectarDuplicadosAsignacion([
        { placa: 'ABC-123', guia: 'Laura Gómez' },
        { placa: 'abc 123', guia: 'Laura Gomez' },
    ]);

    assert.equal(errores.length, 2);
    assert.match(errores[0], /placa/i);
    assert.match(errores[1], /guía/i);
});

test('permite identificadores genéricos repetidos porque todavía no son placas reales', () => {
    const errores = detectarDuplicadosAsignacion([
        { placa: 'Bus 1', guia: 'Laura' },
        { placa: 'Bus 1', guia: 'Carlos' },
    ]);

    assert.deepEqual(errores, []);
});

test('conserva una capacidad manual válida y reconoce su modo', () => {
    assert.deepEqual(normalizarCapacidadProgramacion({ capacidad: 42, capacidadManual: true }), {
        capacidad: 42,
        capacidadManual: true,
        valida: true,
    });
});

test('una capacidad manual inválida no se acepta y la automática conserva el valor por defecto', () => {
    assert.deepEqual(normalizarCapacidadProgramacion({ capacidad: 0, capacidadManual: true }), {
        capacidad: 38,
        capacidadManual: true,
        valida: false,
    });
    assert.deepEqual(normalizarCapacidadProgramacion({ capacidad: 0 }), {
        capacidad: 38,
        capacidadManual: false,
        valida: true,
    });
});
