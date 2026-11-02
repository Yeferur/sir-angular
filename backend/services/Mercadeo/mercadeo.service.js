const { reservasOperativasSource } = require('../schema-capabilities');
const db = require('../../database/db');
const { searchKey } = require('../EntidadesReportantes/entidades-reportantes.service');
const ExcelJS = require('exceljs');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function validDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function parseCreatorIds(value) {
  if (value == null || value === '') return [];
  const rawIds = Array.isArray(value) ? value : String(value).split(',');
  const ids = [...new Set(rawIds.map((item) => String(item).trim()).filter(Boolean))];
  if (ids.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)) {
    throw Object.assign(new Error('Selecciona usuarios válidos para el filtro.'),
      { status: 400, errorCode: 'CREATOR_IDS_INVALID' });
  }
  return ids.map(Number);
}

function buildFilters(query = {}) {
  const conditions = [];
  const values = [];
  const dateFrom = validDate(query.fechaRegistroDesde);
  const dateTo = validDate(query.fechaRegistroHasta);
  if ((query.fechaRegistroDesde || query.fechaRegistroHasta) && (!dateFrom || !dateTo || dateFrom > dateTo)) {
    throw Object.assign(new Error('Selecciona un rango de registro completo y válido.'), { status: 400, errorCode: 'DATE_RANGE_INVALID' });
  }
  if (dateFrom && (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 30) {
    throw Object.assign(new Error('El rango máximo es de 31 días calendario.'), { status: 400, errorCode: 'DATE_RANGE_TOO_LONG' });
  }
  const fechaTour = validDate(query.fechaTour);
  const bookingCode = String(query.codigoReserva || '').trim().slice(0, 20);
  const rawEntityId = String(query.idEntidadReportante || '').trim();
  let entityId = null;
  if (rawEntityId) {
    if (!/^\d+$/.test(rawEntityId) || !Number.isSafeInteger(Number(rawEntityId)) || Number(rawEntityId) < 1) {
      throw Object.assign(new Error('Identificador de entidad reportante no válido.'),
        { status: 400, errorCode: 'ENTITY_ID_INVALID' });
    }
    entityId = Number(rawEntityId);
  }
  const category = Number(query.categoria);
  const creatorIds = parseCreatorIds(query.creadorIds);

  if (dateFrom) { conditions.push('r.Fecha_Registro >= ?'); values.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { conditions.push('r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(dateTo); }
  if (fechaTour) { conditions.push('r.Fecha_Tour = ?'); values.push(fechaTour); }
  if (bookingCode) { conditions.push('r.Id_Reserva = ?'); values.push(bookingCode); }
  if (Number.isSafeInteger(category) && category > 0) { conditions.push('r.Id_Canal = ?'); values.push(category); }
  if (entityId !== null) { conditions.push('r.Id_Entidad_Reportante = ?'); values.push(entityId); }
  if (creatorIds.length) {
    conditions.push(`r.Creado_Por IN (${creatorIds.map(() => '?').join(',')})`);
    values.push(...creatorIds);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    entityId,
    creatorIds,
  };
}

function paginationValue(value, fallback, max) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

const ORIGEN_COLLATION = 'utf8mb4_unicode_ci';

function collatedText(expression) {
  return `CONVERT(${expression} USING utf8mb4) COLLATE ${ORIGEN_COLLATION}`;
}

function normalizeOrigenType(value) {
  const raw = String(value || '').trim().toLocaleUpperCase('es-CO');
  if (!raw || ['TODOS', 'TODO', 'ALL'].includes(raw)) return 'TODOS';
  if (['RESERVA', 'RESERVAS'].includes(raw)) return 'RESERVA';
  if (['TRANSFER', 'TRANSFERS'].includes(raw)) return 'TRANSFER';
  throw Object.assign(new Error('Selecciona un tipo válido.'), { status: 400, errorCode: 'OPERATION_TYPE_INVALID' });
}

const ORIGEN_STATES = Object.freeze([
  'Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Confirmada', 'Confirmado',
  'Completada', 'Completado', 'Cancelada', 'Cancelado', 'Activo', 'Activa',
]);

function normalizeOrigenStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLocaleLowerCase('es-CO');
  const state = ORIGEN_STATES.find(item => item.toLocaleLowerCase('es-CO') === normalized);
  if (!state) throw Object.assign(new Error('Selecciona un estado válido.'), { status: 400, errorCode: 'OPERATION_STATE_INVALID' });
  return state;
}

function buildOrigenFilters(query = {}) {
  const conditions = [];
  const values = [];
  const dateFrom = validDate(query.fechaRegistroDesde);
  const dateTo = validDate(query.fechaRegistroHasta);
  if ((query.fechaRegistroDesde || query.fechaRegistroHasta) && (!dateFrom || !dateTo || dateFrom > dateTo)) {
    throw Object.assign(new Error('Selecciona un rango de creación completo y válido.'), { status: 400, errorCode: 'DATE_RANGE_INVALID' });
  }
  if (dateFrom && (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 30) {
    throw Object.assign(new Error('El rango máximo es de 31 días calendario.'), { status: 400, errorCode: 'DATE_RANGE_TOO_LONG' });
  }
  const serviceDate = validDate(query.fechaTour);
  const type = normalizeOrigenType(query.tipo);
  const rawEntityId = String(query.idEntidadReportante || '').trim();
  let entityId = null;
  if (rawEntityId) {
    if (!/^\d+$/.test(rawEntityId) || !Number.isSafeInteger(Number(rawEntityId)) || Number(rawEntityId) < 1) {
      throw Object.assign(new Error('Identificador de entidad reportante no válido.'), { status: 400, errorCode: 'ENTITY_ID_INVALID' });
    }
    entityId = Number(rawEntityId);
  }
  const category = Number(query.categoria);
  const creatorIds = parseCreatorIds(query.creadorIds);
  const state = normalizeOrigenStatus(query.estado);

  if (type !== 'TODOS') { conditions.push('ops.tipo = ?'); values.push(type); }
  if (dateFrom) { conditions.push('ops.fecha_registro >= ?'); values.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { conditions.push('ops.fecha_registro < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(dateTo); }
  if (serviceDate) { conditions.push('ops.fecha_servicio = ?'); values.push(serviceDate); }
  if (Number.isSafeInteger(category) && category > 0) { conditions.push('ops.id_canal = ?'); values.push(category); }
  if (entityId !== null) { conditions.push('ops.id_entidad_reportante = ?'); values.push(entityId); }
  if (creatorIds.length) {
    conditions.push(`ops.creador_id IN (${creatorIds.map(() => '?').join(',')})`);
    values.push(...creatorIds);
  }
  if (state) { conditions.push('ops.estado = ?'); values.push(state); }
  return { type, state, where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values, entityId, creatorIds };
}

function origenUnionSql() {
  const textNull = collatedText('NULL');
  return `SELECT ${collatedText("'RESERVA'")} AS tipo,
      ${collatedText('CAST(r.Id_Reserva AS CHAR)')} AS id_operacion,
      ${collatedText('r.Id_Reserva')} AS id_reserva,
      CAST(NULL AS UNSIGNED) AS id_transfer,
      r.Fecha_Registro AS fecha_registro, r.Fecha_Tour AS fecha_servicio,
      r.Id_Canal AS id_canal, ${collatedText('c.Nombre_Canal')} AS canal,
      r.Id_Entidad_Reportante AS id_entidad_reportante,
      ${collatedText("CASE WHEN r.Id_Entidad_Reportante IS NULL AND UPPER(TRIM(c.Nombre_Canal)) IN ('HOTEL','AGENCIA NACIONAL','AGENCIA INTERNACIONAL') THEN 'Sin entidad' ELSE er.Nombre END")} AS entidad,
      ${collatedText('er.Tipo')} AS tipo_entidad,
      ${collatedText('r.Nombre_Reportante')} AS nombre_reportante,
      ${collatedText('r.Telefono_Reportante')} AS telefono_reportante,
      r.Creado_Por AS creador_id, ${collatedText('u.Nombres_Apellidos')} AS creador,
      CAST(NULL AS UNSIGNED) AS pasajeros, ${collatedText('r.Estado')} AS estado,
      r.Pendiente_Por_Entidad_En AS pendiente_por_entidad_en
    FROM ${reservasOperativasSource('r')}
    LEFT JOIN entidades_reportantes er ON er.Id_Entidad_Reportante = r.Id_Entidad_Reportante
    LEFT JOIN canales_origen c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN usuarios u ON u.Id_Usuario = r.Creado_Por
  UNION ALL
  SELECT ${collatedText("'TRANSFER'")} AS tipo,
      ${collatedText('CAST(tr.Id_Transfer AS CHAR)')} AS id_operacion,
      ${textNull} AS id_reserva, tr.Id_Transfer AS id_transfer,
      tr.Fecha_Registro AS fecha_registro, tr.Fecha_Transfer AS fecha_servicio,
      tr.Id_Canal AS id_canal, ${collatedText('c.Nombre_Canal')} AS canal,
      tr.Id_Entidad_Reportante AS id_entidad_reportante,
      ${collatedText("CASE WHEN tr.Id_Entidad_Reportante IS NULL AND UPPER(TRIM(c.Nombre_Canal)) IN ('HOTEL','AGENCIA NACIONAL','AGENCIA INTERNACIONAL') THEN 'Sin entidad' ELSE er.Nombre END")} AS entidad,
      ${collatedText('er.Tipo')} AS tipo_entidad,
      ${collatedText('tr.Nombre_Reportante')} AS nombre_reportante,
      ${collatedText('tr.Telefono_Reportante')} AS telefono_reportante,
      tr.Creado_Por AS creador_id, ${collatedText('u.Nombres_Apellidos')} AS creador,
      tr.Cantidad_Personas AS pasajeros, ${collatedText('tr.Estado')} AS estado,
      tr.Pendiente_Por_Entidad_En AS pendiente_por_entidad_en
    FROM transfers tr
    LEFT JOIN entidades_reportantes er ON er.Id_Entidad_Reportante = tr.Id_Entidad_Reportante
    LEFT JOIN canales_origen c ON c.Id_Canal = tr.Id_Canal
    LEFT JOIN usuarios u ON u.Id_Usuario = tr.Creado_Por`;
}

function origenFromSql(filters) {
  return `FROM (${origenUnionSql()}) ops ${filters.where}`;
}

function sortOrigenSql(groupForExport = false) {
  if (groupForExport) {
    const freelance = `(UPPER(TRIM(COALESCE(ops.tipo_entidad, ''))) = 'FREELANCE'
      OR UPPER(TRIM(COALESCE(ops.canal, ''))) = 'FREELANCE')`;
    const exportEntity = `CASE WHEN ${freelance} THEN 'FREELANCE'
      ELSE COALESCE(NULLIF(TRIM(ops.entidad), ''), '—') END`;
    const exportCategory = `CASE WHEN ${freelance} THEN 'FREELANCE'
      ELSE COALESCE(NULLIF(TRIM(ops.tipo_entidad), ''), '—') END`;
    return `${exportEntity} COLLATE ${ORIGEN_COLLATION} ASC,
      CAST(${exportEntity} AS BINARY) ASC,
      COALESCE(ops.id_entidad_reportante, 0) ASC,
      ${exportCategory} COLLATE ${ORIGEN_COLLATION} ASC,
      CAST(${exportCategory} AS BINARY) ASC,
      CASE WHEN ops.tipo = 'RESERVA' THEN 0 ELSE 1 END ASC,
      ops.fecha_registro DESC,
      CASE WHEN ops.id_transfer IS NOT NULL THEN ops.id_transfer END DESC,
      CASE WHEN ops.id_reserva IS NOT NULL THEN ops.id_reserva COLLATE ${ORIGEN_COLLATION} END DESC`;
  }
  return `ops.fecha_registro DESC, ops.tipo COLLATE ${ORIGEN_COLLATION} ASC,
    CASE WHEN ops.id_transfer IS NOT NULL THEN ops.id_transfer END DESC,
    CASE WHEN ops.id_reserva IS NOT NULL THEN ops.id_reserva COLLATE ${ORIGEN_COLLATION} END DESC`;
}

async function buscarOrigenReservas(query = {}) {
  const filters = buildOrigenFilters(query);
  const pageSize = paginationValue(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const requestedPage = paginationValue(query.page, 1, Number.MAX_SAFE_INTEGER);
  const from = origenFromSql(filters);
  const [[summary]] = await db.query(`SELECT COUNT(*) AS totalOperaciones ${from}`, filters.values);
  const totalOperaciones = Number(summary?.totalOperaciones || 0);
  const totalPages = Math.max(1, Math.ceil(totalOperaciones / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const [items] = await db.query(`SELECT ops.* ${from}
    ORDER BY ${sortOrigenSql(query.ordenarParaExcel === true)} LIMIT ? OFFSET ?`, [...filters.values, pageSize, offset]);

  const reservationIds = items.filter(item => item.tipo === 'RESERVA').map(item => item.id_reserva);
  if (reservationIds.length) {
    const [passengerRows] = await db.query(`SELECT Id_Reserva, COUNT(*) AS cantidad
      FROM pasajeros WHERE Id_Reserva IN (${reservationIds.map(() => '?').join(',')})
      GROUP BY Id_Reserva`, reservationIds);
    const counts = new Map(passengerRows.map(row => [String(row.Id_Reserva), Number(row.cantidad || 0)]));
    for (const item of items) if (item.tipo === 'RESERVA') item.pasajeros = counts.get(String(item.id_reserva)) || 0;
  }
  for (const item of items) item.pasajeros = Number(item.pasajeros || 0);
  const pasajerosPagina = items.reduce((sum, item) => sum + Number(item.pasajeros || 0), 0);
  return { items, page, pageSize, totalPages, totalOperaciones, totalPasajeros: pasajerosPagina,
    totalPasajerosEnPagina: pasajerosPagina, tipo: filters.type };
}

async function streamOrigenExcel(query = {}, output) {
  const filters = buildOrigenFilters(query);
  const from = origenFromSql(filters);
  const [typeRows] = await db.query(`SELECT DISTINCT ops.tipo ${from}`, filters.values);
  const operationTypes = new Set(typeRows.map(row => String(row.tipo || '').toUpperCase()));
  if (!operationTypes.size && filters.type !== 'TODOS') operationTypes.add(filters.type);
  const singleType = operationTypes.size === 1 ? [...operationTypes][0] : null;
  const sheetName = singleType === 'RESERVA' ? 'Reservas'
    : singleType === 'TRANSFER' ? 'Transfers' : 'Reservas y transfers';
  const includeTypeColumn = !singleType;

  let page = 1;
  const pageSize = MAX_PAGE_SIZE;
  let result = await buscarOrigenReservas({ ...query, ordenarParaExcel: true, page, pageSize });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: true });
  const sheet = workbook.addWorksheet(sheetName);
  const columns = [
    { header: 'ENTIDAD', key: 'entidad', width: 34 },
    { header: 'CATEGORÍA', key: 'categoria', width: 25 },
  ];
  if (includeTypeColumn) columns.push({ header: 'TIPO', key: 'tipo', width: 14 });
  columns.push(
    { header: 'CÓDIGO', key: 'codigo', width: 22 },
    { header: 'FECHA DEL TOUR', key: 'fecha_tour', width: 19, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'N.º DE PASAJEROS', key: 'pasajeros', width: 14 },
    { header: 'QUIÉN REPORTA', key: 'quien_reporta', width: 30 },
    { header: 'CONTACTO DEL REPORTANTE', key: 'contacto_reportante', width: 20 },
    { header: 'QUIÉN REALIZÓ LA RESERVA', key: 'creador', width: 30 },
    { header: 'FECHA DE REGISTRO', key: 'fecha_registro', width: 22, style: { numFmt: 'dd/mm/yyyy' } },
  );
  sheet.columns = columns;
  const thinBorder = { style: 'thin' };
  const fullThinBorder = {
    top: thinBorder,
    left: thinBorder,
    bottom: thinBorder,
    right: thinBorder,
  };
  const centeredWrapped = { vertical: 'middle', horizontal: 'center', wrapText: true };
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = centeredWrapped;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.alignment = centeredWrapped;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
    cell.border = fullThinBorder;
  });
  headerRow.commit();

  const entityColumn = 1;
  const categoryColumn = 2;
  const typeColumn = includeTypeColumn ? 3 : null;
  let nextRowNumber = 2;
  let currentEntityKey = null;
  let currentEntityRows = [];

  const writeEntityGroup = (items) => {
    if (!items.length) return;
    const firstRowNumber = nextRowNumber;
    const rows = items.map(item => {
      const rowValues = {
        entidad: item.exportEntity,
        categoria: item.exportCategory,
        codigo: item.id_operacion,
        fecha_tour: item.fecha_servicio,
        pasajeros: item.pasajeros,
        quien_reporta: item.nombre_reportante,
        contacto_reportante: item.telefono_reportante,
        creador: item.creador,
        fecha_registro: item.fecha_registro,
      };
      if (includeTypeColumn) rowValues.tipo = item.tipo;
      const row = sheet.addRow(rowValues);
      row.alignment = centeredWrapped;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.alignment = centeredWrapped;
        cell.border = fullThinBorder;
      });
      nextRowNumber += 1;
      return row;
    });
    const lastRowNumber = nextRowNumber - 1;
    if (rows.length > 1) {
      sheet.mergeCells(firstRowNumber, entityColumn, lastRowNumber, entityColumn);
      sheet.mergeCells(firstRowNumber, categoryColumn, lastRowNumber, categoryColumn);
    }
    if (typeColumn) {
      let typeStart = 0;
      while (typeStart < items.length) {
        let typeEnd = typeStart + 1;
        while (typeEnd < items.length && items[typeEnd].tipo === items[typeStart].tipo) typeEnd += 1;
        if (typeEnd - typeStart > 1) {
          sheet.mergeCells(firstRowNumber + typeStart, typeColumn, firstRowNumber + typeEnd - 1, typeColumn);
        }
        typeStart = typeEnd;
      }
    }
    rows.forEach(row => row.commit());
  };

  const addExportFields = item => {
    const isFreelance = String(item.tipo_entidad || '').trim().toLocaleUpperCase('es-CO') === 'FREELANCE'
      || String(item.canal || '').trim().toLocaleUpperCase('es-CO') === 'FREELANCE';
    const exportEntity = isFreelance ? 'FREELANCE' : excelValue(item.entidad);
    const exportCategory = isFreelance ? 'FREELANCE' : excelValue(item.tipo_entidad);
    const entityId = item.id_entidad_reportante;
    const exportKey = entityId != null && String(entityId).trim() !== ''
      ? `entidad:${entityId}` : `sin-id:${exportEntity}\u0000${exportCategory}`;
    return {
      ...item,
      exportEntity,
      exportCategory,
      exportKey,
      codigo: excelValue(item.id_operacion),
      fecha_servicio: excelDate(item.fecha_servicio),
      pasajeros: item.pasajeros == null || item.pasajeros === '' ? '—' : Number(item.pasajeros),
      nombre_reportante: excelValue(item.nombre_reportante),
      telefono_reportante: excelValue(item.telefono_reportante),
      creador: excelValue(item.creador),
      fecha_registro: excelDate(item.fecha_registro),
    };
  };

  while (true) {
    for (const sourceItem of result.items) {
      const item = addExportFields(sourceItem);
      if (currentEntityKey !== null && currentEntityKey !== item.exportKey) {
        writeEntityGroup(currentEntityRows);
        currentEntityRows = [];
      }
      currentEntityKey = item.exportKey;
      currentEntityRows.push(item);
    }
    if (page >= result.totalPages) break;
    page += 1;
    result = await buscarOrigenReservas({ ...query, ordenarParaExcel: true, page, pageSize });
  }
  writeEntityGroup(currentEntityRows);
  sheet.commit();
  await workbook.commit();
}

function excelValue(value) {
  return value == null || String(value).trim() === '' ? '—' : value;
}

function excelDate(value) {
  if (value == null || value === '') return '—';
  const dateText = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return '—';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '—';
  return date;
}

async function buscarReservasMercadeo(query = {}) {
  const { where, values } = buildFilters(query);
  const requestedPage = paginationValue(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = paginationValue(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const [summaryRows] = await db.query(`
    SELECT COUNT(DISTINCT r.Id_Reserva) AS totalReservas,
           COALESCE(SUM((SELECT COUNT(*) FROM pasajeros p_count
             WHERE p_count.Id_Reserva = r.Id_Reserva)), 0) AS totalPasajeros
    FROM ${reservasOperativasSource('r')}
    ${where}
  `, values);
  const totalReservas = Number(summaryRows?.[0]?.totalReservas || 0);
  const totalPasajeros = Number(summaryRows?.[0]?.totalPasajeros || 0);
  const totalPages = Math.max(1, Math.ceil(totalReservas / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const [reservas] = await db.query(`
    SELECT r.Id_Reserva, r.Fecha_Registro, r.Fecha_Tour,
           r.Nombre_Reportante AS NombreReporta,
           r.Telefono_Reportante AS Telefono,
           r.Id_Canal,
           r.Id_Entidad_Reportante,
           er.Nombre AS Nombre_Entidad_Reportante,
           er.Tipo AS Tipo_Entidad_Reportante,
           c.Nombre_Canal AS Categoria,
           (SELECT COUNT(*) FROM pasajeros p_count WHERE p_count.Id_Reserva = r.Id_Reserva) AS Cantidad_Pasajeros,
           r.Creado_Por AS CreadorId,
           u.Nombres_Apellidos AS UsuarioCreador
    FROM ${reservasOperativasSource('r')}
    LEFT JOIN entidades_reportantes er ON er.Id_Entidad_Reportante = r.Id_Entidad_Reportante
    LEFT JOIN canales_origen c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN usuarios u ON u.Id_Usuario = r.Creado_Por
    ${where}
    ORDER BY r.Fecha_Registro DESC, r.Id_Reserva DESC
    LIMIT ? OFFSET ?
  `, [...values, pageSize, offset]);

  return {
    items: reservas,
    page,
    pageSize,
    totalPages,
    totalReservas,
    totalPasajeros,
  };
}

function normalizeTransferId(value) {
  const normalized = String(value || '').trim()
    .replace(/^TRS/i, '').replace(/^TRC/i, '').replace(/^TR-?/i, '');
  return /^\d+$/.test(normalized) ? normalized : null;
}

function buildTransferFilters(query = {}) {
  const conditions = [];
  const values = [];
  const registrationFrom = validDate(query.fechaRegistroDesde);
  const registrationTo = validDate(query.fechaRegistroHasta);
  if ((query.fechaRegistroDesde || query.fechaRegistroHasta)
    && (!registrationFrom || !registrationTo || registrationFrom > registrationTo)) {
    throw Object.assign(new Error('Selecciona un rango de registro completo y válido.'), { status: 400, errorCode: 'DATE_RANGE_INVALID' });
  }
  if (registrationFrom && (Date.parse(registrationTo) - Date.parse(registrationFrom)) / 86400000 > 30) {
    throw Object.assign(new Error('El rango máximo es de 31 días calendario.'), { status: 400, errorCode: 'DATE_RANGE_TOO_LONG' });
  }
  const fechaTour = validDate(query.fechaTour);
  const transferCode = String(query.codigoReserva || '').trim();
  const transferId = transferCode ? normalizeTransferId(transferCode) : null;
  const category = Number(query.categoria);
  const rawEntityId = String(query.idEntidadReportante || '').trim();
  let entityId = null;
  if (rawEntityId) {
    if (!/^\d+$/.test(rawEntityId) || !Number.isSafeInteger(Number(rawEntityId)) || Number(rawEntityId) < 1) {
      throw Object.assign(new Error('Identificador de entidad reportante no válido.'), { status: 400, errorCode: 'ENTITY_ID_INVALID' });
    }
    entityId = Number(rawEntityId);
  }
  const creatorIds = parseCreatorIds(query.creadorIds);

  if (transferCode) {
    if (transferId) { conditions.push('tr.Id_Transfer = ?'); values.push(transferId); }
    else conditions.push('1 = 0');
  }
  if (registrationFrom) { conditions.push('tr.Fecha_Registro >= ?'); values.push(`${registrationFrom} 00:00:00`); }
  if (registrationTo) { conditions.push('tr.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(registrationTo); }
  if (fechaTour) { conditions.push('tr.Fecha_Transfer = ?'); values.push(fechaTour); }
  if (Number.isSafeInteger(category) && category > 0) { conditions.push('tr.Id_Canal = ?'); values.push(category); }
  if (entityId !== null) { conditions.push('tr.Id_Entidad_Reportante = ?'); values.push(entityId); }
  if (creatorIds.length) {
    conditions.push(`tr.Creado_Por IN (${creatorIds.map(() => '?').join(',')})`);
    values.push(...creatorIds);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

async function buscarTransfersMercadeo(query = {}) {
  const { where, values } = buildTransferFilters(query);
  const requestedPage = paginationValue(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = paginationValue(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const [summaryRows] = await db.query(`
    SELECT COUNT(DISTINCT tr.Id_Transfer) AS totalTransfers,
           COALESCE(SUM(tr.Cantidad_Personas), 0) AS totalPasajeros
      FROM transfers tr
      ${where}
  `, values);
  const totalTransfers = Number(summaryRows?.[0]?.totalTransfers || 0);
  const totalPasajeros = Number(summaryRows?.[0]?.totalPasajeros || 0);
  const totalPages = Math.max(1, Math.ceil(totalTransfers / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const [transfers] = await db.query(`
    SELECT tr.Id_Transfer,
           CONCAT('TRS', LPAD(tr.Id_Transfer, 5, '0')) AS Codigo_Transfer,
           tr.Fecha_Registro, tr.Fecha_Transfer, tr.Estado,
           tr.Nombre_Titular, tr.DNI, tr.Telefono_Titular,
           tr.Cantidad_Personas AS Cantidad_Pasajeros,
           tr.Id_Canal, c.Nombre_Canal AS Categoria,
           tr.Id_Entidad_Reportante, er.Nombre AS Nombre_Entidad_Reportante, er.Tipo AS Tipo_Entidad_Reportante,
           tr.Nombre_Reportante AS NombreReporta, tr.Telefono_Reportante AS Telefono,
           tr.Creado_Por AS CreadorId, u.Nombres_Apellidos AS UsuarioCreador,
           s.Nombre_Servicio
      FROM transfers tr
      LEFT JOIN canales_origen c ON c.Id_Canal = tr.Id_Canal
      LEFT JOIN entidades_reportantes er ON er.Id_Entidad_Reportante = tr.Id_Entidad_Reportante
      LEFT JOIN usuarios u ON u.Id_Usuario = tr.Creado_Por
      LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
      ${where}
     ORDER BY tr.Fecha_Registro DESC, tr.Id_Transfer DESC
     LIMIT ? OFFSET ?
  `, [...values, pageSize, offset]);
  return { items: transfers, page, pageSize, totalPages, totalTransfers, totalPasajeros };
}

async function obtenerCategoriasMercadeo() {
  const [rows] = await db.query(`
    SELECT Id_Canal, Nombre_Canal
    FROM canales_origen
    ORDER BY Nombre_Canal
  `);
  return rows;
}

async function obtenerUsuariosMercadeo() {
  const [rows] = await db.query(`
    SELECT Id_Usuario, Nombres_Apellidos, Activo
      FROM usuarios
     ORDER BY Activo DESC, Nombres_Apellidos ASC, Id_Usuario ASC
  `);
  return rows;
}

module.exports = { buscarReservasMercadeo, buscarTransfersMercadeo, obtenerCategoriasMercadeo,
  buscarOrigenReservas, streamOrigenExcel, obtenerCategoriasMercadeo, obtenerUsuariosMercadeo, buildFilters,
  buildTransferFilters, buildOrigenFilters, normalizeOrigenType, normalizeOrigenStatus, origenUnionSql };
