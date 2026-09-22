import { AbstractControl, ValidationErrors } from '@angular/forms';

export const RESERVA_PHONE_PATTERN = /^\+[1-9]\d{10,12}$/;
export const CONTACT_REQUIRED_MESSAGE = 'La reserva necesita al menos un teléfono de contacto válido. Completa el teléfono del reportante o el de un pasajero (ej: +573001234567).';

export function hasReservaContact(reportante: unknown, pasajeros: any[]): boolean {
  return [reportante, ...pasajeros.map(p => p.Telefono_Pasajero)]
    .some(phone => RESERVA_PHONE_PATTERN.test(String(phone ?? '')));
}

export function reservaContactValidator(form: AbstractControl): ValidationErrors | null {
  return hasReservaContact(form.get('Telefono_Reportante')?.value, form.get('Pasajeros')?.value ?? [])
    ? null : { contactRequired: true };
}
