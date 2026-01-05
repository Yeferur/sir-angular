// backend/services/puntos.service.js
const db = require('../../database/db');
const { recordHistorial, logSistema } = require('../Historial/logger');

/**
 * Devuelve los puntos de encuentro de la ruta, en orden de aparición (posición).
 * Si algún punto puede aparecer más de una vez, puedes agregar DISTINCT o GROUP BY.
 */
async function obtenerPuntos({ page = 1, limit = 10, q = '' }) {
  page = Number(page) || 1;
  limit = Number(limit) || 10;
  const offset = (page - 1) * limit;

  const search = (q ?? '').trim();
  const hasSearch = search.length > 0;

  // ----------------------------
  // 1) COUNT (para paginación)
  // ----------------------------
  // OJO: si activas FULLTEXT (recomendado), cambia el WHERE aquí también (abajo te dejo el SQL).
  const term = hasSearch ? `%${search}%` : null;
  const where = hasSearch
    ? `WHERE
  p.Nombre_Punto LIKE ?
  OR p.Sector LIKE ?
  OR p.Direccion LIKE ?
  OR EXISTS (
    SELECT 1
    FROM horarios h
    WHERE h.Id_Punto = p.Id_Punto
      AND h.Hora_Salida LIKE ?
  )
`
    : ``;

  const args = hasSearch ? [term, term, term, term] : [];

  const sqlCount = `SELECT COUNT(*) AS total FROM puntos p ${where}`;
  const [countRows] = await db.query(sqlCount, args);
  const total = Number(countRows?.[0]?.total ?? 0);

  // ----------------------------
  // 2) PAGE DATA
  // ----------------------------
  const sql = `
    SELECT
      p.Id_Punto,
      p.Nombre_Punto AS NombrePunto,
      p.Latitud,
      p.Longitud,
      p.Sector,
      p.Direccion
    FROM puntos p
    ${where}
    ORDER BY p.Nombre_Punto ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [...args, limit, offset]);

  // ----------------------------
  // 3) HORARIOS + NOMBRE TOUR (batch)
  // ----------------------------
  if (!rows?.length) return { rows: [], total };

  const ids = rows.map(r => r.Id_Punto).filter(Boolean);
  if (!ids.length) return { rows, total };

  const placeholders = ids.map(() => '?').join(',');

  // IMPORTANTE:
  // - traemos NombreTour desde la tabla tours
  // - la columna en la DB es Nombre_Tour
  const sqlH = `
    SELECT
      h.Id_Punto,
      h.Id_Tour,
      t.Nombre_Tour AS NombreTour,
      h.Hora_Salida AS HoraSalida
    FROM horarios h
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    WHERE h.Id_Punto IN (${placeholders})
    ORDER BY h.Id_Punto ASC, h.Id_Tour ASC
  `;

  const [hRows] = await db.query(sqlH, ids);

  const map = Object.create(null);
  for (const h of hRows) {
    if (!map[h.Id_Punto]) map[h.Id_Punto] = [];
    map[h.Id_Punto].push({
      Id_Tour: h.Id_Tour,
      NombreTour: h.NombreTour || null,
      HoraSalida: h.HoraSalida
    });
  }

  for (const r of rows) {
    r.horarios = map[r.Id_Punto] || [];
  }

  return { rows, total };
}
async function obtenerPuntosQuery(query) {
  const sql = `
    SELECT
      Id_Punto,
      Nombre_Punto AS NombrePunto,
      Latitud,
      Longitud,
      Sector,
      Direccion
    FROM puntos
    WHERE Nombre_Punto LIKE ?
    ORDER BY Id_Punto ASC
    LIMIT 10
  `;
  
  const params = [`%${query}%`];
  const [rows] = await db.query(sql, params);
  
  return rows;
}

/** Buscar puntos por dirección (exact match normalizado o LIKE)
 *  Retorna hasta 10 resultados. Usa parámetros para evitar inyección.
 */
async function obtenerPuntosPorDireccion(direccion) {
  const d = (direccion || '').toString().trim();
  if (!d) return [];

  // Normalizamos espacios para búsqueda exacta (no manejamos diacríticos aquí)
  const exact = d.replace(/\s+/g, '');

  // 1) Intentar coincidencia exacta (sin espacios, case-insensitive)
  const sqlExact = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE LOWER(REPLACE(Direccion, ' ', '')) = LOWER(?)
    LIMIT 1
  `;
  try {
    const [rowsExact] = await db.query(sqlExact, [exact]);
    if (rowsExact && rowsExact.length) return rowsExact;
  } catch (err) {
    // fallthrough a LIKE
    console.error('Error buscar por direccion exacta:', err);
  }

  // 2) Fallback a LIKE (más tolerante)
  const sqlLike = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE Direccion LIKE ?
    ORDER BY Id_Punto ASC
    LIMIT 10
  `;
  const params = [`%${d}%`];
  const [rowsLike] = await db.query(sqlLike, params);
  return rowsLike;
}


async function obtenerHorario(Id_Punto, Id_Tour) {
  console.log(Id_Punto, Id_Tour);
  const sql = `
    SELECT
    Id_Horario,Hora_Salida AS HoraSalida
    FROM horarios
    WHERE Id_Punto = ? AND Id_Tour = ?
    ORDER BY Id_Horario DESC
    LIMIT 1
  `;
  const params = [Id_Punto, Id_Tour];

  const [rows] = await db.query(sql, params);

  if (!rows || rows.length === 0) {
    throw new Error('No se encontró información de horario para el punto y tour especificados.');
  }

  // SIR2 no tiene columna Ruta en horarios.
  return {
    Id_Horario: rows[0].Id_Horario,
    HoraSalida: rows[0].HoraSalida
  };
}


async function obtenerHorariosPorPunto(Id_Punto) {
  const sql = `
    SELECT
      h.Id_Tour,
      t.Nombre_Tour AS NombreTour,
      h.Hora_Salida AS HoraSalida
    FROM horarios h
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    WHERE h.Id_Punto = ?
    ORDER BY h.Id_Tour ASC
  `;
  const params = [Id_Punto];
  const [rows] = await db.query(sql, params);
  return rows;
}


async function crearPunto(punto, userId = null) {
  const sql = `
    INSERT INTO puntos (Nombre_Punto, Sector, Direccion, Latitud, Longitud)
    VALUES (?, ?, ?, ?, ?)
  `;
  const params = [punto.Nombre_Punto || punto.NombrePunto || null, punto.Sector || null, punto.Direccion || null, punto.Latitud || null, punto.Longitud || null];
  const [result] = await db.query(sql, params);
  try {
    await recordHistorial({ tabla: 'puntos', id_registro: result.insertId, accion: 'CREAR', id_usuario: userId, detalles: [ { columna: 'Nombre_Punto', anterior: null, nuevo: punto.Nombre_Punto || punto.NombrePunto } ] });
  } catch (err) { console.error('Failed to write historial for crearPunto:', err); }
  return { insertId: result.insertId };
}


async function crearHorariosParaPunto(Id_Punto, horarios, userId = null) {
  if (!Array.isArray(horarios) || horarios.length === 0) return { affectedRows: 0 };

  // Deduplicar por Id_Tour (mantener el último valor de cada tour)
  const horariosMap = new Map();
  for (const h of horarios) {
    const Id_Tour = Number(h.Id_Tour || h.IdTour);
    const Hora_Salida = h.Hora_Salida || h.HoraSalida || h.Hora;
    if (Id_Tour && Hora_Salida) {
      horariosMap.set(Id_Tour, String(Hora_Salida));
    }
  }

  // Convertir el mapa a array de rows
  const rows = Array.from(horariosMap.entries()).map(([Id_Tour, Hora_Salida]) => [Id_Punto, Id_Tour, Hora_Salida]);

  if (!rows.length) return { affectedRows: 0 };

  const placeholders = rows.map(() => '(?, ?, ?)').join(',');
  const flat = rows.flat();

  const sql = `INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida) VALUES ${placeholders}`;
  const [result] = await db.query(sql, flat);
  try {
    await recordHistorial({ tabla: 'horarios', id_registro: Id_Punto, accion: 'CREAR_HORARIOS', id_usuario: userId, detalles: [ { columna: 'count', anterior: null, nuevo: result.affectedRows } ] });
  } catch (err) { console.error('Failed to write historial for crearHorariosParaPunto:', err); }
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}






// --- Nuevas utilidades: obtener por id, actualizar y eliminar ---
async function obtenerPuntoPorId(Id_Punto) {
  const sql = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE Id_Punto = ?
    LIMIT 1
  `;
  const [rows] = await db.query(sql, [Id_Punto]);
  if (!rows || !rows.length) return null;

  const punto = rows[0];

  // Traer horarios asociados
  const sqlH = `
    SELECT
      h.Id_Tour,
      t.Nombre_Tour AS NombreTour,
      h.Hora_Salida AS HoraSalida
    FROM horarios h
    LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
    WHERE h.Id_Punto = ?
    ORDER BY h.Id_Tour ASC
  `;
  const [hRows] = await db.query(sqlH, [Id_Punto]);
  punto.horarios = hRows || [];

  return punto;
}

async function actualizarPunto(Id_Punto, punto, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // fetch previous values for historial
    const [prevRows] = await conn.query('SELECT Nombre_Punto, Sector, Direccion, Latitud, Longitud FROM puntos WHERE Id_Punto = ? LIMIT 1', [Id_Punto]);
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    // 1) Update punto
    console.log('Actualizar punto:', Id_Punto, punto);
    await conn.query(`
      UPDATE puntos
      SET Nombre_Punto = ?, Sector = ?, Direccion = ?, Latitud = ?, Longitud = ?
      WHERE Id_Punto = ?
    `, [
      punto.Nombre_Punto || punto.NombrePunto || null,
      punto.Sector || null,
      punto.Direccion || null,
      punto.Latitud ?? null,
      punto.Longitud ?? null,
      Id_Punto
    ]);

    // 2) ✅ SIEMPRE borrar horarios
    await conn.query('DELETE FROM horarios WHERE Id_Punto = ?', [Id_Punto]);

    // 3) Reinsertar (deduplicado)
    if (Array.isArray(punto.horarios)) {
      const map = new Map();

      for (const h of punto.horarios) {
        const Id_Tour = Number(h.Id_Tour ?? h.IdTour);
        if (!Id_Tour) continue;
        const Hora = String(h.Hora_Salida ?? h.HoraSalida ?? 'Pendiente').trim() || 'Pendiente';
        map.set(Id_Tour, Hora);
      }

      if (map.size) {
        const rows = [...map.entries()].map(
          ([Id_Tour, Hora_Salida]) => [Id_Punto, Id_Tour, Hora_Salida]
        );

        await conn.query(
          `INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida)
           VALUES ${rows.map(() => '(?,?,?)').join(',')}`,
          rows.flat()
        );
      }
    }

    await conn.commit();
    try {
      const detalles = [
        { columna: 'Nombre_Punto', anterior: prev ? prev.Nombre_Punto : null, nuevo: punto.Nombre_Punto || punto.NombrePunto },
        { columna: 'Sector', anterior: prev ? prev.Sector : null, nuevo: punto.Sector || null },
        { columna: 'Direccion', anterior: prev ? prev.Direccion : null, nuevo: punto.Direccion || null },
      ];
      await recordHistorial({ conexion: conn, tabla: 'puntos', id_registro: Id_Punto, accion: 'ACTUALIZAR', id_usuario: userId, detalles });
    } catch (errRec) { console.error('Failed to write historial for actualizarPunto:', errRec); }
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `actualizarPunto error: ${e.message || e}`, meta: { Id_Punto, punto } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}


async function eliminarPunto(Id_Punto, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // get previous snapshot
    const [prevRows] = await conn.query('SELECT Nombre_Punto, Sector, Direccion FROM puntos WHERE Id_Punto = ? LIMIT 1', [Id_Punto]);
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    // 1. Eliminar horarios asociados primero
    await conn.query('DELETE FROM horarios WHERE Id_Punto = ?', [Id_Punto]);

    // 2. Eliminar el punto
    const sql = `DELETE FROM puntos WHERE Id_Punto = ?`;
    const [result] = await conn.query(sql, [Id_Punto]);

    await conn.commit();
    try {
      const detalles = [ { columna: 'Nombre_Punto', anterior: prev ? prev.Nombre_Punto : null, nuevo: null }, { columna: 'Direccion', anterior: prev ? prev.Direccion : null, nuevo: null } ];
      await recordHistorial({ conexion: conn, tabla: 'puntos', id_registro: Id_Punto, accion: 'ELIMINAR', id_usuario: userId, detalles });
    } catch (errRec) { console.error('Failed to write historial for eliminarPunto:', errRec); }
    return result;
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `eliminarPunto error: ${e.message || e}`, meta: { Id_Punto } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}


module.exports = {
  obtenerPuntos,
  obtenerPuntosQuery,
  obtenerHorario,
  obtenerHorariosPorPunto,
  obtenerPuntosPorDireccion,
  crearPunto,
  crearHorariosParaPunto,
  obtenerPuntoPorId,
  actualizarPunto,
  eliminarPunto
};