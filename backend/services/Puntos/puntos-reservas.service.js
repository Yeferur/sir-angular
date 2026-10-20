const db = require('../../database/db');
const { reservaNoEliminadaPredicate } = require('../schema-capabilities');
const { normalizarFechaMysql } = require('../../utils/mysqlDate');
const {
  ESTADOS_RESERVA_CANONICOS,
  normalizarEstadoReservaLegacy,
  expandirEstadoReservaFiltro,
} = require('../Reservas/reservas.service');

function parseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function createFilterError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.errorCode = 'INVALID_FILTERS';
  return error;
}

function buildFilters(idPunto, input = {}) {
  const pointId = Number(idPunto);
  if (!Number.isSafeInteger(pointId) || pointId < 1) throw createFilterError('Punto no válido.');
  const desde = parseDate(input.desde);
  const hasta = parseDate(input.hasta);
  if (!desde || !hasta) throw createFilterError('Selecciona un período completo.');
  if (desde > hasta) throw createFilterError('La fecha inicial debe ser anterior a la final.');
  const days = (Date.parse(hasta) - Date.parse(desde)) / 86400000;
  if (days > 365) throw createFilterError('El período máximo es de 366 días.');

  const conditions = [
    reservaNoEliminadaPredicate('r'),
    'r.Fecha_Tour >= ?',
    'r.Fecha_Tour <= ?',
    `(h.Id_Punto = ? OR EXISTS (
      SELECT 1 FROM pasajeros asociado
      WHERE asociado.Id_Reserva = r.Id_Reserva AND asociado.Id_Punto = ?
    ))`,
  ];
  const params = [desde, hasta, pointId, pointId];
  const estado = String(input.estado || '').trim();
  if (estado) {
    const expanded = [...new Set((estado === 'Pendiente'
      ? ESTADOS_RESERVA_CANONICOS.filter(value => value.startsWith('Pendiente'))
      : [estado]).flatMap(expandirEstadoReservaFiltro))];
    if (!expanded.length || normalizarEstadoReservaLegacy(estado) !== estado) {
      throw createFilterError('Estado de reserva no válido.');
    }
    conditions.push(`r.Estado IN (${expanded.map(() => '?').join(',')})`);
    params.push(...expanded);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params, desde, hasta, estado };
}

const FROM = `FROM reservas r
  LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
  LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour`;

const SELECT = `SELECT r.Id_Reserva, r.Fecha_Tour, t.Nombre_Tour, r.Estado,
  (SELECT COUNT(*) FROM pasajeros p WHERE p.Id_Reserva = r.Id_Reserva) AS Pasajeros`;

function normalizeRows(rows) {
  return (rows || []).map(row => ({
    Id_Reserva: row.Id_Reserva,
    Fecha_Tour: normalizarFechaMysql(row.Fecha_Tour, { tipo: 'date' }),
    Nombre_Tour: row.Nombre_Tour || null,
    Pasajeros: Number(row.Pasajeros || 0),
    Estado: normalizarEstadoReservaLegacy(row.Estado),
  }));
}

async function consultarReservasPunto(idPunto, input = {}, { exportAll = false } = {}) {
  const filters = buildFilters(idPunto, input);
  if (exportAll) {
    const [rows] = await db.query(`${SELECT} ${FROM} ${filters.where}
      ORDER BY r.Fecha_Tour DESC, r.Id_Reserva DESC`, filters.params);
    return normalizeRows(rows);
  }

  const requestedPage = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(input.limit, 10) || 25));
  const [[count]] = await db.query(`SELECT COUNT(*) AS total ${FROM} ${filters.where}`, filters.params);
  const total = Number(count?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * limit;
  const [rows] = await db.query(`${SELECT} ${FROM} ${filters.where}
    ORDER BY r.Fecha_Tour DESC, r.Id_Reserva DESC LIMIT ? OFFSET ?`, [...filters.params, limit, offset]);
  return { data: normalizeRows(rows), total, page, limit, totalPages };
}

async function obtenerEstadosReservaPunto() {
  const [rows] = await db.query(`SELECT DISTINCT r.Estado FROM reservas r
    WHERE ${reservaNoEliminadaPredicate('r')} AND r.Estado IS NOT NULL AND TRIM(r.Estado) <> ''`);
  const states = [...ESTADOS_RESERVA_CANONICOS,
    ...rows.map(row => normalizarEstadoReservaLegacy(row.Estado)).filter(Boolean)];
  return [...new Set(states.map(state => state.startsWith('Pendiente') ? 'Pendiente' : state))];
}

module.exports = { consultarReservasPunto, obtenerEstadosReservaPunto, buildFilters };
