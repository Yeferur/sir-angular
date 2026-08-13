const service = require('../../services/Notificaciones/notificaciones.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.listMine = async (req, res) => {
  try { return sendSuccess(res, { data: await service.listMine(req.user.id, req.query.limit) }); }
  catch (error) { console.error('notificaciones listMine:', error); return sendError(res, { status: 500, message: 'No se pudieron consultar las notificaciones.' }); }
};
exports.markRead = async (req, res) => {
  try {
    const found = await service.markRead(req.user.id, req.params.id);
    return found ? sendSuccess(res, { data: { leida: true } }) : sendError(res, { status: 404, message: 'Notificación no encontrada.' });
  } catch (error) { return sendError(res, { status: 500, message: 'No se pudo actualizar la notificación.' }); }
};
exports.markAllRead = async (req, res) => {
  try { await service.markAllRead(req.user.id); return sendSuccess(res, { data: { leidas: true } }); }
  catch (error) { return sendError(res, { status: 500, message: 'No se pudieron actualizar las notificaciones.' }); }
};
