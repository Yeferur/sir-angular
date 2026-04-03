// services/Reservas/reservas.service.js
const db = require('../../database/db');
const fs = require('fs');
const path = require('path');
const websocketManager = require('../../websocketManager');
const { recordHistorial, logSistema } = require('../Historial/logger');

/* ===========================
 * HELPERS
 * =========================== */
async function generarIdReservaUnico(idTour) {
  const [tourRows] = await db.query(
    'SELECT Abreviacion FROM tours WHERE Id_Tour = ? LIMIT 1',
    [idTour]
  );
  const abrev = tourRows?.[0]?.Abreviacion || 'RSV';
  let intentos = 0;
  while (intentos < 6) {
    const numero = Math.floor(10000 + Math.random() * 90000);
    const id = `${abrev}${numero}`;
    const [exists] = await db.query(
      'SELECT 1 FROM reservas WHERE Id_Reserva = ? LIMIT 1',
      [id]
    );
    if (!exists.length) return id;
    intentos++;
  }
  throw new Error('No se pudo generar Id_Reserva único.');
}

function validarFechaTourBogota(fechaTourIso) {
  if (!fechaTourIso) return;
  
  const hoyBogotaStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const hoyBogotaDate = new Date(`${hoyBogotaStr}T00:00:00`);
  
  const fechaRecibidaStr = String(fechaTourIso).split('T')[0];
  const fechaRecibidaDate = new Date(`${fechaRecibidaStr}T00:00:00`);
  
  if (fechaRecibidaDate < hoyBogotaDate) {
    const err = new Error(`La fecha reservada (${fechaRecibidaStr}) no puede ser pasada respecto a la fecha actual en America/Bogota.`);
    err.status = 400;
    throw err;
  }
}

const COMPROBANTE_FILE_RE = /^[a-zA-Z0-9._-]+$/;

function rutaComprobanteRelativaSegura(idReserva, fileName) {
  const safeName = String(fileName || '').trim();
  if (!COMPROBANTE_FILE_RE.test(safeName)) return null;
  return path.join('uploads', 'reservas', String(idReserva), safeName).replace(/\\/g, '/');
}

function normalizarRutaComprobanteExistente(input, idReserva) {
  const value = String(input || '').trim().replace(/\\/g, '/');
  if (!value || value === 'N/A') return value;

  const expectedPrefix = `uploads/reservas/${String(idReserva)}/`;
  if (!value.startsWith(expectedPrefix)) return '';

  const fileName = path.basename(value);
  if (!COMPROBANTE_FILE_RE.test(fileName)) return '';

  return `${expectedPrefix}${fileName}`;
}

async function resolverComprobanteSeguroPorNombre(nombreArchivo) {
  const fileName = String(nombreArchivo || '').trim();
  if (!COMPROBANTE_FILE_RE.test(fileName)) return null;

  const [rows] = await db.query(
    `SELECT Ruta_Comprobante
       FROM pagos_reservas
      WHERE Ruta_Comprobante LIKE ?
      ORDER BY Id_Pago DESC
      LIMIT 1`,
    [`%/${fileName}`]
  );

  if (!rows?.length) return null;

  const relative = String(rows[0].Ruta_Comprobante || '').replace(/\\/g, '/');
  if (!relative.startsWith('uploads/reservas/')) return null;

  const uploadsRoot = path.resolve(__dirname, '../../uploads');
  const absolutePath = path.resolve(__dirname, '../../', relative);
  if (!(absolutePath === uploadsRoot || absolutePath.startsWith(`${uploadsRoot}${path.sep}`))) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) return null;

  return { absolutePath };
}

const TOUR_PASSENGER_RULES = {
  1: { allowInfantes: false, minChildAge: 5 },
  5: { allowInfantes: true, minChildAge: 5 },
};

function normalizarTipoPasajero(tipo) {
  return String(tipo || '').trim().toUpperCase();
}

function contarCuposSolicitados(pasajerosArray = []) {
  return (pasajerosArray || []).reduce((acc, p) => {
    const tipo = normalizarTipoPasajero(p?.Tipo_Pasajero);
    return (tipo === 'ADULTO' || tipo === 'NINO') ? acc + 1 : acc;
  }, 0);
}

function normalizarTourParaCupos(idTour) {
  return (idTour == 1 || idTour == 5) ? 5 : Number(idTour);
}

function normalizarFechaYMD(fecha) {
  if (!fecha) return '';
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return String(fecha).slice(0, 10);
}

function distanciaHaversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function validarPuntosRecogidaLogistica(pasajeros, dbConnection) {
  const lista = Array.isArray(pasajeros) ? pasajeros : [];
  const idsUnicos = Array.from(
    new Set(
      lista
        .map((p) => p?.Id_Punto)
        .filter((id) => id !== undefined && id !== null && String(id).trim() !== '')
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
    )
  );

  if (idsUnicos.length <= 1) return;

  const placeholders = idsUnicos.map(() => '?').join(',');
  const [rows] = await dbConnection.query(
    `SELECT Id_Punto, ruta, Latitud, Longitud
       FROM puntos
      WHERE Id_Punto IN (${placeholders})`,
    idsUnicos
  );

  const puntos = rows || [];

  const rutasNoNulas = new Set(
    puntos
      .map((r) => (r?.ruta == null ? '' : String(r.ruta).trim()))
      .filter((r) => r !== '')
  );

  if (rutasNoNulas.size > 1) {
    throw new Error('Inviabilidad Logística: Todos los pasajeros de una misma reserva deben pertenecer a la misma ruta de recogida.');
  }

  for (let i = 0; i < puntos.length; i++) {
    const lat1 = Number(puntos[i]?.Latitud);
    const lon1 = Number(puntos[i]?.Longitud);
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1)) continue;

    for (let j = i + 1; j < puntos.length; j++) {
      const lat2 = Number(puntos[j]?.Latitud);
      const lon2 = Number(puntos[j]?.Longitud);
      if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) continue;

      const distancia = distanciaHaversineKm(lat1, lon1, lat2, lon2);
      if (distancia > 6) {
        throw new Error('Inviabilidad Logística: Los puntos de encuentro están demasiado separados (> 6km). Por favor, divida la reserva.');
      }
    }
  }
}

function validarReglasPasajerosPorTour(payload) {
  const cab = payload?.cabeceraReserva || {};
  const tourId = Number(cab.Id_Tour || 0);
  const rules = TOUR_PASSENGER_RULES[tourId];
  if (!rules) return;

  const pasajerosArray = Array.isArray(payload?.pasajeros) ? payload.pasajeros : [];
  for (const p of pasajerosArray) {
    const tipo = normalizarTipoPasajero(p?.Tipo_Pasajero);

    if (tipo === 'INFANTE' && rules.allowInfantes === false) {
      const err = new Error(`El tour ${tourId} no permite pasajeros INFANTE.`);
      err.status = 400;
      err.errorCode = 'TOUR_RULE_INFANTE_NOT_ALLOWED';
      throw err;
    }

    const edadRaw = p?.Edad ?? p?.Edad_Pasajero ?? p?.age ?? null;
    if (tipo === 'NINO' && rules.minChildAge != null && edadRaw != null && Number(edadRaw) < Number(rules.minChildAge)) {
      const err = new Error(`El tour ${tourId} requiere edad mínima de ${rules.minChildAge} años para tipo NINO.`);
      err.status = 400;
      err.errorCode = 'TOUR_RULE_MIN_AGE';
      throw err;
    }
  }
}

async function ensureDisponibilidadTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS Disponibilidad (
      Id_Disponibilidad BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      Id_Tour BIGINT UNSIGNED NOT NULL,
      Fecha_Tour DATE NOT NULL,
      Cupos_Totales INT NOT NULL DEFAULT 0,
      Cupos_Disponibles INT NOT NULL DEFAULT 0,
      Updated_At DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (Id_Disponibilidad),
      UNIQUE KEY ux_disponibilidad_tour_fecha (Id_Tour, Fecha_Tour)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function obtenerCupoTotalBase(conn, idTour, fechaTour) {
  const [cupoRows] = await conn.query(
    `SELECT COALESCE(
      (SELECT a.Cupo FROM aforos a WHERE a.Id_Tour = ? AND a.Fecha_Aforo = ? ORDER BY a.Id_Aforo DESC LIMIT 1),
      (SELECT t.Cupo_Base FROM tours t WHERE t.Id_Tour = ? LIMIT 1)
    ) AS CupoTotal`,
    [idTour, fechaTour, idTour]
  );
  return Number(cupoRows?.[0]?.CupoTotal || 0);
}

async function contarOcupadosGrupales(conn, idTour, fechaTour, excludeReservaId = null) {
  const sql = `
    SELECT COALESCE(SUM(CASE WHEN px.Tipo_Pasajero IN ('ADULTO', 'NINO') THEN 1 ELSE 0 END), 0) AS Ocupados
    FROM reservas res
    LEFT JOIN horarios h ON h.Id_Horario = res.Id_Horario
    LEFT JOIN pasajeros px ON px.Id_Reserva = res.Id_Reserva
    WHERE h.Id_Tour = ?
      AND res.Fecha_Tour = ?
      AND (res.Estado IS NULL OR res.Estado <> 'Cancelada')
      AND res.Tipo_Reserva = 'Grupal'
      ${excludeReservaId ? 'AND res.Id_Reserva <> ?' : ''}`;

  const params = excludeReservaId ? [idTour, fechaTour, excludeReservaId] : [idTour, fechaTour];
  const [rows] = await conn.query(sql, params);
  return Number(rows?.[0]?.Ocupados || 0);
}

async function obtenerCuposActualesReserva(conn, idReserva) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN Tipo_Pasajero IN ('ADULTO', 'NINO') THEN 1 ELSE 0 END), 0) AS Cupos
       FROM pasajeros
      WHERE Id_Reserva = ?`,
    [idReserva]
  );
  return Number(rows?.[0]?.Cupos || 0);
}

async function bloquearDisponibilidad(conn, idTour, fechaTour, excludeReservaId = null) {
  await ensureDisponibilidadTable(conn);

  const [rows] = await conn.query(
    `SELECT Cupos_Totales, Cupos_Disponibles
       FROM Disponibilidad
      WHERE Id_Tour = ? AND Fecha_Tour = ?
      FOR UPDATE`,
    [idTour, fechaTour]
  );

  if (rows?.length) {
    return {
      cuposTotales: Number(rows[0].Cupos_Totales || 0),
      cuposDisponibles: Number(rows[0].Cupos_Disponibles || 0),
    };
  }

  const cupoTotal = await obtenerCupoTotalBase(conn, idTour, fechaTour);
  const ocupados = await contarOcupadosGrupales(conn, idTour, fechaTour, excludeReservaId);
  const cuposDisponibles = Math.max(0, cupoTotal - ocupados);

  await conn.query(
    `INSERT INTO Disponibilidad (Id_Tour, Fecha_Tour, Cupos_Totales, Cupos_Disponibles)
     VALUES (?, ?, ?, ?)`,
    [idTour, fechaTour, cupoTotal, cuposDisponibles]
  );

  const [rows2] = await conn.query(
    `SELECT Cupos_Totales, Cupos_Disponibles
       FROM Disponibilidad
      WHERE Id_Tour = ? AND Fecha_Tour = ?
      FOR UPDATE`,
    [idTour, fechaTour]
  );

  return {
    cuposTotales: Number(rows2?.[0]?.Cupos_Totales || 0),
    cuposDisponibles: Number(rows2?.[0]?.Cupos_Disponibles || 0),
  };
}

async function validarYAplicarCuposTransaccional({ conn, idTour, fechaTour, cantidadNueva, cantidadAnterior = 0, excludeReservaId = null }) {
  const cupoInfo = await bloquearDisponibilidad(conn, idTour, fechaTour, excludeReservaId);
  const efectivos = Number(cupoInfo.cuposDisponibles || 0) + Number(cantidadAnterior || 0);

  if (efectivos < Number(cantidadNueva || 0)) {
    const err = new Error(`No hay cupos suficientes. Solicitados: ${cantidadNueva}, Disponibles: ${efectivos}`);
    err.status = 409;
    err.errorCode = 'OVERBOOKING_CONFLICT';
    throw err;
  }

  const restantes = efectivos - Number(cantidadNueva || 0);
  await conn.query(
    `UPDATE Disponibilidad
        SET Cupos_Disponibles = ?, Updated_At = CURRENT_TIMESTAMP(3)
      WHERE Id_Tour = ? AND Fecha_Tour = ?`,
    [restantes, idTour, fechaTour]
  );

  return { cuposDisponibles: restantes, cuposTotales: cupoInfo.cuposTotales };
}

/* ===========================
 * LISTADOS / LECTURA
 * =========================== */
async function filtrarReservas(q) {
  const params = (typeof q === 'object' && q !== null) ? q : { q: String(q || '') };

  const {
    Fecha_Tour, FechaRegistro, Id_Tour, Id_Canal, Estado,
    Id_Reserva, Idioma_Reserva, Telefono_Reportante,
    Nombre_Reportante, DNI, Punto
  } = params;

  const qTerm = String(params.q ?? params.NombreApellido ?? '').trim();

  const conds = [];
  const values = [];

  const like = (v) => `%${v}%`;

  if (Fecha_Tour) { conds.push(`r.Fecha_Tour = ?`); values.push(Fecha_Tour); }

  if (Id_Tour) {
    if (Array.isArray(Id_Tour)) {
      conds.push(`h.Id_Tour IN (${Id_Tour.map(() => '?').join(',')})`);
      values.push(...Id_Tour);
    } else { conds.push(`h.Id_Tour = ?`); values.push(Id_Tour); }
  }

  if (Id_Canal) {
    if (Array.isArray(Id_Canal)) {
      conds.push(`r.Id_Canal IN (${Id_Canal.map(() => '?').join(',')})`);
      values.push(...Id_Canal);
    } else { conds.push(`r.Id_Canal = ?`); values.push(Id_Canal); }
  }

  if (Estado) {
    if (Array.isArray(Estado)) {
      conds.push(`r.Estado IN (${Estado.map(() => '?').join(',')})`);
      values.push(...Estado);
    } else { conds.push(`r.Estado = ?`); values.push(Estado); }
  }

  if (Id_Reserva) { conds.push(`r.Id_Reserva = ?`); values.push(Id_Reserva); }
  if (Idioma_Reserva) { conds.push(`r.Idioma_Reserva = ?`); values.push(Idioma_Reserva); }
  if (Telefono_Reportante) { conds.push(`r.Telefono_Reportante LIKE ?`); values.push(like(Telefono_Reportante)); }
  if (Nombre_Reportante) { conds.push(`r.Nombre_Reportante LIKE ?`); values.push(like(Nombre_Reportante)); }

  if (DNI) {
    conds.push(`EXISTS (SELECT 1 FROM pasajeros px WHERE px.Id_Reserva = r.Id_Reserva AND px.DNI = ?)`);
    values.push(DNI);
  }

  if (qTerm) {
    conds.push(`(
      r.Id_Reserva LIKE ?
      OR r.Nombre_Reportante LIKE ?
      OR t.Nombre_Tour LIKE ?
      OR c.Nombre_Canal LIKE ?
      OR EXISTS (SELECT 1 FROM pasajeros px WHERE px.Id_Reserva = r.Id_Reserva AND px.Nombre_Pasajero LIKE ?)
      OR EXISTS (SELECT 1 FROM pasajeros px WHERE px.Id_Reserva = r.Id_Reserva AND px.DNI LIKE ?)
      OR EXISTS (SELECT 1 FROM puntos pt WHERE pt.Id_Punto = h.Id_Punto AND pt.Nombre_Punto LIKE ?)
      OR EXISTS (
        SELECT 1 FROM pasajeros px
        JOIN puntos pt2 ON pt2.Id_Punto = px.Id_Punto
        WHERE px.Id_Reserva = r.Id_Reserva AND pt2.Nombre_Punto LIKE ?
      )
    )`);
    const L = like(qTerm);
    values.push(L, L, L, L, L, L, L, L);
  }

  if (Punto) {
    const p = String(Punto).trim();
    if (p && p !== qTerm) {
      conds.push(`(
        EXISTS (SELECT 1 FROM puntos pt WHERE pt.Id_Punto = h.Id_Punto AND pt.Nombre_Punto LIKE ?)
        OR EXISTS (
          SELECT 1 FROM pasajeros px
          JOIN puntos pt2 ON pt2.Id_Punto = px.Id_Punto
          WHERE px.Id_Reserva = r.Id_Reserva AND pt2.Nombre_Punto LIKE ?
        )
      )`);
      const LP = like(p);
      values.push(LP, LP);
    }
  }

  if (FechaRegistro) { conds.push(`DATE(r.Fecha_Registro) = ?`); values.push(FechaRegistro); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      r.Id_Reserva, r.Fecha_Tour, h.Id_Tour, t.Nombre_Tour,
      r.Estado, r.Idioma_Reserva, r.Telefono_Reportante, r.Nombre_Reportante,
      COUNT(p.Id_Pasajero) AS Pasajeros
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
    ${where}
    GROUP BY r.Id_Reserva
    ORDER BY r.Fecha_Registro DESC
  `;

  console.log(where, values);
  const [rows] = await db.query(sql, values);
  return rows;
}


async function obtenerReserva(Id_Reserva) {
  const [cabRows] = await db.query(
    `
    SELECT 
      r.Id_Reserva,
      r.Tipo_Reserva,
      r.Fecha_Tour,
      r.Fecha_Registro,
      r.Estado,
      r.Observaciones,
      r.Idioma_Reserva,
      r.Telefono_Reportante,
      r.Nombre_Reportante,
      r.Placa_Bus,
      r.Orden_Ruta,
      t.Nombre_Tour,
      c.Nombre_Canal,
      h.Hora_Salida,
      pto.Nombre_Punto AS PuntoEncuentro
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal
    LEFT JOIN puntos pto ON pto.Id_Punto = h.Id_Punto
    WHERE r.Id_Reserva = ?
    LIMIT 1
    `,
    [Id_Reserva]
  );

  if (!cabRows.length) return null;
  const cab = cabRows[0];

  const [paxRows] = await db.query(
    `
    SELECT 
      Id_Pasajero,
      Id_Reserva,
      Nombre_Pasajero,
      DNI,
      Telefono_Pasajero,
      Tipo_Pasajero,
      Precio_Pasajero,
      Id_Punto,
      Confirmacion
    FROM pasajeros
    WHERE Id_Reserva = ?
    ORDER BY Id_Pasajero ASC
    `,
    [Id_Reserva]
  );

  const [pagosRows] = await db.query(
    `
    SELECT 
      Id_Pago,
      Id_Reserva,
      Monto,
      Tipo,
      Fecha_Pago,
      Observaciones,
      Ruta_Comprobante
    FROM pagos_reservas
    WHERE Id_Reserva = ?
    ORDER BY Fecha_Pago ASC, Id_Pago ASC
    `,
    [Id_Reserva]
  );

  const Pasajeros = paxRows.map(p => ({
    id: p.Id_Pasajero,
    NombrePasajero: p.Nombre_Pasajero,
    TipoPasajero:
      p.Tipo_Pasajero === 'ADULTO' ? 'Adulto' :
      p.Tipo_Pasajero === 'NINO'   ? 'Niño'   :
      'Infante',
    IdPas: p.DNI || '',
    TelefonoPasajero: p.Telefono_Pasajero || '',
    Precio_Pasajero: Number(p.Precio_Pasajero) || 0,
    Precio: '',
    Comision: '',
    Fecha: cab.Fecha_Tour,
    Confirmacion: Number(p.Confirmacion) || 0,
  }));

  const Pagos = pagosRows.map(pg => ({
    Id_Pago: pg.Id_Pago,
    Monto: Number(pg.Monto),
    Tipo: pg.Tipo,
    Fecha_Pago: pg.Fecha_Pago,
    Observaciones: pg.Observaciones,
    Ruta_Comprobante: pg.Ruta_Comprobante
  }));

  const data = {
    Id_Reserva: cab.Id_Reserva,
    Estado: cab.Estado || 'Pendiente',
    NumeroPasajeros: Pasajeros.length,
    TourReserva: cab.Nombre_Tour || '',
    PuntoEncuentro: cab.PuntoEncuentro || '',
    FechaReserva: cab.Fecha_Tour,
    HoraSalida: cab.Hora_Salida || '',
    IdiomaReserva: cab.Idioma_Reserva || '',
    CanalReserva: cab.Nombre_Canal || '',
    Observaciones: cab.Observaciones || '',
    Reportante: {
      Nombre: cab.Nombre_Reportante || '',
      Telefono: cab.Telefono_Reportante || ''
    },
    Pasajeros,
    Pagos
  };

  return data;
}

/* ===========================
 * CATÁLOGOS
 * =========================== */
async function obtenerCanales() {
  const [rows] = await db.query('SELECT * FROM canales_reservas');
  return rows;
}

async function obtenerMonedas() {
  const [rows] = await db.query('SELECT * FROM monedas');
  return rows;
}

async function obtenerTours() {
  const [rows] = await db.query('SELECT * FROM tours WHERE Activo = 1');
  return rows;
}

async function obtenerPlanesByTour(idTour) {
  const [rows] = await db.query(
    'SELECT * FROM planes_tours WHERE Id_Tour = ?',
    [idTour]
  );
  return rows;
}

async function obtenerPreciosPorFiltro(Id_Tour, Id_Plan, Id_Moneda) {
  const sql = `
    SELECT Tipo_Pasajero, Precio
    FROM tour_precios
    WHERE Id_Tour = ?
      AND (Id_Plan = ? OR ? IS NULL)
      AND (Id_Moneda = ? OR ? IS NULL)
  `;
  const [rows] = await db.query(sql, [
    Id_Tour,
    Id_Plan || null, Id_Plan || null,
    Id_Moneda || null, Id_Moneda || null
  ]);
  const map = {};
  for (const r of rows) map[r.Tipo_Pasajero] = Number(r.Precio);
  return map;
}

async function obtenerHorarios(Id_Tour, Id_Punto) {
  const [rows] = await db.query(
    `SELECT Id_Horario, Hora_Salida AS HoraSalida
       FROM horarios
      WHERE Id_Tour = ? AND Id_Punto = ?
      ORDER BY Id_Horario DESC
      LIMIT 1`,
    [Id_Tour, Id_Punto]
  );

  // Si no hay filas, devuelve null
  if (!rows.length) return null;

  return rows[0]; // 👈 Devuelve un objeto, no array
}


/* ===========================
 * CUPOS
 * =========================== */
async function verificarCupos(Fecha, Id_Tour, Cantidad, Id_Reserva) {
  let tourParaCupo = Id_Tour;
  let nombreTour = 'Tour desconocido';

  if (Id_Tour == 1 || Id_Tour == 5) tourParaCupo = 5;

  const sqlCupo = `
    SELECT COALESCE(
      (SELECT a.Cupo FROM aforos a WHERE a.Id_Tour = ? AND a.Fecha_Aforo = ? ORDER BY a.Id_Aforo DESC LIMIT 1),
      (SELECT t.Cupo_Base FROM tours t WHERE t.Id_Tour = ? LIMIT 1)
    ) AS CupoTotal`;
  const [cupoRows] = await db.query(sqlCupo, [tourParaCupo, Fecha, tourParaCupo]);
  const cupoTotal = Number(cupoRows?.[0]?.CupoTotal || 0);

  let ocupados = 0;
  if (typeof Id_Reserva !== 'undefined' && Id_Reserva !== null) {
    // Excluir los pasajeros de la reserva actual
    const sqlOcupados = `
      SELECT COALESCE(SUM(CASE WHEN p.Tipo_Pasajero IN ('ADULTO', 'NINO') THEN 1 ELSE 0 END), 0) AS Ocupados
      FROM reservas r
      LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
      LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = ?
        AND r.Fecha_Tour = ?
        AND (r.Estado IS NULL OR r.Estado <> 'Cancelada')
        AND r.Tipo_Reserva = 'Grupal'
        AND r.Id_Reserva <> ?`;
    const [ocRows] = await db.query(sqlOcupados, [Id_Tour, Fecha, Id_Reserva]);
    ocupados = Number(ocRows?.[0]?.Ocupados || 0);
  } else {
    const sqlOcupados = `
      SELECT COALESCE(SUM(CASE WHEN p.Tipo_Pasajero IN ('ADULTO', 'NINO') THEN 1 ELSE 0 END), 0) AS Ocupados
      FROM reservas r
      LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
      LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = ?
        AND r.Fecha_Tour = ?
        AND (r.Estado IS NULL OR r.Estado <> 'Cancelada')
        AND r.Tipo_Reserva = 'Grupal'`;
    const [ocRows] = await db.query(sqlOcupados, [Id_Tour, Fecha]);
    ocupados = Number(ocRows?.[0]?.Ocupados || 0);
  }

  if (Id_Tour != 1 && Id_Tour != 5) {
    const [nombreResult] = await db.query(
      `SELECT Nombre_Tour FROM tours WHERE Id_Tour = ? LIMIT 1`,
      [Id_Tour]
    );
    nombreTour = nombreResult[0]?.Nombre_Tour || 'Tour desconocido';
  } else {
    const [nombresResult] = await db.query(
      `SELECT Id_Tour, Nombre_Tour FROM tours WHERE Id_Tour IN (1,5)`
    );
    const nombresMap = {};
    for (const row of nombresResult) nombresMap[row.Id_Tour] = row.Nombre_Tour;
    nombreTour = `${nombresMap[1] || 'Tour 1'} Y ${nombresMap[5] || 'Tour 5'}`;
  }

  const disponiblesRaw = cupoTotal - ocupados;
  const disponibles = Math.max(0, disponiblesRaw);
  console.log('disponibles', disponiblesRaw, "CupoTotal", cupoTotal, "Ocupados", ocupados, "Cantidad solicitada", Cantidad);
  return {
    disponible: disponiblesRaw >= Number(Cantidad || 0),
    cupoTotal,
    ocupados,
    cuposDisponibles: disponibles,
    nombreTour
  };
}

/* ===========================
 * CREACIÓN (TRANSACCIÓN)
 * =========================== */
async function crearReservaConPasajerosYPagos(payload, filesMap = {}, userId = null, clientIp = null) {
  let conn;
  try {
    if (!payload || !payload.cabeceraReserva) {
      throw new Error('Payload inválido: falta cabeceraReserva');
    }
    if (!payload.cabeceraReserva.Fecha_Tour) {
      const err = new Error('La fecha del tour es obligatoria');
      err.status = 400;
      throw err;
    }

    validarReglasPasajerosPorTour(payload);
    validarFechaTourBogota(payload.cabeceraReserva.Fecha_Tour);

    conn = await db.getConnection();

  await validarPuntosRecogidaLogistica(payload?.pasajeros, conn);

    await conn.beginTransaction();

    const r = payload.cabeceraReserva;
    const tipoReserva = r.Tipo_Reserva || 'Grupal';
    const pasajerosArray = Array.isArray(payload.pasajeros) ? payload.pasajeros : [];
    const cantidadSolicitada = contarCuposSolicitados(pasajerosArray);

    // Primera operación transaccional: bloqueo y verificación de disponibilidad.
    if (tipoReserva.toLowerCase() === 'grupal' && cantidadSolicitada > 0) {
      await validarYAplicarCuposTransaccional({
        conn,
        idTour: normalizarTourParaCupos(r.Id_Tour),
        fechaTour: normalizarFechaYMD(r.Fecha_Tour),
        cantidadNueva: cantidadSolicitada,
      });
    }

    // --- CÁLCULO DE ESTADO DE RESERVA EN SERVER (SEGURO) ---
    const pagosArray = Array.isArray(payload.pagos) ? payload.pagos : [];
    const totalAbonado = pagosArray.reduce((sum, pag) => sum + Number(pag.Monto || 0), 0);
    const totalVenta = pasajerosArray.reduce((sum, px) => sum + Number(px.Precio_Pasajero || 0), 0);
    
    let estadoCalculado = 'Pendiente';
    if (pagosArray.some(p => p.Tipo === 'Pago Directo' || p.Tipo === 'Pago Completo') || (totalAbonado > 0 && totalAbonado >= totalVenta)) {
      estadoCalculado = 'Confirmada';
    }

    const idReserva = await generarIdReservaUnico(r.Id_Tour);

    await conn.query(
      `INSERT INTO reservas
       (Id_Reserva, Tipo_Reserva, Id_Horario, Fecha_Tour, Id_Canal, Idioma_Reserva,
        Telefono_Reportante, Nombre_Reportante, Estado, Observaciones, Placa_Bus, Orden_Ruta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idReserva,
        r.Tipo_Reserva || 'Grupal',
        r.Id_Horario || null,
        r.Fecha_Tour,
        r.Id_Canal || null,
        r.Idioma_Reserva || 'ESPAÑOL',
        r.Telefono_Reportante || null,
        r.Nombre_Reportante || null,
        estadoCalculado,
        r.Observaciones || null,
        r.Placa_Bus || null,
        r.Orden_Ruta || null,
      ]
    );

    if (pasajerosArray.length > 0) {
      for (const p of pasajerosArray) {
        await conn.query(
          `INSERT INTO pasajeros
           (Id_Reserva, Nombre_Pasajero, DNI, Telefono_Pasajero, Tipo_Pasajero,
            Precio_Tour, Precio_Pasajero, Comision, Id_Punto, Confirmacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            idReserva,
            p.Nombre_Pasajero || '',
            p.DNI || null,
            p.Telefono_Pasajero || null,
            p.Tipo_Pasajero,
            p.Precio_Tour || 0,
            p.Precio_Pasajero || 0,
            p.Comision ?? 0,
            p.Id_Punto || null,
            p.Confirmacion ? 1 : 0
          ]
        );
      }
    }

    const baseDir = path.join(__dirname, '../../uploads', 'reservas', String(idReserva));
    fs.mkdirSync(baseDir, { recursive: true });

    if (pagosArray.length > 0) {
      let abonoIdx = 0;
      for (const pago of pagosArray) {
        const tipo = (pago.Tipo === 'Pago Directo' || pago.Tipo === 'Pago Completo' || pago.Tipo === 'Abono')
          ? pago.Tipo
          : 'Abono';

        let rutaComprobante = 'N/A';

        if (tipo !== 'Pago Directo') {
          const field = pago.fileField;
          const f = field ? filesMap[field] : undefined;
          if (f && f.buffer) {
            const fileName = f.safeName || `${Date.now()}_${Math.random().toString(36).slice(2)}.bin`;
            const dest = path.join(baseDir, fileName);
            fs.writeFileSync(dest, f.buffer);
            rutaComprobante = rutaComprobanteRelativaSegura(idReserva, fileName) || '';
            if (tipo === 'Abono') abonoIdx++;
          } else if (pago.Ruta_Comprobante) {
            rutaComprobante = normalizarRutaComprobanteExistente(pago.Ruta_Comprobante, idReserva);
          } else {
            rutaComprobante = '';
          }
        }

        await conn.query(
          `INSERT INTO pagos_reservas
           (Id_Reserva, Monto, Tipo, Fecha_Pago, Observaciones, Ruta_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            idReserva,
            Number(pago.Monto || 0),
            tipo,
            pago.Fecha_Pago || new Date(),
            pago.Observaciones || null,
            rutaComprobante
          ]
        );
      }
    }

    await recordHistorial({ conexion: conn, tabla: 'reservas', id_registro: idReserva, accion: 'CREAR', id_usuario: userId, detalles: [ { columna: 'Id_Tour', anterior: null, nuevo: r.Id_Tour }, { columna: 'Fecha_Tour', anterior: null, nuevo: r.Fecha_Tour }, { columna: 'Estado', anterior: null, nuevo: estadoCalculado } ] });

    await conn.commit();

    if (payload?.cabeceraReserva?.Fecha_Tour) {
      websocketManager.broadcastReservaEvento({
        type: 'reservaCreada',
        Fecha_Tour: payload.cabeceraReserva.Fecha_Tour,
        Id_Tour: payload.cabeceraReserva.Id_Tour,
        Id_Reserva: idReserva || null,
      });
    }
    
    return { Id_Reserva: idReserva };
  } catch (error) {
    if (conn) await conn.rollback();
    try { await logSistema({ mensaje: `crearReserva error: ${error.message || error}`, meta: { payloadSummary: { Id_Tour: payload?.cabeceraReserva?.Id_Tour } } }); } catch (_) {}
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/* ===========================
 * COMISIONES
 * =========================== */
async function obtenerComisiones(Id_Tour, Id_Canal) {
  const sql = `
    SELECT
      CASE WHEN c.Id_Canal = 1 THEN t.Comision_Hotel
           WHEN c.Id_Canal = 2 THEN t.Comision_Agencia
           WHEN c.Id_Canal = 4 THEN t.Comision_Freelance
           ELSE 0 END AS Comision,
      'ADULTO' AS Tipo_Pasajero
    FROM tours t
    JOIN canales_reservas c ON c.Id_Canal = ?
    WHERE t.Id_Tour = ?
    UNION ALL
    SELECT
      CASE WHEN c.Id_Canal = 1 THEN t.Comision_Hotel
           WHEN c.Id_Canal = 2 THEN t.Comision_Agencia
           WHEN c.Id_Canal = 4 THEN t.Comision_Freelance
           ELSE 0 END AS Comision,
      'NINO' AS Tipo_Pasajero
    FROM tours t
    JOIN canales_reservas c ON c.Id_Canal = ?
    WHERE t.Id_Tour = ?
  `;
  const [rows] = await db.query(sql, [Id_Canal, Id_Tour, Id_Canal, Id_Tour]);
  const result = {};
  for (const row of rows) result[row.Tipo_Pasajero] = row.Comision;
  return result;
}

/* ===========================
 * DETALLE PARA EDICIÓN
 * =========================== */
async function obtenerReservaDetalle(Id_Reserva) {
  // Cabecera (sin r.Id_Moneda). Se deriva una moneda sugerida desde tour_precios.
  const [cabRows] = await db.query(
    `
    SELECT
      r.Id_Reserva,
      h.Id_Tour AS Id_Tour,
      r.Id_Horario,
      r.Fecha_Tour,
      r.Id_Canal,
      r.Idioma_Reserva,
      r.Estado,
      r.Observaciones,
      r.Tipo_Reserva,
      r.Nombre_Reportante,
      r.Telefono_Reportante,
      h.Id_Punto,
      (
        SELECT tp.Id_Moneda
        FROM tour_precios tp
        WHERE tp.Id_Tour = h.Id_Tour
        ORDER BY tp.Id_Moneda IS NULL, tp.Id_Moneda
        LIMIT 1
      ) AS Id_Moneda_Sugerida
    FROM reservas r
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE r.Id_Reserva = ?
    LIMIT 1
    `,
    [Id_Reserva]
  );
  if (!cabRows.length) return null;
  const cab = cabRows[0];

  // Pasajeros (incluye Comision)
  const [paxRows] = await db.query(
    `
    SELECT
      Id_Pasajero,
      Nombre_Pasajero,
      DNI,
      Telefono_Pasajero,
      Tipo_Pasajero,
      Precio_Tour,
      Precio_Pasajero,
      Comision,
      Id_Punto,
      Confirmacion
    FROM pasajeros
    WHERE Id_Reserva = ?
    ORDER BY Id_Pasajero ASC
    `,
    [Id_Reserva]
  );

  // Pagos
  const [pagosRows] = await db.query(
    `
    SELECT
      Id_Pago,
      Monto,
      Tipo,
      Fecha_Pago,
      Observaciones,
      Ruta_Comprobante
    FROM pagos_reservas
    WHERE Id_Reserva = ?
    ORDER BY Fecha_Pago ASC, Id_Pago ASC
    `,
    [Id_Reserva]
  );

  const Cabecera = {
    Id_Reserva: cab.Id_Reserva,
    Id_Tour: cab.Id_Tour,
    Id_Horario: cab.Id_Horario,
    Fecha_Tour: cab.Fecha_Tour.toISOString().slice(0, 10),
    Id_Canal: cab.Id_Canal,
    Idioma_Reserva: cab.Idioma_Reserva,
    Estado: cab.Estado || 'Pendiente',
    Observaciones: cab.Observaciones || null,
    Tipo_Reserva: cab.Tipo_Reserva || 'Grupal',
    Nombre_Reportante: cab.Nombre_Reportante || '',
    Telefono_Reportante: cab.Telefono_Reportante || '',
    Id_Punto: cab.Id_Punto || null,
    Id_Moneda_Sugerida: cab.Id_Moneda_Sugerida || null, // para inicializar selector en front
  };

  const Pasajeros = paxRows.map(r => ({
    Id_Pasajero: r.Id_Pasajero,
    Tipo_Pasajero: r.Tipo_Pasajero,
    Nombre_Pasajero: r.Nombre_Pasajero || '',
    DNI: r.DNI || null,
    Telefono_Pasajero: r.Telefono_Pasajero || null,
    Id_Punto: r.Id_Punto || cab.Id_Punto || null,
    Precio_Tour: Number(r.Precio_Tour || 0),
    Precio_Pasajero: Number(r.Precio_Pasajero || 0),
    Comision: Number(r.Comision || 0),
    Confirmacion: !!r.Confirmacion,
  }));

  const Pagos = pagosRows.map(p => ({
    Id_Pago: p.Id_Pago,
    Tipo: p.Tipo,
    Monto: Number(p.Monto || 0),
    Fecha: p.Fecha_Pago,
    Observaciones: p.Observaciones || null,
    SoporteUrl: p.Ruta_Comprobante || null
  }));

  console.log(Cabecera, Pasajeros, Pagos);

  return { Cabecera, Pasajeros, Pagos };
}

/* ===========================
 * ACTUALIZACIÓN (TRANSACCIÓN)
 * =========================== */
async function actualizarReservaConPasajerosYPagos(Id_Reserva, payload, filesMap = {}, userId = null, clientIp = null) {
  let conn;
  try {
    validarReglasPasajerosPorTour(payload);

    conn = await db.getConnection();
    await validarPuntosRecogidaLogistica(payload?.pasajeros, conn);
    if (payload?.cabeceraReserva?.Fecha_Tour) {
      validarFechaTourBogota(payload.cabeceraReserva.Fecha_Tour);
    }
    await conn.beginTransaction();

    const [currentReservaRows] = await conn.query(
      `SELECT Id_Reserva, Id_Tour, Fecha_Tour, Tipo_Reserva, Estado
         FROM reservas
        WHERE Id_Reserva = ?
        LIMIT 1
        FOR UPDATE`,
      [Id_Reserva]
    );
    if (!currentReservaRows?.length) {
      const err = new Error('Reserva no encontrada');
      err.status = 404;
      err.errorCode = 'RESERVA_NOT_FOUND';
      throw err;
    }

    const r = payload?.cabeceraReserva || {};
    const currentReserva = currentReservaRows[0];
    const pasajerosArray = Array.isArray(payload?.pasajeros) ? payload.pasajeros : [];
    const pagosArray = Array.isArray(payload?.pagos) ? payload.pagos : [];

    const idTourFinal = Number(r.Id_Tour || currentReserva.Id_Tour);
    const fechaTourFinal = normalizarFechaYMD(r.Fecha_Tour || currentReserva.Fecha_Tour);
    const tipoReservaFinal = String(r.Tipo_Reserva || currentReserva.Tipo_Reserva || 'Grupal');

    // Primera operación transaccional: bloqueo y verificación de disponibilidad.
    if (tipoReservaFinal.toLowerCase() === 'grupal') {
      const cuposAntes = await obtenerCuposActualesReserva(conn, Id_Reserva);
      const cantidadSolicitada = payload?.pasajeros !== undefined
        ? contarCuposSolicitados(pasajerosArray)
        : cuposAntes;

      await validarYAplicarCuposTransaccional({
        conn,
        idTour: normalizarTourParaCupos(idTourFinal),
        fechaTour: fechaTourFinal,
        cantidadNueva: cantidadSolicitada,
        cantidadAnterior: cuposAntes,
        excludeReservaId: Id_Reserva,
      });
    }

    const estadoAnterior = currentReserva.Estado || null;

    // --- CÁLCULO DE ESTADO DE RESERVA EN SERVER ---
    const totalAbonado = pagosArray.reduce((sum, pag) => sum + Number(pag.Monto || 0), 0);
    const totalVenta = pasajerosArray.reduce((sum, px) => sum + Number(px.Precio_Pasajero || 0), 0);
    
    let estadoCalculado = 'Pendiente';
    if (pagosArray.some(p => p.Tipo === 'Pago Directo' || p.Tipo === 'Pago Completo') || (totalAbonado > 0 && totalAbonado >= totalVenta)) {
      estadoCalculado = 'Confirmada';
    }

    // 1) Update cabecera
    if (payload?.cabeceraReserva) {
      const fields = [];
      const vals = [];
      const setIf = (col, val) => { fields.push(`${col} = ?`); vals.push(val); };

      if (r.Tipo_Reserva !== undefined) setIf('Tipo_Reserva', r.Tipo_Reserva);
      if (r.Id_Horario !== undefined) setIf('Id_Horario', r.Id_Horario || null);
      if (r.Fecha_Tour !== undefined) setIf('Fecha_Tour', r.Fecha_Tour);
      if (r.Id_Canal !== undefined) setIf('Id_Canal', r.Id_Canal);
      if (r.Idioma_Reserva !== undefined) setIf('Idioma_Reserva', r.Idioma_Reserva);
      if (r.Telefono_Reportante !== undefined) setIf('Telefono_Reportante', r.Telefono_Reportante);
      if (r.Nombre_Reportante !== undefined) setIf('Nombre_Reportante', r.Nombre_Reportante);
      if (r.Observaciones !== undefined) setIf('Observaciones', r.Observaciones);
      if (r.Id_Tour !== undefined) setIf('Id_Tour', r.Id_Tour);
      
      // Estado calculado desde el backend
      setIf('Estado', estadoCalculado);

      if (fields.length) {
        const sql = `UPDATE reservas SET ${fields.join(', ')} WHERE Id_Reserva = ?`;
        await conn.query(sql, [...vals, Id_Reserva]);
      }
    }

    // 2) Reemplazo total de pasajeros
    if (pasajerosArray.length > 0 || payload.pasajeros !== undefined) {
      await conn.query('DELETE FROM pasajeros WHERE Id_Reserva = ?', [Id_Reserva]);

      for (const p of pasajerosArray) {
        await conn.query(
          `INSERT INTO pasajeros
           (Id_Reserva, Nombre_Pasajero, DNI, Telefono_Pasajero, Tipo_Pasajero,
            Precio_Tour, Precio_Pasajero, Comision, Id_Punto, Confirmacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            Id_Reserva,
            p.Nombre_Pasajero || '',
            p.DNI || null,
            p.Telefono_Pasajero || null,
            p.Tipo_Pasajero,
            p.Precio_Tour || 0,
            p.Precio_Pasajero || 0,
            p.Comision ?? 0,
            p.Id_Punto || null,
            p.Confirmacion ? 1 : 0
          ]
        );
      }
    }

    // 3) Pagos
    const baseDir = path.join(__dirname, '../../uploads', 'reservas', String(Id_Reserva));
    fs.mkdirSync(baseDir, { recursive: true });

    if (pagosArray.length > 0 || payload.pagos !== undefined) {
      let abonoIdx = 0;
      const pagosDirectoCompleto = pagosArray.filter(p => p.Tipo === 'Pago Directo' || p.Tipo === 'Pago Completo');
      if (pagosDirectoCompleto.length === 1 && pagosArray.length === 1) {
        await conn.query('DELETE FROM pagos_reservas WHERE Id_Reserva = ?', [Id_Reserva]);
      }
      for (const pago of pagosArray) {
        const tipo = (pago.Tipo === 'Pago Directo' || pago.Tipo === 'Pago Completo' || pago.Tipo === 'Abono') ? pago.Tipo : 'Abono';
        let rutaComprobante = 'N/A';
        if (tipo !== 'Pago Directo') {
          const field = pago.fileField;
          const f = field ? filesMap[field] : undefined;
          if (f && f.buffer) {
            const fileName = f.safeName || `${Date.now()}_${Math.random().toString(36).slice(2)}.bin`;
            const dest = path.join(baseDir, fileName);
            fs.writeFileSync(dest, f.buffer);
            rutaComprobante = rutaComprobanteRelativaSegura(Id_Reserva, fileName) || '';
            if (tipo === 'Abono') abonoIdx++;
          } else if (pago.Ruta_Comprobante || pago.SoporteUrl) {
            rutaComprobante = normalizarRutaComprobanteExistente(pago.Ruta_Comprobante || pago.SoporteUrl, Id_Reserva);
          } else {
            rutaComprobante = '';
          }
        }
        await conn.query(
          `INSERT INTO pagos_reservas
           (Id_Reserva, Monto, Tipo, Fecha_Pago, Observaciones, Ruta_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            Id_Reserva,
            Number(pago.Monto || 0),
            tipo,
            pago.Fecha || new Date(),
            pago.Observaciones || null,
            rutaComprobante
          ]
        );
      }
    }

    await recordHistorial({ conexion: conn, tabla: 'reservas', id_registro: Id_Reserva, accion: 'ACTUALIZAR', id_usuario: userId, detalles: [ { columna: 'Estado', anterior: estadoAnterior, nuevo: estadoCalculado }, { columna: 'Id_Tour', anterior: currentReserva.Id_Tour, nuevo: idTourFinal }, { columna: 'Fecha_Tour', anterior: normalizarFechaYMD(currentReserva.Fecha_Tour), nuevo: fechaTourFinal } ] });

    await conn.commit();

    if (payload?.cabeceraReserva?.Fecha_Tour) {
      websocketManager.broadcastReservaEvento({
        type: 'reservaActualizada',
        Fecha_Tour: payload.cabeceraReserva.Fecha_Tour,
        Id_Tour: payload.cabeceraReserva.Id_Tour,
        Id_Reserva,
      });
    }

    return { Id_Reserva };
  } catch (error) {
    if (conn) await conn.rollback();
    try { await logSistema({ mensaje: `actualizarReserva error: ${error.message || error}`, meta: { Id_Reserva, payloadSummary: { Id_Tour: payload?.cabeceraReserva?.Id_Tour } } }); } catch (_) {}
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/* ===========================
 * UTIL
 * =========================== */
async function getPuntoByIdSvc(Id_Punto) {
  const [rows] = await db.query(
    `SELECT Id_Punto, Nombre_Punto AS NombrePunto
       FROM puntos
      WHERE Id_Punto = ?
      LIMIT 1`,
    [Id_Punto]
  );
  return rows?.[0] || null;
}

/* ===========================
 * VERIFICACIÓN DNI DUPLICADO
 * =========================== */
async function verificarDniDuplicado(dni, fecha, excludeReservaId) {
  if (!dni || !fecha) return { exists: false };
  
  const queryStr = `SELECT 
      r.Id_Reserva,
      r.Fecha_Tour,
      r.Estado,
      r.Nombre_Reportante,
      r.Telefono_Reportante,
      p.Nombre_Pasajero,
      p.DNI,
      t.Nombre_Tour
    FROM pasajeros p
    JOIN reservas r ON r.Id_Reserva = p.Id_Reserva
    LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    WHERE p.DNI = ? AND r.Fecha_Tour = ? ${excludeReservaId ? 'AND r.Id_Reserva != ?' : ''}
    LIMIT 1`;

  const params = excludeReservaId ? [dni, fecha, excludeReservaId] : [dni, fecha];
  
  const [rows] = await db.query(queryStr, params);
  
  if (rows.length > 0) {
    return {
      exists: true,
      reserva: rows[0]
    };
  }
  
  return { exists: false };
}

async function obtenerHistorialCambiosReserva(Id_Reserva, limit = 25) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));

  const [rows] = await db.query(
    `SELECT
      h.Id_Historial,
      h.Id_Registro,
      h.Id_Usuario,
      h.Accion,
      h.Fecha_Hora_Registro,
      u.Nombres_Apellidos AS Usuario_Nombre,
      d.Columna,
      d.Valor_Anterior,
      d.Valor_Nuevo
    FROM historial h
    LEFT JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
    LEFT JOIN detalle_historial d ON d.Id_Historial = h.Id_Historial
    WHERE h.Tabla = 'reservas'
      AND CAST(h.Id_Registro AS CHAR) = ?
    ORDER BY h.Fecha_Hora_Registro DESC, d.Id_Detalle ASC
    LIMIT ?`,
    [String(Id_Reserva), safeLimit * 10]
  );

  const grouped = new Map();

  for (const row of rows || []) {
    const key = Number(row.Id_Historial);
    if (!grouped.has(key)) {
      grouped.set(key, {
        Id_Cambio: key,
        Id_Reserva: String(row.Id_Registro || Id_Reserva),
        Fecha_Registro: row.Fecha_Hora_Registro,
        Id_Usuario: row.Id_Usuario,
        Usuario_Nombre: row.Usuario_Nombre || (row.Id_Usuario ? `Usuario #${row.Id_Usuario}` : 'Sistema'),
        accion: row.Accion || 'ACTUALIZAR',
        estadoAnterior: null,
        estadoNuevo: null,
        cambios: [],
      });
    }

    if (row.Columna) {
      const item = grouped.get(key);
      item.cambios.push({
        columna: row.Columna,
        anterior: row.Valor_Anterior,
        nuevo: row.Valor_Nuevo,
      });

      const col = String(row.Columna || '').toUpperCase();
      if (col === 'ESTADO') {
        item.estadoAnterior = row.Valor_Anterior || null;
        item.estadoNuevo = row.Valor_Nuevo || null;
      }
    }
  }

  return Array.from(grouped.values())
    .slice(0, safeLimit)
    .map((item) => {
      let resumen = `Accion ${item.accion} sobre la reserva.`;
      if (item.estadoAnterior !== item.estadoNuevo) {
        resumen = `Estado cambio de ${item.estadoAnterior || 'Sin estado'} a ${item.estadoNuevo || 'Sin estado'}.`;
      } else if (item.cambios.length > 0) {
        resumen = `Se actualizaron ${item.cambios.length} campo(s) de la reserva.`;
      }

      return {
        Id_Cambio: item.Id_Cambio,
        Id_Reserva: item.Id_Reserva,
        Fecha_Registro: item.Fecha_Registro,
        Id_Usuario: item.Id_Usuario,
        Usuario_Nombre: item.Usuario_Nombre,
        estadoAnterior: item.estadoAnterior,
        estadoNuevo: item.estadoNuevo,
        accion: item.accion,
        resumen,
      };
    });
}

module.exports = {
  // list/read
  filtrarReservas,
  obtenerReserva,
  verificarCupos,
  // catalogs
  obtenerCanales,
  obtenerMonedas,
  obtenerTours,
  obtenerPlanesByTour,
  obtenerPreciosPorFiltro,
  obtenerHorarios,
  // create/update
  crearReservaConPasajerosYPagos,
  actualizarReservaConPasajerosYPagos,
  // detail + aux
  obtenerReservaDetalle,
  obtenerComisiones,
  getPuntoByIdSvc,
  resolverComprobanteSeguroPorNombre,
  // verificación
  verificarDniDuplicado,
  obtenerHistorialCambiosReserva,
};
