type TourDisponibilidadLike = {
  Modo?: string;
  Modo_Disponibilidad?: string;
  Dias_Base?: unknown[];
  diasBase?: unknown;
  Temporadas?: unknown[];
  temporadas?: unknown[];
};

function normalizeDay(value: unknown): number | null {
  const raw = String(value ?? '').trim().toLowerCase();
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

  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

export function isTourDateAvailable(dateOnly: string, tour: TourDisponibilidadLike | null | undefined): boolean {
  const ymd = toDateOnly(dateOnly);
  if (!ymd || !tour) return false;

  const weekDay = getDayFromDateOnly(ymd);
  if (!Number.isFinite(weekDay)) return false;

  const modoRaw = String(tour.Modo ?? tour.Modo_Disponibilidad ?? 'TODO_EL_ANO')
    .trim()
    .toUpperCase()
    .replace(/Ñ/g, 'N')
    .replace(/Á/g, 'A')
    .replace(/É/g, 'E')
    .replace(/Í/g, 'I')
    .replace(/Ó/g, 'O')
    .replace(/Ú/g, 'U');

  const diasBase = Array.isArray(tour.Dias_Base)
    ? tour.Dias_Base
    : Array.isArray(tour.diasBase)
      ? Object.values(tour.diasBase as unknown as object).filter(Boolean)
      : [];

  const diasBaseSet = new Set<number>();
  for (const dia of diasBase) {
    const normalized = normalizeDay(dia);
    if (normalized !== null) diasBaseSet.add(normalized);
  }

  const temporadasRaw = Array.isArray(tour.Temporadas)
    ? tour.Temporadas
    : Array.isArray(tour.temporadas)
      ? tour.temporadas
      : [];

  const cumpleTemporada = temporadasRaw.some((temp: any) => {
    const inicio = toDateOnly(temp?.Fecha_Inicio);
    const fin = toDateOnly(temp?.Fecha_Fin);
    if (!inicio || !fin) return false;
    if (ymd < inicio || ymd > fin) return false;

    const diasTemporada = Array.isArray(temp?.Dias) ? temp.Dias : Array.isArray(temp?.dias) ? temp.dias : [];
    const diasTemporadaSet = new Set<number>();
    for (const dia of diasTemporada) {
      const normalized = normalizeDay(dia);
      if (normalized !== null) diasTemporadaSet.add(normalized);
    }
    return diasTemporadaSet.has(weekDay);
  });

  const cumpleDiaNormal = diasBaseSet.has(weekDay);
  if (modoRaw === 'SOLO_TEMPORADAS') return cumpleTemporada;
  return cumpleDiaNormal || cumpleTemporada;
}

export const toCalendarYmd = toDateOnly;
