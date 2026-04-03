function sendSuccess(res, { data = null, message = 'OK', status = 200 } = {}) {
  return res.status(status).json({ success: true, data, message });
}

function sendError(
  res,
  {
    status = 500,
    message = 'Error interno del servidor',
    errorCode = 'INTERNAL_ERROR',
    details = null,
  } = {}
) {
  const payload = { success: false, data: null, message, errorCode };
  if (details) payload.details = details;
  return res.status(status).json(payload);
}

module.exports = {
  sendSuccess,
  sendError,
};
