const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const db = require('../database/db');
const { generarExcelListadoBus } = require('../services/Programacion/programacion.service');

test('genera el listado operativo por rutas con el formato de reservas y columnas financieras', async () => {
    const originalQuery = db.query;
    const consultas = [];

    db.query = async (sql, params) => {
        consultas.push({ sql, params });

        if (sql.includes('FROM reservas r')) {
            return [[
                {
                    Id_Reserva: 'HN-1',
                    Id_Tour: 5,
                    Nombre_Tour: 'HACIENDA NÁPOLES',
                    Estado: 'Activa',
                    Tipo_Reserva: 'Grupal',
                    IdiomaReserva: 'ESPAÑOL',
                    NombreReporta: 'AGENCIA EJEMPLO',
                    Observaciones: 'LLEVAR DOCUMENTOS',
                    NombreCanal: 'AGENCIA NACIONAL',
                    MonedaCodigo: 'COP',
                    NumeroPasajeros: 2,
                    TotalAbonos: 50000,
                },
                {
                    Id_Reserva: 'RC-1',
                    Id_Tour: 1,
                    Nombre_Tour: 'RÍO CLARO',
                    Estado: 'Activa',
                    Tipo_Reserva: 'Grupal',
                    IdiomaReserva: 'Inglés',
                    NombreReporta: 'FREELANCE',
                    Observaciones: '',
                    NombreCanal: 'AGENCIA INTERNACIONAL',
                    MonedaCodigo: 'USD',
                    NumeroPasajeros: 1,
                    TotalAbonos: 80,
                },
            ]];
        }

        if (sql.includes('FROM pasajeros p')) {
            return [[
                {
                    Id_Reserva: 'HN-1',
                    Id_Pasajero: 10,
                    Nombre_Pasajero: 'Ana, María',
                    DNI: '100',
                    Telefono_Pasajero: '300100',
                    PrecioTour: 299000,
                    Id_Punto: 20,
                    PuntoEncuentro: 'HOTEL HN',
                    Ruta: '2',
                    Posicion: 2,
                },
                {
                    Id_Reserva: 'HN-1',
                    Id_Pasajero: 11,
                    Nombre_Pasajero: 'Luis Pérez',
                    DNI: '101',
                    Telefono_Pasajero: '300101',
                    PrecioTour: 299000,
                    Id_Punto: 20,
                    PuntoEncuentro: 'HOTEL HN',
                    Ruta: '2',
                    Posicion: 2,
                },
                {
                    Id_Reserva: 'RC-1',
                    Id_Pasajero: 12,
                    Nombre_Pasajero: 'John Smith',
                    DNI: 'P-1',
                    Telefono_Pasajero: '+1 555',
                    PrecioTour: 50,
                    Id_Punto: 10,
                    PuntoEncuentro: 'MASAYA',
                    Ruta: '1',
                    Posicion: 1,
                },
                {
                    Id_Reserva: 'CANCELADA-1',
                    Id_Pasajero: 13,
                    Nombre_Pasajero: 'No debe salir',
                    DNI: 'X',
                    PrecioTour: 1,
                    Ruta: '3',
                    Posicion: 1,
                },
            ]];
        }

        throw new Error(`Consulta inesperada: ${sql}`);
    };

    try {
        const buffer = await generarExcelListadoBus({
            fecha: '2026-09-02',
            idTour: 5,
            nombreTour: 'HACIENDA NÁPOLES Y RÍO CLARO',
            bus: {
                id: 'BUS 1',
                guia: 'ALEJANDRO ÁLVAREZ',
                reservas: [
                    { Id_Reserva: 'HN-1', Id_Punto: 20, NombrePunto: 'HOTEL HN', ruta: '2', ordenRuta: 2 },
                    { Id_Reserva: 'RC-1', Id_Punto: 10, NombrePunto: 'MASAYA', ruta: '1', ordenRuta: 1 },
                    { Id_Reserva: 'CANCELADA-1', ruta: '3', ordenRuta: 1 },
                ],
            },
        });

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet('LISTADO');

        assert.deepEqual(
            worksheet.getRow(2).values.slice(1),
            [
                'NOMBRE DEL PASAJERO', 'DNI/PASAPORTE', 'TELEFONO', '# PAX',
                'PUNTO DE ENCUENTRO', 'OBSERVACIONES', 'PRECIO', 'PAGO AGENCIA',
                'DOLARES', 'TRANSFER', 'REPORTA', 'IDIOMA', 'TIPO DE RESERVA',
                'RUTA', 'ESTADO DE RESERVA',
            ]
        );
        assert.equal(worksheet.getCell('A2').fill.fgColor.argb, 'FF00B0F0');
        const titleParts = worksheet.getCell('B1').value.richText;
        const rioClaroTitle = titleParts.find(part => /R[IÍ]O CLARO/i.test(part.text));
        assert.equal(rioClaroTitle.font.color.argb, 'FF00FF00');
        assert.equal(worksheet.getCell('I1').value, 'BUS: BUS 1');
        assert.equal(worksheet.getCell('L1').value, 'GUÍA: ALEJANDRO ÁLVAREZ');

        assert.equal(worksheet.getCell('A3').value, 'John Smith');
        assert.equal(worksheet.getCell('A3').font.color.argb, 'FF00FF00');
        assert.equal(worksheet.getCell('E3').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('L3').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('G3').value, 50);
        assert.equal(worksheet.getCell('I3').value, 50);
        assert.equal(worksheet.getCell('H3').value || '', '');
        assert.equal(worksheet.getCell('J3').value || '', '');
        assert.equal(worksheet.getCell('N3').value, '1');

        assert.equal(worksheet.getCell('A4').value, 'Total Ruta 1');
        assert.equal(worksheet.getCell('D4').value, 1);
        assert.equal(worksheet.getCell('A4').fill.fgColor.argb, 'FFDDDDDD');
        assert.equal(worksheet.getCell('D4').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('A5').value, 'Ana, María');
        assert.equal(worksheet.getCell('A6').value, 'Luis Pérez');
        assert.equal(worksheet.getCell('H5').value, 50000);
        assert.equal(worksheet.getCell('D5').isMerged, true);
        assert.equal(worksheet.getCell('D6').isMerged, true);
        assert.equal(worksheet.getCell('G5').isMerged, false);
        assert.equal(worksheet.getCell('G6').isMerged, false);
        assert.equal(worksheet.getCell('A5').border.top.style, 'thin');
        assert.equal(worksheet.getCell('A5').border.bottom?.style, undefined);
        assert.equal(worksheet.getCell('A6').border.bottom.style, 'thin');
        assert.equal(worksheet.getCell('A7').value, 'Total Ruta 2');
        assert.equal(worksheet.getCell('D7').value, 2);
        assert.equal(worksheet.getCell('A9').value, 'Total de Pasajeros');
        assert.equal(worksheet.getCell('D9').value, 3);
        const valores = [];
        worksheet.eachRow(row => row.eachCell(cell => valores.push(cell.value)));
        assert.equal(valores.includes('No debe salir'), false);

        assert.match(consultas[0].sql, /pagos_reservas/);
        assert.match(consultas[0].sql, /UPPER\(TRIM\(COALESCE\(r\.Estado/);
        assert.equal(consultas.length, 2);
    } finally {
        db.query = originalQuery;
    }
});

test('genera el formato compacto con bus vacío y guía pendiente', async () => {
    const originalQuery = db.query;

    db.query = async (sql) => {
        if (sql.includes('FROM reservas r')) {
            return [[{
                Id_Reserva: 'G-1',
                Id_Tour: 7,
                Nombre_Tour: 'GUATAPÉ',
                Estado: 'Activa',
                Tipo_Reserva: 'Grupal',
                IdiomaReserva: 'Inglés',
                NombreReporta: 'WEB',
                Observaciones: 'LLEGAN ALLÍ',
                NombreCanal: 'DIRECTO',
                MonedaCodigo: 'COP',
                NumeroPasajeros: 2,
                TotalAbonos: 0,
            }]];
        }

        if (sql.includes('FROM pasajeros p')) {
            return [[
                {
                    Id_Reserva: 'G-1',
                    Id_Pasajero: 1,
                    Nombre_Pasajero: 'PASAJERO UNO',
                    DNI: '1',
                    Telefono_Pasajero: '300',
                    PrecioTour: 120000,
                    Id_Punto: 10,
                    PuntoEncuentro: 'PARQUE DEL POBLADO',
                    Ruta: '1',
                    Posicion: 1,
                },
                {
                    Id_Reserva: 'G-1',
                    Id_Pasajero: 2,
                    Nombre_Pasajero: 'PASAJERO DOS',
                    DNI: '2',
                    Telefono_Pasajero: '301',
                    PrecioTour: 120000,
                    Id_Punto: 10,
                    PuntoEncuentro: 'PARQUE DEL POBLADO',
                    Ruta: '1',
                    Posicion: 1,
                },
            ]];
        }

        throw new Error(`Consulta inesperada: ${sql}`);
    };

    try {
        const buffer = await generarExcelListadoBus({
            fecha: '2026-05-16',
            idTour: 7,
            nombreTour: 'GUATAPÉ',
            formato: 'compacto',
            bus: {
                id: '',
                guia: '',
                reservas: [{ Id_Reserva: 'G-1', Id_Punto: 10, NombrePunto: 'PARQUE DEL POBLADO' }],
            },
        });

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet('LISTADO');

        assert.equal(worksheet.columnCount, 12);
        assert.deepEqual(
            worksheet.getRow(2).values.slice(1),
            [
                'NOMBRE DEL PASAJERO', 'DNI/PASAPORTE', 'TELEFONO', '# PAX',
                'PUNTO DE ENCUENTRO', 'OBSERVACIONES', 'PRECIO', 'AGENCIA',
                'DOLARES', 'TRANSFER', 'REPORTA', 'IDIOMA',
            ]
        );
        assert.equal(worksheet.getCell('G1').value, 'BUS:');
        assert.equal(worksheet.getCell('J1').value, 'GUÍA: PENDIENTE');
        assert.equal(worksheet.getCell('J1').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('D3').value, 2);
        assert.equal(worksheet.getCell('D3').isMerged, true);
        assert.equal(worksheet.getCell('G3').isMerged, false);
        assert.equal(worksheet.getCell('E3').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('L3').font.color.argb, 'FFFF0000');
        assert.equal(worksheet.getCell('A5').value || '', '');
        assert.equal(worksheet.getCell('D5').value, 2);
    } finally {
        db.query = originalQuery;
    }
});
