const { reservasOperativasSource } = require('../schema-capabilities');
const db = require('../../database/db');
const { searchKey } = require('../EntidadesReportantes/entidades-reportantes.service');

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
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
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
      LEFT JOIN canales_reservas c ON c.Id_Canal = tr.Id_Canal
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
    FROM canales_reservas
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
  obtenerUsuariosMercadeo, buildFilters, buildTransferFilters };
