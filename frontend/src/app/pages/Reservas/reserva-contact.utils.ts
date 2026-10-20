export const RESERVA_PHONE_PATTERN = /^\+[1-9]\d{10,12}$/;

export function isValidReporterPhone(value: unknown): boolean {
  return RESERVA_PHONE_PATTERN.test(String(value ?? '').trim());
}

export function isValidPassengerPhone(value: unknown): boolean {
  return RESERVA_PHONE_PATTERN.test(String(value ?? '').trim());
}

export function hasValidPassengerPhone(passengers: Array<{ Telefono_Pasajero?: unknown }> | null | undefined): boolean {
  return Array.isArray(passengers) && passengers.some(passenger => isValidPassengerPhone(passenger?.Telefono_Pasajero));
}
