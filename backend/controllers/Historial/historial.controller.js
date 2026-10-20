const ExcelJS = require('exceljs');
const historialService = require('../../services/Historial/historial.service');
const { sendSuccess, sendError } = require('../../utils/responseEnvelope');
const { etiquetaAccion } = require('../../services/Historial/catalogos');

function filtersFromQuery(query) {
  return {
    usuarios: query.usuarios ?? query.usuario,
    acciones: query.acciones ?? query.tipoAccion,
    actividad: query.actividad,
    modulos: query.modulos ?? query.modulo,
    referencia: query.referencia ?? '',
    fechaInicio: query.desde ?? query.fechaInicio ?? '',
    fechaFin: query.hasta ?? query.fechaFin ?? '',
    page: query.page,
    limit: query.limit,
  };
}

exports.getFilterOptions = async (_req, res) => {
  try {
    return sendSuccess(res, { data: await historialService.getFilterOptions(), message: 'Filtros de historial obtenidos correctamente' });
  } catch (error) {
    console.error('Error obteniendo filtros de historial:', error);
    return sendError(res, { status: 500, message: 'Error obteniendo filtros de historial', errorCode: 'INTERNAL_ERROR' });
  }
};

exports.getHistorial = async (req, res) => {
  try {
    const result = await historialService.getHistorial(filtersFromQuery(req.query));
    return sendSuccess(res, { data: result, message: 'Historial obtenido correctamente' });
  } catch (error) {
    const clientError = /fecha|período|periodo|módulo|actividad|identificadores|referencia|filtro/i.test(error.message || '');
    return sendError(res, { status: clientError ? 400 : 500, message: clientError ? error.message : 'Error obteniendo historial', errorCode: clientError ? 'INVALID_FILTERS' : 'INTERNAL_ERROR' });
  }
};

exports.exportHistorial = async (req, res) => {
  try {
    const data = await historialService.exportarHistorial(filtersFromQuery(req.query));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIR';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Historial', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 22 },
      { header: 'Usuario', key: 'usuario', width: 28 },
      { header: 'Acción', key: 'accion', width: 34 },
      { header: 'Módulo', key: 'modulo', width: 28 },
      { header: 'Recurso / ID', key: 'registro', width: 22 },
      { header: 'Resumen', key: 'resumen', width: 80 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of data) {
      sheet.addRow({
        fecha: row.Fecha_Accion,
        usuario: row.Usuario_Nombre || 'Sistema',
        accion: etiquetaAccion(row.Tipo_Accion),
        modulo: row.Modulo,
        registro: row.Id_Registro == null ? '' : String(row.Id_Registro),
        resumen: row.Descripcion,
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="historial-${date}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error exportando historial:', error);
    const clientError = /fecha|período|periodo|módulo|actividad|identificadores|referencia|filtro/i.test(error.message || '');
    return sendError(res, { status: clientError ? 400 : 500, message: clientError ? error.message : 'Error exportando el historial', errorCode: clientError ? 'INVALID_FILTERS' : 'EXPORT_FAILED' });
  }
};

exports.obtenerHistorial = async (req, res) => {
  try {
    const tabla = String(req.query.tabla || '').trim();
    const id = req.query.id ? String(req.query.id) : null;
    if (!tabla) return sendError(res, { status: 400, message: 'Se requiere el parametro tabla', errorCode: 'MISSING_PARAMS' });
    const records = await historialService.getHistorialByTableAndId(tabla, id);
    return sendSuccess(res, { data: records, message: 'Historial obtenido correctamente' });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    return sendError(res, { status: 500, message: 'Error consultando historial', errorCode: 'INTERNAL_ERROR' });
  }
};
