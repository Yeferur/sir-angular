const service = require('../../services/Turnos/turnos-intercambios.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function handle(res, error, fallback) {
  const known = ['INVALID_DATE','INVALID_REQUEST','ADVISOR_SHIFT_NOT_FOUND','WEEK_NOT_PUBLISHED','WORK_SHIFT_REQUIRED',
    'SHIFT_ALREADY_STARTED','CHANNEL_REQUIRED','DIFFERENT_CHANNEL','SAME_SHIFT','VACATION_CONFLICT','PENDING_EXCHANGE',
    'EXCHANGE_NOT_FOUND','NOT_RECIPIENT','EXCHANGE_ALREADY_RESOLVED','SHIFT_CHANGED','CANNOT_CANCEL'];
  if (known.includes(error.code)) return sendError(res, { status: error.code === 'EXCHANGE_NOT_FOUND' ? 404 : 409, message: error.message, errorCode: error.code });
  console.error('turnos intercambio:', error); return sendError(res, { status: 500, message: fallback });
}
exports.candidates = async (req,res) => { try { return sendSuccess(res,{data:{asesores:await service.listCandidates(req.user.id,req.query.fecha)}}); } catch(e){return handle(res,e,'No se pudieron consultar los asesores.');} };
exports.listMine = async (req,res) => { try { return sendSuccess(res,{data:{intercambios:await service.listMine(req.user.id)}}); } catch(e){return handle(res,e,'No se pudieron consultar las solicitudes.');} };
exports.create = async (req,res) => { try { return sendSuccess(res,{status:201,data:await service.createRequest(req.user.id,req.body),message:'Solicitud enviada correctamente'}); } catch(e){return handle(res,e,'No se pudo crear la solicitud.');} };
exports.respond = async (req,res) => { try { return sendSuccess(res,{data:await service.respond(req.user.id,req.params.id,req.body?.aceptar===true)}); } catch(e){return handle(res,e,'No se pudo responder la solicitud.');} };
exports.cancel = async (req,res) => { try { return sendSuccess(res,{data:await service.cancel(req.user.id,req.params.id)}); } catch(e){return handle(res,e,'No se pudo cancelar la solicitud.');} };
