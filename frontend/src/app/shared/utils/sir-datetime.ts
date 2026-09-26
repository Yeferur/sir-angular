export const SIR_TIME_ZONE = 'America/Bogota';

function partsInSirTimeZone(date: Date): Record<string, string> {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SIR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
}

export function toSirLocalDateTime(date: Date): string {
  const parts = partsInSirTimeZone(date);
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}

export function sirLocalDateTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null;
  const date = new Date(`${value}:00-05:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function sirToday(date = new Date()): string {
  return toSirLocalDateTime(date).slice(0, 10);
}

/** Devuelve el siguiente minuto completo en la zona operativa de SIR. */
export function nextSirMinute(date = new Date()): string {
  const next = new Date(date.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return toSirLocalDateTime(next);
}

export function nextSirTime(step = 5, date = new Date()): string {
  const next = new Date(date.getTime() + step * 60_000);
  next.setUTCSeconds(0, 0);
  if (sirToday(next) !== sirToday(date)) return '23:59';
  const local = toSirLocalDateTime(next);
  const [hours, minutes] = local.slice(11).split(':').map(Number);
  const rounded = Math.ceil((hours * 60 + minutes) / step) * step;
  return `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

export function isFutureSirDateTime(value: string, now = new Date()): boolean {
  const iso = sirLocalDateTimeToIso(value);
  return !!iso && new Date(iso).getTime() > now.getTime();
}
