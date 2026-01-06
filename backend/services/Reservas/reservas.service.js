// services/Reservas/reservas.service.js
const db = require('../../database/db');
const fs = require('fs');
const path = require('path');

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
  const [rows] = await db.query('SELECT * FROM tours');
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

  const disponibles = cupoTotal - ocupados;
  console.log('disponibles', disponibles, "CupoTotal", cupoTotal, "Ocupados", ocupados, "Cantidad solicitada", Cantidad);
  return {
    disponible: disponibles >= Number(Cantidad || 0),
    cupoTotal,
    ocupados,
    cuposDisponibles: disponibles,
    nombreTour
  };
}

/* ===========================
 * CREACIÓN (TRANSACCIÓN)
 * =========================== */
async function crearReservaConPasajerosYPagos(payload, filesMap = {}, userId = null) {
  const conn = await db.getConnection();
  try {
    if (!payload || !payload.cabeceraReserva) {
      throw new Error('Payload inválido: falta cabeceraReserva');
    }

    await conn.beginTransaction();

    const r = payload.cabeceraReserva;
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
        r.Estado || 'Pendiente',
        r.Observaciones || null,
        r.Placa_Bus || null,
        r.Orden_Ruta || null,
      ]
    );

    if (Array.isArray(payload.pasajeros)) {
      for (const p of payload.pasajeros) {
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

    if (Array.isArray(payload.pagos)) {
      let abonoIdx = 0;
      for (const pago of payload.pagos) {
        const tipo = (pago.Tipo === 'Pago Directo' || pago.Tipo === 'Pago Completo' || pago.Tipo === 'Abono')
          ? pago.Tipo
          : 'Abono';

        let rutaComprobante = 'N/A';

        if (tipo !== 'Pago Directo') {
          const field = pago.fileField;
          const f = field ? filesMap[field] : undefined;
          if (f && f.buffer) {
            const ext = path.extname(f.originalname) || '.bin';
            const fileName = (tipo === 'Pago Completo')
              ? `comprobante_${idReserva}${ext}`
              : `abono_${abonoIdx}_${idReserva}${ext}`;
            const dest = path.join(baseDir, fileName);
            fs.writeFileSync(dest, f.buffer);
            rutaComprobante = path.join('uploads', 'reservas', String(idReserva), fileName).replace(/\\/g, '/');
            if (tipo === 'Abono') abonoIdx++;
          } else if (pago.Ruta_Comprobante) {
            rutaComprobante = pago.Ruta_Comprobante;
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

    await conn.commit();
    try {
      const { recordHistorial } = require('../Historial/logger');
      await recordHistorial({ conexion: conn, tabla: 'reservas', id_registro: idReserva, accion: 'CREAR', id_usuario: userId, detalles: [ { columna: 'Id_Tour', anterior: null, nuevo: r.Id_Tour }, { columna: 'Fecha_Tour', anterior: null, nuevo: r.Fecha_Tour } ] });
    } catch (errRec) {
      console.error('Failed to write historial for crearReserva:', errRec);
    }
    conn.release();
    return { success: true, Id_Reserva: idReserva };
  } catch (e) {
    await conn.rollback();
    await conn.rollback();
    try { const { logSistema } = require('../Historial/logger'); await logSistema({ mensaje: `crearReserva error: ${e.message || e}`, meta: { payloadSummary: { Id_Tour: payload?.cabeceraReserva?.Id_Tour } } }); } catch (_) {}
    conn.release();
    throw e;
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
async function actualizarReservaConPasajerosYPagos(Id_Reserva, payload, filesMap = {}, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Update cabecera (SIN Id_Moneda)
    if (payload?.cabeceraReserva) {
      const r = payload.cabeceraReserva;
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
      if (r.Estado !== undefined) setIf('Estado', r.Estado);
      if (r.Observaciones !== undefined) setIf('Observaciones', r.Observaciones);
      if (r.Id_Tour !== undefined) setIf('Id_Tour', r.Id_Tour);
      // ❌ No existe r.Id_Moneda en reservas → NO actualizar

      if (fields.length) {
        const sql = `UPDATE reservas SET ${fields.join(', ')} WHERE Id_Reserva = ?`;
        await conn.query(sql, [...vals, Id_Reserva]);
      }
    }

    // 2) Reemplazo total de pasajeros
    if (Array.isArray(payload?.pasajeros)) {
      await conn.query('DELETE FROM pasajeros WHERE Id_Reserva = ?', [Id_Reserva]);

      for (const p of payload.pasajeros) {
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

    if (Array.isArray(payload?.pagos)) {
      let abonoIdx = 0;
      // Solo eliminamos pagos previos si el array contiene exactamente un pago de tipo 'Pago Directo' o 'Pago Completo'
      const pagosDirectoCompleto = payload.pagos.filter(p => p.Tipo === 'Pago Directo' || p.Tipo === 'Pago Completo');
      if (pagosDirectoCompleto.length === 1 && payload.pagos.length === 1) {
        await conn.query('DELETE FROM pagos_reservas WHERE Id_Reserva = ?', [Id_Reserva]);
      }
      for (const pago of payload.pagos) {
        const tipo = (pago.Tipo === 'Pago Directo' || pago.Tipo === 'Pago Completo' || pago.Tipo === 'Abono') ? pago.Tipo : 'Abono';
        let rutaComprobante = 'N/A';
        if (tipo !== 'Pago Directo') {
          const field = pago.fileField;
          const f = field ? filesMap[field] : undefined;
          if (f && f.buffer) {
            const ext = path.extname(f.originalname) || '.bin';
            const fileName = (tipo === 'Pago Completo')
              ? `comprobante_${Id_Reserva}${ext}`
              : `abono_${abonoIdx}_${Id_Reserva}${ext}`;
            const dest = path.join(baseDir, fileName);
            fs.writeFileSync(dest, f.buffer);
            rutaComprobante = path.join('uploads', 'reservas', String(Id_Reserva), fileName).replace(/\\/g, '/');
            if (tipo === 'Abono') abonoIdx++;
          } else if (pago.Ruta_Comprobante) {
            rutaComprobante = pago.Ruta_Comprobante;
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

    await conn.commit();
    conn.release();
  } catch (e) {
    await conn.rollback();
    conn.release();
    throw e;
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
async function verificarDniDuplicado(dni, fecha) {
  if (!dni || !fecha) return { exists: false };
  
  const [rows] = await db.query(
    `SELECT 
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
    WHERE p.DNI = ? AND r.Fecha_Tour = ?
    LIMIT 1`,
    [dni, fecha]
  );
  
  if (rows.length > 0) {
    return {
      exists: true,
      reserva: rows[0]
    };
  }
  
  return { exists: false };
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
  // verificación
  verificarDniDuplicado,
};
