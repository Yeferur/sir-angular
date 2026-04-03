const { calcularRutaEntrePuntos } = require('../../services/Programacion/rutas.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.getRutas = async(req, res) => {
 try {
    const { puntos, destino } = req.body;
    console.log(puntos);
    if (!Array.isArray(puntos) || puntos.length < 2) {
      return sendError(res, { status: 400, message: 'Debe enviar al menos 2 puntos validos.', errorCode: 'BAD_REQUEST' });
    }
    const ruta = await calcularRutaEntrePuntos(puntos, destino);
    return sendSuccess(res, { data: { ruta }, message: 'Ruta generada correctamente' });
  } catch (err) {
    console.error('Error generando ruta:', err);
    return sendError(res, { status: 500, message: 'Error generando ruta', errorCode: 'INTERNAL_ERROR' });
  }
}

