const PHONE_PATTERN = /^\+[1-9]\d{10,12}$/;

function isValidReporterPhone(phone) {
  return PHONE_PATTERN.test(String(phone ?? '').trim());
}

function isValidPassengerPhone(phone) {
  return PHONE_PATTERN.test(String(phone ?? '').trim());
}

function hasValidPassengerPhone(passengers = []) {
  return Array.isArray(passengers) && passengers.some(passenger => isValidPassengerPhone(passenger?.Telefono_Pasajero));
}

function validarContactoReserva(reportante, pasajeros = []) {
  const reporterPhone = String(reportante ?? '').trim();
  if (!reporterPhone) {
    const error = new Error('El teléfono del reportante es obligatorio.');
    error.status = 400;
    error.errorCode = 'RESERVA_REPORTER_PHONE_REQUIRED';
    throw error;
  }
  if (!PHONE_PATTERN.test(reporterPhone)) {
    const error = new Error('El teléfono debe tener formato internacional, por ejemplo +573001234567. Los teléfonos adicionales pueden dejarse vacíos.');
    error.status = 400;
    error.errorCode = 'RESERVA_PHONE_INVALID';
    throw error;
  }

  const passengerList = Array.isArray(pasajeros) ? pasajeros : [];
  for (const passenger of passengerList) {
    const phone = String(passenger?.Telefono_Pasajero ?? '').trim();
    if (phone && !PHONE_PATTERN.test(phone)) {
      const error = new Error('El teléfono debe tener formato internacional, por ejemplo +573001234567. Los teléfonos adicionales pueden dejarse vacíos.');
      error.status = 400;
      error.errorCode = 'RESERVA_PHONE_INVALID';
      throw error;
    }
  }

  if (!hasValidPassengerPhone(passengerList)) {
    const error = new Error('El teléfono de al menos un pasajero es obligatorio.');
    error.status = 400;
    error.errorCode = 'RESERVA_PASSENGER_PHONE_REQUIRED';
    throw error;
  }
}

module.exports = { isValidReporterPhone, isValidPassengerPhone, hasValidPassengerPhone, validarContactoReserva };
