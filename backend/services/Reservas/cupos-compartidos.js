// Single shared-seat policy. Private vehicles never consume the group inventory.
const CANCELLED_STATES = Object.freeze(['CANCELADA', 'CANCELADO', 'ANULADA', 'ANULADO']);
const SEATED_TYPES = Object.freeze(['ADULTO', 'NIÑO']);
const normalize = value => String(value ?? '').trim().toUpperCase();

function normalizePassengerType(value) {
  const type = normalize(value);
  return type === 'NINO' ? 'NIÑO' : type;
}

function seatWeight(value) {
  return SEATED_TYPES.includes(normalizePassengerType(value)) ? 1 : 0;
}

function sharedSeatsForPassengers(passengers = []) {
  return passengers.reduce((sum, passenger) => sum + seatWeight(passenger?.Tipo_Pasajero), 0);
}

function reservationConsumesSharedSeats({ tipoReserva, estado, eliminadaEn = null } = {}) {
  return normalize(tipoReserva) === 'GRUPAL'
    && !CANCELLED_STATES.includes(normalize(estado))
    && !eliminadaEn;
}

function assertAlias(alias) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) throw new Error('Alias SQL de cupos inválido.');
  return alias;
}

function passengerSeatSql(alias = 'p') {
  const p = assertAlias(alias);
  // NINO is read only for compatibility with the unmigrated source database.
  return `CASE WHEN UPPER(TRIM(COALESCE(${p}.Tipo_Pasajero,''))) IN ('ADULTO','NIÑO','NINO') THEN 1 ELSE 0 END`;
}

function consumingReservationSql(alias = 'r', { softDelete = false } = {}) {
  const r = assertAlias(alias);
  return `UPPER(TRIM(COALESCE(${r}.Tipo_Reserva,'')))='GRUPAL' AND ${activeReservationSql(r, { softDelete })}`;
}

function activeReservationSql(alias = 'r', { softDelete = false } = {}) {
  const r = assertAlias(alias);
  return `UPPER(TRIM(COALESCE(${r}.Estado,''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO')
    ${softDelete ? `AND ${r}.Eliminada_En IS NULL` : ''}`;
}

module.exports = {
  CANCELLED_STATES, SEATED_TYPES, normalizePassengerType, seatWeight,
  sharedSeatsForPassengers, reservationConsumesSharedSeats,
  passengerSeatSql, consumingReservationSql,
  activeReservationSql,
};
