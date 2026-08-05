const test = require('node:test');
const assert = require('node:assert/strict');
const {
    reconcilePrivateBuses,
    validatePrivateAssignments,
} = require('../services/Programacion/programacion-private');

const generated = [
    {
        id: 'Bus 1',
        guia: '',
        capacidad: 38,
        ocupados: 38,
        indice: 1,
        Id_Reserva_Privada: 'R-1',
    },
    {
        id: 'Bus 2',
        guia: '',
        capacidad: 38,
        ocupados: 4,
        indice: 2,
        Id_Reserva_Privada: 'R-1',
    },
    {
        id: 'Bus 3',
        guia: '',
        capacidad: 38,
        ocupados: 2,
        indice: 1,
        Id_Reserva_Privada: 'R-2',
    },
];

test('reconcilia asignaciones guardadas y deja las reservas nuevas pendientes', () => {
    const result = reconcilePrivateBuses(generated, [
        { Id_Reserva_Privada: 'R-1', Orden_Bus: 1, Placa_Display: 'VAN-10', Guia: 'Ana' },
        { Id_Reserva_Privada: 'R-1', Orden_Bus: 2, Placa_Display: 'BUS-20', Guia: 'Luis' },
    ]);

    assert.equal(result[0].id, 'VAN-10');
    assert.equal(result[1].guia, 'Luis');
    assert.equal(result[0].persistido, true);
    assert.equal(result[2].nuevo, true);
    assert.equal(result[2].guia, '');
});

test('normaliza identificadores opcionales y exige guía', () => {
    const submitted = generated.map((bus) => ({ ...bus, guia: 'Guía asignada' }));
    submitted[0].id = '';

    const result = validatePrivateAssignments(submitted, generated);
    assert.equal(result[0].id, 'Bus 1');
    assert.equal(result[0].idReserva, 'R-1');
    assert.equal(result.length, 3);
});

test('rechaza vehículos sin guía', () => {
    assert.throws(
        () => validatePrivateAssignments(generated, generated),
        (error) => error.errorCode === 'PRIVATE_PROGRAM_VALIDATION_ERROR'
            && error.details.some((detail) => detail.includes('sin guía'))
    );
});

test('detecta reservas creadas o eliminadas mientras se editaba', () => {
    const submitted = generated.slice(0, 2).map((bus) => ({ ...bus, guia: 'Ana' }));
    assert.throws(
        () => validatePrivateAssignments(submitted, generated),
        (error) => error.details.some((detail) => detail.includes('R-2'))
    );
});
