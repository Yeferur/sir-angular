const db = require('../database/db');

// Estados admitidos (normalizamos con UPPER/TRIM para tolerar mayúsculas, minúsculas y espacios)
const ESTADOS_VALIDOS = ['ACTIVA', 'ACTIVO', 'PENDIENTE', 'PENDIENTEDATOS', 'CONFIRMADA', 'COMPLETADA'];

async function obtenerDatosInicio(fecha) {
  // TOURS: cupo del día (aforos) con fallback a Cupo_Base,
  //        pasajeros grupales y # de reservas privadas del día
  const toursQuery = `
    SELECT 
      t.Id_Tour,
      t.Nombre_Tour,
      COALESCE((
        SELECT a.Cupo
        FROM aforos a
        WHERE a.Id_Tour = t.Id_Tour
          AND a.Fecha_Aforo = ?
        ORDER BY a.Id_Aforo DESC
        LIMIT 1
      ), t.Cupo_Base) AS cupos,
      COALESCE((
        SELECT SUM(cnt_pasajeros)
        FROM (
          SELECT COUNT(p.Id_Pasajero) AS cnt_pasajeros
          FROM reservas r
          JOIN horarios h ON h.Id_Horario = r.Id_Horario
          JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
          WHERE h.Id_Tour = t.Id_Tour AND p.Tipo_Pasajero IN ('ADULTO', 'NINO')
            AND r.Fecha_Tour = ?
            AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
            AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_VALIDOS.map(() => '?').join(',')})
          GROUP BY r.Id_Reserva
        ) x
      ), 0) AS NumeroPasajeros,
      COALESCE((
        SELECT COUNT(r.Id_Reserva)
        FROM reservas r
        JOIN horarios h ON h.Id_Horario = r.Id_Horario
        WHERE h.Id_Tour = t.Id_Tour
          AND r.Fecha_Tour = ?
          AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
          AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_VALIDOS.map(() => '?').join(',')})
      ), 0) AS totalReservas,
      COALESCE((
        SELECT COUNT(*)
        FROM reservas r
        JOIN horarios h ON h.Id_Horario = r.Id_Horario
        WHERE h.Id_Tour = t.Id_Tour
          AND r.Fecha_Tour = ?
          AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA'
          AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_VALIDOS.map(() => '?').join(',')})
      ), 0) AS totalPrivados
    FROM tours t
    WHERE t.Activo = 1
  `;

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
      FROM reservas r
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE r.Fecha_Tour = ?
        AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
        AND p.Tipo_Pasajero IN ('ADULTO', 'NINO')
        AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_VALIDOS.map(() => '?').join(',')})
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
    FROM reservas r
    JOIN horarios h ON h.Id_Horario = r.Id_Horario
    WHERE r.Fecha_Tour = ?
      AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA'
      AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN (${ESTADOS_VALIDOS.map(() => '?').join(',')})
    ORDER BY r.Id_Reserva
  `;

  try {
    const estadosParams = ESTADOS_VALIDOS.slice(); // copia
    const [tours] = await db.query(
      toursQuery,
      [
        fecha,                 // aforos.Fecha_Aforo
        fecha, ...estadosParams, // pasajeros GRUPAL
        fecha, ...estadosParams, // reservas GRUPAL (nuevo)
        fecha, ...estadosParams  // count PRV
      ]
    );

    // Normalize numeric fields to avoid string concatenation in frontend
    for (const t of tours) {
      t.cupos = Number(t.cupos) || 0;
      t.NumeroPasajeros = Number(t.NumeroPasajeros) || 0;
      t.totalReservas = Number(t.totalReservas) || 0;
      t.totalPrivados = Number(t.totalPrivados) || 0;
    }

    const [transfers] = await db.query(transferQuery, [fecha]);
    for (const transfer of transfers) {
      transfer.totalTransfers = Number(transfer.totalTransfers) || 0;
    }

    const [planesRaw] = await db.query(planesQuery, [fecha, ...estadosParams]);

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

    const [privadosRaw] = await db.query(privadosQuery, [fecha, ...estadosParams]);

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
console.log('Datos de inicio obtenidos para fecha', fecha, { tours, transfers });
    return { tours, transfers };
  } catch (error) {
    throw error;
  }
}

async function guardarAforo({ Id_Tour, Fecha, NuevoCupo, userId = null }) {
  const { recordHistorial, logSistema } = require('./Historial/logger');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Obtener número de pasajeros existentes para ese tour y fecha
    const pasajerosQuery = `
      SELECT COUNT(p.Id_Pasajero) AS totalPasajeros
      FROM reservas r
      JOIN horarios h ON h.Id_Horario = r.Id_Horario
      JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva
      WHERE h.Id_Tour = ? AND r.Fecha_Tour = ? AND p.Tipo_Pasajero IN ('ADULTO', 'NINO')
        AND UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
        AND UPPER(TRIM(COALESCE(r.Estado, ''))) IN ('ACTIVA','ACTIVO','PENDIENTE','PENDIENTEDATOS','CONFIRMADA','COMPLETADA')
    `;
    const [[{ totalPasajeros }]] = await conn.query(pasajerosQuery, [Id_Tour, Fecha]);

    if (NuevoCupo < totalPasajeros) {
      await conn.rollback();
      return { success: false, error: `El cupo no puede ser menor al número de pasajeros existentes (${totalPasajeros}).` };
    }

    // 2. Insertar o actualizar aforo
    // fetch previous aforo (if any) to record previous value
    const [prevA] = await conn.query('SELECT Cupo FROM aforos WHERE Id_Tour = ? AND Fecha_Aforo = ? ORDER BY Id_Aforo DESC LIMIT 1', [Id_Tour, Fecha]);
    const previoCupo = prevA && prevA[0] ? prevA[0].Cupo : null;

    const insertQuery = `
      INSERT INTO aforos (Id_Tour, Fecha_Aforo, Cupo)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE Cupo = VALUES(Cupo)
    `;
    await conn.query(insertQuery, [Id_Tour, Fecha, NuevoCupo]);

    // 3. Obtener nombre del tour
    const [[tourRow]] = await conn.query('SELECT Nombre_Tour FROM tours WHERE Id_Tour = ?', [Id_Tour]);
    const Nombre_Tour = tourRow?.Nombre_Tour || '';

    await recordHistorial({ conexion: conn, tabla: 'aforos', id_registro: Id_Tour, accion: 'CAMBIAR_AFORO_TOUR', id_usuario: userId, detalles: [{ columna: 'Fecha_Aforo', anterior: null, nuevo: Fecha }, { columna: 'Cupo', anterior: previoCupo, nuevo: NuevoCupo }] });

    await conn.commit();

    // 4. Emitir evento WebSocket a los usuarios activos (después del commit)
    try {
      const wsManager = require('../websocketManager');
      if (typeof userId !== 'undefined') {
        wsManager.broadcastAforoActualizado({ Id_Tour, Nombre_Tour, NuevoCupo, userId });
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

module.exports = { obtenerDatosInicio, guardarAforo };
