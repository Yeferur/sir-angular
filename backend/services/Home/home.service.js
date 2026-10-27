const { reservasOperativasSource, getSchemaCapabilities } = require('../schema-capabilities');
const { passengerSeatSql, consumingReservationSql, activeReservationSql } = require('../Reservas/cupos-compartidos');
const db = require('../../database/db');
const crypto = require('crypto');
const { isClientRoleName } = require('../../utils/clientAccess');
const { syncHomeProcesses } = require('../Pendientes/home-process-detector.service');
const { jornadaConfirmada } = require('../Confirmacion/confirmacion.service');
const { consolidateCapacityAlerts } = require('../Aforos/shared-capacity.service');

const ACTIVE_RESERVATION_SQL = activeReservationSql('r');
const ACTIVE_TRANSFER_SQL = "UPPER(TRIM(COALESCE(tr.Estado, ''))) NOT IN ('CANCELADA','CANCELADO','ANULADA','ANULADO','ELIMINADA','ELIMINADO')";

function bogotaDate(offsetDays = 0) {
  const base = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
  const date = new Date(`${parts}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function hasAnyPermission(permissions, ...codes) {
  const available = new Set(Array.isArray(permissions) ? permissions : []);
  return codes.some((code) => available.has(code));
}

function commissionProcess(rows = []) {
  const situations = (rows || []).map((row) => ({
    reservationId: String(row.Id_Reserva),
    date: String(row.Fecha_Tour),
    tourId: row.Id_Tour == null ? null : String(row.Id_Tour),
    tourName: String(row.Nombre_Tour || '').trim() || null,
  })).sort((a, b) => `${a.date}:${a.reservationId}`.localeCompare(`${b.date}:${b.reservationId}`));
  const dates = situations.map((item) => item.date).filter(Boolean);
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;
  const count = situations.length;
  const tours = new Map();
  for (const item of situations) {
    if (item.tourId && item.tourName) tours.set(item.tourId, item.tourName);
  }
  const uniqueTour = tours.size === 1 ? Array.from(tours.entries())[0] : null;
  const period = periodStart && periodEnd
    ? (periodStart === periodEnd ? `del ${periodStart}` : `entre ${periodStart} y ${periodEnd}`)
    : '';
  return {
    count,
    periodStart,
    periodEnd,
    tourId: uniqueTour?.[0] || null,
    tourName: uniqueTour?.[1] || null,
    notificationIdentity: count
      ? crypto.createHash('sha256').update(situations.map((item) => `${item.reservationId}:${item.date}`).join('|')).digest('hex')
      : null,
    description: count
      ? `${count} ${count === 1 ? 'reserva viajada' : 'reservas viajadas'} ${period} ${count === 1 ? 'tiene comisión pendiente' : 'tienen comisiones pendientes'}.`
      : 'No hay reservas viajadas con comisiones pendientes.',
  };
}

async function filterUnconfirmedJourneys(rows = [], isConfirmed = jornadaConfirmada) {
  const pairs = new Map();
  for (const row of rows || []) {
    const tour = Number(row.Id_Tour);
    const date = String(row.Fecha_Tour || '').slice(0, 10);
    if (tour > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)) pairs.set(`${tour}:${date}`, { tour, date });
  }
  const states = new Map(await Promise.all(Array.from(pairs, async ([key, pair]) => [
    key,
    await isConfirmed(pair.tour, pair.date),
  ])));
  return (rows || []).filter((row) => !states.get(`${Number(row.Id_Tour)}:${String(row.Fecha_Tour || '').slice(0, 10)}`));
}

async function filterCommissionRowsByJourneyConfirmation(rows = [], isConfirmed = jornadaConfirmada) {
  const pairs = new Map();
  for (const row of rows || []) {
    const tour = Number(row.Id_Tour);
    const date = String(row.Fecha_Tour || '').slice(0, 10);
    if (tour > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)) pairs.set(`${tour}:${date}`, { tour, date });
  }
  const states = new Map(await Promise.all(Array.from(pairs, async ([key, pair]) => [
    key,
    await isConfirmed(pair.tour, pair.date),
  ])));
  return (rows || []).filter((row) => states.get(`${Number(row.Id_Tour)}:${String(row.Fecha_Tour || '').slice(0, 10)}`));
}

function shiftIsoDate(date, offset) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function normalizeOverview(rows, dates) {
  const byDate = new Map((rows || []).map((row) => [String(row.Fecha), row]));
  const normalize = (date) => {
    const row = byDate.get(date) || {};
    return {
      date,
      reservations: Number(row.Reservas || 0),
      passengers: Number(row.Pasajeros || 0),
      privateReservations: Number(row.Privadas || 0),
      privatePassengers: Number(row.Pasajeros_Privados || 0),
      transfers: Number(row.Transfers || 0),
      transferPassengers: Number(row.Pasajeros_Transfer || 0),
    };
  };
  return {
    today: normalize(dates.today),
    tomorrow: normalize(dates.tomorrow),
  };
}

async function getProfile(userId) {
  const [rows] = await db.query(
    `SELECT u.Id_Usuario, u.Nombres_Apellidos, u.Avatar, r.Nombre_Rol
       FROM usuarios u
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
      WHERE u.Id_Usuario = ?
      LIMIT 1`,
    [userId],
  );
  return rows?.[0] || null;
}

async function getOverview(userId, dates, personalScope, includeTransfers = true) {
  const reservationScope = personalScope ? 'AND r.Creado_Por = ?' : '';
  const transferScope = personalScope ? 'AND tr.Creado_Por = ?' : '';
  const reservationParams = personalScope
    ? [dates.today, dates.tomorrow, userId]
    : [dates.today, dates.tomorrow];
  const transferParams = personalScope
    ? [dates.today, dates.tomorrow, userId]
    : [dates.today, dates.tomorrow];

  const [reservationRows] = await db.query(
    `SELECT
       DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha,
       COUNT(DISTINCT r.Id_Reserva) AS Reservas,
       COUNT(p.Id_Pasajero) AS Pasajeros,
        COUNT(DISTINCT CASE
          WHEN UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'GRUPAL'))) = 'PRIVADA' THEN r.Id_Reserva
        END) AS Privadas,
        COUNT(CASE
          WHEN UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'GRUPAL'))) = 'PRIVADA' THEN p.Id_Pasajero
        END) AS Pasajeros_Privados
     FROM ${reservasOperativasSource('r')}
     LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
     WHERE r.Fecha_Tour IN (?, ?)
       AND ${ACTIVE_RESERVATION_SQL}
       ${reservationScope}
     GROUP BY r.Fecha_Tour`,
    reservationParams,
  );

  const [transferRows] = includeTransfers ? await db.query(
    `SELECT
       DATE_FORMAT(tr.Fecha_Transfer, '%Y-%m-%d') AS Fecha,
       COUNT(*) AS Transfers,
       COALESCE(SUM(tr.Cantidad_Personas), 0) AS Pasajeros_Transfer
     FROM transfers tr
     WHERE tr.Fecha_Transfer IN (?, ?)
       AND ${ACTIVE_TRANSFER_SQL}
       ${transferScope}
     GROUP BY tr.Fecha_Transfer`,
    transferParams,
  ) : [[]];

  const combined = new Map();
  for (const row of reservationRows || []) {
    const key = String(row.Fecha || '');
    combined.set(key, { ...row, Fecha: key });
  }
  for (const row of transferRows || []) {
    const key = String(row.Fecha || '');
    combined.set(key, { ...(combined.get(key) || { Fecha: key }), ...row, Fecha: key });
  }
  return normalizeOverview(Array.from(combined.values()), dates);
}

async function getPersonalWork(userId, dates, permissions, clientMode = false) {
  const canReadReservations = hasAnyPermission(permissions, 'RESERVAS.LEER');
  const canReadTransfers = hasAnyPermission(permissions, 'TRANSFERS.LEER');
  const upcomingEnd = bogotaDate(14);

  const reservationsPromise = canReadReservations
    ? db.query(
      `SELECT
         r.Id_Reserva,
         DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha,
         r.Estado,
         r.Tipo_Reserva,
         t.Nombre_Tour,
         COUNT(p.Id_Pasajero) AS Pasajeros
       FROM ${reservasOperativasSource('r')}
       LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
       LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
       WHERE r.Creado_Por = ?
         AND r.Fecha_Tour BETWEEN ? AND ?
         AND ${ACTIVE_RESERVATION_SQL}
       GROUP BY r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, t.Nombre_Tour
       ORDER BY r.Fecha_Tour ASC, r.Fecha_Registro DESC
       LIMIT 6`,
      [userId, dates.today, upcomingEnd],
    )
    : Promise.resolve([[]]);

  const transfersPromise = canReadTransfers
    ? db.query(
      `SELECT
         tr.Id_Transfer,
         DATE_FORMAT(tr.Fecha_Transfer, '%Y-%m-%d') AS Fecha,
         tr.Hora_Recogida,
         tr.Estado,
         tr.Punto_Salida,
         tr.Punto_Destino,
         tr.Cantidad_Personas,
         st.Nombre_Servicio
       FROM transfers tr
       LEFT JOIN servicios_transfer st ON st.Id_Servicio = tr.Id_Servicio
       WHERE tr.Creado_Por = ?
         AND tr.Fecha_Transfer BETWEEN ? AND ?
         AND ${ACTIVE_TRANSFER_SQL}
       ORDER BY tr.Fecha_Transfer ASC, tr.Hora_Recogida ASC
       LIMIT 6`,
      [userId, dates.today, upcomingEnd],
    )
    : Promise.resolve([[]]);

  const pendingPromise = canReadReservations
    ? db.query(
      `SELECT COUNT(*) AS Total
       FROM ${reservasOperativasSource('r')}
       WHERE r.Creado_Por = ?
         AND r.Fecha_Tour >= ?
         AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN ('PENDIENTE','PENDIENTE DE DATOS','PENDIENTE DE PAGO')`,
      [userId, dates.today],
    )
    : Promise.resolve([[{ Total: 0 }]]);

  const activityPromise = clientMode ? Promise.resolve([[]]) : db.query(
    `SELECT h.Accion, h.Tabla, h.Id_Registro, h.Fecha_Hora_Registro
       FROM historial h
      WHERE h.Id_Usuario = ?
      ORDER BY h.Fecha_Hora_Registro DESC, h.Id_Historial DESC
      LIMIT 8`,
    [userId],
  );

  const [reservationsResult, transfersResult, pendingResult, activityResult] = await Promise.all([
    reservationsPromise,
    transfersPromise,
    pendingPromise,
    activityPromise,
  ]);

  return {
    upcomingReservations: reservationsResult[0] || [],
    upcomingTransfers: transfersResult[0] || [],
    pendingReservations: Number(pendingResult[0]?.[0]?.Total || 0),
    recentActivity: activityResult[0] || [],
  };
}

async function getCapacityAlerts(dates) {
  const capabilities = getSchemaCapabilities();
  const capacitySql = capabilities.aforoOperation
    ? "COALESCE(CASE WHEN a.Operacion = 'USAR_BASE' THEN NULL ELSE a.Cupo END, t.Cupo_Base, 0)"
    : 'COALESCE(a.Cupo, t.Cupo_Base, 0)';
  const scanDates = Array.from({ length: 8 }, (_, index) => shiftIsoDate(dates.today, index));
  const dateTableSql = scanDates.map(() => 'SELECT ? AS Fecha').join(' UNION ALL ');
  const [rows] = await db.query(
    `SELECT
       t.Id_Tour,
       t.Nombre_Tour,
       DATE_FORMAT(d.Fecha, '%Y-%m-%d') AS Fecha,
       ${capacitySql} AS Capacidad,
       COALESCE(o.Ocupados, 0) AS Ocupados
     FROM tours t
     CROSS JOIN (${dateTableSql}) d
     LEFT JOIN aforos a ON a.Id_Aforo = (
       SELECT a2.Id_Aforo
       FROM aforos a2
       WHERE a2.Id_Tour = t.Id_Tour AND a2.Fecha_Aforo = d.Fecha
       ORDER BY a2.Id_Aforo DESC
       LIMIT 1
     )
     LEFT JOIN (
       SELECT h.Id_Tour, r.Fecha_Tour, SUM(${passengerSeatSql('p')}) AS Ocupados
       FROM ${reservasOperativasSource('r')}
       INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
       WHERE r.Fecha_Tour BETWEEN ? AND ?
         AND ${consumingReservationSql('r', { softDelete: capabilities.reservasSoftDelete })}
       GROUP BY h.Id_Tour, r.Fecha_Tour
     ) o ON o.Id_Tour = t.Id_Tour AND o.Fecha_Tour = d.Fecha
     WHERE t.Activo = 1
     ORDER BY d.Fecha ASC, t.Id_Tour ASC`,
    [...scanDates, dates.today, scanDates[scanDates.length - 1]],
  );
  return consolidateCapacityAlerts(rows || [], 8);
}

async function findPendingJourneys(startDate, endDate) {
  const [rows] = await db.query(
    `SELECT h.Id_Tour, DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
            COUNT(p.Id_Pasajero) AS Total_Pasajeros
       FROM ${reservasOperativasSource('r')}
       INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE r.Fecha_Tour BETWEEN ? AND ?
        AND ${ACTIVE_RESERVATION_SQL}
      GROUP BY h.Id_Tour, r.Fecha_Tour
     HAVING COUNT(p.Id_Pasajero) > 0
      ORDER BY r.Fecha_Tour, h.Id_Tour`,
    [startDate, endDate],
  );
  return filterUnconfirmedJourneys(rows || []);
}

async function getOperationalProcesses(dates, permissions) {
  const processes = [];
  const canReadConfirmation = hasAnyPermission(permissions, 'CONTROL_VIAJE.LEER');
  const canReadInsurance = hasAnyPermission(permissions, 'SEGUROS.LEER');
  const pendingJourneys = canReadConfirmation || canReadInsurance
    ? await findPendingJourneys(bogotaDate(-2), dates.today)
    : [];

  if (canReadConfirmation) {
    processes.push({
      id: 'confirmation',
      label: 'Control de viaje',
      description: 'Jornadas vencidas o de hoy pendientes de cierre.',
      count: pendingJourneys.length,
      route: '/Reservas/Confirmacion',
      ...(pendingJourneys[0] ? { routeParams: { tour: pendingJourneys[0].Id_Tour, fecha: pendingJourneys[0].Fecha_Tour, buscar: 1 } } : {}),
      permission: 'CONTROL_VIAJE.LEER',
    });
  }

  if (hasAnyPermission(permissions, 'PROGRAMACION.LEER')) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS Total
       FROM (
         SELECT h.Id_Tour, r.Fecha_Tour
         FROM ${reservasOperativasSource('r')}
         INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
         LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
         WHERE r.Fecha_Tour BETWEEN ? AND ?
           AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'GRUPAL'))) = 'GRUPAL'
           AND ${ACTIVE_RESERVATION_SQL}
         GROUP BY h.Id_Tour, r.Fecha_Tour
         HAVING COUNT(p.Id_Pasajero) > 0
           AND NOT EXISTS (
             SELECT 1
             FROM programaciones pg
             INNER JOIN programacion_tours pt ON pt.Id_Programacion = pg.Id_Programacion
             WHERE pg.Fecha_Tour = r.Fecha_Tour
               AND pt.Id_Tour = h.Id_Tour
               AND pg.Estado = 'activa'
               AND COALESCE(pg.Tipo_Programacion, 'grupal') = 'grupal'
           )
       ) pendientes`,
      [dates.today, dates.tomorrow],
    );
    processes.push({
      id: 'programming',
      label: 'Programación',
      description: 'Tours de hoy o mañana pendientes de programación.',
      count: Number(rows?.[0]?.Total || 0),
      route: '/Programacion/Listado',
      permission: 'PROGRAMACION.LEER',
    });
  }

  if (hasAnyPermission(permissions, 'SEGUROS.LEER')) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS Total
       FROM programacion_buses pb
       INNER JOIN programaciones pg ON pg.Id_Programacion = pb.Id_Programacion
       WHERE pg.Estado = 'activa'
         AND pg.Fecha_Tour BETWEEN ? AND ?
         AND (
           NULLIF(TRIM(pb.Guia), '') IS NULL OR NULLIF(TRIM(pb.DNI_Guia), '') IS NULL
           OR NULLIF(TRIM(pb.Conductor), '') IS NULL OR NULLIF(TRIM(pb.DNI_Conductor), '') IS NULL
         )`,
      [dates.today, dates.tomorrow],
    );
    processes.push({
      id: 'insurance',
      label: 'Seguros',
      description: 'Vehículos con datos de guía o conductor incompletos.',
      count: Number(rows?.[0]?.Total || 0),
      route: '/Seguros',
      ...(pendingJourneys[0] ? { routeParams: { tour: pendingJourneys[0].Id_Tour, fecha: pendingJourneys[0].Fecha_Tour, buscar: 1 } } : {}),
      permission: 'SEGUROS.LEER',
    });
  }

  if (hasAnyPermission(permissions, 'COMISIONES.LEER')) {
    const [rows] = await db.query(
      `SELECT DISTINCT r.Id_Reserva, DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
              t.Id_Tour, t.Nombre_Tour
       FROM ${reservasOperativasSource('r')}
       LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
       INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
       LEFT JOIN liquidaciones l ON l.Id_Reserva = r.Id_Reserva
       WHERE r.Fecha_Tour <= ?
         AND p.Confirmacion = 1
         AND p.Comision > 0
         AND COALESCE(l.Estado, 'PENDIENTE') = 'PENDIENTE'
         AND ${ACTIVE_RESERVATION_SQL}
       ORDER BY r.Fecha_Tour, r.Id_Reserva`,
      [dates.today],
    );
    const confirmedRows = await filterCommissionRowsByJourneyConfirmation(rows || []);
    const commissions = commissionProcess(confirmedRows);
    processes.push({
      id: 'commissions',
      label: 'Comisiones',
      notificationTitle: commissions.count === 1
        ? '1 reserva con comisión pendiente'
        : `${commissions.count} reservas con comisiones pendientes`,
      description: commissions.description,
      count: commissions.count,
      route: '/Comisiones',
      permission: 'COMISIONES.LEER',
      periodStart: commissions.periodStart,
      periodEnd: commissions.periodEnd,
      tourId: commissions.tourId,
      tourName: commissions.tourName,
      notificationIdentity: commissions.notificationIdentity,
    });
  }

  return processes;
}

async function getManagementActivity(permissions) {
  if (!hasAnyPermission(permissions, 'HISTORIAL.LEER')) return [];
  const [rows] = await db.query(
    `SELECT h.Accion, h.Tabla, h.Id_Registro, h.Fecha_Hora_Registro,
            COALESCE(h.Actor_Nombre, u.Nombres_Apellidos) AS Usuario,
            h.Actor_Rol
       FROM historial h
       LEFT JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
      ORDER BY h.Fecha_Hora_Registro DESC, h.Id_Historial DESC
      LIMIT 8`,
  );
  return rows || [];
}

async function getHomeSummary(userId, permissions = []) {
  const profile = await getProfile(userId);
  if (!profile) {
    const error = new Error('No se encontró el perfil del usuario autenticado.');
    error.status = 404;
    error.errorCode = 'PROFILE_NOT_FOUND';
    throw error;
  }

  const dates = { today: bogotaDate(0), tomorrow: bogotaDate(1) };
  const clientMode = isClientRoleName(profile.Nombre_Rol);
  const management = hasAnyPermission(permissions, 'INFORMES.LEER', 'USUARIOS.LEER');
  const operations = hasAnyPermission(
    permissions,
    'PROGRAMACION.LEER',
    'CONTROL_VIAJE.LEER',
    'SEGUROS.LEER',
    'COMISIONES.LEER',
    'AFOROS.LEER',
  );
  const personalScope = !management;

  const [overview, personalWork, processes, capacityAlerts, recentActivity] = await Promise.all([
    getOverview(userId, dates, personalScope, !clientMode && hasAnyPermission(permissions, 'TRANSFERS.LEER')),
    getPersonalWork(userId, dates, permissions, clientMode),
    operations ? getOperationalProcesses(dates, permissions) : Promise.resolve([]),
    operations && hasAnyPermission(permissions, 'AFOROS.LEER')
      ? getCapacityAlerts(dates)
      : Promise.resolve([]),
    management ? getManagementActivity(permissions) : Promise.resolve([]),
  ]);

  // Inicio ya es la fuente de estas detecciones. Pendientes proyecta su
  // resultado, sin volver a decidir qué significa cada condición operativa.
  if (!clientMode && hasAnyPermission(permissions, 'PENDIENTES.LEER')) {
    try {
      await syncHomeProcesses(processes);
    } catch (error) {
      // Un fallo de proyección no debe impedir que el asesor abra Inicio.
      console.error('[Pendientes] No se pudieron sincronizar los procesos de Inicio:', error);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dates,
    profile: {
      id: profile.Id_Usuario,
      name: profile.Nombres_Apellidos,
      avatar: profile.Avatar || null,
      role: profile.Nombre_Rol || 'Usuario',
      mode: clientMode ? 'client' : management ? 'management' : 'advisor',
    },
    capabilities: {
      management,
      operations,
      clientMode,
      canCreateReservations: hasAnyPermission(permissions, 'RESERVAS.CREAR'),
      canReadReservations: hasAnyPermission(permissions, 'RESERVAS.LEER'),
      canUpdateReservations: hasAnyPermission(permissions, 'RESERVAS.ACTUALIZAR'),
      canCreateTransfers: hasAnyPermission(permissions, 'TRANSFERS.CREAR'),
      canReadTransfers: hasAnyPermission(permissions, 'TRANSFERS.LEER'),
      canUpdateTransfers: hasAnyPermission(permissions, 'TRANSFERS.ACTUALIZAR'),
      canReadAforos: hasAnyPermission(permissions, 'AFOROS.LEER'),
      canReadReports: hasAnyPermission(permissions, 'INFORMES.LEER'),
      canReadProgramming: hasAnyPermission(permissions, 'PROGRAMACION.LEER'),
    },
    overview,
    personalWork,
    operations: {
      processes,
      capacityAlerts,
      recentActivity,
    },
  };
}

module.exports = {
  getHomeSummary,
  bogotaDate,
  hasAnyPermission,
  normalizeOverview,
  commissionProcess,
  getCapacityAlerts,
  filterUnconfirmedJourneys,
  filterCommissionRowsByJourneyConfirmation,
};
