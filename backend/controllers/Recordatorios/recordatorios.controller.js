const service = require('../../services/Recordatorios/recordatorios.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function handleError(res, error, fallback) {
  if (error instanceof service.ReminderOperationError) {
    return sendError(res, { status: error.status, message: error.message, errorCode: error.code });
  }
  console.error(fallback, error);
  return sendError(res, { status: 500, message: fallback });
}

exports.listMine = async (req, res) => {
  try {
    const includeCompleted = String(req.query.incluirCompletados || 'false') === 'true';
    const reminders = await service.listMine(req.user.id, { includeCompleted });
    return sendSuccess(res, { data: { recordatorios: reminders, total: reminders.length } });
  } catch (error) { return handleError(res, error, 'No se pudieron consultar los recordatorios.'); }
};

exports.create = async (req, res) => {
  try {
    const reminder = await service.create(req.user.id, req.body || {});
    return sendSuccess(res, { data: reminder, message: 'Recordatorio creado.', status: 201 });
  } catch (error) { return handleError(res, error, 'No se pudo crear el recordatorio.'); }
};

exports.update = async (req, res) => {
  try {
    const reminder = await service.update(req.user.id, req.params.id, req.body || {});
    return sendSuccess(res, { data: reminder, message: 'Recordatorio actualizado.' });
  } catch (error) { return handleError(res, error, 'No se pudo actualizar el recordatorio.'); }
};

exports.postpone = async (req, res) => {
  try {
    const reminder = await service.postpone(req.user.id, req.params.id, req.body?.suprimidoHasta);
    return sendSuccess(res, { data: reminder, message: 'Recordatorio pospuesto.' });
  } catch (error) { return handleError(res, error, 'No se pudo posponer el recordatorio.'); }
};

exports.complete = async (req, res) => {
  try {
    const reminder = await service.complete(req.user.id, req.params.id);
    return sendSuccess(res, { data: reminder, message: 'Recordatorio completado.' });
  } catch (error) { return handleError(res, error, 'No se pudo completar el recordatorio.'); }
};

exports.remove = async (req, res) => {
  try {
    await service.remove(req.user.id, req.params.id);
    return sendSuccess(res, { data: { eliminado: true }, message: 'Recordatorio eliminado.' });
  } catch (error) { return handleError(res, error, 'No se pudo eliminar el recordatorio.'); }
};
