function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const RESERVATION_CODE_PATTERN = /\b([A-Z]{1,5}-?\d{3,10})\b/i;

function normalizeReservationCode(rawValue) {
  return String(rawValue || '')
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function canonicalReservationCode(rawValue) {
  return normalizeReservationCode(rawValue).replace(/-/g, '');
}

function extractReservationCodeCandidate(message) {
  const rawMessage = String(message || '').trim();
  if (!rawMessage) return null;

  const normalizedMessage = rawMessage.replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalizedMessage.match(RESERVATION_CODE_PATTERN);
  if (!match) return null;

  const originalCode = normalizeReservationCode(match[1]);
  const canonicalCode = canonicalReservationCode(match[1]);

  if (!/[A-Z]/.test(canonicalCode) || !/\d/.test(canonicalCode)) {
    return null;
  }

  return {
    original: originalCode,
    canonical: canonicalCode,
  };
}

module.exports = {
  RESERVATION_CODE_PATTERN,
  canonicalReservationCode,
  extractReservationCodeCandidate,
  normalizeReservationCode,
  normalizeText,
};
