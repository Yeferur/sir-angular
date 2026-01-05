// backend/services/Tours/tours.service.js
const db = require('../../database/db');
const { recordHistorial, logSistema } = require('../Historial/logger');

const DIAS_VALIDOS = new Set([
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
]);

function normalizeDia(d) {
  if (d == null) return null;
  const s = String(d).trim().toLowerCase();
  // por si llega con tilde desde algún lado
  if (s === 'miércoles') return 'miercoles';
  if (s === 'sábado') return 'sabado';
  return s;
}

function pickDiasSeleccionados(diasObj) {
  if (!diasObj || typeof diasObj !== 'object') return [];
  const out = [];
  for (const [k, v] of Object.entries(diasObj)) {
    const dia = normalizeDia(k);
    if (v === true && DIAS_VALIDOS.has(dia)) out.push(dia);
  }
  // orden fijo para consistencia
  const order = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
  out.sort((a,b) => order.indexOf(a) - order.indexOf(b));
  return out;
}

function assertFechaISO(value, fieldName) {
  if (!value) throw new Error(`${fieldName} es obligatoria`);
  // formato yyyy-mm-dd
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${fieldName} inválida (usa YYYY-MM-DD)`);
  return value;
}

function assertRangoFechas(inicio, fin) {
  // Comparación por string funciona para YYYY-MM-DD
  if (fin < inicio) throw new Error('La fecha fin no puede ser menor que la fecha inicio');
}

async function guardarDisponibilidadYTemporadas(conn, Id_Tour, data) {
  // Soportamos tanto la forma antigua (campos en root) como la nueva: data.Disponibilidad
  const dispo = data?.Disponibilidad || data || {};
  const modoRaw = (dispo?.Modo_Disponibilidad || dispo?.Modo || 'TODO_EL_ANO').toString().trim().toUpperCase();
  // Normalizamos para comparar (aceptar Ñ o N)
  const modoNorm = modoRaw.replace(/Ñ/g, 'N');
  const temporadas = Array.isArray(dispo?.Temporadas) ? dispo.Temporadas : Array.isArray(dispo?.temporadas) ? dispo.temporadas : [];

  // Dias base puede llegar como objeto {lunes:true,...} (forma antigua) o como array ['lunes', ...] (frontend nuevo)
  let diasBaseSel = [];
  if (Array.isArray(dispo?.Dias_Base)) {
    diasBaseSel = dispo.Dias_Base.map((d) => normalizeDia(d)).filter((d) => DIAS_VALIDOS.has(d));
  } else if (dispo?.diasBase && typeof dispo.diasBase === 'object') {
    diasBaseSel = pickDiasSeleccionados(dispo.diasBase);
  } else {
    diasBaseSel = [];
  }

  if (!['TODO_EL_ANO', 'SOLO_TEMPORADAS'].includes(modoNorm)) {
    throw new Error('Modo_Disponibilidad inválido');
  }

  // Reglas
  if (modoNorm === 'SOLO_TEMPORADAS' && temporadas.length === 0) {
    throw new Error('Debes agregar al menos una temporada en el modo SOLO_TEMPORADAS');
  }
  const hasDiasBaseProvided = data && Object.prototype.hasOwnProperty.call(data, 'diasBase');
  if (modoNorm === 'TODO_EL_ANO' && hasDiasBaseProvided && diasBaseSel.length === 0) {
    throw new Error('Debes seleccionar al menos un día base en TODO_EL_ANO');
  }

  // 1) Días base: solo si TODO_EL_ANO
  if (modoNorm === 'TODO_EL_ANO') {
    // si tu app crea tour y luego lo edita, esto evita duplicados
    await conn.query('DELETE FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);

    for (const dia of diasBaseSel) {
      await conn.query(
        'INSERT INTO tours_dias (Id_Tour, Dia_Semana) VALUES (?, ?)',
        [Id_Tour, dia]
      );
    }
  } else {
    // si cambian modos en un update futuro, esto limpia
    await conn.query('DELETE FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);
  }

  // 2) Temporadas (siempre permitidas)
  // Nota: en crearTour no hay nada previo, pero igual queda “idempotente” para reutilizar en update
  const [tempsExist] = await conn.query('SELECT Id_Temporada FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
  if (tempsExist.length) {
    const ids = tempsExist.map(x => x.Id_Temporada);
    await conn.query(`DELETE FROM tours_temporada_dias WHERE Id_Temporada IN (${ids.map(() => '?').join(',')})`, ids);
    await conn.query('DELETE FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
  }

  for (const t of temporadas) {
    const nombre = (t?.Nombre_Temporada || '').toString().trim();
    if (!nombre) throw new Error('Nombre_Temporada es obligatorio en temporadas');

    const inicio = assertFechaISO(t?.Fecha_Inicio, 'Fecha_Inicio');
    const fin = assertFechaISO(t?.Fecha_Fin, 'Fecha_Fin');
    assertRangoFechas(inicio, fin);

    // Acepta tanto `Dias` como arreglo (nueva forma) como `dias` objeto (antigua forma)
    let diasTempSel = [];
    if (Array.isArray(t?.Dias)) {
      diasTempSel = t.Dias.map((d) => normalizeDia(d)).filter((d) => DIAS_VALIDOS.has(d));
    } else {
      diasTempSel = pickDiasSeleccionados(t?.dias);
    }
    if (diasTempSel.length === 0) throw new Error(`Selecciona al menos un día para la temporada: ${nombre}`);

    const [ins] = await conn.query(
      `INSERT INTO tours_temporadas (Id_Tour, Nombre_Temporada, Fecha_Inicio, Fecha_Fin)
       VALUES (?, ?, ?, ?)`,
      [Id_Tour, nombre, inicio, fin]
    );
    const Id_Temporada = ins.insertId;

    for (const dia of diasTempSel) {
      await conn.query(
        'INSERT INTO tours_temporada_dias (Id_Temporada, Dia_Semana) VALUES (?, ?)',
        [Id_Temporada, dia]
      );
    }
  }

  // Devolvemos en formato más legible (con Ñ) y con keys consistentes
  const modoDisplay = modoNorm === 'TODO_EL_ANO' ? 'TODO_EL_AÑO' : 'SOLO_TEMPORADAS';
  return { Modo: modoDisplay, Dias_Base: diasBaseSel, Temporadas: temporadas.length };
}

async function crearTour(data, userId = null) {
  const {
    Nombre_Tour,
    Abreviacion,
    Comision_Hotel = 0,
    Comision_Agencia = 0,
    Comision_Freelance = 0,
    Cupo_Base = 0,
    Latitud = null,
    Longitud = null,
    Id_Tour_Origen = null
  } = data || {};

  if (!Nombre_Tour) throw new Error('El nombre del tour es obligatorio');

  const tourOrigenId = Id_Tour_Origen && Number(Id_Tour_Origen) > 0 ? Number(Id_Tour_Origen) : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Crear el tour
    const [result] = await conn.query(
      `INSERT INTO tours
        (Nombre_Tour, Abreviacion, Comision_Hotel, Comision_Agencia, Comision_Freelance, Cupo_Base, Latitud, Longitud)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Nombre_Tour,
        Abreviacion || null,
        Number(Comision_Hotel) || 0,
        Number(Comision_Agencia) || 0,
        Number(Comision_Freelance) || 0,
        Number(Cupo_Base) || 0,
        Latitud,
        Longitud
      ]
    );

    const nuevoIdTour = result.insertId;

    // 2) Horarios
    const [puntos] = await conn.query('SELECT Id_Punto FROM puntos ORDER BY Id_Punto');

    if (puntos && puntos.length > 0) {
      if (tourOrigenId) {
        for (const punto of puntos) {
          const [horarioOrigen] = await conn.query(
            'SELECT Hora_Salida FROM horarios WHERE Id_Tour = ? AND Id_Punto = ? LIMIT 1',
            [tourOrigenId, punto.Id_Punto]
          );

          const horaSalida = horarioOrigen.length > 0 ? horarioOrigen[0].Hora_Salida : 'Pendiente';

          await conn.query(
            'INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida) VALUES (?, ?, ?)',
            [punto.Id_Punto, nuevoIdTour, horaSalida]
          );
        }
      } else {
        for (const punto of puntos) {
          await conn.query(
            'INSERT INTO horarios (Id_Punto, Id_Tour, Hora_Salida) VALUES (?, ?, ?)',
            [punto.Id_Punto, nuevoIdTour, 'Pendiente']
          );
        }
      }
    }

    
    // 3) Planes y precios (frontend envía Planes[] con Monedas[].Precios)
    const planes = Array.isArray(data?.Planes) ? data.Planes : [];
    for (let pi = 0; pi < planes.length; pi++) {
      const p = planes[pi] || {};
      // Crear registro en planes_tours para TODOS los planes (incluido el básico)
      const [insPlan] = await conn.query('INSERT INTO planes_tours (Id_Tour, Nombre_Plan) VALUES (?, ?)', [nuevoIdTour, p.Nombre_Plan || null]);
      const Id_Plan = insPlan.insertId;

      const monedas = Array.isArray(p.Monedas) ? p.Monedas : [];
      for (const m of monedas) {
        const Id_Moneda = m?.Id_Moneda ? Number(m.Id_Moneda) : null;
        const precios = m?.Precios || {};
        const tipos = ['ADULTO', 'NINO', 'INFANTE'];
        for (const tipo of tipos) {
          const precio = Number(precios[tipo] || 0);
          await conn.query(
            `INSERT INTO tour_precios (Id_Tour, Id_Plan, Id_Moneda, Tipo_Pasajero, Precio)
             VALUES (?, ?, ?, ?, ?)`,
            [nuevoIdTour, Id_Plan, Id_Moneda, tipo, precio]
          );
        }
      }
    }

    // 4) Disponibilidad + Temporadas
    const disponibilidad = await guardarDisponibilidadYTemporadas(conn, nuevoIdTour, data);

    await conn.commit();
    // record historial (inside same transaction)
    try {
      await recordHistorial({ conexion: conn, tabla: 'tours', id_registro: nuevoIdTour, accion: 'CREAR', id_usuario: userId, detalles: [
        { columna: 'Nombre_Tour', anterior: null, nuevo: Nombre_Tour },
        { columna: 'Abreviacion', anterior: null, nuevo: Abreviacion }
      ] });
    } catch (errRec) {
      console.error('Failed to write historial for crearTour:', errRec);
    }

    return { success: true, Id_Tour: nuevoIdTour, disponibilidad };
  } catch (e) {
    await conn.rollback();
    // log error
    try { await logSistema({ mensaje: `crearTour error: ${e.message || e}`, meta: { data: { Nombre_Tour } } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

// ======= TODO LO DEMÁS QUEDA IGUAL (tus funciones existentes) =======

async function obtenerPreciosTour(Id_Tour, Id_Plan, Id_Moneda) {
  const sql = `
    SELECT Id_PrecioTour, Id_Tour, Id_Plan, Id_Moneda, Tipo_Pasajero, Precio
    FROM tour_precios
    WHERE Id_Tour = ?
      AND (Id_Plan = ? OR (? IS NULL AND Id_Plan IS NULL))
      AND (Id_Moneda = ? OR (? IS NULL AND Id_Moneda IS NULL))
    ORDER BY Tipo_Pasajero
  `;
  const [rows] = await db.query(sql, [
    Id_Tour,
    Id_Plan ?? null, Id_Plan ?? null,
    Id_Moneda ?? null, Id_Moneda ?? null
  ]);
  return rows;
}

async function upsertPreciosTour(Id_Tour, Id_Plan, Id_Moneda, preciosMap, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const tipos = Object.keys(preciosMap || {});
    for (const tipo of tipos) {
      const precio = preciosMap[tipo];
      if (precio == null) continue;

      const [exists] = await conn.query(
        `SELECT Id_PrecioTour FROM tour_precios
         WHERE Id_Tour = ?
           AND (Id_Plan = ? OR (? IS NULL AND Id_Plan IS NULL))
           AND (Id_Moneda = ? OR (? IS NULL AND Id_Moneda IS NULL))
           AND Tipo_Pasajero = ?
         LIMIT 1`,
        [Id_Tour, Id_Plan ?? null, Id_Plan ?? null, Id_Moneda ?? null, Id_Moneda ?? null, tipo]
      );

      if (exists.length) {
        await conn.query(
          `UPDATE tour_precios SET Precio = ? WHERE Id_PrecioTour = ?`,
          [precio, exists[0].Id_PrecioTour]
        );
      } else {
        await conn.query(
          `INSERT INTO tour_precios (Id_Tour, Id_Plan, Id_Moneda, Tipo_Pasajero, Precio)
           VALUES (?, ?, ?, ?, ?)`,
          [Id_Tour, Id_Plan ?? null, Id_Moneda ?? null, tipo, precio]
        );
      }
    }

    await conn.commit();
    try {
      await recordHistorial({ tabla: 'tour_precios', id_registro: Id_Tour, accion: 'UPSERT_PRECIOS', id_usuario: userId, detalles: [{ columna: 'Id_Plan', anterior: null, nuevo: Id_Plan }, { columna: 'Id_Moneda', anterior: null, nuevo: Id_Moneda }, { columna: 'precios', anterior: null, nuevo: JSON.stringify(preciosMap) }] });
    } catch (errRec) { console.error('Failed to write historial for upsertPreciosTour:', errRec); }
    return { success: true };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `upsertPreciosTour error: ${e.message || e}`, meta: { Id_Tour, Id_Plan, Id_Moneda, preciosMap } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function crearPlanTour(Id_Tour, Nombre_Plan) {
  if (!Nombre_Plan) throw new Error('Nombre_Plan es requerido para crear un plan');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      'INSERT INTO planes_tours (Id_Tour, Nombre_Plan) VALUES (?, ?)',
      [Id_Tour, Nombre_Plan]
    );
    await conn.commit();
    return res.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function obtenerTours() {
  const [rows] = await db.query('SELECT Id_Tour, Nombre_Tour, Abreviacion FROM tours ORDER BY Nombre_Tour');
  return rows;
}

async function obtenerTourPorId(Id_Tour) {
  const [rows] = await db.query('SELECT * FROM tours WHERE Id_Tour = ? LIMIT 1', [Id_Tour]);
  if (!rows.length) return null;
  const tour = rows[0];

  const Disponibilidad = await obtenerDisponibilidadTour(Id_Tour);

  const [monRows] = await db.query(
    'SELECT Id_Moneda, Codigo, Nombre_Moneda FROM monedas ORDER BY Id_Moneda'
  );
  const monedasCatalogo = (monRows || []).map((m) => ({
    Id_Moneda: Number(m.Id_Moneda),
    Codigo: String(m.Codigo || ''),
    Nombre_Moneda: String(m.Nombre_Moneda || ''),
  }));

  const [planesRows] = await db.query(
    'SELECT Id_Plan, Nombre_Plan FROM planes_tours WHERE Id_Tour = ? ORDER BY Id_Plan ASC',
    [Id_Tour]
  );

  const [preciosRows] = await db.query(
    `
    SELECT tp.Id_Plan, tp.Id_Moneda, m.Codigo, m.Nombre_Moneda, tp.Tipo_Pasajero, tp.Precio
    FROM tour_precios tp
    LEFT JOIN monedas m ON m.Id_Moneda = tp.Id_Moneda
    WHERE tp.Id_Tour = ?
      AND tp.Id_Moneda IS NOT NULL
    ORDER BY tp.Id_Plan ASC, tp.Id_Moneda ASC, tp.Tipo_Pasajero ASC
    `,
    [Id_Tour]
  );

  // Detectar mismatch (MUY útil para tu caso)
  const planesIds = new Set((planesRows || []).map(p => Number(p.Id_Plan)));
  const preciosPlanesIds = new Set((preciosRows || []).map(r => (r.Id_Plan == null ? null : Number(r.Id_Plan))));
  for (const pid of preciosPlanesIds) {
    if (pid != null && !planesIds.has(pid)) {
      console.warn('[TOUR PLAN MISMATCH]', { Id_Tour, precio_Id_Plan: pid, planesIds: [...planesIds] });
    }
  }

  const preciosIdx = new Map(); // planKey -> Map(monId -> {ADULTO,NINO,INFANTE})
  const monedaMeta = new Map();

  for (const r of (preciosRows || [])) {
    const planKey = (r.Id_Plan == null) ? 'NULL' : `P:${Number(r.Id_Plan)}`;
    const monId = Number(r.Id_Moneda);

    if (!preciosIdx.has(planKey)) preciosIdx.set(planKey, new Map());
    const byMon = preciosIdx.get(planKey);

    if (!byMon.has(monId)) byMon.set(monId, { ADULTO: 0, NINO: 0, INFANTE: 0 });

    if (!monedaMeta.has(monId)) {
      monedaMeta.set(monId, { Codigo: String(r.Codigo || ''), Nombre_Moneda: String(r.Nombre_Moneda || '') });
    }

    const tipo = String(r.Tipo_Pasajero || '').toUpperCase();
    if (tipo === 'ADULTO' || tipo === 'NINO' || tipo === 'INFANTE') {
      byMon.get(monId)[tipo] = Number(r.Precio || 0);
    }
  }

  function buildMonedasForPlanKey(planKey) {
    const byMon = preciosIdx.get(planKey) || new Map();
    return monedasCatalogo.map((mc) => {
      const monId = Number(mc.Id_Moneda);
      const metaJoin = monedaMeta.get(monId) || {};
      const Precios = byMon.get(monId) || { ADULTO: 0, NINO: 0, INFANTE: 0 };

      return {
        Id_Moneda: monId,
        Codigo: mc.Codigo || metaJoin.Codigo || '',
        Nombre_Moneda: mc.Nombre_Moneda || metaJoin.Nombre_Moneda || '',
        Precios: {
          ADULTO: Number(Precios.ADULTO || 0),
          NINO: Number(Precios.NINO || 0),
          INFANTE: Number(Precios.INFANTE || 0),
        },
      };
    });
  }

  let Planes = [];

  if (Array.isArray(planesRows) && planesRows.length) {
    Planes = planesRows.map((p, idx) => {
      const planId = Number(p.Id_Plan);
      const planKey = `P:${planId}`;
      const Monedas = buildMonedasForPlanKey(planKey);

      const AllowNino = Monedas.some(m => Number(m.Precios?.NINO || 0) > 0);
      const AllowInfante = Monedas.some(m => Number(m.Precios?.INFANTE || 0) > 0);

      return {
        Id_Plan: planId,
        Nombre_Plan: p.Nombre_Plan || (idx === 0 ? 'Plan básico' : 'Plan'),
        AllowNino,
        AllowInfante,
        Monedas,
      };
    });
  } else {
    const Monedas = buildMonedasForPlanKey('NULL');
    const AllowNino = Monedas.some(m => Number(m.Precios?.NINO || 0) > 0);
    const AllowInfante = Monedas.some(m => Number(m.Precios?.INFANTE || 0) > 0);

    Planes = [{
      Id_Plan: null,
      Nombre_Plan: 'Plan básico',
      AllowNino,
      AllowInfante,
      Monedas,
    }];
  }
console.log('Obtained tour planes:', Planes);
  return {
    ...tour,
    Disponibilidad: Disponibilidad || { Modo: 'TODO_EL_AÑO', Dias_Base: [], Temporadas: [] },
    Planes,
  };
}


async function actualizarTour(Id_Tour, data, userId = null) {
  const {
    Nombre_Tour,
    Abreviacion,
    Comision_Hotel = 0,
    Comision_Agencia = 0,
    Comision_Freelance = 0,
    Cupo_Base = 0,
    Latitud = null,
    Longitud = null
  } = data || {};

  if (!Nombre_Tour) throw new Error('El nombre del tour es obligatorio');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // fetch previous tour snapshot
    const [prevRows] = await conn.query('SELECT Nombre_Tour, Abreviacion, Comision_Hotel, Comision_Agencia, Comision_Freelance, Cupo_Base FROM tours WHERE Id_Tour = ? LIMIT 1', [Id_Tour]);
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    const [result] = await conn.query(
      `UPDATE tours
       SET Nombre_Tour = ?,
           Abreviacion = ?,
           Comision_Hotel = ?,
           Comision_Agencia = ?,
           Comision_Freelance = ?,
           Cupo_Base = ?,
           Latitud = ?,
           Longitud = ?
       WHERE Id_Tour = ?`,
      [
        Nombre_Tour,
        Abreviacion || null,
        Number(Comision_Hotel) || 0,
        Number(Comision_Agencia) || 0,
        Number(Comision_Freelance) || 0,
        Number(Cupo_Base) || 0,
        Latitud,
        Longitud,
        Id_Tour
      ]
    );

    // Opcional: actualizar disponibilidad/temporadas
    if (data?.Modo_Disponibilidad || data?.diasBase || data?.temporadas || data?.Disponibilidad) {
      await guardarDisponibilidadYTemporadas(conn, Id_Tour, data);
    }

    // Si vienen `Planes` en el payload, recreamos planes y precios para reflejar el nuevo estado
    if (Array.isArray(data?.Planes)) {
      // borramos precios existentes del tour
      await conn.query('DELETE FROM tour_precios WHERE Id_Tour = ?', [Id_Tour]);
      // borramos planes existentes (las FK en tour_precios ya fueron limpiadas)
      await conn.query('DELETE FROM planes_tours WHERE Id_Tour = ?', [Id_Tour]);

      const planes = data.Planes;
      for (const p of planes) {
        const [insPlan] = await conn.query('INSERT INTO planes_tours (Id_Tour, Nombre_Plan) VALUES (?, ?)', [Id_Tour, p.Nombre_Plan || null]);
        const Id_Plan = insPlan.insertId;

        const monedas = Array.isArray(p.Monedas) ? p.Monedas : [];
        for (const m of monedas) {
          const Id_Moneda = m?.Id_Moneda ? Number(m.Id_Moneda) : null;
          const precios = m?.Precios || {};
          const tipos = ['ADULTO', 'NINO', 'INFANTE'];
          for (const tipo of tipos) {
            const precio = Number(precios[tipo] || 0);
            await conn.query(
              `INSERT INTO tour_precios (Id_Tour, Id_Plan, Id_Moneda, Tipo_Pasajero, Precio)
               VALUES (?, ?, ?, ?, ?)`,
              [Id_Tour, Id_Plan, Id_Moneda, tipo, precio]
            );
          }
        }
      }
    }

    await conn.commit();
    try {
      const detalles = [
        { columna: 'Nombre_Tour', anterior: prev ? prev.Nombre_Tour : null, nuevo: Nombre_Tour },
        { columna: 'Abreviacion', anterior: prev ? prev.Abreviacion : null, nuevo: Abreviacion }
      ];
      await recordHistorial({ conexion: conn, tabla: 'tours', id_registro: Id_Tour, accion: 'ACTUALIZAR', id_usuario: userId, detalles });
    } catch (errRec) { console.error('Failed to write historial for actualizarTour:', errRec); }
    return { success: true, affectedRows: result.affectedRows };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `actualizarTour error: ${e.message || e}`, meta: { Id_Tour, data } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function eliminarTour(Id_Tour, userId = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // fetch previous tour snapshot
    const [prevRows] = await conn.query('SELECT Nombre_Tour, Abreviacion FROM tours WHERE Id_Tour = ? LIMIT 1', [Id_Tour]);
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    const [reservas] = await conn.query(
      `SELECT COUNT(*) as total FROM reservas r
       JOIN horarios h ON h.Id_Horario = r.Id_Horario
       WHERE h.Id_Tour = ?`,
      [Id_Tour]
    );

    if (reservas[0].total > 0) {
      await conn.rollback();
      throw new Error('No se puede eliminar el tour porque tiene reservas asociadas.');
    }

    // Limpieza disponibilidad
    const [temps] = await conn.query('SELECT Id_Temporada FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
    if (temps.length) {
      const ids = temps.map(x => x.Id_Temporada);
      await conn.query(`DELETE FROM tours_temporada_dias WHERE Id_Temporada IN (${ids.map(() => '?').join(',')})`, ids);
    }
    await conn.query('DELETE FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
    await conn.query('DELETE FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);

    // Lo tuyo
    await conn.query('DELETE FROM horarios WHERE Id_Tour = ?', [Id_Tour]);
    await conn.query('DELETE FROM tour_precios WHERE Id_Tour = ?', [Id_Tour]);
    await conn.query('DELETE FROM planes_tours WHERE Id_Tour = ?', [Id_Tour]);
    await conn.query('DELETE FROM aforos WHERE Id_Tour = ?', [Id_Tour]);

    const [result] = await conn.query('DELETE FROM tours WHERE Id_Tour = ?', [Id_Tour]);

    await conn.commit();
    try { await recordHistorial({ conexion: conn, tabla: 'tours', id_registro: Id_Tour, accion: 'ELIMINAR', id_usuario: userId, detalles: [ { columna: 'Nombre_Tour', anterior: prev ? prev.Nombre_Tour : null, nuevo: null } ] }); } catch (errRec) { console.error('Failed to write historial for eliminarTour:', errRec); }
    return { success: true, affectedRows: result.affectedRows };
  } catch (e) {
    await conn.rollback();
    try { await logSistema({ mensaje: `eliminarTour error: ${e.message || e}`, meta: { Id_Tour } }); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  crearTour,
  obtenerPreciosTour,
  upsertPreciosTour,
  crearPlanTour,
  obtenerTours,
  obtenerTourPorId,
  actualizarTour,
  eliminarTour
};

async function obtenerDisponibilidadTour(Id_Tour) {
  const [rowsTour] = await db.query('SELECT Id_Tour FROM tours WHERE  Id_Tour= ? LIMIT 1', [Id_Tour]);
  if (!rowsTour.length) return null;

  // Modo
  const [diasRows] = await db.query('SELECT Dia_Semana FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);
  const diasBase = diasRows.map(r => r.Dia_Semana).filter(Boolean);

  // Temporadas y sus días
  const [temps] = await db.query('SELECT Id_Temporada, Nombre_Temporada, Fecha_Inicio, Fecha_Fin FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
  const temporadas = [];
  for (const t of temps) {
    const [td] = await db.query('SELECT Dia_Semana FROM tours_temporada_dias WHERE Id_Temporada = ?', [t.Id_Temporada]);
    temporadas.push({
      Id_Temporada: t.Id_Temporada,
      Nombre_Temporada: t.Nombre_Temporada,
      Fecha_Inicio: (function(d){ if (!d) return null; if (d instanceof Date) return d.toISOString().slice(0,10); const s=String(d); const m=s.match(/^\d{4}-\d{2}-\d{2}/); return m?m[0]:s; })(t.Fecha_Inicio),
      Fecha_Fin: (function(d){ if (!d) return null; if (d instanceof Date) return d.toISOString().slice(0,10); const s=String(d); const m=s.match(/^\d{4}-\d{2}-\d{2}/); return m?m[0]:s; })(t.Fecha_Fin),
      Dias: td.map(x => x.Dia_Semana).filter(Boolean),
    });
  }
  const modoNorm = (diasBase && diasBase.length > 0) ? 'TODO_EL_AÑO' : (temporadas.length ? 'SOLO_TEMPORADAS' : 'TODO_EL_AÑO');
  const result = { Modo: modoNorm, Dias_Base: diasBase, Temporadas: temporadas };
  console.log('Disponibilidad tour', Id_Tour, result);
  return result;
}

module.exports.obtenerDisponibilidadTour = obtenerDisponibilidadTour;
