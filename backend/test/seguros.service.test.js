const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBusStatus } = require('../services/Seguros/seguros.service');

function bus(overrides = {}) {
    return {
        Id_Bus_Prog: 1,
        Orden_Bus: 1,
        Placa_Display: 'ABC123',
        Tipo_Bus: 'grupal',
        Guia: 'Laura Gómez',
        DNI_Guia: '101010',
        Conductor: 'Carlos Pérez',
        DNI_Conductor: '202020',
        pasajeros: [
            { Id_Pasajero: 1, Id_Reserva: 'TG100', Nombre_Pasajero: 'Ana', DNI: '303030' },
        ],
        ...overrides,
    };
}

test('marca un bus listo solo cuando pasajeros, guía y conductor tienen documento', () => {
    const result = buildBusStatus(bus());
    assert.equal(result.Datos_Completos, true);
    assert.equal(result.Total_Asegurados, 3);
    assert.deepEqual(result.Faltantes, []);
});

test('explica los datos faltantes y no exige la placa para descargar', () => {
    const result = buildBusStatus(bus({
        Placa_Display: '',
        DNI_Guia: null,
        Conductor: null,
        DNI_Conductor: null,
        pasajeros: [
            { Id_Pasajero: 1, Id_Reserva: 'TG100', Nombre_Pasajero: 'Ana', DNI: null },
        ],
    }));

    assert.equal(result.Datos_Completos, false);
    assert.equal(result.Pasajeros_Sin_Documento, 1);
    assert.deepEqual(result.Faltantes.map(item => item.code), [
        'DNI_GUIA',
        'CONDUCTOR',
        'DNI_CONDUCTOR',
        'DOCUMENTO_PASAJERO',
    ]);
    assert.ok(!result.Faltantes.some(item => item.code === 'PLACA'));
});

test('el nombre del guía puede completarse desde Seguros', () => {
    const result = buildBusStatus(bus({ Guia: null }));
    assert.equal(result.Datos_Completos, false);
    assert.deepEqual(result.Faltantes[0], {
        code: 'GUIA',
        label: 'Nombre del guía',
        source: 'seguros',
    });
});
