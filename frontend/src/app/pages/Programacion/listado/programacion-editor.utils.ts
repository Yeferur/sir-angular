import { Bus, Reserva } from '../../../interfaces/Programacion/reservas';
import { ProgramacionViewStop } from './programacion-view.types';

export function isGenericBusId(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim();
  return !normalized || /^Bus\s+\d+$/i.test(normalized);
}

export function renumberGenericBuses(buses: Bus[] | null | undefined): void {
  if (!Array.isArray(buses) || !buses.length) return;

  let genericIndex = 1;
  for (const bus of buses) {
    if (isGenericBusId(bus.id)) {
      bus.id = `Bus ${genericIndex}`;
      genericIndex += 1;
    }
  }
}

export function bestBusCapacity(passengers: number, capacities: readonly number[]): number | null {
  if (!passengers || passengers <= 0) return capacities[0] ?? null;
  return capacities.find((capacity) => capacity >= passengers) ?? null;
}

export function reservationPointKey(reservation: Reserva): string {
  const pointId = reservation.Id_Punto
    ?? reservation.idPunto
    ?? reservation.IdPunto;

  if (pointId !== null && pointId !== undefined && String(pointId).trim() !== '') {
    return `punto-${pointId}`;
  }

  const name = String(
    reservation.NombrePunto
    || reservation.PuntoEncuentro
    || 'SIN_PUNTO'
  ).trim().toUpperCase();

  return `nombre-${name}`;
}

export function groupProgramacionStops(
  reservations: Reserva[],
  preferredOrder?: string[],
): ProgramacionViewStop[] {
  const stopsByKey = new Map<string, ProgramacionViewStop>();
  const appearanceOrder: string[] = [];

  for (const reservation of reservations) {
    const points: Array<{
      Id_Punto: number | string | null;
      NombrePunto: string;
      Latitud: number | string | null;
      Longitud: number | string | null;
      ruta: string | null;
      ordenRuta: number | null;
      pasajeros: number;
    }> = (reservation as any).puntosReserva?.length
      ? (reservation as any).puntosReserva
      : [{
          Id_Punto: reservation.Id_Punto ?? reservation.idPunto ?? reservation.IdPunto ?? null,
          NombrePunto: String(reservation.NombrePunto || reservation.PuntoEncuentro || 'Sin punto').trim() || 'Sin punto',
          Latitud: reservation.Latitud ?? null,
          Longitud: reservation.Longitud ?? null,
          ruta: reservation.ruta ?? null,
          ordenRuta: reservation.Orden_Ruta ?? reservation.ordenRuta ?? null,
          pasajeros: reservation.NumeroPasajeros || 0,
        }];

    for (const point of points) {
      const pointId = point.Id_Punto;
      const key = pointId !== null && pointId !== undefined && String(pointId).trim() !== ''
        ? `punto-${pointId}`
        : `nombre-${String(point.NombrePunto || 'SIN_PUNTO').trim().toUpperCase()}`;

      if (!stopsByKey.has(key)) {
        stopsByKey.set(key, {
          key,
          Id_Punto: point.Id_Punto ?? null,
          NombrePunto: point.NombrePunto || 'Sin punto',
          reservas: [],
          totalPax: 0,
          ruta: point.ruta ?? (point as any).Ruta ?? reservation.ruta ?? null,
          ordenRuta: point.ordenRuta ?? null,
          Latitud: point.Latitud ?? null,
          Longitud: point.Longitud ?? null,
        });
        appearanceOrder.push(key);
      }

      const stop = stopsByKey.get(key)!;
      stop.reservas.push({
        ...reservation,
        __paxEnEstePunto: point.pasajeros,
      } as Reserva & { __paxEnEstePunto: number });
      stop.totalPax += point.pasajeros;
    }
  }

  const stops = Array.from(stopsByKey.values());
  const rank = new Map(
    (preferredOrder?.length ? preferredOrder : appearanceOrder)
      .map((key, index) => [key, index]),
  );

  return stops.sort((a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER));
}
