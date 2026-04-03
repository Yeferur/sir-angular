const phoneService = require('../services/phone.service');
const { sendSuccess, sendError } = require('../utils/responseEnvelope');

exports.checkWhatsApp = async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return sendError(res, {
      status: 400,
      message: 'phone required',
      errorCode: 'MISSING_PARAMS',
    });
  }

  try {
    const result = await phoneService.checkWhatsApp(phone);
    return sendSuccess(res, { data: result, message: 'Telefono validado correctamente' });
  } catch (err) {
    console.error('checkWhatsApp error', err);
    return sendError(res, {
      status: err.status || 500,
      message: err.message || 'internal',
      errorCode: 'INTERNAL_ERROR',
    });
  }
};
