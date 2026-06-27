// backend/services/puntos.service.js
const db = require('../../database/db');
const { recordHistorial, logSistema } = require('../Historial/logger');

function normalizarRuta(r) {
  const s = (r ?? '').toString().trim();
  if (!s) return 'PENDIENTE';
  if (s.toUpperCase() === 'PENDIENTE') return 'PENDIENTE';
  return s;
}

function normalizeComparable(value) {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function createDuplicatePointError(existingPoint) {
  const error = new Error('Ya existe un punto con ese nombre y esa dirección.');
  error.statusCode = 409;
  error.errorCode = 'PUNTO_DUPLICATE_EXACT';
  error.details = existingPoint ? {
    Id_Punto: existingPoint.Id_Punto,
    Nombre_Punto: existingPoint.Nombre_Punto,
    Direccion: existingPoint.Direccion
  } : null;
  return error;
}

async function lockRuta(conn, ruta) {
  await conn.query(`SELECT Id_Punto FROM puntos WHERE ruta = ? FOR UPDATE`, [ruta]);
}

/**
 * Compacta posiciones para una ruta: 1..N sin huecos.
 * MySQL 5.7+ (usa variables).
 */
async function compactarRuta(conn, ruta) {
  await lockRuta(conn, ruta);
  await conn.query(`SET @n := 0;`);
  await conn.query(
    `
    UPDATE puntos p
    JOIN (
      SELECT Id_Punto, (@n := @n + 1) AS rn
      FROM puntos
      WHERE ruta = ?
      ORDER BY posicion ASC, Id_Punto ASC
    ) x ON x.Id_Punto = p.Id_Punto
    SET p.posicion = x.rn
    WHERE p.ruta = ?;
    `,
    [ruta, ruta]
  );
}

/**
 * Asigna posición al final de una ruta (MAX+1).
 */
async function asignarAlFinal(conn, idPunto, ruta) {
  await lockRuta(conn, ruta);
  const [[mx]] = await conn.query(
    `SELECT COALESCE(MAX(posicion), 0) AS m FROM puntos WHERE ruta = ?`,
    [ruta]
  );
  const nextPos = Number(mx?.m ?? 0) + 1;
  await conn.query(`UPDATE puntos SET posicion = ? WHERE Id_Punto = ?`, [nextPos, idPunto]);
  await compactarRuta(conn, ruta);
  return nextPos;
}

/**
 * Reordenar manual por ruta: recibe ids en el orden final (1..N).
 * Reescribe posiciones exactas y compacta.
 * - Valida que todos pertenezcan a esa ruta.
 * - Si faltan IDs en el payload, se anexan al final (para no perderlos).
 */
async function reordenarPuntosRuta(rutaInput, idsOrdenados, userId = null) {
  const ruta = normalizarRuta(rutaInput);

  if (!Array.isArray(idsOrdenados) || idsOrdenados.length === 0) {
    throw new Error('idsOrdenados es requerido y debe ser un array con al menos 1 Id_Punto.');
  }

  // normaliza ids
  const ids = idsOrdenados
    .map(x => Number(x))
    .filter(x => Number.isFinite(x) && x > 0);

  if (!ids.length) throw new Error('idsOrdenados inválido.');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await lockRuta(conn, ruta);

    // Traer todos los puntos de esa ruta
    const [allRows] = await conn.query(
      `SELECT Id_Punto FROM puntos WHERE ruta = ? ORDER BY posicion ASC, Id_Punto ASC`,
      [ruta]
    );
    const allIds = allRows.map(r => Number(r.Id_Punto));

    // Validar: ids recibidos deben estar dentro de la ruta
    const setAll = new Set(allIds);
    for (const id of ids) {
      if (!setAll.has(id)) {
        throw new Error(`El punto ${id} no pertenece a la ruta ${ruta}.`);
      }
    }

    // Si el payload no incluyó todos, añadimos los faltantes al final en su orden actual
    const setPayload = new Set(ids);
    const faltantes = allIds.filter(id => !setPayload.has(id));
    const finalOrder = ids.concat(faltantes);

    // Reescribir posiciones en bloque con CASE
    // (rápido y sin múltiples updates)
    const cases = finalOrder.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
    const inList = finalOrder.join(',');

    await conn.query(
      `UPDATE puntos SET posicion = CASE Id_Punto ${cases} ELSE posicion END
       WHERE ruta = ? AND Id_Punto IN (${inList})`,
      [ruta]
    );

    await compactarRuta(conn, ruta);

    await recordHistorial({
      conexion: conn,
      tabla: 'puntos',
      id_registro: 0,
      accion: 'REORDENAR_RUTA',
      id_usuario: userId,
      detalles: [{ columna: 'ruta', anterior: null, nuevo: ruta }]
    });

    await conn.commit();

    return { ok: true, ruta, total: finalOrder.length };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `reordenarPuntosRuta error: ${e.message || e}`, meta: { ruta, idsOrdenados } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function obtenerRutasPuntos() {
  const [rows] = await db.query(
    `
    SELECT DISTINCT ruta
    FROM puntos
    WHERE ruta IS NOT NULL AND TRIM(ruta) <> ''
    ORDER BY ruta ASC
    `
  );
  return rows.map((r) => r.ruta);
}

async function obtenerPuntosPorRuta(rutaInput) {
  const ruta = normalizarRuta(rutaInput);
  const [rows] = await db.query(
    `
    SELECT
      Id_Punto,
      Nombre_Punto AS NombrePunto,
      ruta,
      posicion,
      Sector,
      Direccion,
      Latitud,
      Longitud
    FROM puntos
    WHERE ruta = ?
    ORDER BY posicion ASC, Id_Punto ASC
    `,
    [ruta]
  );
  return rows;
}

async function actualizarOrdenPuntosRuta(rutaInput, ordenItems, userId = null) {
  const ruta = normalizarRuta(rutaInput);

  if (!Array.isArray(ordenItems) || !ordenItems.length) {
    throw new Error('ordenItems es requerido y debe ser un array no vacío.');
  }

  const parsedItems = ordenItems
    .map((item) => {
      const idRaw = item?.id_punto ?? item?.Id_Punto ?? item?.idPunto;
      const posRaw = item?.posicion ?? item?.Posicion;
      const id = Number(idRaw);
      const posicion = Number(posRaw);
      return { id, posicion };
    })
    .filter((x) => Number.isFinite(x.id) && x.id > 0 && Number.isFinite(x.posicion) && x.posicion > 0);

  if (!parsedItems.length) {
    throw new Error('El payload no contiene elementos válidos con id_punto y posicion.');
  }

  const ids = parsedItems.map((x) => x.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new Error('Hay id_punto repetidos en el payload.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await lockRuta(conn, ruta);

    const [rowsRuta] = await conn.query(
      `SELECT Id_Punto FROM puntos WHERE ruta = ? ORDER BY posicion ASC, Id_Punto ASC`,
      [ruta]
    );
    const idsRuta = rowsRuta.map((r) => Number(r.Id_Punto));
    const idsRutaSet = new Set(idsRuta);

    for (const id of ids) {
      if (!idsRutaSet.has(id)) {
        throw new Error(`El punto ${id} no pertenece a la ruta ${ruta}.`);
      }
    }

    const sortedByPos = [...parsedItems].sort((a, b) => a.posicion - b.posicion);
    const orderedIds = sortedByPos.map((x) => x.id);

    const faltantes = idsRuta.filter((id) => !uniqueIds.has(id));
    const finalOrder = orderedIds.concat(faltantes);

    if (!finalOrder.length) {
      throw new Error('No hay puntos para reordenar en la ruta seleccionada.');
    }

    const cases = finalOrder.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
    const inList = finalOrder.join(',');

    await conn.query(
      `
      UPDATE puntos
      SET posicion = CASE Id_Punto ${cases} ELSE posicion END
      WHERE ruta = ? AND Id_Punto IN (${inList})
      `,
      [ruta]
    );

    await compactarRuta(conn, ruta);
    await recordHistorial({
      conexion: conn,
      tabla: 'puntos',
      id_registro: 0,
      accion: 'REORDENAR_RUTA',
      id_usuario: userId,
      detalles: [{ columna: 'ruta', anterior: null, nuevo: ruta }]
    });

    await conn.commit();

    return { ok: true, ruta, total: finalOrder.length };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `actualizarOrdenPuntosRuta error: ${e.message || e}`, meta: { ruta, ordenItems } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Devuelve puntos paginados (orden: ruta + posicion).
 */
async function obtenerPuntos({ page = 1, limit = 10, q = '' }) {
  page = Number(page) || 1;
  limit = Number(limit) || 10;
  const offset = (page - 1) * limit;

  const search = (q ?? '').trim();
  const hasSearch = search.length > 0;

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

  const sql = `
    SELECT
      p.Id_Punto,
      p.Nombre_Punto AS NombrePunto,
      p.ruta,
      p.posicion,
      p.Latitud,
      p.Longitud,
      p.Sector,
      p.Direccion
    FROM puntos p
    ${where}
    ORDER BY p.ruta ASC, p.posicion ASC, p.Id_Punto ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [...args, limit, offset]);
  if (!rows?.length) return { rows: [], total };

  const ids = rows.map(r => r.Id_Punto).filter(Boolean);
  if (!ids.length) return { rows, total };

  const placeholders = ids.map(() => '?').join(',');

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
      ruta,
      posicion,
      Latitud,
      Longitud,
      Sector,
      Direccion
    FROM puntos
    WHERE Nombre_Punto LIKE ?
    ORDER BY ruta ASC, posicion ASC, Id_Punto ASC
    LIMIT 10
  `;
  const params = [`%${query}%`];
  const [rows] = await db.query(sql, params);
  return rows;
}

async function obtenerPuntosPorDireccion(direccion) {
  const d = (direccion || '').toString().trim();
  if (!d) return [];

  const exact = d.replace(/\s+/g, '');

  const sqlExact = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, ruta, posicion, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE LOWER(REPLACE(Direccion, ' ', '')) = LOWER(?)
    LIMIT 1
  `;
  try {
    const [rowsExact] = await db.query(sqlExact, [exact]);
    if (rowsExact && rowsExact.length) return rowsExact;
  } catch (err) {
    console.error('Error buscar por direccion exacta:', err);
  }

  const sqlLike = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, ruta, posicion, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE Direccion LIKE ?
    ORDER BY ruta ASC, posicion ASC, Id_Punto ASC
    LIMIT 10
  `;
  const params = [`%${d}%`];
  const [rowsLike] = await db.query(sqlLike, params);
  return rowsLike;
}

async function obtenerHorario(Id_Punto, Id_Tour) {
  const sql = `
    SELECT Id_Horario, Hora_Salida AS HoraSalida
    FROM horarios
    WHERE Id_Punto = ? AND Id_Tour = ?
    ORDER BY Id_Horario DESC
    LIMIT 1
  `;
  const [rows] = await db.query(sql, [Id_Punto, Id_Tour]);
  if (!rows || rows.length === 0) {
    throw new Error('No se encontró información de horario para el punto y tour especificados.');
  }
  return { Id_Horario: rows[0].Id_Horario, HoraSalida: rows[0].HoraSalida };
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
  const [rows] = await db.query(sql, [Id_Punto]);
  return rows;
}

/**
 * Crear punto (sin que el front mande posición):
 * - ruta default PENDIENTE si no viene
 * - posicion al final de esa ruta
 * - compacta ruta
 */
async function crearPunto(punto, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const ruta = normalizarRuta(punto.ruta);
    const normalizedName = normalizeComparable(punto.Nombre_Punto || punto.NombrePunto || '');
    const normalizedAddress = normalizeComparable(punto.Direccion || '');

    if (normalizedName && normalizedAddress) {
      const [candidateRows] = await conn.query(
        `SELECT Id_Punto, Nombre_Punto, Direccion
         FROM puntos
         FOR UPDATE`
      );

      const exactDuplicate = candidateRows.find((row) => (
        normalizeComparable(row?.Nombre_Punto || '') === normalizedName
        && normalizeComparable(row?.Direccion || '') === normalizedAddress
      ));

      if (exactDuplicate) {
        throw createDuplicatePointError(exactDuplicate);
      }
    }

    await lockRuta(conn, ruta);
    const [[mx]] = await conn.query(
      `SELECT COALESCE(MAX(posicion), 0) AS m FROM puntos WHERE ruta = ?`,
      [ruta]
    );
    const nextPos = Number(mx?.m ?? 0) + 1;

    const sql = `
      INSERT INTO puntos (Nombre_Punto, Sector, Direccion, Latitud, Longitud, ruta, posicion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      punto.Nombre_Punto || punto.NombrePunto || null,
      punto.Sector || null,
      punto.Direccion || null,
      punto.Latitud || null,
      punto.Longitud || null,
      ruta,
      nextPos
    ];

    const [result] = await conn.query(sql, params);

    await compactarRuta(conn, ruta);

    await conn.commit();

    try {
      await recordHistorial({
        tabla: 'puntos',
        id_registro: result.insertId,
        accion: 'CREAR_PUNTO',
        id_usuario: userId,
        detalles: [
          { columna: 'Nombre_Punto', anterior: null, nuevo: punto.Nombre_Punto || punto.NombrePunto },
          { columna: 'ruta', anterior: null, nuevo: ruta },
          { columna: 'posicion', anterior: null, nuevo: nextPos }
        ]
      });
    } catch (err) {
      console.error('Failed to write historial for crearPunto:', err);
    }

    return { insertId: result.insertId };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `crearPunto error: ${e.message || e}`, meta: { punto } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function crearHorariosParaPunto(Id_Punto, horarios, userId = null) {
  if (!Array.isArray(horarios) || horarios.length === 0) return { affectedRows: 0 };

  const horariosMap = new Map();
  for (const h of horarios) {
    const Id_Tour = Number(h.Id_Tour || h.IdTour);
    const Hora_Salida = h.Hora_Salida || h.HoraSalida || h.Hora;
    if (Id_Tour && Hora_Salida) horariosMap.set(Id_Tour, String(Hora_Salida));
  }

  const rows = Array.from(horariosMap.entries()).map(([Id_Tour, Hora_Salida]) => [Id_Punto, Id_Tour, Hora_Salida]);
  if (!rows.length) return { affectedRows: 0 };

  const placeholders = rows.map(() => '(?, ?, ?)').join(',');
  const flat = rows.flat();

  const sql = `INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida) VALUES ${placeholders}`;
  const [result] = await db.query(sql, flat);

  try {
    await recordHistorial({
      tabla: 'horarios',
      id_registro: Id_Punto,
      accion: 'CREAR_HORARIOS',
      id_usuario: userId,
      detalles: [{ columna: 'count', anterior: null, nuevo: result.affectedRows }]
    });
  } catch (err) {
    console.error('Failed to write historial for crearHorariosParaPunto:', err);
  }

  return { insertId: result.insertId, affectedRows: result.affectedRows };
}

async function obtenerPuntoPorId(Id_Punto) {
  const sql = `
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, ruta, posicion, Latitud, Longitud, Sector, Direccion
    FROM puntos
    WHERE Id_Punto = ?
    LIMIT 1
  `;
  const [rows] = await db.query(sql, [Id_Punto]);
  if (!rows || !rows.length) return null;

  const punto = rows[0];

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

/**
 * Actualizar punto:
 * - si cambia ruta => lo manda al final de la ruta nueva
 * - compacta ruta vieja y nueva
 * - NO requiere posicion enviada en flujo normal
 */
async function actualizarPunto(Id_Punto, punto, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [prevRows] = await conn.query(
      `SELECT Nombre_Punto, Sector, Direccion, Latitud, Longitud, ruta, posicion
       FROM puntos
       WHERE Id_Punto = ? LIMIT 1 FOR UPDATE`,
      [Id_Punto]
    );
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;
    if (!prev) throw new Error('Punto no existe');

    const rutaVieja = normalizarRuta(prev.ruta);
    const rutaNueva = normalizarRuta(punto.ruta ?? prev.ruta);

    await conn.query(
      `
      UPDATE puntos
      SET Nombre_Punto = ?, Sector = ?, Direccion = ?, Latitud = ?, Longitud = ?, ruta = ?
      WHERE Id_Punto = ?
      `,
      [
        punto.Nombre_Punto || punto.NombrePunto || null,
        punto.Sector || null,
        punto.Direccion || null,
        punto.Latitud ?? null,
        punto.Longitud ?? null,
        rutaNueva,
        Id_Punto
      ]
    );

    if (rutaNueva !== rutaVieja) {
      await asignarAlFinal(conn, Id_Punto, rutaNueva);
      await compactarRuta(conn, rutaVieja);
      await compactarRuta(conn, rutaNueva);
    } else {
      // por seguridad: compactar siempre mantiene el 1..N aunque haya datos viejos raros
      await compactarRuta(conn, rutaNueva);
    }

    await conn.query('DELETE FROM horarios WHERE Id_Punto = ?', [Id_Punto]);

    if (Array.isArray(punto.horarios)) {
      const map = new Map();
      for (const h of punto.horarios) {
        const Id_Tour = Number(h.Id_Tour ?? h.IdTour);
        if (!Id_Tour) continue;
        const Hora = String(h.Hora_Salida ?? h.HoraSalida ?? 'Pendiente').trim() || 'Pendiente';
        map.set(Id_Tour, Hora);
      }

      if (map.size) {
        const rows = [...map.entries()].map(([Id_Tour, Hora_Salida]) => [Id_Punto, Id_Tour, Hora_Salida]);
        await conn.query(
          `INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida)
           VALUES ${rows.map(() => '(?,?,?)').join(',')}`,
          rows.flat()
        );
      }
    }

    const detalles = [
      { columna: 'Nombre_Punto', anterior: prev.Nombre_Punto, nuevo: punto.Nombre_Punto || punto.NombrePunto },
      { columna: 'Sector', anterior: prev.Sector, nuevo: punto.Sector || null },
      { columna: 'Direccion', anterior: prev.Direccion, nuevo: punto.Direccion || null },
      { columna: 'ruta', anterior: prev.ruta, nuevo: rutaNueva }
    ];
    await recordHistorial({ conexion: conn, tabla: 'puntos', id_registro: Id_Punto, accion: 'ACTUALIZAR_PUNTO', id_usuario: userId, detalles });

    await conn.commit();
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

    const [prevRows] = await conn.query(
      `SELECT Nombre_Punto, Sector, Direccion, ruta
       FROM puntos
       WHERE Id_Punto = ? LIMIT 1 FOR UPDATE`,
      [Id_Punto]
    );
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;
    if (!prev) throw new Error('Punto no existe');

    const ruta = normalizarRuta(prev.ruta);

    await conn.query('DELETE FROM horarios WHERE Id_Punto = ?', [Id_Punto]);
    const [result] = await conn.query(`DELETE FROM puntos WHERE Id_Punto = ?`, [Id_Punto]);

    await compactarRuta(conn, ruta);

    const detalles = [
      { columna: 'Nombre_Punto', anterior: prev.Nombre_Punto, nuevo: null },
      { columna: 'Direccion', anterior: prev.Direccion, nuevo: null },
      { columna: 'ruta', anterior: prev.ruta, nuevo: null }
    ];
    await recordHistorial({ conexion: conn, tabla: 'puntos', id_registro: Id_Punto, accion: 'ELIMINAR_PUNTO', id_usuario: userId, detalles });

    await conn.commit();

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
  obtenerRutasPuntos,
  obtenerPuntosPorRuta,
  obtenerHorario,
  obtenerHorariosPorPunto,
  obtenerPuntosPorDireccion,
  crearPunto,
  crearHorariosParaPunto,
  obtenerPuntoPorId,
  actualizarPunto,
  eliminarPunto,
  reordenarPuntosRuta,
  actualizarOrdenPuntosRuta
};
