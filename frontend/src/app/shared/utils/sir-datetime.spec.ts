import { isFutureSirDateTime, nextSirMinute, sirLocalDateTimeToIso, toSirLocalDateTime } from './sir-datetime';

describe('Fecha y hora operativa de SIR', () => {
  it('convierte explícitamente entre Bogotá y UTC', () => {
    expect(sirLocalDateTimeToIso('2099-10-15T12:30')).toBe('2099-10-15T17:30:00.000Z');
    expect(toSirLocalDateTime(new Date('2099-10-15T17:30:00.000Z'))).toBe('2099-10-15T12:30');
  });

  it('rechaza valores incompletos y fechas vencidas', () => {
    expect(sirLocalDateTimeToIso('2099-10-15T')).toBeNull();
    expect(isFutureSirDateTime('2000-01-01T08:00')).toBeFalse();
  });

  it('acepta minutos arbitrarios y un futuro inmediato', () => {
    const now = new Date('2026-09-26T20:00:30.000Z'); // 3:00:30 p. m. en Bogotá
    expect(isFutureSirDateTime('2026-09-26T15:01', now)).toBeTrue();
    expect(isFutureSirDateTime('2026-09-26T15:08', now)).toBeTrue();
    expect(isFutureSirDateTime('2026-09-26T15:00', now)).toBeFalse();
  });

  it('permite cualquier hora válida en una fecha futura', () => {
    const now = new Date('2026-09-26T20:00:30.000Z');
    expect(isFutureSirDateTime('2026-09-27T00:01', now)).toBeTrue();
    expect(isFutureSirDateTime('2026-09-27T23:59', now)).toBeTrue();
  });

  it('propone el siguiente minuto completo incluso al cambiar de día', () => {
    expect(nextSirMinute(new Date('2026-09-26T20:03:24.000Z'))).toBe('2026-09-26T15:04');
    expect(nextSirMinute(new Date('2026-09-27T04:59:45.000Z'))).toBe('2026-09-27T00:00');
  });
});
