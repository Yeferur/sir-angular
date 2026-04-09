const { obtenerPuntos, obtenerPuntosQuery, obtenerRutasPuntos, obtenerPuntosPorRuta, obtenerHorario, obtenerHorariosPorPunto, obtenerPuntosPorDireccion, crearPunto, crearHorariosParaPunto, obtenerPuntoPorId, actualizarPunto, eliminarPunto, actualizarOrdenPuntosRuta } = require('../../services/Puntos/puntos.service');
const ExcelJS = require('exceljs');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

exports.exportarPuntosExcel = async (req, res) => {
  const q = req.query.q || '';
  try {
    const result = await obtenerPuntos({ page: 1, limit: 10000, q });
    const puntos = result.rows || [];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Puntos de Encuentro');

    worksheet.columns = [
      { header: 'ID del Punto', key: 'id', width: 15 },
      { header: 'Nombre del Punto', key: 'nombre', width: 40 },
      { header: 'Ruta', key: 'ruta', width: 20 },
      { header: 'Posición', key: 'posicion', width: 15 }
    ];

    puntos.forEach(p => {
      worksheet.addRow({
        id: p.Id_Punto,
        nombre: p.Nombre_Punto || p.NombrePunto,
        ruta: p.ruta || 'PENDIENTE',
        posicion: p.posicion !== undefined ? p.posicion : ''
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

  try {
    const result = await obtenerPuntos({ page, limit, q });
    return sendSuccess(res, { data: { data: result.rows, total: result.total }, message: 'Puntos obtenidos correctamente' });
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
      status: 400,
      message: error?.message || 'No fue posible actualizar el orden de puntos.',
      errorCode: 'BAD_REQUEST'
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
  console.log(Id_Punto, Id_Tour);
  try {
    const horario = await obtenerHorario(Id_Punto, Id_Tour);
    return sendSuccess(res, { data: horario, message: 'Horario obtenido correctamente' });
    console.log(horario);
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

  const payload = {
    Nombre_Punto: nombre,
    Sector: Sector || null,
    Direccion: Direccion || null,
    Latitud: Latitud ?? null,
    Longitud: Longitud ?? null
  };

  try {
    const userId = req.user?.id || null;
    const result = await crearPunto(payload, userId);
    const insertId = result.insertId;

    // Si el cliente envía horarios, insertarlos asociados al punto recién creado
    const horarios = Array.isArray(req.body.horarios) ? req.body.horarios : [];
    if (horarios.length) {
      try {
        await crearHorariosParaPunto(insertId, horarios, userId);
      } catch (err) {
        console.error('Error al crear horarios para punto:', err);
      }
    }

    return sendSuccess(res, { data: { insertId }, message: 'Punto creado correctamente', status: 201 });
  } catch (error) {
    console.error('Error al crear punto:', error);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
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
    await actualizarPunto(id, payload, userId);
    return sendSuccess(res, { data: null, message: 'Punto actualizado correctamente' });
  } catch (err) {
    console.error('Error al actualizar punto:', err);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.deletePunto = async (req, res) => {
  const id = req.params.id;
  try {
    const userId = req.user?.id || null;
    await eliminarPunto(id, userId);
    return sendSuccess(res, { data: null, message: 'Punto eliminado correctamente' });
  } catch (err) {
    console.error('Error al eliminar punto:', err);
    return sendError(res, { status: 500, message: 'Error interno del servidor', errorCode: 'INTERNAL_ERROR' });
  }
};
