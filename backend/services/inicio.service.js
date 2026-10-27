const {
  reservasOperativasSource,
  getSchemaCapabilities,
  requireSchemaCapability,
} = require('./schema-capabilities');
const db = require('../database/db');
const { passengerSeatSql, consumingReservationSql, activeReservationSql } = require('./Reservas/cupos-compartidos');
const { annotateSharedCapacity } = require('./Aforos/shared-capacity.service');

const availabilityPolicy = alias => consumingReservationSql(alias, { softDelete: getSchemaCapabilities().reservasSoftDelete });
const activePolicy = alias => activeReservationSql(alias, { softDelete: getSchemaCapabilities().reservasSoftDelete });

function normalizarTourInicio(tour) {
  return {
    ...tour,
    cupos: Number(tour.cupos) || 0,
    NumeroPasajeros: Number(tour.NumeroPasajeros) || 0,
    totalReservas: Number(tour.totalReservas) || 0,
    totalPrivados: Number(tour.totalPrivados) || 0,
  };
}

function crearConsultaTours({ fecha, incluirCupos = false, incluirPrivados = false, ordenarPorNombre = false } = {}) {
  const campos = ['t.Id_Tour', 't.Nombre_Tour'];
  const params = [];

  if (incluirCupos) {
    campos.push(`COALESCE((
      SELECT a.Cupo
      FROM aforos a
      WHERE a.Id_Tour = t.Id_Tour
        AND a.Fecha_Aforo = ?
      ORDER BY a.Id_Aforo DESC
      LIMIT 1
    ), t.Cupo_Base) AS cupos`);
    params.push(fecha);
  }

  campos.push(`COALESCE((
    SELECT SUM(cnt_pasajeros)
    FROM (
      SELECT COUNT(p.Id_Pasajero) AS cnt_pasajeros
      FROM ${reservasOperativasSource('r')}
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = t.Id_Tour AND ${passengerSeatSql('p')} = 1
        AND r.Fecha_Tour = ?
        AND ${availabilityPolicy('r')}
      GROUP BY r.Id_Reserva
    ) x
  ), 0) AS NumeroPasajeros`);
  params.push(fecha);

  campos.push(`COALESCE((
    SELECT COUNT(r.Id_Reserva)
    FROM ${reservasOperativasSource('r')}
    JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE h.Id_Tour = t.Id_Tour
      AND r.Fecha_Tour = ?
      AND ${availabilityPolicy('r')}
  ), 0) AS totalReservas`);
  params.push(fecha);

  if (incluirPrivados) {
    campos.push(`COALESCE((
      SELECT COUNT(*)
      FROM ${reservasOperativasSource('r')}
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      WHERE h.Id_Tour = t.Id_Tour
        AND r.Fecha_Tour = ?
        AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA'
        AND ${activePolicy('r')}
    ), 0) AS totalPrivados`);
    params.push(fecha);
  }

  const query = `
    SELECT
      ${campos.join(',\n      ')}
    FROM tours t
    WHERE t.Activo = 1${ordenarPorNombre ? '\n    ORDER BY t.Nombre_Tour ASC' : ''}
  `;

  return { query, params };
}

function normalizarResumenTourProgramacion(tour) {
  return {
    Id_Tour: Number(tour.Id_Tour) || 0,
    Nombre_Tour: String(tour.Nombre_Tour || ''),
    NumeroPasajeros: Number(tour.NumeroPasajeros) || 0,
    totalReservas: Number(tour.totalReservas) || 0,
  };
}

async function obtenerResumenToursProgramacion(fecha) {
  const { query, params } = crearConsultaTours({ fecha, ordenarPorNombre: true });
  const [rows] = await db.query(query, params);
  return (rows || []).map(normalizarResumenTourProgramacion);
}

async function obtenerDatosInicio(fecha) {
  // TOURS: cupo del día (aforos) con fallback a Cupo_Base,
  // pasajeros grupales y # de reservas privadas del día.
  const { query: toursQuery, params: toursQueryParams } = crearConsultaTours({
    fecha,
    incluirCupos: true,
    incluirPrivados: true,
  });

  // TRANSFERS: total por servicio en la fecha, excluyendo estados anulados/cancelados
  const transferQuery = `
    SELECT 
      st.Id_Servicio AS id,
      st.Nombre_Servicio AS Servicio,
      COALESCE(SUM(CASE WHEN tr.Id_Transfer IS NOT NULL THEN 1 ELSE 0 END), 0) AS totalTransfers
    FROM servicios_transfer st
    LEFT JOIN transfers tr
      ON tr.Id_Servicio = st.Id_Servicio
     AND tr.Fecha_Transfer = ?
     AND (
       tr.Estado IS NULL
       OR UPPER(TRIM(tr.Estado)) NOT IN ('CANCELADO','CANCELADA','ANULADO','ANULADA','ELIMINADO','ELIMINADA')
     )
    GROUP BY st.Id_Servicio, st.Nombre_Servicio
    ORDER BY st.Id_Servicio
  `;

  // PLANES: solo devolvemos desglose cuando el tour tiene mas de un plan configurado.
  // El conteo real se obtiene desde pasajeros.Id_Plan.
  const planesQuery = `
    SELECT
      pt.Id_Tour               AS Id_Tour,
      pt.Id_Plan               AS Id_Plan,
      pt.Nombre_Plan           AS Nombre_Plan,
      COALESCE(pc.NumeroPasajeros, 0) AS NumeroPasajeros
    FROM planes_tours pt
    JOIN (
      SELECT Id_Tour
      FROM planes_tours
      GROUP BY Id_Tour
      HAVING COUNT(*) > 1
    ) tours_multiples ON tours_multiples.Id_Tour = pt.Id_Tour
    LEFT JOIN (
      SELECT
        h.Id_Tour,
        p.Id_Plan,
        COUNT(p.Id_Pasajero) AS NumeroPasajeros
      FROM ${reservasOperativasSource('r')}
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE r.Fecha_Tour = ?
        AND ${availabilityPolicy('r')}
        AND ${passengerSeatSql('p')} = 1
      GROUP BY h.Id_Tour, p.Id_Plan
    ) pc ON pc.Id_Tour = pt.Id_Tour AND pc.Id_Plan = pt.Id_Plan
    ORDER BY pt.Id_Tour, pt.Id_Plan
  `;

  // PRIVADOS: lista por tour (Id_Reserva + #pasajeros de esa reserva)
  const privadosQuery = `
    SELECT 
      h.Id_Tour AS Id_Tour,
      r.Id_Reserva AS Id_Reserva,
      (
        SELECT COUNT(*)
        FROM pasajeros p
        WHERE p.Id_Reserva = r.Id_Reserva
      ) AS NumeroPasajeros
    FROM ${reservasOperativasSource('r')}
    JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE r.Fecha_Tour = ?
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA'
      AND ${activePolicy('r')}
    ORDER BY r.Id_Reserva
  `;

  try {
    const [tours] = await db.query(
      toursQuery,
      toursQueryParams
    );

    // Normalize numeric fields to avoid string concatenation in frontend
    for (let index = 0; index < tours.length; index += 1) {
      tours[index] = normalizarTourInicio(tours[index]);
    }

    const [transfers] = await db.query(transferQuery, [fecha]);
    for (const transfer of transfers) {
      transfer.totalTransfers = Number(transfer.totalTransfers) || 0;
    }

    const [planesRaw] = await db.query(planesQuery, [fecha]);

    // Agrupar planes por tour
    const planesMap = {};
    for (const row of planesRaw) {
      if (!planesMap[row.Id_Tour]) planesMap[row.Id_Tour] = [];
      planesMap[row.Id_Tour].push({
        Id_Plan: row.Id_Plan,
        Nombre_Plan: row.Nombre_Plan,
        NumeroPasajeros: Number(row.NumeroPasajeros) || 0,
      });
    }

    const [privadosRaw] = await db.query(privadosQuery, [fecha]);

    // map privados por tour
    const privadosMap = {};
    for (const p of privadosRaw) {
      if (!privadosMap[p.Id_Tour]) privadosMap[p.Id_Tour] = [];
      privadosMap[p.Id_Tour].push({
        Id_Reserva: p.Id_Reserva,
        NumeroPasajeros: Number(p.NumeroPasajeros) || 0
      });
    }

    // Anexar planes y privados a cada tour.
    // planes solo se incluye si hay datos — el frontend usa su presencia para mostrar el toggle.
    for (const t of tours) {
      t.privados = privadosMap[t.Id_Tour] || [];
      const planes = planesMap[t.Id_Tour];
      if (planes && planes.length > 0) t.planes = planes;
    }
    return { tours: annotateSharedCapacity(tours), transfers };
  } catch (error) {
    throw error;
  }
}

async function guardarAforo({ Id_Tour, Fecha, NuevoCupo, userId = null }) {
  const cupo = Number(NuevoCupo);
  if (!Number.isInteger(cupo) || cupo < 0) {
    return { success: false, error: 'El cupo debe ser un entero no negativo.' };
  }
  const { recordHistorial, logSistema } = require('./Historial/logger');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Mantener el mismo orden de bloqueo que las operaciones de tour y USAR_BASE.
    const [[tourLock]] = await conn.query(
      'SELECT Cupo_Base FROM tours WHERE Id_Tour = ? AND Activo = 1 FOR UPDATE',
      [Id_Tour],
    );
    if (!tourLock) {
      await conn.rollback();
      return { success: false, error: 'El tour no existe o está desactivado.' };
    }

    const aforoOperation = getSchemaCapabilities().aforoOperation;
    const aforoSubquery = aforoOperation
      ? `(SELECT CASE WHEN Operacion = 'USAR_BASE' THEN NULL ELSE Cupo END FROM aforos
          WHERE Id_Tour = ? AND Fecha_Aforo = ? ORDER BY Id_Aforo DESC LIMIT 1)`
      : `(SELECT Cupo FROM aforos WHERE Id_Tour = ? AND Fecha_Aforo = ? ORDER BY Id_Aforo DESC LIMIT 1)`;
    const [[capacidadActual]] = await conn.query(
      `SELECT COALESCE(${aforoSubquery}, ?) AS Cupo`, [Id_Tour, Fecha, tourLock.Cupo_Base]);
    await conn.query(`INSERT INTO disponibilidad (Id_Tour, Fecha_Tour, Cupos_Totales, Cupos_Disponibles)
      VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE Id_Disponibilidad = Id_Disponibilidad`,
    [Id_Tour, Fecha, Number(capacidadActual?.Cupo || 0), Number(capacidadActual?.Cupo || 0)]);
    await conn.query('SELECT Id_Disponibilidad FROM disponibilidad WHERE Id_Tour = ? AND Fecha_Tour = ? FOR UPDATE', [Id_Tour, Fecha]);

    // 1. Obtener número de pasajeros existentes para ese tour y fecha
    const pasajerosQuery = `
      SELECT COUNT(p.Id_Pasajero) AS totalPasajeros
      FROM ${reservasOperativasSource('r')}
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = ? AND r.Fecha_Tour = ? AND ${passengerSeatSql('p')} = 1
        AND ${availabilityPolicy('r')}
    `;
    const [[{ totalPasajeros }]] = await conn.query(pasajerosQuery, [Id_Tour, Fecha]);

    if (cupo < totalPasajeros) {
      await conn.rollback();
      return { success: false, error: `El cupo no puede ser menor al número de pasajeros existentes (${totalPasajeros}).` };
    }

    // 2. Insertar o actualizar aforo
    // fetch previous aforo (if any) to record previous value
    const [prevA] = await conn.query(`SELECT ${aforoOperation ? 'Operacion, ' : ''}Cupo
      FROM aforos WHERE Id_Tour = ? AND Fecha_Aforo = ? ORDER BY Id_Aforo DESC LIMIT 1`, [Id_Tour, Fecha]);
    const previoCupo = prevA && prevA[0] ? prevA[0].Cupo : null;

    const insertQuery = aforoOperation
      ? `INSERT INTO aforos (Id_Tour, Fecha_Aforo, Cupo, Operacion) VALUES (?, ?, ?, 'FIJAR')`
      : `INSERT INTO aforos (Id_Tour, Fecha_Aforo, Cupo) VALUES (?, ?, ?)`;
    await conn.query(insertQuery, [Id_Tour, Fecha, cupo]);

    // Si el saldo ya está materializado, reconciliarlo en la misma transacción.
    await conn.query(`UPDATE disponibilidad
      SET Cupos_Totales = ?, Cupos_Disponibles = ?, Updated_At = CURRENT_TIMESTAMP(3)
      WHERE Id_Tour = ? AND Fecha_Tour = ?`,
    [cupo, cupo - Number(totalPasajeros), Id_Tour, Fecha]);

    // 3. Obtener nombre del tour
    const [[tourRow]] = await conn.query('SELECT Nombre_Tour FROM tours WHERE Id_Tour = ?', [Id_Tour]);
    const Nombre_Tour = tourRow?.Nombre_Tour || '';

    await recordHistorial({ conexion: conn, tabla: 'aforos', id_registro: Id_Tour, accion: 'CAMBIAR_AFORO_TOUR', id_usuario: userId, detalles: [{ columna: 'Fecha_Aforo', anterior: null, nuevo: Fecha }, { columna: 'Cupo', anterior: previoCupo, nuevo: NuevoCupo }] });

    await conn.commit();

    // 4. Emitir evento WebSocket a los usuarios activos (después del commit)
    try {
      const wsManager = require('../websocketManager');
      if (typeof userId !== 'undefined') {
        wsManager.broadcastAforoActualizado({
          Id_Tour,
          Nombre_Tour,
          NuevoCupo,
          Fecha,
        });
      }
    } catch (err) {
      console.error('Error enviando notificación de aforo actualizado:', err);
    }

    return { success: true, message: 'Aforo actualizado exitosamente.' };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `guardarAforo error: ${e.message || e}`, meta: { Id_Tour, Fecha, NuevoCupo } }); } catch (_) { }
    throw e;
  } finally {
    conn.release();
  }
}

async function retirarAforo({ Id_Tour, Fecha, userId = null }) {
  requireSchemaCapability('aforoOperation', 'Retirar un aforo requiere la migración que agrega Operacion a aforos.');
  const { recordHistorial, logSistema } = require('./Historial/logger');
  const conn = await db.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const [[tour]] = await conn.query('SELECT Cupo_Base FROM tours WHERE Id_Tour = ? AND Activo = 1 FOR UPDATE', [Id_Tour]);
    if (!tour) {
      await conn.rollback();
      return { success: false, error: 'El tour no existe o está desactivado.' };
    }
    const [[current]] = await conn.query(`SELECT CASE WHEN Operacion='USAR_BASE' THEN NULL ELSE Cupo END AS Cupo
      FROM aforos WHERE Id_Tour = ? AND Fecha_Aforo = ? AND (Operacion='USAR_BASE' OR Cupo IS NOT NULL)
      ORDER BY Id_Aforo DESC LIMIT 1`, [Id_Tour, Fecha]);
    const currentCapacity = current?.Cupo == null ? Number(tour.Cupo_Base || 0) : Number(current.Cupo);
    await conn.query(`INSERT INTO disponibilidad (Id_Tour, Fecha_Tour, Cupos_Totales, Cupos_Disponibles)
      VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE Id_Disponibilidad = Id_Disponibilidad`,
    [Id_Tour, Fecha, currentCapacity, currentCapacity]);
    await conn.query('SELECT Id_Disponibilidad FROM disponibilidad WHERE Id_Tour = ? AND Fecha_Tour = ? FOR UPDATE', [Id_Tour, Fecha]);
    const [[{ totalPasajeros }]] = await conn.query(`SELECT COUNT(*) AS totalPasajeros
      FROM ${reservasOperativasSource('r')} JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = ? AND r.Fecha_Tour = ? AND ${passengerSeatSql('p')} = 1
        AND ${availabilityPolicy('r')}
        `, [Id_Tour, Fecha]);
    const baseCapacity = Number(tour.Cupo_Base || 0);
    if (baseCapacity < Number(totalPasajeros)) {
      await conn.rollback();
      return { success: false, error: `Cupo_Base (${baseCapacity}) es menor que los pasajeros activos (${totalPasajeros}); no se retiró el override.` };
    }
    await conn.query("INSERT INTO aforos (Id_Tour, Fecha_Aforo, Cupo, Operacion) VALUES (?, ?, NULL, 'USAR_BASE')", [Id_Tour, Fecha]);
    await conn.query(`UPDATE disponibilidad SET Cupos_Totales=?, Cupos_Disponibles=?, Updated_At=CURRENT_TIMESTAMP(3)
      WHERE Id_Tour=? AND Fecha_Tour=?`, [baseCapacity, baseCapacity - Number(totalPasajeros), Id_Tour, Fecha]);
    await recordHistorial({ conexion: conn, tabla: 'aforos', id_registro: Id_Tour,
      accion: 'RETIRAR_AFORO_TOUR', id_usuario: userId, detalles: [
        { columna: 'Fecha_Aforo', anterior: Fecha, nuevo: Fecha },
        { columna: 'Operacion', anterior: 'FIJAR', nuevo: 'USAR_BASE' },
        { columna: 'Cupo', anterior: current?.Cupo ?? null, nuevo: baseCapacity },
      ] });
    await conn.commit();
    committed = true;
    return { success: true, message: 'El aforo de esta fecha vuelve a usar Cupo_Base.' };
  } catch (error) {
    if (!committed) await conn.rollback();
    try { await logSistema({ mensaje: `retirarAforo error: ${error.message || error}`, meta: { Id_Tour, Fecha } }); } catch (_) {}
    throw error;
  } finally { conn.release(); }
}

module.exports = {
  obtenerDatosInicio,
  obtenerResumenToursProgramacion,
  guardarAforo,
  retirarAforo,
  normalizarTourInicio,
};
