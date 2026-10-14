const { reservasOperativasSource } = require('../schema-capabilities');
const db = require('../../database/db');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function validDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function buildFilters(query = {}) {
  const conditions = [];
  const values = [];
  const passengerConditions = [];
  const passengerValues = [];
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
  const passengerName = String(query.nombrePasajero || '').trim().slice(0, 255);
  const document = String(query.documento || '').trim().slice(0, 50);
  const category = Number(query.categoria);

  if (dateFrom) { conditions.push('r.Fecha_Registro >= ?'); values.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { conditions.push('r.Fecha_Registro < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(dateTo); }
  if (fechaTour) { conditions.push('r.Fecha_Tour = ?'); values.push(fechaTour); }
  if (bookingCode) { conditions.push('r.Id_Reserva = ?'); values.push(bookingCode); }
  if (Number.isSafeInteger(category) && category > 0) { conditions.push('r.Id_Canal = ?'); values.push(category); }
  if (passengerName || document) {
    if (passengerName) { passengerConditions.push('p.Nombre_Pasajero LIKE ?'); passengerValues.push(`${passengerName}%`); }
    if (document) { passengerConditions.push('p.DNI = ?'); passengerValues.push(document); }
    conditions.push(`EXISTS (SELECT 1 FROM pasajeros p WHERE p.Id_Reserva = r.Id_Reserva AND ${passengerConditions.join(' AND ')})`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    passengerName,
    document,
    passengerConditions,
    passengerValues,
  };
}

function paginationValue(value, fallback, max) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

async function buscarReservasMercadeo(query = {}) {
  const { where, values, passengerName, document, passengerConditions, passengerValues } = buildFilters(query);
  const requestedPage = paginationValue(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = paginationValue(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const [summaryRows] = await db.query(`
    SELECT COUNT(DISTINCT r.Id_Reserva) AS totalReservas,
           COUNT(DISTINCT p.Id_Pasajero) AS totalPasajeros
    FROM ${reservasOperativasSource('r')}
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva${passengerConditions.length ? ` AND ${passengerConditions.join(' AND ')}` : ''}
    ${where}
  `, [...passengerValues, ...values, ...passengerValues]);
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
           c.Nombre_Canal AS Categoria,
           r.Creado_Por AS CreadorId,
           u.Nombres_Apellidos AS UsuarioCreador
    FROM ${reservasOperativasSource('r')}
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN usuarios u ON u.Id_Usuario = r.Creado_Por
    ${where}
    ORDER BY r.Fecha_Registro DESC, r.Id_Reserva DESC
    LIMIT ? OFFSET ?
  `, [...values, ...passengerValues, pageSize, offset]);

  const ids = reservas.map((row) => row.Id_Reserva);
  let pasajerosPorReserva = new Map();
  if (ids.length) {
    const idPlaceholders = ids.map(() => '?').join(',');
    const passengerConditions = [`Id_Reserva IN (${idPlaceholders})`];
    const passengerValues = [...ids];
    if (passengerName) { passengerConditions.push('Nombre_Pasajero LIKE ?'); passengerValues.push(`${passengerName}%`); }
    if (document) { passengerConditions.push('DNI = ?'); passengerValues.push(document); }
    const [passengers] = await db.query(`
      SELECT Id_Reserva, Id_Pasajero, Nombre_Pasajero, DNI
      FROM pasajeros
      WHERE ${passengerConditions.join(' AND ')}
      ORDER BY Id_Reserva, Id_Pasajero
    `, passengerValues);
    pasajerosPorReserva = new Map(ids.map((id) => [String(id), []]));
    for (const passenger of passengers) {
      pasajerosPorReserva.get(String(passenger.Id_Reserva))?.push({
        id: passenger.Id_Pasajero,
        nombre: passenger.Nombre_Pasajero,
        documento: passenger.DNI,
      });
    }
  }

  return {
    items: reservas.map((reserva) => ({
      ...reserva,
      pasajeros: pasajerosPorReserva.get(String(reserva.Id_Reserva)) || [],
    })),
    page,
    pageSize,
    totalPages,
    totalReservas,
    totalPasajeros,
  };
}

async function obtenerCategoriasMercadeo() {
  const [rows] = await db.query(`
    SELECT Id_Canal, Nombre_Canal
    FROM canales_reservas
    ORDER BY Nombre_Canal
  `);
  return rows;
}

module.exports = { buscarReservasMercadeo, obtenerCategoriasMercadeo, buildFilters };
