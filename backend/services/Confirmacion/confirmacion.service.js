const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');

const MAX_CAMBIOS = 1500;
let jornadaSchemaPromise = null;

function ensureJornadaSchema() {
  if (!jornadaSchemaPromise) {
    jornadaSchemaPromise = db.query(
      `CREATE TABLE IF NOT EXISTS confirmaciones_jornada (
        Id_Confirmacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        Id_Tour BIGINT UNSIGNED NOT NULL,
        Fecha_Tour DATE NOT NULL,
        Total_Pasajeros INT UNSIGNED NOT NULL DEFAULT 0,
        Total_Viajaron INT UNSIGNED NOT NULL DEFAULT 0,
        Total_No_Viajaron INT UNSIGNED NOT NULL DEFAULT 0,
        Confirmada_En DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        Confirmada_Por BIGINT UNSIGNED NULL,
        PRIMARY KEY (Id_Confirmacion),
        UNIQUE KEY ux_confirmaciones_jornada_tour_fecha (Id_Tour, Fecha_Tour),
        KEY idx_confirmaciones_jornada_fecha (Fecha_Tour),
        KEY idx_confirmaciones_jornada_usuario (Confirmada_Por)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ).catch((error) => {
      jornadaSchemaPromise = null;
      throw error;
    });
  }
  return jornadaSchemaPromise;
}

function serviceError(message, status = 400, errorCode = 'VALIDATION_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function validarFiltros(idTourValue, fechaValue) {
  const Id_Tour = Number(idTourValue);
  const Fecha = String(fechaValue || '').trim();
  if (!Number.isInteger(Id_Tour) || Id_Tour <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(Fecha)) {
    throw serviceError('Selecciona un tour y una fecha válidos.', 400, 'INVALID_FILTERS');
  }
  return { Id_Tour, Fecha };
}

function normalizarCambios(pasajeros) {
  if (!Array.isArray(pasajeros) || !pasajeros.length || pasajeros.length > MAX_CAMBIOS) {
    throw serviceError('La selección de pasajeros no es válida.', 400, 'INVALID_PASSENGERS');
  }

  const cambios = new Map();
  for (const pasajero of pasajeros) {
    const id = Number(pasajero?.Id_Pasajero);
    const confirmacion = Number(pasajero?.Confirmacion);
    if (!Number.isInteger(id) || id <= 0 || ![0, 1].includes(confirmacion)) {
      throw serviceError('Hay pasajeros con una confirmación inválida.', 400, 'INVALID_CONFIRMATION');
    }
    cambios.set(id, confirmacion);
  }
  return Array.from(cambios, ([Id_Pasajero, Confirmacion]) => ({ Id_Pasajero, Confirmacion }));
}

async function obtenerPasajerosPorTour(idTourValue, fechaValue) {
  const { Id_Tour, Fecha } = validarFiltros(idTourValue, fechaValue);
  const [rows] = await db.query(
    `SELECT
       P.Id_Pasajero,
       P.Id_Reserva,
       P.Nombre_Pasajero,
       P.DNI,
       P.Telefono_Pasajero,
       P.Tipo_Pasajero,
       P.Confirmacion,
       R.Telefono_Reportante,
       R.Nombre_Reportante,
       R.Tipo_Reserva,
       C.Nombre_Canal,
       COALESCE(PP.Nombre_Punto, PH.Nombre_Punto) AS PuntoEncuentro
     FROM pasajeros P
     INNER JOIN reservas R ON R.Id_Reserva = P.Id_Reserva
     INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
     LEFT JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
     LEFT JOIN puntos PP ON PP.Id_Punto = P.Id_Punto
     LEFT JOIN puntos PH ON PH.Id_Punto = H.Id_Punto
     WHERE H.Id_Tour = ?
       AND R.Fecha_Tour = ?
       AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
     ORDER BY R.Id_Reserva, P.Nombre_Pasajero, P.Id_Pasajero`,
    [Id_Tour, Fecha],
  );
  return rows;
}

function normalizarEstadoJornadas(rows, Fecha) {
  const jornadas = (rows || []).map((row) => {
    const totalPasajeros = Number(row.Total_Pasajeros || 0);
    const totalViajaron = Number(row.Total_Viajaron || 0);
    const fueConfirmada = Boolean(row.Confirmada_En);
    const cambioCantidad = fueConfirmada && Number(row.Total_Pasajeros_Confirmados || 0) !== totalPasajeros;
    return {
      Id_Tour: Number(row.Id_Tour),
      Nombre_Tour: row.Nombre_Tour,
      Total_Pasajeros: totalPasajeros,
      Total_Comisionables: Number(row.Total_Comisionables || 0),
      Total_Viajaron: totalViajaron,
      Total_No_Viajaron: totalPasajeros - totalViajaron,
      Confirmada: fueConfirmada && !cambioCantidad,
      Requiere_Confirmacion: !fueConfirmada || cambioCantidad,
      Cambio_Cantidad: cambioCantidad,
      Confirmada_En: row.Confirmada_En || null,
      Confirmada_Por: row.Confirmada_Por ? Number(row.Confirmada_Por) : null,
    };
  });

  return {
    Fecha,
    Total_Jornadas: jornadas.length,
    Jornadas_Pendientes: jornadas.filter((jornada) => jornada.Requiere_Confirmacion).length,
    Total_Pasajeros: jornadas.reduce((sum, jornada) => sum + jornada.Total_Pasajeros, 0),
    jornadas,
  };
}

async function obtenerEstadoConfirmacion(fechaValue, idTourValue = null) {
  const Fecha = String(fechaValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(Fecha)) {
    throw serviceError('Selecciona una fecha válida.', 400, 'INVALID_DATE');
  }

  let Id_Tour = null;
  if (idTourValue !== null && idTourValue !== undefined && String(idTourValue).trim()) {
    Id_Tour = Number(idTourValue);
    if (!Number.isInteger(Id_Tour) || Id_Tour <= 0) {
      throw serviceError('Selecciona un tour válido.', 400, 'INVALID_TOUR');
    }
  }

  await ensureJornadaSchema();
  const params = [Fecha];
  const tourCondition = Id_Tour ? 'AND H.Id_Tour = ?' : '';
  if (Id_Tour) params.push(Id_Tour);
  const [rows] = await db.query(
    `SELECT
       H.Id_Tour,
       T.Nombre_Tour,
       COUNT(P.Id_Pasajero) AS Total_Pasajeros,
       SUM(CASE WHEN P.Comision > 0 THEN 1 ELSE 0 END) AS Total_Comisionables,
       SUM(CASE WHEN P.Confirmacion = 1 THEN 1 ELSE 0 END) AS Total_Viajaron,
       CJ.Total_Pasajeros AS Total_Pasajeros_Confirmados,
       CJ.Total_Viajaron AS Total_Viajaron_Confirmados,
       CJ.Total_No_Viajaron AS Total_No_Viajaron_Confirmados,
       CJ.Confirmada_En,
       CJ.Confirmada_Por
     FROM pasajeros P
     INNER JOIN reservas R ON R.Id_Reserva = P.Id_Reserva
     INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
     INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
     LEFT JOIN confirmaciones_jornada CJ
       ON CJ.Id_Tour = H.Id_Tour AND CJ.Fecha_Tour = R.Fecha_Tour
     WHERE R.Fecha_Tour = ?
       ${tourCondition}
       AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
     GROUP BY H.Id_Tour, T.Nombre_Tour, CJ.Id_Confirmacion, CJ.Total_Pasajeros,
              CJ.Total_Viajaron, CJ.Total_No_Viajaron, CJ.Confirmada_En, CJ.Confirmada_Por
     ORDER BY T.Nombre_Tour, H.Id_Tour`,
    params,
  );

  return normalizarEstadoJornadas(rows, Fecha);
}

async function actualizarConfirmacion(payload, userId = null) {
  const { Id_Tour, Fecha } = validarFiltros(payload?.Id_Tour, payload?.Fecha);
  const cambios = normalizarCambios(payload?.pasajeros);
  const ids = cambios.map((item) => item.Id_Pasajero);
  const placeholders = ids.map(() => '?').join(',');
  await ensureJornadaSchema();
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [actuales] = await conn.query(
      `SELECT P.Id_Pasajero, P.Confirmacion, P.Id_Reserva
       FROM pasajeros P
       INNER JOIN reservas R ON R.Id_Reserva = P.Id_Reserva
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       WHERE P.Id_Pasajero IN (${placeholders})
         AND H.Id_Tour = ?
         AND R.Fecha_Tour = ?
         AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
       FOR UPDATE`,
      [...ids, Id_Tour, Fecha],
    );

    if (actuales.length !== ids.length) {
      const encontrados = new Set(actuales.map((row) => Number(row.Id_Pasajero)));
      const invalidos = ids.filter((id) => !encontrados.has(id));
      throw serviceError(
        'La lista cambió o contiene pasajeros que no pertenecen a esta jornada.',
        409,
        'TRIP_CONTROL_CHANGED',
        invalidos,
      );
    }

    const actualPorId = new Map(actuales.map((row) => [Number(row.Id_Pasajero), row]));
    const efectivos = cambios.filter((item) =>
      Number(actualPorId.get(item.Id_Pasajero)?.Confirmacion || 0) !== item.Confirmacion,
    );
    if (efectivos.length) {
      const caseSql = efectivos.map(() => 'WHEN ? THEN ?').join(' ');
      const caseParams = efectivos.flatMap((item) => [item.Id_Pasajero, item.Confirmacion]);
      const effectiveIds = efectivos.map((item) => item.Id_Pasajero);
      const effectivePlaceholders = effectiveIds.map(() => '?').join(',');
      await conn.query(
        `UPDATE pasajeros
         SET Confirmacion = CASE Id_Pasajero ${caseSql} ELSE Confirmacion END
         WHERE Id_Pasajero IN (${effectivePlaceholders})`,
        [...caseParams, ...effectiveIds],
      );
    }

    const [[resumen]] = await conn.query(
      `SELECT
         COUNT(P.Id_Pasajero) AS Total_Pasajeros,
         SUM(CASE WHEN P.Confirmacion = 1 THEN 1 ELSE 0 END) AS Total_Viajaron,
         GROUP_CONCAT(DISTINCT P.Id_Reserva ORDER BY P.Id_Reserva SEPARATOR ',') AS Reservas
       FROM pasajeros P
       INNER JOIN reservas R ON R.Id_Reserva = P.Id_Reserva
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       WHERE H.Id_Tour = ?
         AND R.Fecha_Tour = ?
         AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')`,
      [Id_Tour, Fecha],
    );
    const totalPasajeros = Number(resumen?.Total_Pasajeros || 0);
    const totalViajaron = Number(resumen?.Total_Viajaron || 0);
    const totalNoViajaron = totalPasajeros - totalViajaron;

    await conn.query(
      `INSERT INTO confirmaciones_jornada
       (Id_Tour, Fecha_Tour, Total_Pasajeros, Total_Viajaron, Total_No_Viajaron, Confirmada_En, Confirmada_Por)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         Total_Pasajeros = VALUES(Total_Pasajeros),
         Total_Viajaron = VALUES(Total_Viajaron),
         Total_No_Viajaron = VALUES(Total_No_Viajaron),
         Confirmada_En = NOW(),
         Confirmada_Por = VALUES(Confirmada_Por)`,
      [Id_Tour, Fecha, totalPasajeros, totalViajaron, totalNoViajaron, userId || null],
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'pasajeros',
      id_registro: 'CONTROL_VIAJE',
      accion: 'ACTUALIZAR_ASISTENCIA',
      id_usuario: userId,
      detalles: [
        { columna: 'Fecha_Tour', anterior: null, nuevo: Fecha },
        { columna: 'Id_Tour', anterior: null, nuevo: Id_Tour },
        { columna: 'Cambios', anterior: null, nuevo: efectivos.length },
        { columna: 'Confirmados', anterior: null, nuevo: totalViajaron },
        { columna: 'No_Viajaron', anterior: null, nuevo: totalNoViajaron },
        { columna: 'Reservas', anterior: null, nuevo: resumen?.Reservas || '' },
      ],
    });

    await conn.commit();
    return {
      updated: efectivos.length,
      confirmed: true,
      totalPasajeros,
      totalViajaron,
      totalNoViajaron,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  obtenerPasajerosPorTour,
  obtenerEstadoConfirmacion,
  actualizarConfirmacion,
  normalizarCambios,
  validarFiltros,
  normalizarEstadoJornadas,
  ensureJornadaSchema,
};
