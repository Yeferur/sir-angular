const listadoGeneral = require('../../services/Programacion/listado-general.service');
const { recordHistorial } = require('../../services/Historial/logger');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');

function reportError(res, error, fallback) {
  const status = Number(error?.statusCode || error?.status || 500);
  const message = status < 500 ? error.message : fallback;
  return sendError(res, {
    status,
    message,
    errorCode: status < 500 ? 'LISTADO_GENERAL_INVALID_FILTERS' : 'LISTADO_GENERAL_FAILED',
  });
}

exports.obtenerOpcionesListadoGeneralController = async (_req, res) => {
  try {
    const data = await listadoGeneral.obtenerOpcionesListadoGeneral();
    return sendSuccess(res, { data, message: 'Opciones del listado general obtenidas correctamente.' });
  } catch (error) {
    console.error('No se pudieron cargar las opciones del listado general:', error);
    return reportError(res, error, 'No se pudieron cargar las opciones del listado general.');
  }
};

exports.consultarListadoGeneralController = async (req, res) => {
  try {
    const data = await listadoGeneral.consultarListadoGeneral(
      req.body?.filters || req.body || {},
      req.body?.format || 'nuevo',
      req.body?.reportType || 'reservas_grupales'
    );
    return sendSuccess(res, { data, message: 'Listado general consultado correctamente.' });
  } catch (error) {
    console.error('No se pudo consultar el listado general:', error);
    return reportError(res, error, 'No se pudo consultar el listado general.');
  }
};

exports.exportarListadoGeneralController = async (req, res) => {
  try {
    const result = await listadoGeneral.exportarListadoGeneral(
      req.body?.filters || {},
      req.body?.format || 'nuevo',
      req.body?.reportType || 'reservas_grupales'
    );
    try {
      await recordHistorial({
        tabla: 'programacion',
        id_registro: 'listado-general',
        accion: 'EXPORTAR_EXCEL_LISTADO_GENERAL',
        id_usuario: req.user?.id || null,
        detalles: [
          { columna: 'Formato', anterior: null, nuevo: req.body?.format || 'nuevo' },
          { columna: 'Tipo de listado', anterior: null, nuevo: result.filters.reportType },
          { columna: 'Filas', anterior: null, nuevo: result.rowCount },
          { columna: 'Fecha del tour', anterior: null, nuevo: result.filters.exactTourDate || `${result.filters.tourFrom || ''} a ${result.filters.tourTo || ''}` },
        ],
      });
    } catch (historyError) {
      console.error('No se pudo registrar la exportación del listado general:', historyError);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (error) {
    console.error('No se pudo exportar el listado general:', error);
    return reportError(res, error, 'No se pudo generar el archivo Excel del listado general.');
  }
};
