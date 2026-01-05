const db = require('../database/db');

// Estados admitidos (normalizamos con UPPER para tolerar mayúsc/minúsc)
const ESTADOS_VALIDOS = ['PENDIENTE','PENDIENTEDATOS','CONFIRMADA','COMPLETADA'];

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
            AND UPPER(r.Tipo_Reserva) = 'GRUPAL'
            AND UPPER(r.Estado) IN (${ESTADOS_VALIDOS.map(()=>'?').join(',')})
          GROUP BY r.Id_Reserva
        ) x
      ), 0) AS NumeroPasajeros,
      COALESCE((
        SELECT COUNT(*)
        FROM reservas r
        JOIN horarios h ON h.Id_Horario = r.Id_Horario
        WHERE h.Id_Tour = t.Id_Tour
          AND r.Fecha_Tour = ?
          AND UPPER(r.Tipo_Reserva) = 'PRIVADA'
          AND UPPER(r.Estado) IN (${ESTADOS_VALIDOS.map(()=>'?').join(',')})
      ), 0) AS totalPrivados
    FROM tours t
  `;

  // TRANSFERS: total por servicio en la fecha
  const transferQuery = `
    SELECT 
      st.Id_Servicio AS id,
      st.Nombre_Servicio AS Servicio,
      COALESCE(SUM(CASE WHEN tr.Id_Servicio = st.Id_Servicio THEN 1 ELSE 0 END), 0) AS totalTransfers
    FROM servicios_transfer st
    LEFT JOIN transfers tr
      ON tr.Id_Servicio = st.Id_Servicio
     AND tr.Fecha_Transfer = ?
     AND UPPER(tr.Estado) IN ('PENDIENTE','ACTIVO','COMPLETADO')
    GROUP BY st.Id_Servicio, st.Nombre_Servicio
    ORDER BY st.Id_Servicio
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
      AND UPPER(r.Tipo_Reserva) = 'PRIVADA'
      AND UPPER(r.Estado) IN ('PENDIENTE','CONFIRMADA','COMPLETADA','PENDIENTEDATOS')
    ORDER BY r.Id_Reserva
  `;

  try {
    const estadosParams = ESTADOS_VALIDOS.slice(); // copia

    const [tours] = await db.query(
      toursQuery,
      [
        fecha,                 // aforos.Fecha_Aforo
        fecha, ...estadosParams, // pasajeros GRUPAL
        fecha, ...estadosParams  // count PRV
      ]
    );

    const [transfers] = await db.query(transferQuery, [fecha]);
    const [privadosRaw] = await db.query(privadosQuery, [fecha]);

    // map privados por tour
    const privadosMap = {};
    for (const p of privadosRaw) {
      if (!privadosMap[p.Id_Tour]) privadosMap[p.Id_Tour] = [];
      privadosMap[p.Id_Tour].push({
        Id_Reserva: p.Id_Reserva,
        NumeroPasajeros: p.NumeroPasajeros
      });
    }

    // anexar lista de privados a cada tour
    for (const t of tours) {
      t.privados = privadosMap[t.Id_Tour] || [];
    }

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
        AND UPPER(r.Tipo_Reserva) = 'GRUPAL'
        AND UPPER(r.Estado) IN ('PENDIENTE','PENDIENTEDATOS','CONFIRMADA','COMPLETADA')
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

    await conn.commit();

    try {
      await recordHistorial({ conexion: conn, tabla: 'aforos', id_registro: Id_Tour, accion: 'CREAR_O_ACTUALIZAR', id_usuario: userId, detalles: [ { columna: 'Fecha_Aforo', anterior: null, nuevo: Fecha }, { columna: 'Cupo', anterior: previoCupo, nuevo: NuevoCupo } ] });
    } catch (errRec) { console.error('Failed to write historial for guardarAforo:', errRec); }

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
    try { await logSistema({ mensaje: `guardarAforo error: ${e.message || e}`, meta: { Id_Tour, Fecha, NuevoCupo } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { obtenerDatosInicio, guardarAforo };
