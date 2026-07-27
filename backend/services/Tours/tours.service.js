// backend/services/Tours/tours.service.js
const db = require('../../database/db');
const { recordHistorial, logSistema } = require('../Historial/logger');

const DIAS_VALIDOS = new Set([
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
]);

function normalizeDia(d) {
  if (d == null) return null;
  const s = String(d)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

function normalizarComisionesEntrada(comisiones) {
  if (!Array.isArray(comisiones)) return [];

  const normalizadas = [];
  const seen = new Set();

  for (const item of comisiones) {
    const Id_Canal = Number(item?.Id_Canal);
    if (!Id_Canal || Number.isNaN(Id_Canal) || seen.has(Id_Canal)) continue;
    seen.add(Id_Canal);
    normalizadas.push({
      Id_Canal,
      Valor: Number(item?.Valor) || 0
    });
  }

  return normalizadas;
}

function normalizarFechaPlan(value, fieldName) {
  if (value == null || value === '') return null;
  return assertFechaISO(value, fieldName);
}

function normalizarVigenciaPlan(plan) {
  const Fecha_Inicio = normalizarFechaPlan(plan?.Fecha_Inicio, 'Fecha_Inicio');
  const Fecha_Fin = normalizarFechaPlan(plan?.Fecha_Fin, 'Fecha_Fin');

  if ((Fecha_Inicio && !Fecha_Fin) || (!Fecha_Inicio && Fecha_Fin)) {
    throw new Error('Los planes con vigencia deben tener fecha de inicio y fecha fin');
  }
  if (Fecha_Inicio && Fecha_Fin) assertRangoFechas(Fecha_Inicio, Fecha_Fin);

  return { Fecha_Inicio, Fecha_Fin };
}

async function guardarPreciosPlan(conn, Id_Tour, Id_Plan, monedas) {
  await conn.query(
    'DELETE FROM tour_precios WHERE Id_Tour = ? AND Id_Plan = ?',
    [Id_Tour, Id_Plan]
  );

  for (const moneda of Array.isArray(monedas) ? monedas : []) {
    const Id_Moneda = Number(moneda?.Id_Moneda) || null;
    if (!Id_Moneda) throw new Error('Cada tarifa debe tener una moneda válida');

    const precios = moneda?.Precios || {};
    for (const tipo of ['ADULTO', 'NINO', 'INFANTE']) {
      const precio = Number(precios[tipo] || 0);
      if (!Number.isFinite(precio) || precio < 0) {
        throw new Error(`El precio de ${tipo.toLowerCase()} no puede ser negativo`);
      }
      await conn.query(
        `INSERT INTO tour_precios (Id_Tour, Id_Plan, Id_Moneda, Tipo_Pasajero, Precio)
         VALUES (?, ?, ?, ?, ?)`,
        [Id_Tour, Id_Plan, Id_Moneda, tipo, precio]
      );
    }
  }
}

async function guardarComisionesTour(conn, Id_Tour, comisiones) {
  const lista = normalizarComisionesEntrada(comisiones);
  if (!lista.length) return;

  for (const item of lista) {
    await conn.query(
      `INSERT INTO tour_comisiones (Id_Tour, Id_Canal, Valor)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE Valor = VALUES(Valor)`,
      [Id_Tour, item.Id_Canal, item.Valor]
    );
  }
}

async function obtenerCanalesComision() {
  const [rows] = await db.query(
    `SELECT Id_Canal, Nombre_Canal
     FROM canales_reservas
     WHERE Tiene_Comision = 1
     ORDER BY Nombre_Canal ASC`
  );

  return rows.map((row) => ({
    Id_Canal: Number(row.Id_Canal),
    Nombre_Canal: row.Nombre_Canal
  }));
}

async function obtenerComisionesToursMap(idsTour) {
  const ids = [...new Set((idsTour || []).map((id) => Number(id)).filter((id) => id > 0))];
  const map = new Map();

  if (!ids.length) return map;

  const [rows] = await db.query(
    `SELECT
       tc.Id_Tour,
       tc.Id_Canal,
       COALESCE(cr.Nombre_Canal, CONCAT('CANAL ', tc.Id_Canal)) AS Nombre_Canal,
       tc.Valor
     FROM tour_comisiones tc
     LEFT JOIN canales_reservas cr ON cr.Id_Canal = tc.Id_Canal
     WHERE tc.Id_Tour IN (${ids.map(() => '?').join(',')})
     ORDER BY tc.Id_Tour ASC, tc.Id_Canal ASC`,
    ids
  );

  for (const row of rows) {
    const idTour = Number(row.Id_Tour);
    if (!map.has(idTour)) map.set(idTour, []);
    map.get(idTour).push({
      Id_Canal: Number(row.Id_Canal),
      Nombre_Canal: row.Nombre_Canal,
      Valor: Number(row.Valor || 0)
    });
  }

  return map;
}

async function guardarDisponibilidadYTemporadas(conn, Id_Tour, data) {
  const dispo = data?.Disponibilidad || data || {};
  const modo = String(dispo?.Modo || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const temporadas = Array.isArray(dispo?.Temporadas)
    ? dispo.Temporadas
    : Array.isArray(dispo?.temporadas)
      ? dispo.temporadas
      : [];

  const tieneDiasBase = Object.prototype.hasOwnProperty.call(dispo, 'Dias_Base')
    || Object.prototype.hasOwnProperty.call(dispo, 'diasBase');
  const tieneTemporadas = Object.prototype.hasOwnProperty.call(dispo, 'Temporadas')
    || Object.prototype.hasOwnProperty.call(dispo, 'temporadas');

  let diasBaseSel = [];
  if (Array.isArray(dispo?.Dias_Base)) {
    diasBaseSel = dispo.Dias_Base
      .map((d) => normalizeDia(d))
      .filter((d) => DIAS_VALIDOS.has(d));
  } else if (dispo?.diasBase && typeof dispo.diasBase === 'object') {
    diasBaseSel = pickDiasSeleccionados(dispo.diasBase);
  }

  if (modo === 'TODO_EL_ANO' && diasBaseSel.length === 0) {
    throw new Error('Selecciona al menos un día habitual de operación');
  }
  if (modo === 'SOLO_TEMPORADAS' && temporadas.length === 0) {
    throw new Error('Agrega al menos una temporada para este modo de disponibilidad');
  }

  if (tieneDiasBase) {
    await conn.query('DELETE FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);
    for (const dia of diasBaseSel) {
      await conn.query(
        'INSERT INTO tours_dias (Id_Tour, Dia_Semana) VALUES (?, ?)',
        [Id_Tour, dia]
      );
    }
  }

  if (tieneTemporadas) {
    const [tempsExist] = await conn.query(
      'SELECT Id_Temporada FROM tours_temporadas WHERE Id_Tour = ?',
      [Id_Tour]
    );

    if (tempsExist.length) {
      const ids = tempsExist.map((x) => x.Id_Temporada);
      await conn.query(
        `DELETE FROM tours_temporada_dias WHERE Id_Temporada IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      await conn.query('DELETE FROM tours_temporadas WHERE Id_Tour = ?', [Id_Tour]);
    }

    for (const t of temporadas) {
      const nombre = (t?.Nombre_Temporada || '').toString().trim();
      if (!nombre) throw new Error('Nombre_Temporada es obligatorio en temporadas');

      const inicio = assertFechaISO(t?.Fecha_Inicio, 'Fecha_Inicio');
      const fin = assertFechaISO(t?.Fecha_Fin, 'Fecha_Fin');
      assertRangoFechas(inicio, fin);

      let diasTempSel = [];
      if (Array.isArray(t?.Dias)) {
        diasTempSel = t.Dias
          .map((d) => normalizeDia(d))
          .filter((d) => DIAS_VALIDOS.has(d));
      } else {
        diasTempSel = pickDiasSeleccionados(t?.dias);
      }
      if (diasTempSel.length === 0) {
        throw new Error(`Selecciona al menos un día para la temporada: ${nombre}`);
      }

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
  }

  const modoDisplay = diasBaseSel.length > 0 ? 'TODO_EL_AÑO' : (temporadas.length > 0 ? 'SOLO_TEMPORADAS' : 'TODO_EL_AÑO');
  return { Modo: modoDisplay, Dias_Base: diasBaseSel, Temporadas: temporadas };
}

async function crearTour(data, userId = null) {
  const {
    Nombre_Tour,
    Abreviacion,
    Comisiones,
    comisiones,
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
        (Nombre_Tour, Abreviacion, Cupo_Base, Latitud, Longitud, Activo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        Nombre_Tour,
        Abreviacion || null,
        Number(Cupo_Base) || 0,
        Latitud,
        Longitud
      ]
    );

    const nuevoIdTour = result.insertId;

    await guardarComisionesTour(conn, nuevoIdTour, Comisiones ?? comisiones);

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
    if (!planes.length) throw new Error('Agrega al menos un plan al tour');
    for (let pi = 0; pi < planes.length; pi++) {
      const p = planes[pi] || {};
      const { Fecha_Inicio, Fecha_Fin } = normalizarVigenciaPlan(p);
      // Crear registro en planes_tours para TODOS los planes (incluido el básico)
      const [insPlan] = await conn.query(
        'INSERT INTO planes_tours (Id_Tour, Nombre_Plan, Fecha_Inicio, Fecha_Fin) VALUES (?, ?, ?, ?)',
        [nuevoIdTour, p.Nombre_Plan || null, Fecha_Inicio, Fecha_Fin]
      );
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

    await recordHistorial({ conexion: conn, tabla: 'tours', id_registro: nuevoIdTour, accion: 'CREAR_TOUR', id_usuario: userId, detalles: [
      { columna: 'Nombre_Tour', anterior: null, nuevo: Nombre_Tour },
      { columna: 'Abreviacion', anterior: null, nuevo: Abreviacion }
    ] });
    await conn.commit();

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

    await recordHistorial({ conexion: conn, tabla: 'tour_precios', id_registro: Id_Tour, accion: 'UPSERT_PRECIOS', id_usuario: userId, detalles: [{ columna: 'Id_Plan', anterior: null, nuevo: Id_Plan }, { columna: 'Id_Moneda', anterior: null, nuevo: Id_Moneda }, { columna: 'precios', anterior: null, nuevo: JSON.stringify(preciosMap) }] });
    await conn.commit();
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
  const [rows] = await db.query(
    `SELECT
       t.Id_Tour,
       t.Nombre_Tour,
       t.Abreviacion,
       t.Cupo_Base,
       t.Latitud,
       t.Longitud,
       (SELECT COUNT(*) FROM planes_tours pt WHERE pt.Id_Tour = t.Id_Tour) AS Cantidad_Planes,
       (SELECT COUNT(*) FROM tours_dias td WHERE td.Id_Tour = t.Id_Tour) AS Cantidad_Dias_Base,
       (SELECT COUNT(*) FROM tours_temporadas tt WHERE tt.Id_Tour = t.Id_Tour) AS Cantidad_Temporadas,
       (
         SELECT DATE_FORMAT(MIN(tt2.Fecha_Inicio), '%Y-%m-%d')
         FROM tours_temporadas tt2
         WHERE tt2.Id_Tour = t.Id_Tour AND tt2.Fecha_Fin >= CURDATE()
       ) AS Proxima_Temporada
     FROM tours t
     WHERE t.Activo = 1
     ORDER BY t.Nombre_Tour ASC`
  );
  const comisionesMap = await obtenerComisionesToursMap(rows.map((row) => row.Id_Tour));
  return rows.map((row) => ({
    ...row,
    Comisiones: comisionesMap.get(Number(row.Id_Tour)) || [],
    comisiones: comisionesMap.get(Number(row.Id_Tour)) || []
  }));
}

async function obtenerTourPorId(Id_Tour) {
  const [rows] = await db.query('SELECT * FROM tours WHERE Id_Tour = ? AND Activo = 1 LIMIT 1', [Id_Tour]);
  if (!rows.length) return null;
  const tour = rows[0];
  const comisionesMap = await obtenerComisionesToursMap([Id_Tour]);

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
    `SELECT
       Id_Plan,
       Nombre_Plan,
       DATE_FORMAT(Fecha_Inicio, '%Y-%m-%d') AS Fecha_Inicio,
       DATE_FORMAT(Fecha_Fin, '%Y-%m-%d') AS Fecha_Fin
     FROM planes_tours
     WHERE Id_Tour = ?
     ORDER BY Id_Plan ASC`,
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
        Fecha_Inicio: p.Fecha_Inicio,
        Fecha_Fin: p.Fecha_Fin,
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
      Fecha_Inicio: null,
      Fecha_Fin: null,
      AllowNino,
      AllowInfante,
      Monedas,
    }];
  }
  return {
    ...tour,
    Comisiones: comisionesMap.get(Number(Id_Tour)) || [],
    comisiones: comisionesMap.get(Number(Id_Tour)) || [],
    Disponibilidad: Disponibilidad || { Modo: 'TODO_EL_AÑO', Dias_Base: [], Temporadas: [] },
    Planes,
  };
}


async function actualizarTour(Id_Tour, data, userId = null) {
  const {
    Nombre_Tour,
    Abreviacion,
    Comisiones,
    comisiones,
    Cupo_Base = 0,
    Latitud = null,
    Longitud = null
  } = data || {};

  if (!Nombre_Tour) throw new Error('El nombre del tour es obligatorio');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // fetch previous tour snapshot
    const [prevRows] = await conn.query(
      'SELECT Nombre_Tour, Abreviacion, Cupo_Base FROM tours WHERE Id_Tour = ? LIMIT 1',
      [Id_Tour]
    );
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    const [result] = await conn.query(
      `UPDATE tours
       SET Nombre_Tour = ?,
           Abreviacion = ?,
           Cupo_Base = ?,
           Latitud = ?,
           Longitud = ?
       WHERE Id_Tour = ?`,
      [
        Nombre_Tour,
        Abreviacion || null,
        Number(Cupo_Base) || 0,
        Latitud,
        Longitud,
        Id_Tour
      ]
    );

    const actualizaComisiones =
      Object.prototype.hasOwnProperty.call(data || {}, 'Comisiones')
      || Object.prototype.hasOwnProperty.call(data || {}, 'comisiones');
    if (actualizaComisiones) {
      await conn.query('DELETE FROM tour_comisiones WHERE Id_Tour = ?', [Id_Tour]);
      await guardarComisionesTour(conn, Id_Tour, Comisiones ?? comisiones);
    }

    // Opcional: actualizar disponibilidad/temporadas
    if (
      Object.prototype.hasOwnProperty.call(data || {}, 'Dias_Base') ||
      Object.prototype.hasOwnProperty.call(data || {}, 'diasBase') ||
      Object.prototype.hasOwnProperty.call(data || {}, 'Temporadas') ||
      Object.prototype.hasOwnProperty.call(data || {}, 'temporadas') ||
      Object.prototype.hasOwnProperty.call(data || {}, 'Disponibilidad')
    ) {
      await guardarDisponibilidadYTemporadas(conn, Id_Tour, data);
    }

    // Actualiza por Id_Plan para conservar referencias históricas.
    if (Array.isArray(data?.Planes)) {
      if (!data.Planes.length) throw new Error('El tour debe conservar al menos un plan');
      const [planesActuales] = await conn.query(
        'SELECT Id_Plan FROM planes_tours WHERE Id_Tour = ?',
        [Id_Tour]
      );
      const idsActuales = new Set(planesActuales.map((plan) => Number(plan.Id_Plan)));
      const idsRecibidos = new Set();
      const planes = data.Planes;

      for (const p of planes) {
        const nombrePlan = String(p?.Nombre_Plan || '').trim();
        if (!nombrePlan) throw new Error('El nombre del plan es obligatorio');
        const { Fecha_Inicio, Fecha_Fin } = normalizarVigenciaPlan(p);
        let Id_Plan = Number(p?.Id_Plan) || null;

        if (Id_Plan && idsActuales.has(Id_Plan)) {
          await conn.query(
            `UPDATE planes_tours
             SET Nombre_Plan = ?, Fecha_Inicio = ?, Fecha_Fin = ?
             WHERE Id_Plan = ? AND Id_Tour = ?`,
            [nombrePlan, Fecha_Inicio, Fecha_Fin, Id_Plan, Id_Tour]
          );
        } else {
          const [insPlan] = await conn.query(
            'INSERT INTO planes_tours (Id_Tour, Nombre_Plan, Fecha_Inicio, Fecha_Fin) VALUES (?, ?, ?, ?)',
            [Id_Tour, nombrePlan, Fecha_Inicio, Fecha_Fin]
          );
          Id_Plan = Number(insPlan.insertId);
        }

        idsRecibidos.add(Id_Plan);
        await guardarPreciosPlan(conn, Id_Tour, Id_Plan, p.Monedas);
      }

      const idsRetirados = [...idsActuales].filter((id) => !idsRecibidos.has(id));
      for (const Id_Plan of idsRetirados) {
        const [[usoHistorico]] = await conn.query(
          'SELECT COUNT(*) AS total FROM pasajeros WHERE Id_Plan = ?',
          [Id_Plan]
        );
        if (Number(usoHistorico?.total || 0) > 0) {
          throw new Error('No puedes eliminar un plan utilizado por pasajeros. Conserva el plan para proteger el histórico.');
        }
        await conn.query(
          'DELETE FROM tour_precios WHERE Id_Tour = ? AND Id_Plan = ?',
          [Id_Tour, Id_Plan]
        );
        await conn.query(
          'DELETE FROM planes_tours WHERE Id_Tour = ? AND Id_Plan = ?',
          [Id_Tour, Id_Plan]
        );
      }
    }

    const detalles = [
      { columna: 'Nombre_Tour', anterior: prev ? prev.Nombre_Tour : null, nuevo: Nombre_Tour },
      { columna: 'Abreviacion', anterior: prev ? prev.Abreviacion : null, nuevo: Abreviacion }
    ];
    await recordHistorial({ conexion: conn, tabla: 'tours', id_registro: Id_Tour, accion: 'ACTUALIZAR_TOUR', id_usuario: userId, detalles });
    await conn.commit();
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
    const [prevRows] = await conn.query('SELECT Nombre_Tour, Abreviacion, Activo FROM tours WHERE Id_Tour = ? LIMIT 1', [Id_Tour]);
    const prev = prevRows && prevRows[0] ? prevRows[0] : null;

    if (!prev) {
      await conn.rollback();
      throw new Error('Tour no encontrado.');
    }

    const [[usoReservas]] = await conn.query(
      `SELECT COUNT(DISTINCT r.Id_Reserva) AS total
       FROM reservas r
       INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
       WHERE h.Id_Tour = ?`,
      [Id_Tour]
    );
    const reservasAsociadas = Number(usoReservas?.total || 0);
    let result;
    let accion;
    if (reservasAsociadas > 0) {
      [result] = await conn.query('UPDATE tours SET Activo = 0 WHERE Id_Tour = ?', [Id_Tour]);
      accion = 'DESACTIVADO';
    } else {
      await conn.query('DELETE FROM programacion_tours WHERE Id_Tour = ?', [Id_Tour]);
      await conn.query('DELETE FROM programaciones WHERE Id_Tour = ?', [Id_Tour]);
      await conn.query('DELETE FROM horarios WHERE Id_Tour = ?', [Id_Tour]);
      await conn.query('DELETE FROM tour_comisiones WHERE Id_Tour = ?', [Id_Tour]);
      [result] = await conn.query('DELETE FROM tours WHERE Id_Tour = ?', [Id_Tour]);
      accion = 'ELIMINADO';
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'tours',
      id_registro: Id_Tour,
      accion: accion === 'DESACTIVADO' ? 'DESACTIVAR_TOUR' : 'ELIMINAR_TOUR',
      id_usuario: userId,
      detalles: [
        { columna: 'Nombre_Tour', anterior: prev ? prev.Nombre_Tour : null, nuevo: prev ? prev.Nombre_Tour : null },
        { columna: 'Abreviacion', anterior: prev ? prev.Abreviacion : null, nuevo: prev ? prev.Abreviacion : null },
        { columna: 'Activo', anterior: prev ? prev.Activo : null, nuevo: accion === 'DESACTIVADO' ? 0 : null }
      ]
    });
    await conn.commit();
    return { success: true, accion, reservasAsociadas, affectedRows: result.affectedRows };
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
  obtenerCanalesComision,
  obtenerTours,
  obtenerTourPorId,
  actualizarTour,
  eliminarTour
};

async function obtenerDisponibilidadTour(Id_Tour) {
  const [rowsTour] = await db.query('SELECT Id_Tour FROM tours WHERE Id_Tour = ? AND Activo = 1 LIMIT 1', [Id_Tour]);
  if (!rowsTour.length) return null;

  const [diasRows] = await db.query('SELECT Dia_Semana FROM tours_dias WHERE Id_Tour = ?', [Id_Tour]);
  const diasBase = Array.from(
    new Set(
      diasRows
        .map((r) => normalizeDia(r.Dia_Semana))
        .filter((dia) => DIAS_VALIDOS.has(dia))
    )
  ).sort((a, b) => ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].indexOf(a) - ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].indexOf(b));

  const [temps] = await db.query(
    `SELECT
      Id_Temporada,
      Nombre_Temporada,
      DATE_FORMAT(Fecha_Inicio, '%Y-%m-%d') AS Fecha_Inicio,
      DATE_FORMAT(Fecha_Fin, '%Y-%m-%d') AS Fecha_Fin
    FROM tours_temporadas
    WHERE Id_Tour = ?
    ORDER BY Fecha_Inicio ASC`,
    [Id_Tour]
  );
  const temporadas = [];
  for (const t of temps) {
    const [td] = await db.query('SELECT Dia_Semana FROM tours_temporada_dias WHERE Id_Temporada = ?', [t.Id_Temporada]);
    temporadas.push({
      Id_Temporada: t.Id_Temporada,
      Nombre_Temporada: t.Nombre_Temporada,
      Fecha_Inicio: t.Fecha_Inicio,
      Fecha_Fin: t.Fecha_Fin,
      Dias: Array.from(
        new Set(
          td
            .map((x) => normalizeDia(x.Dia_Semana))
            .filter((dia) => DIAS_VALIDOS.has(dia))
        )
      ).sort((a, b) => ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].indexOf(a) - ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].indexOf(b)),
    });
  }
  const modoNorm = diasBase.length > 0 ? 'TODO_EL_AÑO' : (temporadas.length > 0 ? 'SOLO_TEMPORADAS' : 'TODO_EL_AÑO');
  const result = { Modo: modoNorm, Dias_Base: diasBase, Temporadas: temporadas };
  return result;
}

module.exports.obtenerDisponibilidadTour = obtenerDisponibilidadTour;
