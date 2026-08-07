const turnosService = require('../../services/Turnos/turnos.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.listarAsesores = async (_req, res) => {
  try {
    const asesores = await turnosService.listAdvisorsWithSchedules();
    return sendSuccess(res, {
      data: { asesores, zonaHoraria: turnosService.BOGOTA_TIME_ZONE, horaSalidaMaxima: turnosService.MAX_END_TIME },
      message: 'Jornadas de asesores obtenidas correctamente',
    });
  } catch (error) {
    console.error('listarAsesores turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudieron consultar las jornadas.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.obtenerMiJornada = async (req, res) => {
  try {
    const jornada = await turnosService.getAdvisorSchedule(req.user?.id);
    if (!jornada) {
      return sendError(res, {
        status: 403,
        message: 'La jornada personal está disponible únicamente para usuarios con rol Asesor.',
        errorCode: 'ADVISOR_ONLY',
      });
    }
    return sendSuccess(res, {
      data: { jornada, zonaHoraria: turnosService.BOGOTA_TIME_ZONE, horaSalidaMaxima: turnosService.MAX_END_TIME },
      message: 'Jornada personal obtenida correctamente',
    });
  } catch (error) {
    console.error('obtenerMiJornada turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo consultar tu jornada.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.actualizarJornada = async (req, res) => {
  try {
    const result = await turnosService.replaceAdvisorSchedule(req.params.id, req.body?.turnos, req.user?.id);
    return sendSuccess(res, { data: result, message: 'Jornada actualizada correctamente' });
  } catch (error) {
    const knownErrors = new Set([
      'INVALID_ADVISOR', 'ADVISOR_NOT_FOUND', 'INVALID_SCHEDULE', 'INVALID_SCHEDULE_DAY',
      'INVALID_SCHEDULE_TIME', 'INVALID_SCHEDULE_RANGE', 'SCHEDULE_AFTER_11PM',
    ]);
    if (knownErrors.has(error.code)) {
      return sendError(res, { status: error.code === 'ADVISOR_NOT_FOUND' ? 404 : 400, message: error.message, errorCode: error.code });
    }
    console.error('actualizarJornada turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo actualizar la jornada.', errorCode: 'INTERNAL_ERROR' });
  }
};
