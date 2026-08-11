const turnosService = require('../../services/Turnos/turnos.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.obtenerSemana = async (req, res) => {
  try {
    const resultado = await turnosService.listWeekSchedule(req.query?.fecha, req.user?.id);
    return sendSuccess(res, {
      data: { ...resultado, horaSalidaMaxima: turnosService.MAX_END_TIME, pasoMinutos: turnosService.SCHEDULE_STEP_MINUTES },
      message: 'Semana de turnos obtenida correctamente',
    });
  } catch (error) {
    console.error('obtenerSemana turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo consultar la semana de turnos.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.obtenerCanales = async (_req, res) => {
  try {
    const canales = await turnosService.listCanales();
    return sendSuccess(res, { data: { canales }, message: 'Canales de turno obtenidos correctamente' });
  } catch (error) {
    console.error('obtenerCanales turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudieron consultar los canales.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.obtenerHistorial = async (_req, res) => {
  try {
    const semanas = await turnosService.listWeekHistory();
    return sendSuccess(res, { data: { semanas }, message: 'Historial de turnos obtenido correctamente' });
  } catch (error) {
    console.error('obtenerHistorial turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo consultar el historial de turnos.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.obtenerMiJornada = async (req, res) => {
  try {
    const jornada = await turnosService.getAdvisorWeekSchedule(req.user?.id, req.query?.fecha);
    if (!jornada) {
      return sendError(res, {
        status: 403,
        message: 'La jornada personal está disponible únicamente para usuarios con rol Asesor.',
        errorCode: 'ADVISOR_ONLY',
      });
    }
    if (jornada.noPublicada) {
      return sendError(res, {
        status: 404,
        message: 'Tu horario de esta semana todavía no ha sido publicado.',
        errorCode: 'WEEK_NOT_PUBLISHED',
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

exports.actualizarAsesorSemana = async (req, res) => {
  try {
    const result = await turnosService.replaceAdvisorWeek(
      req.params.idSemana,
      req.params.idUsuario,
      { turnos: req.body?.turnos, esSupernumerario: req.body?.esSupernumerario },
      req.user?.id
    );
    return sendSuccess(res, { data: result, message: 'Jornada actualizada correctamente' });
  } catch (error) {
    const knownErrors = new Set([
      'INVALID_ADVISOR', 'ADVISOR_NOT_FOUND', 'WEEK_NOT_FOUND', 'WEEK_ROWS_MISSING', 'INVALID_SCHEDULE',
      'INVALID_SCHEDULE_DAY', 'INVALID_SCHEDULE_TIME', 'INVALID_SCHEDULE_STEP', 'INVALID_SCHEDULE_RANGE', 'SCHEDULE_AFTER_11PM',
    ]);
    if (knownErrors.has(error.code)) {
      return sendError(res, { status: error.code === 'ADVISOR_NOT_FOUND' || error.code === 'WEEK_NOT_FOUND' ? 404 : 400, message: error.message, errorCode: error.code });
    }
    console.error('actualizarAsesorSemana turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo actualizar la jornada.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.copiarSemanaAnterior = async (req, res) => {
  try {
    const result = await turnosService.copyWeekFrom(req.params.idSemana, req.user?.id);
    return sendSuccess(res, { data: result, message: 'Semana anterior copiada correctamente' });
  } catch (error) {
    if (error.code === 'WEEK_NOT_FOUND' || error.code === 'PREVIOUS_WEEK_NOT_FOUND') {
      return sendError(res, { status: 404, message: error.message, errorCode: error.code });
    }
    console.error('copiarSemanaAnterior turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo copiar la semana anterior.', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.publicarSemana = async (req, res) => {
  try {
    const result = await turnosService.publishWeek(
      req.params.idSemana,
      req.body?.jornadas,
      req.body?.aceptarAdvertencias,
      req.user?.id
    );
    return sendSuccess(res, { data: result, message: 'Semana publicada correctamente' });
  } catch (error) {
    if (error.code === 'SCHEDULE_WARNINGS') {
      return sendError(res, {
        status: 409,
        message: error.message,
        errorCode: error.code,
        details: { advertencias: error.advertencias || [] },
      });
    }
    if (['INVALID_WEEK_PAYLOAD', 'WEEK_ROWS_MISSING', 'INVALID_SCHEDULE', 'INVALID_SCHEDULE_DAY',
      'INVALID_SCHEDULE_TIME', 'INVALID_SCHEDULE_STEP', 'INVALID_SCHEDULE_RANGE',
      'SCHEDULE_AFTER_11PM', 'INVALID_VACATION', 'VACATION_OVERLAP',
      'INVALID_WEEK_CHANNEL'].includes(error.code)) {
      return sendError(res, { status: 400, message: error.message, errorCode: error.code });
    }
    if (error.code === 'WEEK_NOT_FOUND') {
      return sendError(res, { status: 404, message: error.message, errorCode: error.code });
    }
    console.error('publicarSemana turnos error:', error);
    return sendError(res, { status: 500, message: 'No se pudo publicar la semana.', errorCode: 'INTERNAL_ERROR' });
  }
};
