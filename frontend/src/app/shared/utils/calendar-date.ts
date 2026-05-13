type TourDisponibilidadLike = {
  Dias_Base?: unknown[];
  Temporadas?: unknown[];
};

function normalizeDayText(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDay(value: unknown): number | null {
  const raw = normalizeDayText(value);
  if (!raw) return null;
  switch (raw) {
    case '0':
    case 'domingo':
      return 0;
    case '1':
    case 'lunes':
      return 1;
    case '2':
    case 'martes':
      return 2;
    case '3':
    case 'miercoles':
    case 'miércoles':
      return 3;
    case '4':
    case 'jueves':
      return 4;
    case '5':
    case 'viernes':
      return 5;
    case '6':
    case 'sabado':
    case 'sábado':
      return 6;
    default:
      return null;
  }
}

export function toDateOnly(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const yyyy = input.getFullYear();
    const mm = String(input.getMonth() + 1).padStart(2, '0');
    const dd = String(input.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const text = String(input).trim();
  if (!text) return null;

  const ymd = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

export function getDayFromDateOnly(dateOnly: string): number {
  const ymd = toDateOnly(dateOnly);
  if (!ymd) return NaN;

  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return NaN;

  return new Date(year, month - 1, day).getDay();
}

export function isTourDateAvailable(dateOnly: string, tour: TourDisponibilidadLike | null | undefined): boolean {
  const ymd = toDateOnly(dateOnly);
  if (!ymd || !tour) return false;

  const weekDay = getDayFromDateOnly(ymd);
  if (!Number.isFinite(weekDay)) return false;

  const diasBase = Array.isArray(tour.Dias_Base)
    ? tour.Dias_Base
    : [];

  const diasBaseSet = new Set<string>();
  for (const dia of diasBase) {
    const normalized = normalizeDayText(dia);
    if (normalized) diasBaseSet.add(normalized);
  }

  const temporadasRaw = Array.isArray(tour.Temporadas)
    ? tour.Temporadas
    : [];

  const dayNameMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const dayName = dayNameMap[weekDay] || null;
  if (!dayName) return false;

  const cumpleDiaBase = diasBaseSet.has(dayName);

  const cumpleTemporada = temporadasRaw.some((temp: any) => {
    const inicio = toDateOnly(temp?.Fecha_Inicio);
    const fin = toDateOnly(temp?.Fecha_Fin);
    if (!inicio || !fin) return false;
    if (ymd < inicio || ymd > fin) return false;

    const diasTemporada = Array.isArray(temp?.Dias) ? temp.Dias : [];
    const diasTemporadaSet = new Set<string>();
    for (const dia of diasTemporada) {
      const normalized = normalizeDayText(dia);
      if (normalized) diasTemporadaSet.add(normalized);
    }

    return diasTemporadaSet.has(dayName);
  });

  return cumpleDiaBase || cumpleTemporada;
}

export const toCalendarYmd = toDateOnly;
