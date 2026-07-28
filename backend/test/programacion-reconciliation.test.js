const test = require('node:test');
const assert = require('node:assert/strict');
const {
    obtenerReservasSinAsignar,
} = require('../services/Programacion/programacion-reconciliation');

test('detecta reservas activas creadas después del snapshot', () => {
    const buses = [
        { reservas: [{ Id_Reserva: 'R-1' }, { Id_Reserva: 'R-2' }] },
    ];
    const actuales = [
        { Id_Reserva: 'R-1' },
        { Id_Reserva: 'R-2' },
        { Id_Reserva: 'R-3', NumeroPasajeros: 4 },
    ];

    assert.deepEqual(obtenerReservasSinAsignar(buses, actuales), [
        { Id_Reserva: 'R-3', NumeroPasajeros: 4 },
    ]);
});

test('no devuelve pendientes cuando todas las reservas están asignadas', () => {
    const buses = [
        { reservas: [{ Id_Reserva: 10 }] },
        { reservas: [{ Id_Reserva: 11 }] },
    ];
    const actuales = [{ Id_Reserva: '10' }, { Id_Reserva: '11' }];

    assert.deepEqual(obtenerReservasSinAsignar(buses, actuales), []);
});

test('conserva la reserva completa para permitir su asignación manual', () => {
    const nueva = {
        Id_Reserva: 'R-9',
        NumeroPasajeros: 3,
        NombrePunto: 'Hotel de prueba',
        Latitud: 6.2,
        Longitud: -75.5,
    };

    assert.strictEqual(obtenerReservasSinAsignar([], [nueva])[0], nueva);
});
