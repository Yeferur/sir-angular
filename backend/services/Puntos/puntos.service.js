// backend/services/puntos.service.js
const db = require('../../database/db');
const { recordHistorial, logSistema } = require('../Historial/logger');
const PUNTO_PROTEGIDO_ID = Number(process.env.PUNTOS_ESTACION_POBLADO_ID || 6);

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
      WHERE ruta = ? AND Activo = 1
      ORDER BY posicion ASC, Id_Punto ASC
    ) x ON x.Id_Punto = p.Id_Punto
    SET p.posicion = x.rn
    WHERE p.ruta = ? AND p.Activo = 1;
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
    `SELECT COALESCE(MAX(posicion), 0) AS m FROM puntos WHERE ruta = ? AND Activo = 1`,
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
  if (ruta === 'PENDIENTE') {
    const error = new Error('Los puntos pendientes deben tener una ruta asignada antes de poder ordenarse.');
    error.statusCode = 422;
    error.errorCode = 'RUTA_REQUIRED_FOR_ORDER';
    throw error;
  }

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
      `SELECT Id_Punto FROM puntos WHERE ruta = ? AND Activo = 1 ORDER BY posicion ASC, Id_Punto ASC`,
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
       WHERE ruta = ? AND Activo = 1 AND Id_Punto IN (${inList})`,
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
    WHERE Activo = 1 AND ruta IS NOT NULL AND TRIM(ruta) <> ''
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
    WHERE ruta = ? AND Activo = 1
    ORDER BY posicion ASC, Id_Punto ASC
    `,
    [ruta]
  );
  return rows.map(row => ({
    ...row,
    EsProtegido: Number(row.Id_Punto) === PUNTO_PROTEGIDO_ID
  }));
}

async function actualizarOrdenPuntosRuta(rutaInput, ordenItems, userId = null) {
  const ruta = normalizarRuta(rutaInput);
  if (ruta === 'PENDIENTE') {
    const error = new Error('Los puntos pendientes deben tener una ruta asignada antes de poder ordenarse.');
    error.statusCode = 422;
    error.errorCode = 'RUTA_REQUIRED_FOR_ORDER';
    throw error;
  }

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
      `SELECT Id_Punto FROM puntos WHERE ruta = ? AND Activo = 1 ORDER BY posicion ASC, Id_Punto ASC`,
      [ruta]
    );
    const idsRuta = rowsRuta.map((r) => Number(r.Id_Punto));
    const idsRutaSet = new Set(idsRuta);

    if (ids.length !== idsRuta.length) {
      const error = new Error('El orden debe incluir todos los puntos activos de la ruta.');
      error.statusCode = 422;
      error.errorCode = 'INCOMPLETE_ROUTE_ORDER';
      throw error;
    }

    for (const id of ids) {
      if (!idsRutaSet.has(id)) {
        throw new Error(`El punto ${id} no pertenece a la ruta ${ruta}.`);
      }
    }

    const sortedByPos = [...parsedItems].sort((a, b) => a.posicion - b.posicion);
    const positionsAreContinuous = sortedByPos.every((item, index) => item.posicion === index + 1);
    if (!positionsAreContinuous) {
      const error = new Error('Las posiciones deben ser únicas y consecutivas desde 1.');
      error.statusCode = 422;
      error.errorCode = 'INVALID_ROUTE_POSITIONS';
      throw error;
    }
    const orderedIds = sortedByPos.map((x) => x.id);

    const finalOrder = orderedIds;

    if (!finalOrder.length) {
      throw new Error('No hay puntos para reordenar en la ruta seleccionada.');
    }
    if (ruta === '0' && finalOrder.includes(PUNTO_PROTEGIDO_ID) && finalOrder[0] !== PUNTO_PROTEGIDO_ID) {
      const error = new Error('Estación Poblado debe conservarse como primer punto de la ruta 0.');
      error.statusCode = 409;
      error.errorCode = 'PUNTO_PROTEGIDO';
      throw error;
    }

    const cases = finalOrder.map((id, idx) => `WHEN ${id} THEN ${idx + 1}`).join(' ');
    const inList = finalOrder.join(',');

    await conn.query(
      `
      UPDATE puntos
      SET posicion = CASE Id_Punto ${cases} ELSE posicion END
      WHERE ruta = ? AND Activo = 1 AND Id_Punto IN (${inList})
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
async function obtenerPuntos({
  page = 1,
  limit = 10,
  q = '',
  ruta = '',
  allowLargeLimit = false
}) {
  page = Math.max(1, Math.trunc(Number(page)) || 1);
  const maxLimit = allowLargeLimit ? 10000 : 100;
  limit = Math.min(maxLimit, Math.max(1, Math.trunc(Number(limit)) || 10));

  const search = String(q ?? '').trim();
  const routeFilter = String(ruta ?? '').trim();
  const conditions = ['p.Activo = 1'];
  const args = [];

  if (search) {
    const term = `%${search}%`;
    conditions.push(`(
      p.Nombre_Punto LIKE ?
      OR p.Sector LIKE ?
      OR p.Direccion LIKE ?
    )`);
    args.push(term, term, term);
  }

  if (routeFilter) {
    conditions.push('p.ruta = ?');
    args.push(routeFilter);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sqlCount = `SELECT COUNT(*) AS total FROM puntos p ${where}`;
  const [countRows] = await db.query(sqlCount, args);
  const total = Number(countRows?.[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  page = Math.min(page, totalPages);
  const offset = (page - 1) * limit;

  const sql = `
    SELECT
      p.Id_Punto,
      p.Nombre_Punto AS NombrePunto,
      p.ruta,
      p.posicion,
      p.Latitud,
      p.Longitud,
      p.Sector,
      p.Direccion,
      p.Activo
    FROM puntos p
    ${where}
    ORDER BY p.ruta ASC, p.posicion ASC, p.Id_Punto ASC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await db.query(sql, [...args, limit, offset]);
  if (!rows?.length) return { rows: [], total, page, limit };

  const ids = rows.map(r => r.Id_Punto).filter(Boolean);
  if (!ids.length) return { rows, total, page, limit };

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
    r.EsProtegido = Number(r.Id_Punto) === PUNTO_PROTEGIDO_ID;
  }

  return { rows, total, page, limit };
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
    WHERE Activo = 1 AND Nombre_Punto LIKE ?
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
    WHERE Activo = 1 AND LOWER(REPLACE(Direccion, ' ', '')) = LOWER(?)
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
    WHERE Activo = 1 AND Direccion LIKE ?
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
    let nextPos;
    const anteriorId = Number(punto.Id_Punto_Anterior || 0);
    if (anteriorId > 0) {
      const [[anterior]] = await conn.query(
        `SELECT Id_Punto, posicion FROM puntos
         WHERE Id_Punto = ? AND ruta = ? AND Activo = 1 FOR UPDATE`,
        [anteriorId, ruta]
      );
      if (!anterior) throw new Error('El punto seleccionado como referencia no pertenece a la ruta.');
      nextPos = Number(anterior.posicion) + 1;
      await conn.query(
      'UPDATE puntos SET posicion = posicion + 1 WHERE ruta = ? AND Activo = 1 AND posicion >= ?',
        [ruta, nextPos]
      );
    } else {
      const [[mx]] = await conn.query(
        `SELECT COALESCE(MAX(posicion), 0) AS m FROM puntos WHERE ruta = ? AND Activo = 1`,
        [ruta]
      );
      nextPos = Number(mx?.m ?? 0) + 1;
    }

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

    if (Array.isArray(punto.horarios) && punto.horarios.length) {
      const horarios = new Map();
      for (const h of punto.horarios) {
        const idTour = Number(h.Id_Tour ?? h.IdTour);
        if (!idTour) continue;
        horarios.set(idTour, String(h.Hora_Salida ?? h.HoraSalida ?? 'Pendiente').trim() || 'Pendiente');
      }
      if (horarios.size) {
        const rows = [...horarios.entries()].map(([idTour, hora]) => [result.insertId, idTour, hora]);
        await conn.query(
          `INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida)
           VALUES ${rows.map(() => '(?,?,?)').join(',')}`,
          rows.flat()
        );
      }
    }

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
    SELECT Id_Punto, Nombre_Punto AS NombrePunto, ruta, posicion, Latitud, Longitud, Sector, Direccion, Activo
    FROM puntos
    WHERE Id_Punto = ?
    LIMIT 1
  `;
  const [rows] = await db.query(sql, [Id_Punto]);
  if (!rows || !rows.length) return null;

  const punto = rows[0];
  punto.EsProtegido = Number(Id_Punto) === PUNTO_PROTEGIDO_ID;

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

    const normalizedName = normalizeComparable(punto.Nombre_Punto || punto.NombrePunto || '');
    const normalizedAddress = normalizeComparable(punto.Direccion || '');
    if (normalizedName && normalizedAddress) {
      const [candidateRows] = await conn.query(
        `SELECT Id_Punto, Nombre_Punto, Direccion
         FROM puntos
         WHERE Id_Punto <> ?
         FOR UPDATE`,
        [Id_Punto]
      );
      const duplicate = candidateRows.find(row =>
        normalizeComparable(row?.Nombre_Punto || '') === normalizedName
        && normalizeComparable(row?.Direccion || '') === normalizedAddress
      );
      if (duplicate) throw createDuplicatePointError(duplicate);
    }

    const rutaVieja = normalizarRuta(prev.ruta);
    const rutaNueva = Number(Id_Punto) === PUNTO_PROTEGIDO_ID
      ? '0'
      : normalizarRuta(punto.ruta ?? prev.ruta);
    const reubicar = Number(Id_Punto) !== PUNTO_PROTEGIDO_ID
      && (rutaNueva !== rutaVieja || punto.reubicar === true);

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

    if (reubicar) {
      await lockRuta(conn, rutaNueva);
      const [rowsRutaNueva] = await conn.query(
        `SELECT Id_Punto
         FROM puntos
         WHERE ruta = ? AND Activo = 1 AND Id_Punto <> ?
         ORDER BY posicion ASC, Id_Punto ASC`,
        [rutaNueva, Id_Punto]
      );
      const orden = rowsRutaNueva.map(row => Number(row.Id_Punto));
      const anteriorId = Number(punto.Id_Punto_Anterior || 0);
      if (anteriorId > 0) {
        const index = orden.indexOf(anteriorId);
        if (index < 0) throw new Error('El punto seleccionado como referencia no pertenece a la ruta.');
        orden.splice(index + 1, 0, Number(Id_Punto));
      } else {
        orden.push(Number(Id_Punto));
      }
      const cases = orden.map((id, index) => `WHEN ${id} THEN ${index + 1}`).join(' ');
      await conn.query(
        `UPDATE puntos
         SET posicion = CASE Id_Punto ${cases} ELSE posicion END
         WHERE ruta = ? AND Activo = 1 AND Id_Punto IN (${orden.join(',')})`,
        [rutaNueva]
      );
      await compactarRuta(conn, rutaVieja);
      await compactarRuta(conn, rutaNueva);
    } else {
      // por seguridad: compactar siempre mantiene el 1..N aunque haya datos viejos raros
      await compactarRuta(conn, rutaNueva);
    }

    if (Array.isArray(punto.horarios)) {
      const map = new Map();
      for (const h of punto.horarios) {
        const Id_Tour = Number(h.Id_Tour ?? h.IdTour);
        if (!Id_Tour) continue;
        const Hora = String(h.Hora_Salida ?? h.HoraSalida ?? 'Pendiente').trim() || 'Pendiente';
        map.set(Id_Tour, Hora);
      }

      for (const [Id_Tour, Hora_Salida] of map.entries()) {
        const [existingRows] = await conn.query(
          `SELECT Id_Horario
           FROM horarios
           WHERE Id_Punto = ? AND Id_Tour = ?
           ORDER BY Id_Horario ASC
           LIMIT 1
           FOR UPDATE`,
          [Id_Punto, Id_Tour]
        );
        const existing = existingRows?.[0];
        if (existing) {
          await conn.query(
            'UPDATE horarios SET Hora_Salida = ? WHERE Id_Horario = ?',
            [Hora_Salida, existing.Id_Horario]
          );
        } else {
          await conn.query(
            'INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida) VALUES (?, ?, ?)',
            [Id_Punto, Id_Tour, Hora_Salida]
          );
        }
      }
    }

    const detalles = [
      { columna: 'Nombre_Punto', anterior: prev.Nombre_Punto, nuevo: punto.Nombre_Punto || punto.NombrePunto },
      { columna: 'Sector', anterior: prev.Sector, nuevo: punto.Sector || null },
      { columna: 'Direccion', anterior: prev.Direccion, nuevo: punto.Direccion || null },
      { columna: 'ruta', anterior: prev.ruta, nuevo: rutaNueva },
      { columna: 'posicion', anterior: prev.posicion, nuevo: reubicar ? 'RECALCULADA' : prev.posicion }
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
      `SELECT Id_Punto, Nombre_Punto, Sector, Direccion, ruta, Activo
       FROM puntos
       WHERE Id_Punto = ? LIMIT 1 FOR UPDATE`,
      [Id_Punto]
    );
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;
    if (!prev) throw new Error('Punto no existe');
    if (Number(Id_Punto) === PUNTO_PROTEGIDO_ID) {
      const error = new Error('Estación Poblado es el punto inicial protegido y no se puede eliminar.');
      error.statusCode = 409;
      error.errorCode = 'PUNTO_PROTEGIDO';
      throw error;
    }

    const ruta = normalizarRuta(prev.ruta);
    const [[uso]] = await conn.query(
      'SELECT COUNT(DISTINCT Id_Reserva) AS total FROM pasajeros WHERE Id_Punto = ?',
      [Id_Punto]
    );
    const reservasAsociadas = Number(uso?.total || 0);
    let result;
    let accion;
    if (reservasAsociadas > 0) {
      [result] = await conn.query('UPDATE puntos SET Activo = 0, posicion = 0 WHERE Id_Punto = ?', [Id_Punto]);
      accion = 'DESACTIVADO';
    } else {
      await conn.query('DELETE FROM horarios WHERE Id_Punto = ?', [Id_Punto]);
      [result] = await conn.query('DELETE FROM puntos WHERE Id_Punto = ?', [Id_Punto]);
      accion = 'ELIMINADO';
    }

    await compactarRuta(conn, ruta);

    const detalles = [
      { columna: 'Nombre_Punto', anterior: prev.Nombre_Punto, nuevo: null },
      { columna: 'Direccion', anterior: prev.Direccion, nuevo: null },
      { columna: 'ruta', anterior: prev.ruta, nuevo: null }
    ];
    await recordHistorial({ conexion: conn, tabla: 'puntos', id_registro: Id_Punto, accion: accion === 'DESACTIVADO' ? 'DESACTIVAR_PUNTO' : 'ELIMINAR_PUNTO', id_usuario: userId, detalles });

    await conn.commit();

    return { accion, reservasAsociadas, affectedRows: result.affectedRows };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `eliminarPunto error: ${e.message || e}`, meta: { Id_Punto } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function validarCoordenadasOSRM(latitud, longitud, fetchImpl = global.fetch) {
  const lat = Number(latitud);
  const lon = Number(longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Las coordenadas no tienen un formato válido.');
  }
  const baseUrl = String(process.env.PROGRAMACION_OSRM_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    const error = new Error('OSRM no está configurado en el backend.');
    error.statusCode = 503;
    error.errorCode = 'OSRM_NO_CONFIGURADO';
    throw error;
  }
  let response;
  try {
    response = await fetchImpl(
      `${baseUrl}/nearest/v1/driving/${lon},${lat}?number=1`,
      { signal: AbortSignal.timeout(Number(process.env.PROGRAMACION_OSRM_TIMEOUT_MS || 5000)) }
    );
  } catch (cause) {
    const error = new Error('No fue posible consultar OSRM.');
    error.statusCode = 503;
    error.errorCode = 'OSRM_NO_DISPONIBLE';
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`OSRM respondió HTTP ${response.status}.`);
    error.statusCode = 503;
    error.errorCode = 'OSRM_NO_DISPONIBLE';
    throw error;
  }
  const body = await response.json();
  const waypoint = body?.waypoints?.[0];
  const distanciaMetros = Number(waypoint?.distance);
  const maxMetros = Number(process.env.PUNTOS_OSRM_MAX_SNAP_METERS || 1000);
  if (body?.code !== 'Ok' || !Number.isFinite(distanciaMetros) || distanciaMetros > maxMetros) {
    const error = new Error('Las coordenadas están demasiado lejos de una vía operativa.');
    error.statusCode = 422;
    error.errorCode = 'COORDENADAS_NO_OPERATIVAS';
    throw error;
  }
  return {
    valida: true,
    distanciaViaMetros: Math.round(distanciaMetros),
    coordenadasAjustadas: waypoint.location
  };
}

async function validarOperatividadRuta(rutaInput) {
  const puntos = await obtenerPuntosPorRuta(rutaInput);
  const resultados = [];
  const pendientes = [];

  for (const punto of puntos) {
    const lat = Number(punto.Latitud);
    const lon = Number(punto.Longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) < 0.0001 || Math.abs(lon) < 0.0001) {
      resultados.push({
        Id_Punto: punto.Id_Punto,
        estado: 'SIN_COORDENADAS',
        mensaje: 'No tiene coordenadas válidas.'
      });
    } else {
      pendientes.push(punto);
    }
  }

  const concurrencia = 5;
  for (let index = 0; index < pendientes.length; index += concurrencia) {
    const bloque = pendientes.slice(index, index + concurrencia);
    const bloqueResultados = await Promise.all(bloque.map(async punto => {
      try {
        const validacion = await validarCoordenadasOSRM(punto.Latitud, punto.Longitud);
        return {
          Id_Punto: punto.Id_Punto,
          estado: 'OPERATIVO',
          distanciaViaMetros: validacion.distanciaViaMetros,
          mensaje: `Conectado a una vía a ${validacion.distanciaViaMetros} m.`
        };
      } catch (error) {
        return {
          Id_Punto: punto.Id_Punto,
          estado: error?.errorCode === 'COORDENADAS_NO_OPERATIVAS'
            ? 'NO_OPERATIVO'
            : 'NO_VERIFICADO',
          mensaje: error?.message || 'No fue posible verificar las coordenadas.'
        };
      }
    }));
    resultados.push(...bloqueResultados);
  }

  return resultados;
}

module.exports = {
  obtenerPuntos,
  obtenerPuntosQuery,
  obtenerRutasPuntos,
  obtenerPuntosPorRuta,
  obtenerHorario,
  obtenerHorariosPorPunto,
  obtenerPuntosPorDireccion,
  validarCoordenadasOSRM,
  validarOperatividadRuta,
  crearPunto,
  crearHorariosParaPunto,
  obtenerPuntoPorId,
  actualizarPunto,
  eliminarPunto,
  reordenarPuntosRuta,
  actualizarOrdenPuntosRuta
};
