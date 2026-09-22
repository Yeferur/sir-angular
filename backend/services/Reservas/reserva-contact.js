const PHONE_PATTERN = /^\+[1-9]\d{10,12}$/;

function hasReservaContact(reportante, pasajeros = []) {
  return [reportante, ...pasajeros.map(p => p.Telefono_Pasajero)]
    .some(phone => PHONE_PATTERN.test(String(phone ?? '')));
}

function validarContactoReserva(reportante, pasajeros = []) {
  const phones = [reportante, ...pasajeros.map(p => p.Telefono_Pasajero)];
  if (phones.some(phone => phone != null && phone !== '' && !PHONE_PATTERN.test(String(phone)))) {
    const error = new Error('El teléfono debe tener formato internacional, por ejemplo +573001234567. Los teléfonos adicionales pueden dejarse vacíos.');
    error.status = 400;
    error.errorCode = 'RESERVA_PHONE_INVALID';
    throw error;
  }
  if (!hasReservaContact(reportante, pasajeros)) {
    const error = new Error('La reserva necesita al menos un teléfono de contacto válido. Completa el teléfono del reportante o el de un pasajero.');
    error.status = 400;
    error.errorCode = 'RESERVA_CONTACT_REQUIRED';
    throw error;
  }
}

module.exports = { hasReservaContact, validarContactoReserva };
