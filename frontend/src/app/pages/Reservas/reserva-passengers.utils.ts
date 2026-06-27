import { AbstractControl } from '@angular/forms';

export type ReservaPassengerType = 'ADULTO' | 'NINO' | 'INFANTE';

const PASSENGER_ORDER: Record<ReservaPassengerType, number> = {
  ADULTO: 0,
  NINO: 1,
  INFANTE: 2,
};

export function normalizeReservaPassengerType(raw: unknown): ReservaPassengerType {
  const normalized = String(raw ?? '').trim().toUpperCase();
  if (normalized === 'NINO') return 'NINO';
  if (normalized === 'INFANTE') return 'INFANTE';
  return 'ADULTO';
}

export function reservaPassengerTypeLabel(raw: unknown): string {
  const tipo = normalizeReservaPassengerType(raw);
  if (tipo === 'NINO') return 'Niño';
  if (tipo === 'INFANTE') return 'Infante';
  return 'Adulto';
}

export function getReservaPassengerInsertIndex(
  controls: readonly AbstractControl[],
  tipo: unknown
): number {
  const targetOrder = PASSENGER_ORDER[normalizeReservaPassengerType(tipo)];

  for (let i = 0; i < controls.length; i++) {
    const currentOrder = PASSENGER_ORDER[
      normalizeReservaPassengerType(controls[i]?.get?.('Tipo_Pasajero')?.value)
    ];
    if (currentOrder > targetOrder) return i;
  }

  return controls.length;
}

export function sortReservaPassengerControls<T extends AbstractControl>(
  controls: readonly T[]
): T[] {
  return [...controls]
    .map((control, index) => ({ control, index }))
    .sort((a, b) => {
      const orderA = PASSENGER_ORDER[
        normalizeReservaPassengerType(a.control?.get?.('Tipo_Pasajero')?.value)
      ];
      const orderB = PASSENGER_ORDER[
        normalizeReservaPassengerType(b.control?.get?.('Tipo_Pasajero')?.value)
      ];
      return orderA - orderB || a.index - b.index;
    })
    .map((entry) => entry.control);
}
