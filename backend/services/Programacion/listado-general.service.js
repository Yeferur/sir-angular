const ExcelJS = require('exceljs');
const db = require('../../database/db');
const { reservasOperativasSource } = require('../schema-capabilities');

const RESERVATION_STATES = Object.freeze(['Pendiente', 'Confirmada', 'Cancelada']);
const MAX_PREVIEW_ROWS = 100;
const EXCEL_MAX_ROWS = 1_048_575;

function validDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : false;
}

function normalizeList(value, field, normalize = item => item) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  if (values.length > 100) throw Object.assign(new Error(`El filtro ${field} admite hasta 100 opciones.`), { statusCode: 400 });
  return [...new Set(values.map(normalize).filter(item => item !== null && item !== ''))];
}

function normalizePositiveId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function buildFilters(input = {}, format = 'nuevo', reportType = 'reservas_grupales') {
  if (!['tradicional', 'nuevo', 'masivo'].includes(format)) {
    throw Object.assign(new Error('El formato de listado no es válido.'), { statusCode: 400 });
  }
  if (!['reservas_grupales_privadas', 'reservas_grupales', 'reservas_privadas'].includes(reportType)) {
    throw Object.assign(new Error('El tipo de listado de reservas no es válido.'), { statusCode: 400 });
  }
  const exactTourDate = validDate(input.fechaTour);
  const tourFrom = validDate(input.fechaTourDesde);
  const tourTo = validDate(input.fechaTourHasta);
  for (const [key, value] of Object.entries({
    fechaTour: exactTourDate,
    fechaTourDesde: tourFrom,
    fechaTourHasta: tourTo,
  })) {
    if (value === false) throw Object.assign(new Error(`La fecha ${key} no es válida.`), { statusCode: 400 });
  }
  if (format === 'masivo' && (exactTourDate || !tourFrom || !tourTo)) {
    throw Object.assign(new Error('El listado masivo requiere un rango completo de fecha del tour.'), { statusCode: 400 });
  }
  if (format !== 'masivo' && (tourFrom || tourTo)) {
    throw Object.assign(new Error('El rango de fecha del tour solo está disponible para el formato masivo.'), { statusCode: 400 });
  }
  if (tourFrom && tourTo && tourFrom > tourTo) {
    throw Object.assign(new Error('La fecha inicial del tour no puede ser posterior a la fecha final.'), { statusCode: 400 });
  }
  const tours = normalizeList(input.tours, 'tours', normalizePositiveId);
  if (tours.length !== (Array.isArray(input.tours) ? [...new Set(input.tours.map(String).map(v => v.trim()).filter(Boolean))].length : input.tours ? 1 : 0)) {
    throw Object.assign(new Error('Selecciona identificadores de tour válidos.'), { statusCode: 400 });
  }
  const rutas = normalizeList(input.rutas, 'rutas', item => String(item).trim().slice(0, 50));
  const estados = normalizeList(input.estados, 'estados', item => String(item).trim().slice(0, 50));
  if (estados.some(state => !RESERVATION_STATES.includes(state))) {
    throw Object.assign(new Error('El estado de reserva seleccionado no es válido.'), { statusCode: 400 });
  }
  const canales = normalizeList(input.canales, 'canales', normalizePositiveId);
  if (canales.length !== (Array.isArray(input.canales) ? [...new Set(input.canales.map(String).map(v => v.trim()).filter(Boolean))].length : input.canales ? 1 : 0)) {
    throw Object.assign(new Error('Selecciona canales válidos.'), { statusCode: 400 });
  }
  const conditions = [];
  const params = [];
  if (exactTourDate) { conditions.push('r.Fecha_Tour = ?'); params.push(exactTourDate); }
  if (tourFrom) { conditions.push('r.Fecha_Tour >= ?'); params.push(tourFrom); }
  if (tourTo) { conditions.push('r.Fecha_Tour <= ?'); params.push(tourTo); }
  if (tours.length) {
    conditions.push(`h.Id_Tour IN (${tours.map(() => '?').join(',')})`);
    params.push(...tours);
  }
  if (rutas.length) {
    conditions.push(`COALESCE(NULLIF(TRIM(pt.ruta), ''), 'Pendiente') IN (${rutas.map(() => '?').join(',')})`);
    params.push(...rutas);
  }
  if (estados.length) {
    conditions.push(`r.Estado IN (${estados.map(() => '?').join(',')})`);
    params.push(...estados);
  }
  if (canales.length) {
    conditions.push(`r.Id_Canal IN (${canales.map(() => '?').join(',')})`);
    params.push(...canales);
  }
  const normalizedReservationType = "COALESCE(NULLIF(UPPER(TRIM(r.Tipo_Reserva)), ''), 'GRUPAL')";
  if (reportType === 'reservas_grupales') conditions.push(`${normalizedReservationType} = 'GRUPAL'`);
  else if (reportType === 'reservas_privadas') conditions.push(`${normalizedReservationType} = 'PRIVADA'`);
  else conditions.push(`${normalizedReservationType} IN ('GRUPAL', 'PRIVADA')`);
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    filters: { exactTourDate, tourFrom, tourTo, tours, rutas, estados, canales, reportType },
  };
}

function standardJoins() {
  return `
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN monedas m ON m.Id_Moneda = r.Id_Moneda
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
    LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
  `;
}

async function obtenerOpcionesListadoGeneral() {
  const [[tours], [rutas], [canales]] = await Promise.all([
    db.query(`SELECT Id_Tour, Nombre_Tour, Activo FROM tours ORDER BY Activo DESC, Nombre_Tour`),
    db.query(`SELECT DISTINCT COALESCE(NULLIF(TRIM(ruta), ''), 'Pendiente') AS Ruta FROM puntos ORDER BY Ruta`),
    db.query(`SELECT Id_Canal, Nombre_Canal FROM canales_reservas ORDER BY Nombre_Canal`),
  ]);
  return {
    tours: tours || [],
    rutas: rutas || [],
    canales: canales || [],
    estados: RESERVATION_STATES.map(value => ({ value, label: value })),
  };
}

async function consultarListadoGeneral(input = {}, format = 'nuevo', reportType = 'reservas_grupales') {
  const filters = buildFilters(input, format, reportType);
  const from = `FROM ${reservasOperativasSource('r')} ${standardJoins()} ${filters.where}`;
  const [[summary]] = await db.query(`
    SELECT COUNT(DISTINCT r.Id_Reserva) AS totalReservas,
           COUNT(DISTINCT p.Id_Pasajero) AS totalPasajeros
      ${from}
  `, filters.params);
  const [items] = await db.query(`
    SELECT r.Id_Reserva,
           DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
           t.Nombre_Tour,
           r.Estado,
           c.Nombre_Canal,
           r.Nombre_Reportante,
           COUNT(DISTINCT p.Id_Pasajero) AS NumeroPasajeros,
           GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(pt.ruta), ''), 'Pendiente')
             ORDER BY COALESCE(CAST(pt.ruta AS UNSIGNED), 999999), pt.ruta SEPARATOR ', ') AS Rutas
      ${from}
     GROUP BY r.Id_Reserva, r.Fecha_Tour, t.Nombre_Tour,
              r.Estado, c.Nombre_Canal, r.Nombre_Reportante
     ORDER BY r.Fecha_Tour, t.Nombre_Tour, r.Id_Reserva
     LIMIT ?
  `, [...filters.params, MAX_PREVIEW_ROWS]);
  return {
    items: items || [],
    totalReservas: Number(summary?.totalReservas || 0),
    totalPasajeros: Number(summary?.totalPasajeros || 0),
    limite: MAX_PREVIEW_ROWS,
  };
}

async function obtenerFilasListadoGeneral(input = {}, format = 'nuevo', reportType = 'reservas_grupales') {
  const filters = buildFilters(input, format, reportType);
  const passengerCountConditions = [];
  const passengerCountParams = [];
  if (filters.filters.rutas.length) {
    passengerCountConditions.push(`COALESCE(NULLIF(TRIM(ptcount.ruta), ''), 'Pendiente') IN (${filters.filters.rutas.map(() => '?').join(',')})`);
    passengerCountParams.push(...filters.filters.rutas);
  }
  const passengerCountWhere = passengerCountConditions.length ? `WHERE ${passengerCountConditions.join(' AND ')}` : '';
  const [rows] = await db.query(`
    SELECT r.Id_Reserva,
           DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
           r.Estado,
           r.Tipo_Reserva,
           r.Idioma_Reserva,
           r.Nombre_Reportante,
           r.Telefono_Reportante,
           r.Observaciones,
           h.Id_Tour,
           t.Nombre_Tour,
           c.Nombre_Canal,
           COALESCE(m.Codigo, 'COP') AS Codigo_Moneda,
           p.Id_Pasajero,
           p.Nombre_Pasajero,
           p.DNI,
           p.Telefono_Pasajero,
           p.Precio_Pasajero AS PrecioTour,
           pt.Nombre_Punto AS PuntoEncuentro,
           COALESCE(NULLIF(TRIM(pt.ruta), ''), 'Pendiente') AS Ruta,
           pt.posicion AS Posicion,
           total.NumeroPasajeros,
           CASE WHEN UPPER(REPLACE(TRIM(COALESCE(c.Nombre_Canal, '')), '_', ' ')) = 'AGENCIA NACIONAL'
                THEN COALESCE(abonos.TotalAbonos, 0) ELSE NULL END AS PagoAgencia,
           CASE WHEN UPPER(TRIM(COALESCE(m.Codigo, ''))) = 'USD'
                THEN p.Precio_Pasajero ELSE NULL END AS Dolares
      FROM ${reservasOperativasSource('r')}
      INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
      LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
      LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
      LEFT JOIN monedas m ON m.Id_Moneda = r.Id_Moneda
      INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      LEFT JOIN puntos pt ON pt.Id_Punto = p.Id_Punto
      LEFT JOIN (
        SELECT pcount.Id_Reserva, COUNT(*) AS NumeroPasajeros
          FROM pasajeros pcount
          LEFT JOIN puntos ptcount ON ptcount.Id_Punto = pcount.Id_Punto
          ${passengerCountWhere}
         GROUP BY pcount.Id_Reserva
      ) total ON total.Id_Reserva = r.Id_Reserva
      LEFT JOIN (
        SELECT Id_Reserva, SUM(Monto) AS TotalAbonos
          FROM pagos_reservas
         WHERE UPPER(TRIM(COALESCE(Tipo, ''))) = 'ABONO'
         GROUP BY Id_Reserva
      ) abonos ON abonos.Id_Reserva = r.Id_Reserva
      ${filters.where}
     ORDER BY COALESCE(CAST(pt.ruta AS UNSIGNED), 999999), pt.ruta,
              pt.posicion, r.Fecha_Tour, h.Id_Tour, r.Id_Reserva, p.Id_Pasajero
  `, [...passengerCountParams, ...filters.params]);
  return { rows: rows || [], filters: filters.filters };
}

function spreadsheetText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function exportName(value, fallback = 'Listado') {
  return String(value || fallback).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || fallback;
}

function fillAndAlignHeader(row, fillColor = 'FF00B0F0') {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });
}

function formatValue(row, key, type = 'text') {
  if (key === 'Transfer') return '';
  if (key === 'Categoria') return spreadsheetText(row.Nombre_Canal || '');
  if (key === 'NombreReporta') return spreadsheetText(row.Nombre_Reportante || '');
  if (key === 'TelefonoReserva') return spreadsheetText(row.Telefono_Reportante || '');
  if (key === 'IdiomaReserva') return spreadsheetText(row.Idioma_Reserva || '');
  if (key === 'TipoReserva') return spreadsheetText(row.Tipo_Reserva || '');
  if (key === 'Estado') return spreadsheetText(row.Estado || '');
  if (key === 'Tour') return spreadsheetText(row.Nombre_Tour || '');
  if (key === 'Pax') return Number(row.NumeroPasajeros || 0);
  if (key === 'PuntoEncuentro') return spreadsheetText(row.PuntoEncuentro || '');
  if (key === 'Observaciones') return spreadsheetText(row.Observaciones || '');
  if (key === 'Precio') return row.PrecioTour ?? '';
  if (key === 'PagoAgencia') return row.PagoAgencia ?? '';
  if (key === 'Dolares') return row.Dolares ?? '';
  if (key === 'Ruta') return spreadsheetText(row.Ruta || 'Pendiente');
  const map = {
    NombrePasajero: 'Nombre_Pasajero',
    Documento: 'DNI',
    TelefonoPasajero: 'Telefono_Pasajero',
    FechaTour: 'Fecha_Tour',
    Canal: 'Nombre_Canal',
  };
  const value = row[map[key] || key];
  return type === 'number' ? (value ?? '') : spreadsheetText(value);
}

function getColumnSpecs(format) {
  const common = [
    ['TOUR', 'Tour', 30], ['NOMBRE DEL PASAJERO', 'NombrePasajero', 42],
    ['DNI/PASAPORTE', 'Documento', 18], ['TELEFONO', 'TelefonoPasajero', 22],
    ['TELEFONO RESERVA', 'TelefonoReserva', 20], ['# PAX', 'Pax', 10],
    ['PUNTO DE ENCUENTRO', 'PuntoEncuentro', 30], ['OBSERVACIONES', 'Observaciones', 40],
    ['PRECIO', 'Precio', 15], ['DOLARES', 'Dolares', 14], ['TRANSFER', 'Transfer', 18],
    ['REPORTA', 'NombreReporta', 36], ['IDIOMA', 'IdiomaReserva', 12],
    ['TIPO DE RESERVA', 'TipoReserva', 20], ['RUTA', 'Ruta', 14],
    ['ESTADO DE RESERVA', 'Estado', 18],
  ];
  common.push(['CATEGORÍA', 'Categoria', 18]);
  if (format === 'nuevo') return [
    ['NOMBRE DEL PASAJERO', 'NombrePasajero', 42], ['DNI/PASAPORTE', 'Documento', 18],
    ['TELEFONO', 'TelefonoPasajero', 22], ['# PAX', 'Pax', 10],
    ['PUNTO DE ENCUENTRO', 'PuntoEncuentro', 30], ['OBSERVACIONES', 'Observaciones', 40],
    ['PRECIO', 'Precio', 15], ['PAGO AGENCIA', 'PagoAgencia', 18], ['DOLARES', 'Dolares', 14],
    ['TRANSFER', 'Transfer', 18], ['REPORTA', 'NombreReporta', 36], ['IDIOMA', 'IdiomaReserva', 12],
    ['TIPO DE RESERVA', 'TipoReserva', 20], ['RUTA', 'Ruta', 14], ['ESTADO DE RESERVA', 'Estado', 18],
    ['CATEGORÍA', 'Categoria', 18],
  ];
  if (format === 'tradicional') {
    return common;
  }
  return common;
}

function buildWorkbookRows(rows, columns) {
  return rows.map(row => Object.fromEntries(columns.map(([, key]) => [key, formatValue(row, key)])));
}

function formatTourPeriod(filters) {
  if (filters.exactTourDate) return filters.exactTourDate;
  if (filters.tourFrom && filters.tourTo) return `${filters.tourFrom} a ${filters.tourTo}`;
  return filters.tourFrom || filters.tourTo || 'Todas las fechas';
}

async function exportarListadoGeneral(input = {}, format = 'nuevo', reportType = 'reservas_grupales') {
  if (!['tradicional', 'nuevo', 'masivo'].includes(format)) {
    throw Object.assign(new Error('El formato de exportación no es válido.'), { statusCode: 400 });
  }
  const { rows, filters } = await obtenerFilasListadoGeneral(input, format, reportType);
  if (!rows.length) {
    throw Object.assign(new Error('No hay reservas para exportar con los filtros seleccionados.'), { statusCode: 404 });
  }
  const additionalRows = format === 'nuevo'
    ? new Set(rows.map(row => row.Ruta || 'Pendiente')).size + 3
    : 1;
  if (rows.length + additionalRows > EXCEL_MAX_ROWS) {
    throw Object.assign(new Error('El resultado supera el máximo de filas de Excel. Reduce el rango de fechas.'), { statusCode: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Maxitours SIR';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('LISTADO', { views: [{ state: 'frozen', ySplit: format === 'nuevo' ? 2 : 1 }] });
  const specs = getColumnSpecs(format);
  worksheet.columns = specs.map(([header, key, width]) => ({ header, key, width }));

  if (format === 'nuevo') {
    const tourNames = [...new Set(rows.map(row => row.Nombre_Tour).filter(Boolean))];
    const headerOne = worksheet.getRow(1);
    headerOne.getCell(1).value = `Fecha del tour: ${formatTourPeriod(filters)}`;
    headerOne.getCell(1).font = { bold: true };
    headerOne.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    headerOne.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
    headerOne.getCell(1).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    headerOne.getCell(2).value = tourNames.length ? tourNames.join(' - ') : 'Tour: N/A';
    headerOne.getCell(2).font = { bold: true };
    headerOne.getCell(2).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerOne.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
    worksheet.mergeCells(1, 2, 1, specs.length);
    const headerRow = worksheet.getRow(2);
    headerRow.values = specs.map(([header]) => header);
    fillAndAlignHeader(headerRow);
  } else {
    fillAndAlignHeader(worksheet.getRow(1));
  }

  if (format === 'nuevo') {
    let currentRoute = null;
    let routePax = 0;
    const addRouteTotal = route => {
      const totalRow = worksheet.addRow([]);
      totalRow.getCell(1).value = `Total Ruta ${route}`;
      totalRow.getCell(1).font = { bold: true };
      totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDDDDD' } };
      totalRow.getCell(4).value = routePax;
      totalRow.getCell(4).font = { bold: true, color: { argb: 'FFFF0000' } };
      totalRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDDDDD' } };
      totalRow.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
      });
    };
    for (const item of rows) {
      if (currentRoute !== null && currentRoute !== item.Ruta) {
        addRouteTotal(currentRoute);
        routePax = 0;
      }
      currentRoute = item.Ruta;
      routePax += 1;
      const data = buildWorkbookRows([item], specs)[0];
      worksheet.addRow(data);
    }
    if (currentRoute !== null) addRouteTotal(currentRoute);
    const grandTotal = worksheet.addRow([]);
    grandTotal.getCell(1).value = 'Total de Pasajeros';
    grandTotal.getCell(1).font = { bold: true };
    grandTotal.getCell(4).value = rows.length;
    grandTotal.getCell(4).font = { bold: true };
  } else {
    worksheet.addRows(buildWorkbookRows(rows, specs));
  }

  worksheet.eachRow({ includeEmpty: true }, row => {
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const tour = filters.tours.length === 1
    ? rows.find(row => Number(row.Id_Tour) === Number(filters.tours[0]))?.Nombre_Tour
    : null;
  const reportNames = {
    reservas_grupales_privadas: 'Grupales_y_Privadas',
    reservas_grupales: 'Grupales',
    reservas_privadas: 'Privadas',
  };
  const filename = `Listado_General_${exportName(tour, 'Reservas')}_${reportNames[filters.reportType]}_${exportName(formatTourPeriod(filters), 'fechas')}_${format}.xlsx`;
  return { buffer, filename, rowCount: rows.length, filters };
}

module.exports = {
  RESERVATION_STATES,
  MAX_PREVIEW_ROWS,
  buildFilters,
  obtenerOpcionesListadoGeneral,
  consultarListadoGeneral,
  obtenerFilasListadoGeneral,
  exportarListadoGeneral,
};
