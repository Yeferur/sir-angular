const test = require('node:test');
const assert = require('node:assert/strict');
const { validarContactoReserva, hasReservaContact } = require('../services/Reservas/reserva-contact');

test('un único teléfono de reportante permite pasajeros adicionales sin teléfono', () => {
  const pasajeros = ['ADULTO', 'ADULTO', 'NINO', 'INFANTE'].map(Tipo_Pasajero => ({ Tipo_Pasajero, Telefono_Pasajero: null }));
  assert.doesNotThrow(() => validarContactoReserva('+573001234567', pasajeros));
  assert.equal(hasReservaContact('+573001234567', pasajeros), true);
});

test('un teléfono de pasajero basta; validar no duplica ni borra teléfonos existentes', () => {
  const pasajeros = [{ Telefono_Pasajero: '+573001234567' }, { Telefono_Pasajero: '+573009876543' }, { Telefono_Pasajero: '' }];
  const before = structuredClone(pasajeros);
  validarContactoReserva('', pasajeros);
  validarContactoReserva(null, pasajeros);
  assert.deepEqual(pasajeros, before);
});

test('falta de contacto y teléfono adicional inválido tienen errores específicos', () => {
  assert.throws(() => validarContactoReserva('', [{ Telefono_Pasajero: null }]), e => e.status === 400 && e.errorCode === 'RESERVA_CONTACT_REQUIRED' && e.message.includes('al menos un teléfono'));
  for (const phone of ['123', ' ', '+01234567890', '+573001234567xxxx']) {
    assert.throws(() => validarContactoReserva('+573001234567', [{ Telefono_Pasajero: phone }]), e => e.status === 400 && e.errorCode === 'RESERVA_PHONE_INVALID');
  }
});

// Opt-in: exercises real transactions ONLY in the explicitly authorized local copy.
test('creación y edición reales preservan contacto, pasajeros y datos tras errores', { skip: process.env.RUN_RESERVAS_INTEGRATION !== '1' }, async () => {
  const db = require('../database/db');
  const [[identity]] = await db.query('SELECT DATABASE() db, @@hostname host');
  assert.equal(identity.db, 'sir2_programacion_alertas_test_20260921');
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.DB_HOST));
  const svc = require('../services/Reservas/reservas.service');
  const date = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  const suffix = Date.now().toString();
  const payload = {
    cabeceraReserva: { Tipo_Reserva: 'Grupal', Id_Tour: 2, Id_Horario: 2, Id_Punto: 397, Fecha_Tour: date, Id_Moneda: 1, Id_Canal: 1, Idioma_Reserva: 'ESPAÑOL', Nombre_Reportante: 'PRUEBA AUTOMATIZADA CONTACTO', Telefono_Reportante: '+573001234567', Observaciones: 'SINTETICA - prueba automatizada formulario' },
    pasajeros: ['ADULTO', 'ADULTO', 'NINO', 'INFANTE'].map((Tipo_Pasajero, index) => ({ Tipo_Pasajero, Nombre_Pasajero: `SINTETICO ${index}`, DNI: `TEST-${suffix}-${index}`, Telefono_Pasajero: null, Id_Punto: 397, Precio_Pasajero: 100, Precio_Tour: 100 })),
    pagos: [{ Tipo: 'Pago Directo', Monto: 400 }], replacePagos: true,
  };
  let id;
  try {
    id = (await svc.crearReservaConPasajerosYPagos(payload)).Id_Reserva;
    assert.ok(id);
    const read = async () => {
      const [[cabecera]] = await db.query('SELECT Nombre_Reportante, Telefono_Reportante, Estado, Observaciones FROM reservas WHERE Id_Reserva=?', [id]);
      const [pasajeros] = await db.query('SELECT Nombre_Pasajero, DNI, Telefono_Pasajero, Tipo_Pasajero FROM pasajeros WHERE Id_Reserva=? ORDER BY Id_Pasajero', [id]);
      return { cabecera, pasajeros };
    };
    assert.equal((await read()).cabecera.Estado, 'Confirmada');
    payload.cabeceraReserva.Observaciones = 'EDICION SINTETICA';
    await svc.actualizarReservaConPasajerosYPagos(id, payload);
    assert.deepEqual((await read()).pasajeros.map(p => p.Telefono_Pasajero), [null, null, null, null]);
    payload.cabeceraReserva.Telefono_Reportante = '';
    payload.pasajeros[0].Telefono_Pasajero = '+573009876543';
    await svc.actualizarReservaConPasajerosYPagos(id, payload);
    await svc.actualizarReservaConPasajerosYPagos(id, payload);
    const before = await read();
    assert.equal(before.cabecera.Estado, 'Confirmada');
    assert.deepEqual(before.pasajeros.map(p => p.Telefono_Pasajero), ['+573009876543', null, null, null]);
    for (const [mutation, code] of [
      [p => { p.pasajeros[0].Telefono_Pasajero = ''; }, 'RESERVA_CONTACT_REQUIRED'],
      [p => { p.pasajeros[1].Telefono_Pasajero = '123'; }, 'RESERVA_PHONE_INVALID'],
      [p => { p.cabeceraReserva.Fecha_Tour = '2026-06-30'; }, 'RESERVA_TOUR_DATE_PAST'],
    ]) {
      const invalid = structuredClone(payload); mutation(invalid);
      await assert.rejects(svc.actualizarReservaConPasajerosYPagos(id, invalid), e => e.status === 400 && e.errorCode === code);
      assert.deepEqual(await read(), before);
      await assert.rejects(svc.crearReservaConPasajerosYPagos(invalid), e => e.status === 400 && e.errorCode === code);
    }
  } finally {
    // Only this test's synthetic reservation; no existing records or saved programs are changed.
    if (id) await svc.eliminarReservaSvc(id);
    await new Promise(resolve => setTimeout(resolve, 200));
    await db.end();
  }
});
