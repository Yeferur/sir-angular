const { obtenerPuntos, obtenerPuntosQuery, obtenerRutasPuntos, obtenerPuntosPorRuta, obtenerHorario, obtenerHorariosPorPunto, obtenerPuntosPorDireccion, validarCoordenadasOSRM, validarOperatividadRuta, crearPunto, obtenerPuntoPorId, actualizarPunto, eliminarPunto, actualizarOrdenPuntosRuta } = require('../../services/Puntos/puntos.service');
const ExcelJS = require('exceljs');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.exportarPuntosExcel = async (req, res) => {
  const q = req.query.q || '';
  const ruta = req.query.ruta || '';
  try {
    const result = await obtenerPuntos({ page: 1, limit: 10000, q, ruta, allowLargeLimit: true });
    const puntos = result.rows || [];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Puntos de Encuentro');

    worksheet.columns = [
      { header: 'Nombre del Punto', key: 'nombre', width: 40 },
      { header: 'Sector', key: 'sector', width: 25 },
      { header: 'Dirección', key: 'direccion', width: 45 },
      { header: 'Ruta', key: 'ruta', width: 20 }
    ];

    puntos.forEach(p => {
      worksheet.addRow({
        nombre: p.Nombre_Punto || p.NombrePunto,
        sector: p.Sector || '',
        direccion: p.Direccion || '',
        ruta: p.ruta || 'PENDIENTE'
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Puntos_Encuentro.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error al exportar puntos a Excel:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'EXPORT_FAILED' });
  }
};

exports.getPuntos = async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  const q = req.query.q || '';
  const ruta = req.query.ruta || '';

  try {
    const result = await obtenerPuntos({ page, limit, q, ruta });
    return sendSuccess(res, {
      data: {
        data: result.rows,
        total: result.total,
        page: result.page,
        limit: result.limit
      },
      message: 'Puntos obtenidos correctamente'
    });
  } catch (error) {
    console.error('Error al obtener puntos:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getPuntosQuery = async (req, res) => {
  const query = req.query.query || "";
  try {
    const puntos = await obtenerPuntosQuery(query);
    return sendSuccess(res, { data: puntos, message: 'Puntos obtenidos correctamente' });
  } catch (error) {
    console.error('Error al obtener puntos:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getRutasPuntos = async (req, res) => {
  try {
    const rutas = await obtenerRutasPuntos();
    return sendSuccess(res, { data: rutas, message: 'Rutas obtenidas correctamente' });
  } catch (error) {
    console.error('Error al obtener rutas de puntos:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getPuntosByRuta = async (req, res) => {
  const ruta = req.params.ruta || req.query.ruta;
  if (!ruta || !String(ruta).trim()) {
    return sendError(res, { status: 400, message: 'Ruta es requerida', errorCode: 'MISSING_PARAMS' });
  }

  try {
    const puntos = await obtenerPuntosPorRuta(ruta);
    return sendSuccess(res, { data: puntos, message: 'Puntos por ruta obtenidos correctamente' });
  } catch (error) {
    console.error('Error al obtener puntos por ruta:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.updateOrdenPuntosByRuta = async (req, res) => {
  const ruta = req.params.ruta;
  const orden = req.body?.orden;

  if (!ruta || !String(ruta).trim()) {
    return sendError(res, { status: 400, message: 'Ruta es requerida', errorCode: 'MISSING_PARAMS' });
  }

  if (!Array.isArray(orden) || !orden.length) {
    return sendError(res, {
      status: 400,
      message: 'Debes enviar un array "orden" con elementos { id_punto, posicion }.',
      errorCode: 'BAD_REQUEST'
    });
  }

  try {
    const userId = req.user?.id || null;
    const result = await actualizarOrdenPuntosRuta(ruta, orden, userId);
    return sendSuccess(res, { data: result, message: 'Orden de puntos actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar orden de puntos:', error);
    return sendError(res, {
      status: error?.statusCode || 400,
      message: error?.message || 'No fue posible actualizar el orden de puntos.',
      errorCode: error?.errorCode || 'BAD_REQUEST'
    });
  }
};

exports.getPuntosByDireccion = async (req, res) => {
  const direccion = req.query.direccion || '';
  try {
    const puntos = await obtenerPuntosPorDireccion(direccion);
    return sendSuccess(res, { data: puntos, message: 'Puntos obtenidos correctamente' });
  } catch (error) {
    console.error('Error al buscar punto por direccion:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getHorario = async (req, res) => {
  const { Id_Punto, Id_Tour } = req.query;
  if (!Id_Punto || !Id_Tour) {
    return sendError(res, {
      status: 400,
      message: 'Id_Punto e Id_Tour son requeridos.',
      errorCode: 'MISSING_PARAMS'
    });
  }
  try {
    const horario = await obtenerHorario(Id_Punto, Id_Tour);
    return sendSuccess(res, { data: horario, message: 'Horario obtenido correctamente' });
  } catch (error) {
    console.error('Error al obtener horario:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getHorariosPorPunto = async (req, res) => {
  const Id_Punto = req.query.Id_Punto;
  if (!Id_Punto) return sendError(res, { status: 400, message: 'Id_Punto es requerido', errorCode: 'MISSING_PARAMS' });
  try {
    const horarios = await obtenerHorariosPorPunto(Id_Punto);
    return sendSuccess(res, { data: horarios, message: 'Horarios obtenidos correctamente' });
  } catch (error) {
    console.error('Error al obtener horarios por punto:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.createPunto = async (req, res) => {
  const { NombrePunto, Nombre_Punto, Sector, Direccion, Latitud, Longitud } = req.body || {};
  const nombre = NombrePunto || Nombre_Punto;
  if (!nombre || String(nombre).trim().length === 0) {
    return sendError(res, { status: 400, message: 'Nombre del punto es requerido', errorCode: 'MISSING_PARAMS' });
  }
  if (!String(Sector || '').trim() || !String(Direccion || '').trim()) {
    return sendError(res, {
      status: 400,
      message: 'El sector y la dirección son obligatorios.',
      errorCode: 'MISSING_PARAMS'
    });
  }
  if (!Array.isArray(req.body?.horarios) || req.body.horarios.length === 0) {
    return sendError(res, {
      status: 400,
      message: 'El punto debe crearse con los horarios de los tours.',
      errorCode: 'HORARIOS_REQUIRED'
    });
  }

  const payload = {
    Nombre_Punto: nombre,
    Sector: Sector || null,
    Direccion: Direccion || null,
    Latitud: Latitud ?? null,
    Longitud: Longitud ?? null,
    ruta: req.body?.ruta,
    Id_Punto_Anterior: req.body?.Id_Punto_Anterior ?? null,
    horarios: Array.isArray(req.body?.horarios) ? req.body.horarios : []
  };

  try {
    const userId = req.user?.id || null;
    await validarCoordenadasOSRM(payload.Latitud, payload.Longitud);
    const result = await crearPunto(payload, userId);
    return sendSuccess(res, { data: result, message: 'Punto creado correctamente', status: 201 });
  } catch (error) {
    console.error('Error al crear punto:', error);
    return sendError(res, {
      status: error?.statusCode || 500,
      message: error?.message || 'Error interno del servidor',
      errorCode: error?.errorCode || 'INTERNAL_ERROR',
      details: error?.details || null
    });
  }
};

exports.getOperatividadPuntosByRuta = async (req, res) => {
  const ruta = req.params.ruta;
  try {
    const data = await validarOperatividadRuta(ruta);
    return sendSuccess(res, { data, message: 'Operatividad de puntos validada correctamente' });
  } catch (error) {
    return sendError(res, {
      status: error?.statusCode || 500,
      message: error?.message || 'No fue posible validar la operatividad de la ruta.',
      errorCode: error?.errorCode || 'OPERATIVIDAD_FAILED'
    });
  }
};

exports.validarCoordenadasPunto = async (req, res) => {
  try {
    const data = await validarCoordenadasOSRM(req.body?.Latitud, req.body?.Longitud);
    return sendSuccess(res, { data, message: 'Coordenadas validadas correctamente' });
  } catch (error) {
    return sendError(res, {
      status: error?.statusCode || 422,
      message: error?.message || 'Las coordenadas no son operativas.',
      errorCode: error?.errorCode || 'COORDENADAS_NO_OPERATIVAS'
    });
  }
};

exports.getPuntoById = async (req, res) => {
  const id = req.params.id;
  try {
    const punto = await obtenerPuntoPorId(id);
    if (!punto) return sendError(res, { status: 404, message: 'Punto no encontrado', errorCode: 'NOT_FOUND' });
    return sendSuccess(res, { data: punto, message: 'Punto obtenido correctamente' });
  } catch (err) {
    console.error('Error al obtener punto por id:', err);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.updatePunto = async (req, res) => {
  const id = req.params.id;
  try {
    const userId = req.user?.id || null;
    const payload = req.body || {};
    const nombre = payload.NombrePunto || payload.Nombre_Punto;
    if (!String(nombre || '').trim() || !String(payload.Sector || '').trim() || !String(payload.Direccion || '').trim()) {
      return sendError(res, {
        status: 400,
        message: 'El nombre, el sector y la dirección son obligatorios.',
        errorCode: 'MISSING_PARAMS'
      });
    }
    if (!Array.isArray(payload.horarios) || payload.horarios.length === 0) {
      return sendError(res, {
        status: 400,
        message: 'El punto debe conservar los horarios de los tours.',
        errorCode: 'HORARIOS_REQUIRED'
      });
    }
    await validarCoordenadasOSRM(payload.Latitud, payload.Longitud);
    await actualizarPunto(id, payload, userId);
    return sendSuccess(res, { data: null, message: 'Punto actualizado correctamente' });
  } catch (err) {
    console.error('Error al actualizar punto:', err);
    return sendError(res, {
      status: err?.statusCode || 500,
      message: err?.message || 'Error interno del servidor',
      errorCode: err?.errorCode || 'INTERNAL_ERROR'
    });
  }
};

exports.deletePunto = async (req, res) => {
  const id = req.params.id;
  try {
    const userId = req.user?.id || null;
    const data = await eliminarPunto(id, userId);
    return sendSuccess(res, {
      data,
      message: data?.accion === 'DESACTIVADO'
        ? 'El punto se desactivó porque tiene reservas asociadas.'
        : 'Punto eliminado definitivamente.'
    });
  } catch (err) {
    console.error('Error al eliminar punto:', err);
    return sendError(res, {
      status: err?.statusCode || 500,
      message: err?.message || 'Error interno del servidor',
      errorCode: err?.errorCode || 'INTERNAL_ERROR'
    });
  }
};
