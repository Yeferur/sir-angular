function denyClientAccess(req, res, next) {
  if (!req.user?.isClient) return next();
  return res.status(403).json({
    success: false,
    data: null,
    message: 'Este módulo no está disponible para el rol Cliente.',
    error: 'Este módulo no está disponible para el rol Cliente.',
    errorCode: 'CLIENT_MODULE_FORBIDDEN',
  });
}

module.exports = { denyClientAccess };
