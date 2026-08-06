const db = require('../../database/db');

const ACTIVE_RESERVATION_SQL = "UPPER(TRIM(COALESCE(r.Estado, ''))) NOT IN ('CANCELADA','CANCELADO','ELIMINADA','ELIMINADO')";
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

function normalizeOverview(rows, dates) {
  const byDate = new Map((rows || []).map((row) => [String(row.Fecha), row]));
  const normalize = (date) => {
    const row = byDate.get(date) || {};
    return {
      date,
      reservations: Number(row.Reservas || 0),
      passengers: Number(row.Pasajeros || 0),
      privateReservations: Number(row.Privadas || 0),
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

async function getOverview(userId, dates, personalScope) {
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
       END) AS Privadas
     FROM reservas r
     LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
     WHERE r.Fecha_Tour IN (?, ?)
       AND ${ACTIVE_RESERVATION_SQL}
       ${reservationScope}
     GROUP BY r.Fecha_Tour`,
    reservationParams,
  );

  const [transferRows] = await db.query(
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
  );

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

async function getPersonalWork(userId, dates, permissions) {
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
       FROM reservas r
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
       FROM reservas r
       WHERE r.Creado_Por = ?
         AND r.Fecha_Tour >= ?
         AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN ('PENDIENTE','PENDIENTE DE DATOS','PENDIENTE DE PAGO')`,
      [userId, dates.today],
    )
    : Promise.resolve([[{ Total: 0 }]]);

  const activityPromise = db.query(
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
  const [rows] = await db.query(
    `SELECT
       t.Id_Tour,
       t.Nombre_Tour,
       DATE_FORMAT(r.Fecha_Tour, '%Y-%m-%d') AS Fecha,
       COALESCE(a.Cupo, t.Cupo_Base, 0) AS Capacidad,
       SUM(CASE WHEN p.Tipo_Pasajero IN ('ADULTO','NINO') THEN 1 ELSE 0 END) AS Ocupados
     FROM reservas r
     INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
     INNER JOIN tours t ON t.Id_Tour = h.Id_Tour
     LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
     LEFT JOIN aforos a ON a.Id_Aforo = (
       SELECT a2.Id_Aforo
       FROM aforos a2
       WHERE a2.Id_Tour = h.Id_Tour AND a2.Fecha_Aforo = r.Fecha_Tour
       ORDER BY a2.Id_Aforo DESC
       LIMIT 1
     )
     WHERE r.Fecha_Tour BETWEEN ? AND ?
       AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, 'GRUPAL'))) = 'GRUPAL'
       AND ${ACTIVE_RESERVATION_SQL}
     GROUP BY t.Id_Tour, t.Nombre_Tour, r.Fecha_Tour, a.Cupo, t.Cupo_Base
     HAVING Capacidad <= 0 OR (Ocupados / NULLIF(Capacidad, 0)) >= 0.8
     ORDER BY
       CASE WHEN Capacidad <= 0 THEN 2 ELSE Ocupados / NULLIF(Capacidad, 0) END DESC,
       r.Fecha_Tour ASC
     LIMIT 8`,
    [dates.today, bogotaDate(7)],
  );
  return (rows || []).map((row) => {
    const capacity = Number(row.Capacidad || 0);
    const occupied = Number(row.Ocupados || 0);
    const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : null;
    return {
      tourId: Number(row.Id_Tour),
      tourName: row.Nombre_Tour,
      date: row.Fecha,
      capacity,
      occupied,
      percentage,
      status: capacity <= 0 ? 'missing' : percentage >= 100 ? 'full' : percentage >= 90 ? 'critical' : 'warning',
    };
  });
}

async function getOperationalProcesses(dates, permissions) {
  const processes = [];

  if (hasAnyPermission(permissions, 'CONTROL_VIAJE.LEER', 'COMISIONES.LEER', 'SEGUROS.LEER')) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS Total
       FROM (
         SELECT h.Id_Tour, r.Fecha_Tour
         FROM reservas r
         INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
         LEFT JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
         LEFT JOIN confirmaciones_jornada cj
           ON cj.Id_Tour = h.Id_Tour AND cj.Fecha_Tour = r.Fecha_Tour
         WHERE r.Fecha_Tour BETWEEN ? AND ?
           AND ${ACTIVE_RESERVATION_SQL}
         GROUP BY h.Id_Tour, r.Fecha_Tour, cj.Id_Confirmacion, cj.Total_Pasajeros
         HAVING COUNT(p.Id_Pasajero) > 0
            AND (cj.Id_Confirmacion IS NULL OR cj.Total_Pasajeros <> COUNT(p.Id_Pasajero))
       ) pendientes`,
      [bogotaDate(-2), dates.today],
    );
    processes.push({
      id: 'confirmation',
      label: 'Control de viaje',
      description: 'Jornadas vencidas o de hoy pendientes de cierre.',
      count: Number(rows?.[0]?.Total || 0),
      route: '/Reservas/Confirmacion',
      permission: 'CONTROL_VIAJE.LEER',
    });
  }

  if (hasAnyPermission(permissions, 'PROGRAMACION.LEER')) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS Total
       FROM (
         SELECT h.Id_Tour, r.Fecha_Tour
         FROM reservas r
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
      description: 'Tours de hoy o mañana aún sin listado activo.',
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
      permission: 'SEGUROS.LEER',
    });
  }

  if (hasAnyPermission(permissions, 'COMISIONES.LEER')) {
    const [rows] = await db.query(
      `SELECT COUNT(DISTINCT r.Id_Reserva) AS Total
       FROM reservas r
       INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
       LEFT JOIN liquidaciones l ON l.Id_Reserva = r.Id_Reserva
       WHERE r.Fecha_Tour <= ?
         AND p.Confirmacion = 1
         AND p.Comision > 0
         AND COALESCE(l.Estado, 'PENDIENTE') = 'PENDIENTE'
         AND ${ACTIVE_RESERVATION_SQL}`,
      [dates.today],
    );
    processes.push({
      id: 'commissions',
      label: 'Comisiones',
      description: 'Reservas viajadas que aún tienen comisión pendiente.',
      count: Number(rows?.[0]?.Total || 0),
      route: '/Comisiones',
      permission: 'COMISIONES.LEER',
    });
  }

  return processes;
}

async function getManagementActivity(permissions) {
  if (!hasAnyPermission(permissions, 'HISTORIAL.LEER')) return [];
  const [rows] = await db.query(
    `SELECT h.Accion, h.Tabla, h.Id_Registro, h.Fecha_Hora_Registro,
            u.Nombres_Apellidos AS Usuario
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
  const management = hasAnyPermission(permissions, 'INFORMES.LEER', 'USUARIOS.LEER');
  const operations = hasAnyPermission(
    permissions,
    'PROGRAMACION.LEER',
    'CONTROL_VIAJE.LEER',
    'SEGUROS.LEER',
    'COMISIONES.LEER',
    'AFOROS.LEER',
    'INICIO.LEER',
  );
  const personalScope = !management;

  const [overview, personalWork, processes, capacityAlerts, recentActivity] = await Promise.all([
    getOverview(userId, dates, personalScope),
    getPersonalWork(userId, dates, permissions),
    operations ? getOperationalProcesses(dates, permissions) : Promise.resolve([]),
    operations && hasAnyPermission(permissions, 'AFOROS.LEER', 'INICIO.LEER')
      ? getCapacityAlerts(dates)
      : Promise.resolve([]),
    management ? getManagementActivity(permissions) : Promise.resolve([]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    dates,
    profile: {
      id: profile.Id_Usuario,
      name: profile.Nombres_Apellidos,
      avatar: profile.Avatar || null,
      role: profile.Nombre_Rol || 'Usuario',
      mode: management ? 'management' : 'advisor',
    },
    capabilities: {
      management,
      operations,
      canCreateReservations: hasAnyPermission(permissions, 'RESERVAS.CREAR'),
      canReadReservations: hasAnyPermission(permissions, 'RESERVAS.LEER'),
      canUpdateReservations: hasAnyPermission(permissions, 'RESERVAS.ACTUALIZAR'),
      canCreateTransfers: hasAnyPermission(permissions, 'TRANSFERS.CREAR'),
      canReadTransfers: hasAnyPermission(permissions, 'TRANSFERS.LEER'),
      canUpdateTransfers: hasAnyPermission(permissions, 'TRANSFERS.ACTUALIZAR'),
      canReadAforos: hasAnyPermission(permissions, 'AFOROS.LEER', 'INICIO.LEER'),
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
};
