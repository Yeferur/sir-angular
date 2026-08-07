const CLIENT_ROLE_NAME = 'cliente';
const CLIENT_RESERVATION_PERMISSION_CODES = Object.freeze([
  'RESERVAS.LEER',
  'RESERVAS.CREAR',
  'RESERVAS.ACTUALIZAR',
]);

function normalizeRoleName(value) {
  return String(value || '').trim().toLocaleLowerCase('es-CO');
}

function isClientRoleName(value) {
  return normalizeRoleName(value) === CLIENT_ROLE_NAME;
}

function clientOwnerIdFromRequest(req) {
  if (!req?.user?.isClient) return null;
  const userId = Number(req.user.id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function createReservationNotFoundError() {
  const error = new Error('Reserva no encontrada');
  error.status = 404;
  error.errorCode = 'RESERVA_NOT_FOUND';
  return error;
}

function assertReservationOwner(reservation, ownerUserId) {
  if (ownerUserId == null) return;
  if (!reservation || Number(reservation.Creado_Por) !== Number(ownerUserId)) {
    // Se responde como inexistente para no confirmar que el identificador
    // pertenece a otro usuario.
    throw createReservationNotFoundError();
  }
}

module.exports = {
  CLIENT_RESERVATION_PERMISSION_CODES,
  isClientRoleName,
  clientOwnerIdFromRequest,
  createReservationNotFoundError,
  assertReservationOwner,
};
