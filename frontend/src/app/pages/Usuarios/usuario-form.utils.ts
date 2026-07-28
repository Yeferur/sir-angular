export interface PasswordStrength {
  score: number;
  label: 'Sin cambio' | 'Débil' | 'Media' | 'Fuerte';
  checks: {
    length8: boolean;
    lower: boolean;
    upper: boolean;
    digit: boolean;
    symbol: boolean;
    length12: boolean;
  };
}

export const USER_PHONE_REGEX = /^[0-9]{7,15}$/;

export function normalizeUserName(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('es-CO');
}

export function evaluateUserPassword(passwordValue: unknown, emptyLabel = false): PasswordStrength {
  const password = String(passwordValue || '');
  const checks = {
    length8: password.length >= 8,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    length12: password.length >= 12,
  };
  const score = Object.values(checks).filter(Boolean).length;

  let label: PasswordStrength['label'] = 'Débil';
  if (!password && emptyLabel) label = 'Sin cambio';
  else if (score >= 5) label = 'Fuerte';
  else if (score >= 3) label = 'Media';

  return { score, label, checks };
}

export function isUserPasswordStrong(passwordValue: unknown): boolean {
  const checks = evaluateUserPassword(passwordValue).checks;
  return checks.length8 && checks.lower && checks.upper && checks.digit && checks.symbol;
}
