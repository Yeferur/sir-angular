const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');

const BOGOTA_TIME_ZONE = 'America/Bogota';
const MAX_END_TIME = '23:00';
const SCHEDULE_STEP_MINUTES = 30;
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function validateWeeklySchedule(value) {
  if (!Array.isArray(value) || value.length !== 7) {
    const error = new Error('La jornada debe incluir los siete días de la semana.');
    error.code = 'INVALID_SCHEDULE';
    throw error;
  }

  const seenDays = new Set();
  const normalized = value.map((item) => {
    const diaSemana = Number(item?.diaSemana);
    if (!Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7 || seenDays.has(diaSemana)) {
      const error = new Error('Los días de la jornada no son válidos o están repetidos.');
      error.code = 'INVALID_SCHEDULE_DAY';
      throw error;
    }
    seenDays.add(diaSemana);

    const esLaborable = item?.esLaborable === true || item?.esLaborable === 1;
    if (!esLaborable) {
      return { diaSemana, nombreDia: DAY_NAMES[diaSemana - 1], esLaborable: false, horaInicio: null, horaFin: null };
    }

    const horaInicio = normalizeTime(item?.horaInicio);
    const horaFin = normalizeTime(item?.horaFin);
    if (!horaInicio || !horaFin) {
      const error = new Error(`${DAY_NAMES[diaSemana - 1]} necesita una hora de entrada y una de salida válidas.`);
      error.code = 'INVALID_SCHEDULE_TIME';
      throw error;
    }
    if (Number(horaInicio.slice(3)) % SCHEDULE_STEP_MINUTES !== 0 || Number(horaFin.slice(3)) % SCHEDULE_STEP_MINUTES !== 0) {
      const error = new Error(`${DAY_NAMES[diaSemana - 1]}: los turnos son en punto o y media, no en cualquier minuto.`);
      error.code = 'INVALID_SCHEDULE_STEP';
      throw error;
    }
    if (horaInicio >= horaFin) {
      const error = new Error(`La salida del ${DAY_NAMES[diaSemana - 1].toLowerCase()} debe ser posterior a la entrada.`);
      error.code = 'INVALID_SCHEDULE_RANGE';
      throw error;
    }
    if (horaFin > MAX_END_TIME) {
      const error = new Error('La hora de salida no puede superar las 11:00 p. m.');
      error.code = 'SCHEDULE_AFTER_11PM';
      throw error;
    }

    return { diaSemana, nombreDia: DAY_NAMES[diaSemana - 1], esLaborable: true, horaInicio, horaFin };
  });

  return normalized.sort((a, b) => a.diaSemana - b.diaSemana);
}

function getScheduleWarnings(turnos) {
  const normalized = validateWeeklySchedule(turnos);
  const workDays = normalized.filter((day) => day.esLaborable);
  const warnings = [];

  if (workDays.length === 0) {
    warnings.push({ code: 'NO_WORK_DAYS', message: 'No tiene ninguna jornada asignada.' });
    return warnings;
  }
  if (workDays.length === 7) {
    warnings.push({ code: 'NO_REST_DAY', message: 'No tiene un día de descanso durante la semana.' });
  }

  return warnings;
}

function getBogotaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayByName = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    diaSemana: dayByName[values.weekday],
    hora: `${values.hour}:${values.minute}`,
  };
}

function getBogotaTodayDateOnly(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return dateOnlyFromParts(Number(values.year), Number(values.month), Number(values.day));
}

// Se usa UTC internamente solo como aritmética de fechas civiles (sin hora),
// para no arrastrar desfaces de zona horaria al sumar/restar días.
function dateOnlyFromParts(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  // Las columnas DATE vuelven de mysql2 como objetos Date (medianoche local
  // representada en UTC-ms), no como strings — hay que aceptar ambos casos.
  if (value instanceof Date) {
    return dateOnlyFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return dateOnlyFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function addDays(dateOnly, amount) {
  const result = new Date(dateOnly);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function datesOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

function validateVacation(value) {
  if (value == null) return null;
  const fechaInicio = parseDateOnly(value.fechaInicio);
  const fechaFin = parseDateOnly(value.fechaFin);
  const fechaRegreso = parseDateOnly(value.fechaRegreso);
  const diasHabiles = Number(value.diasHabiles || 15);
  if (!fechaInicio || !fechaFin || !fechaRegreso || fechaInicio > fechaFin || fechaRegreso <= fechaFin) {
    const error = new Error('Las fechas de vacaciones o de regreso no son válidas.');
    error.code = 'INVALID_VACATION';
    throw error;
  }
  if (!Number.isInteger(diasHabiles) || diasHabiles < 1 || diasHabiles > 60) {
    const error = new Error('La cantidad de días hábiles de vacaciones no es válida.');
    error.code = 'INVALID_VACATION';
    throw error;
  }
  return {
    idVacacion: /^\d+$/.test(String(value.idVacacion || '')) ? String(value.idVacacion) : null,
    fechaInicio: formatDateOnly(fechaInicio),
    fechaFin: formatDateOnly(fechaFin),
    fechaRegreso: formatDateOnly(fechaRegreso),
    diasHabiles,
    observaciones: String(value.observaciones || '').trim().slice(0, 500) || null,
  };
}

function mapVacationRow(row) {
  if (!row?.Id_Vacacion) return null;
  return {
    idVacacion: String(row.Id_Vacacion),
    fechaInicio: formatDateOnly(parseDateOnly(row.Vacacion_Inicio)),
    fechaFin: formatDateOnly(parseDateOnly(row.Vacacion_Fin)),
    fechaRegreso: formatDateOnly(parseDateOnly(row.Vacacion_Regreso)),
    diasHabiles: Number(row.Vacacion_Dias_Habiles),
    estado: row.Vacacion_Estado || 'programada',
    observaciones: row.Vacacion_Observaciones || null,
  };
}

function mondayOf(dateOnly) {
  const weekday = dateOnly.getUTCDay(); // 0=domingo ... 6=sábado
  const diff = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(dateOnly);
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday;
}

function getWeekBounds(fechaReferencia) {
  const reference = parseDateOnly(fechaReferencia) || getBogotaTodayDateOnly();
  const monday = mondayOf(reference);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { fechaInicio: formatDateOnly(monday), fechaFin: formatDateOnly(sunday) };
}

function getCurrentScheduleStatus(turnos, now = new Date()) {
  if (!Array.isArray(turnos) || turnos.length !== 7) return 'sin_configurar';
  const clock = getBogotaClock(now);
  const hoy = formatDateOnly(getBogotaTodayDateOnly(now));
  const today = turnos.find((turno) => turno.fecha === hoy) || turnos.find((turno) => Number(turno.diaSemana) === clock.diaSemana);
  if (!today?.esLaborable) return 'fuera_turno';
  return clock.hora >= today.horaInicio && clock.hora < today.horaFin ? 'en_turno' : 'fuera_turno';
}

function mapDiaRow(row) {
  return {
    idTurnoDia: row.Id_Turno_Dia != null ? String(row.Id_Turno_Dia) : null,
    diaSemana: Number(row.Dia_Semana),
    nombreDia: DAY_NAMES[Number(row.Dia_Semana) - 1],
    fecha: row.Fecha instanceof Date ? formatDateOnly(row.Fecha) : String(row.Fecha),
    esLaborable: Number(row.Es_Laborable) === 1,
    horaInicio: row.Hora_Inicio ? String(row.Hora_Inicio).slice(0, 5) : null,
    horaFin: row.Hora_Fin ? String(row.Hora_Fin).slice(0, 5) : null,
    esSupernumerario: Number(row.Es_Supernumerario) === 1,
  };
}

async function getOrCreateWeek(fechaReferencia, actorId, connection = db) {
  const { fechaInicio, fechaFin } = getWeekBounds(fechaReferencia);

  const [existing] = await connection.query(
    `SELECT Id_Semana, Fecha_Inicio, Fecha_Fin, Estado, Fecha_Ultima_Publicacion
     FROM turnos_semanas WHERE Fecha_Inicio = ? LIMIT 1`,
    [fechaInicio]
  );

  let semanaRow;
  if (existing.length) {
    semanaRow = existing[0];
  } else {
    const [result] = await connection.query(
      `INSERT INTO turnos_semanas (Fecha_Inicio, Fecha_Fin, Estado, Creado_Por, Actualizado_Por)
       VALUES (?, ?, 'borrador', ?, ?)`,
      [fechaInicio, fechaFin, actorId || null, actorId || null]
    );
    semanaRow = {
      Id_Semana: result.insertId,
      Fecha_Inicio: fechaInicio,
      Fecha_Fin: fechaFin,
      Estado: 'borrador',
      Fecha_Ultima_Publicacion: null,
    };
  }

  await ensureAdvisorRows(semanaRow.Id_Semana, fechaInicio, connection);

  return {
    idSemana: String(semanaRow.Id_Semana),
    fechaInicio,
    fechaFin,
    estado: semanaRow.Estado,
    fechaUltimaPublicacion: semanaRow.Fecha_Ultima_Publicacion,
  };
}

async function ensureAdvisorRows(idSemana, fechaInicio, connection = db) {
  await connection.query(
    `INSERT INTO turnos_dias (Id_Semana, Id_Usuario, Fecha, Dia_Semana, Es_Laborable)
     SELECT ?, u.Id_Usuario, DATE_ADD(?, INTERVAL dias.numero DAY), dias.numero + 1, 0
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     CROSS JOIN (
       SELECT 0 AS numero UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
       UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
     ) dias
     WHERE LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
       AND NOT EXISTS (
         SELECT 1 FROM turnos_dias td
         WHERE td.Id_Usuario = u.Id_Usuario AND td.Fecha = DATE_ADD(?, INTERVAL dias.numero DAY)
       )`,
    [idSemana, fechaInicio, fechaInicio]
  );

  await connection.query(
    `INSERT INTO turnos_asesores_semana (Id_Semana, Id_Usuario, Id_Canal)
     SELECT ?, u.Id_Usuario, u.Id_Canal
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     WHERE LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
     ON DUPLICATE KEY UPDATE Id_Asignacion = Id_Asignacion`,
    [idSemana]
  );
}

async function listWeekSchedule(fechaReferencia, actorId) {
  const semana = await getOrCreateWeek(fechaReferencia, actorId);

  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario, u.Nombres_Apellidos, u.Usuario, u.Correo, u.Activo,
       cb.Id_Canal AS Id_Canal_Base, cb.Nombre_Canal AS Nombre_Canal_Base,
       cs.Id_Canal AS Id_Canal_Semanal, cs.Nombre_Canal AS Nombre_Canal_Semanal,
       COALESCE(cs.Id_Canal, cb.Id_Canal) AS Id_Canal,
       COALESCE(cs.Nombre_Canal, cb.Nombre_Canal) AS Nombre_Canal,
       tas.Es_Supernumerario AS Supernumerario_Semana,
       v.Id_Vacacion, v.Fecha_Inicio AS Vacacion_Inicio, v.Fecha_Fin AS Vacacion_Fin,
       v.Fecha_Regreso AS Vacacion_Regreso, v.Dias_Habiles AS Vacacion_Dias_Habiles,
       v.Estado AS Vacacion_Estado, v.Observaciones AS Vacacion_Observaciones,
       td.Id_Turno_Dia, td.Fecha, td.Dia_Semana, td.Es_Laborable, td.Hora_Inicio, td.Hora_Fin, td.Es_Supernumerario
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     LEFT JOIN canales_turno cb ON cb.Id_Canal = u.Id_Canal
     LEFT JOIN turnos_asesores_semana tas ON tas.Id_Usuario = u.Id_Usuario AND tas.Id_Semana = ?
     LEFT JOIN canales_turno cs ON cs.Id_Canal = tas.Id_Canal
     LEFT JOIN turnos_vacaciones v ON v.Id_Usuario = u.Id_Usuario AND v.Estado = 'programada'
       AND v.Fecha_Inicio <= ? AND v.Fecha_Fin >= ?
     LEFT JOIN turnos_dias td ON td.Id_Usuario = u.Id_Usuario AND td.Id_Semana = ?
     WHERE LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
     ORDER BY (COALESCE(cs.Nombre_Canal, cb.Nombre_Canal) IS NULL), COALESCE(cs.Nombre_Canal, cb.Nombre_Canal) ASC,
       u.Activo DESC, u.Nombres_Apellidos ASC, td.Dia_Semana ASC`,
    [semana.idSemana, semana.fechaFin, semana.fechaInicio, semana.idSemana]
  );

  const advisors = new Map();
  for (const row of rows) {
    const id = String(row.Id_Usuario);
    if (!advisors.has(id)) {
      advisors.set(id, {
        idUsuario: id,
        nombre: row.Nombres_Apellidos || '',
        usuario: row.Usuario || '',
        correo: row.Correo || '',
        activo: Number(row.Activo) === 1,
        canal: row.Id_Canal != null ? { idCanal: String(row.Id_Canal), nombreCanal: row.Nombre_Canal } : null,
        canalBase: row.Id_Canal_Base != null ? { idCanal: String(row.Id_Canal_Base), nombreCanal: row.Nombre_Canal_Base } : null,
        canalSemanal: row.Id_Canal_Semanal != null ? { idCanal: String(row.Id_Canal_Semanal), nombreCanal: row.Nombre_Canal_Semanal } : null,
        vacacion: mapVacationRow(row),
        esSupernumerario: Number(row.Supernumerario_Semana) === 1,
        configurado: false,
        estadoActual: 'sin_configurar',
        turnos: [],
      });
    }
    if (row.Id_Turno_Dia != null) advisors.get(id).turnos.push(mapDiaRow(row));
  }

  const asesores = [...advisors.values()].map((advisor) => {
    advisor.configurado = advisor.turnos.some((dia) => dia.esLaborable);
    advisor.esSupernumerario = advisor.esSupernumerario || advisor.turnos.some((dia) => dia.esSupernumerario);
    advisor.estadoActual = getCurrentScheduleStatus(advisor.turnos);
    return advisor;
  });

  return { semana, asesores };
}

async function getAdvisorWeekSchedule(userId, fechaReferencia) {
  if (!/^\d+$/.test(String(userId || ''))) return null;

  const { fechaInicio, fechaFin } = getWeekBounds(fechaReferencia);
  const [semanaRows] = await db.query(
    `SELECT Id_Semana, Fecha_Inicio, Fecha_Fin, Estado, Fecha_Ultima_Publicacion
     FROM turnos_semanas WHERE Fecha_Inicio = ? LIMIT 1`,
    [fechaInicio]
  );
  if (!semanaRows.length) return null;
  const semana = semanaRows[0];

  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario, u.Nombres_Apellidos, u.Usuario, u.Correo, u.Activo,
       COALESCE(cs.Id_Canal, cb.Id_Canal) AS Id_Canal,
       COALESCE(cs.Nombre_Canal, cb.Nombre_Canal) AS Nombre_Canal,
       tas.Es_Supernumerario AS Supernumerario_Semana,
       v.Id_Vacacion, v.Fecha_Inicio AS Vacacion_Inicio, v.Fecha_Fin AS Vacacion_Fin,
       v.Fecha_Regreso AS Vacacion_Regreso, v.Dias_Habiles AS Vacacion_Dias_Habiles,
       v.Estado AS Vacacion_Estado, v.Observaciones AS Vacacion_Observaciones,
       td.Id_Turno_Dia, td.Fecha, td.Dia_Semana, td.Es_Laborable, td.Hora_Inicio, td.Hora_Fin, td.Es_Supernumerario
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     LEFT JOIN canales_turno cb ON cb.Id_Canal = u.Id_Canal
     LEFT JOIN turnos_asesores_semana tas ON tas.Id_Usuario = u.Id_Usuario AND tas.Id_Semana = ?
     LEFT JOIN canales_turno cs ON cs.Id_Canal = tas.Id_Canal
     LEFT JOIN turnos_vacaciones v ON v.Id_Usuario = u.Id_Usuario AND v.Estado = 'programada'
       AND v.Fecha_Inicio <= ? AND v.Fecha_Fin >= ?
     LEFT JOIN turnos_dias td ON td.Id_Usuario = u.Id_Usuario AND td.Id_Semana = ?
     WHERE u.Id_Usuario = ? AND LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
     ORDER BY td.Dia_Semana ASC`,
    [semana.Id_Semana, fechaFin, fechaInicio, semana.Id_Semana, userId]
  );
  if (!rows.length) return null;

  // La semana existe y el usuario es Asesor, pero todavía no se ha publicado
  // ninguna vez: no debe verse como si ya tuviera un horario asignado.
  if (semana.Estado === 'borrador') return { noPublicada: true };

  const first = rows[0];
  const turnos = rows.filter((row) => row.Id_Turno_Dia != null).map(mapDiaRow);
  return {
    idUsuario: String(first.Id_Usuario),
    nombre: first.Nombres_Apellidos || '',
    usuario: first.Usuario || '',
    correo: first.Correo || '',
    activo: Number(first.Activo) === 1,
    canal: first.Id_Canal != null ? { idCanal: String(first.Id_Canal), nombreCanal: first.Nombre_Canal } : null,
    vacacion: mapVacationRow(first),
    semana: {
      idSemana: String(semana.Id_Semana),
      fechaInicio,
      fechaFin,
      estado: semana.Estado,
    },
    esSupernumerario: Number(first.Supernumerario_Semana) === 1 || turnos.some((dia) => dia.esSupernumerario),
    configurado: turnos.some((dia) => dia.esLaborable),
    estadoActual: getCurrentScheduleStatus(turnos),
    turnos,
  };
}

async function replaceAdvisorWeek(idSemana, userId, { turnos, esSupernumerario }, actorId) {
  if (!/^\d+$/.test(String(idSemana || '')) || !/^\d+$/.test(String(userId || ''))) {
    const error = new Error('La semana o el asesor indicado no son válidos.');
    error.code = 'INVALID_ADVISOR';
    throw error;
  }

  const normalized = validateWeeklySchedule(turnos);
  const supernumerario = esSupernumerario === true || esSupernumerario === 1;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [semanas] = await conn.query(
      `SELECT Id_Semana, Fecha_Inicio, Estado FROM turnos_semanas WHERE Id_Semana = ? LIMIT 1 FOR UPDATE`,
      [idSemana]
    );
    if (!semanas.length) {
      const error = new Error('La semana indicada no existe.');
      error.code = 'WEEK_NOT_FOUND';
      throw error;
    }
    const semana = semanas[0];

    const [users] = await conn.query(
      `SELECT u.Id_Usuario FROM usuarios u
       INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
       WHERE u.Id_Usuario = ? AND LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
       LIMIT 1 FOR UPDATE`,
      [userId]
    );
    if (!users.length) {
      const error = new Error('El usuario no existe o ya no tiene el rol Asesor.');
      error.code = 'ADVISOR_NOT_FOUND';
      throw error;
    }

    await ensureAdvisorRows(semana.Id_Semana, semana.Fecha_Inicio, conn);

    const [previousRows] = await conn.query(
      `SELECT Id_Turno_Dia, Dia_Semana, Fecha, Es_Laborable, Hora_Inicio, Hora_Fin, Es_Supernumerario
       FROM turnos_dias WHERE Id_Usuario = ? AND Id_Semana = ? ORDER BY Dia_Semana`,
      [userId, semana.Id_Semana]
    );
    if (previousRows.length !== 7) {
      const error = new Error('No se pudo preparar la semana para este asesor.');
      error.code = 'WEEK_ROWS_MISSING';
      throw error;
    }
    const previousByDay = new Map(previousRows.map((row) => [Number(row.Dia_Semana), row]));

    for (const day of normalized) {
      const previous = previousByDay.get(day.diaSemana);
      await conn.query(
        `UPDATE turnos_dias
         SET Es_Laborable = ?, Hora_Inicio = ?, Hora_Fin = ?, Es_Supernumerario = ?, Actualizado_Por = ?
         WHERE Id_Turno_Dia = ?`,
        [day.esLaborable ? 1 : 0, day.horaInicio, day.horaFin, supernumerario ? 1 : 0, actorId || null, previous.Id_Turno_Dia]
      );
    }

    if (semana.Estado === 'publicado') {
      await conn.query(`UPDATE turnos_semanas SET Estado = 'pendiente_republicacion', Actualizado_Por = ? WHERE Id_Semana = ?`, [actorId || null, semana.Id_Semana]);
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'turnos_dias',
      id_registro: userId,
      accion: 'ACTUALIZAR_TURNOS_SEMANA',
      id_usuario: actorId,
      detalles: [{
        columna: 'Jornada_Semana',
        anterior: JSON.stringify(previousRows.map(mapDiaRow)),
        nuevo: JSON.stringify(normalized.map((day, index) => ({ ...day, esSupernumerario: supernumerario, fecha: formatDateOnly(new Date(previousRows[index].Fecha)) }))),
      }],
    });

    await conn.commit();
    return {
      idUsuario: String(userId),
      idSemana: String(semana.Id_Semana),
      esSupernumerario: supernumerario,
      configurado: normalized.some((day) => day.esLaborable),
      estadoActual: getCurrentScheduleStatus(normalized.map((day) => ({ ...day, fecha: formatDateOnly(new Date(previousByDay.get(day.diaSemana).Fecha)) }))),
      turnos: normalized.map((day) => ({ ...day, esSupernumerario: supernumerario, fecha: formatDateOnly(new Date(previousByDay.get(day.diaSemana).Fecha)) })),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function copyWeekFrom(idSemanaDestino, actorId) {
  if (!/^\d+$/.test(String(idSemanaDestino || ''))) {
    const error = new Error('La semana indicada no es válida.');
    error.code = 'WEEK_NOT_FOUND';
    throw error;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [destRows] = await conn.query(
      `SELECT Id_Semana, Fecha_Inicio FROM turnos_semanas WHERE Id_Semana = ? LIMIT 1 FOR UPDATE`,
      [idSemanaDestino]
    );
    if (!destRows.length) {
      const error = new Error('La semana indicada no existe.');
      error.code = 'WEEK_NOT_FOUND';
      throw error;
    }
    const destino = destRows[0];

    const fechaAnterior = formatDateOnly(addDays(parseDateOnly(destino.Fecha_Inicio), -7));
    const [origenRows] = await conn.query(
      `SELECT Id_Semana FROM turnos_semanas WHERE Fecha_Inicio = ? LIMIT 1`,
      [fechaAnterior]
    );
    if (!origenRows.length) {
      const error = new Error('No existe una semana anterior guardada para copiar.');
      error.code = 'PREVIOUS_WEEK_NOT_FOUND';
      throw error;
    }
    const idSemanaOrigen = origenRows[0].Id_Semana;

    await ensureAdvisorRows(destino.Id_Semana, destino.Fecha_Inicio, conn);

    // Solo se copian Es_Laborable/Hora_Inicio/Hora_Fin. Es_Supernumerario,
    // intercambios, presencia, historial y Estado nunca se copian — el
    // supernumerario rota semana a semana y debe reasignarse a propósito.
    await conn.query(
      `UPDATE turnos_dias td_destino
       INNER JOIN turnos_dias td_origen
         ON td_origen.Id_Usuario = td_destino.Id_Usuario AND td_origen.Dia_Semana = td_destino.Dia_Semana
       SET td_destino.Es_Laborable = td_origen.Es_Laborable,
           td_destino.Hora_Inicio = td_origen.Hora_Inicio,
           td_destino.Hora_Fin = td_origen.Hora_Fin,
           td_destino.Actualizado_Por = ?
       WHERE td_destino.Id_Semana = ? AND td_origen.Id_Semana = ?`,
      [actorId || null, destino.Id_Semana, idSemanaOrigen]
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'turnos_semanas',
      id_registro: destino.Id_Semana,
      accion: 'COPIAR_TURNOS_SEMANA_ANTERIOR',
      id_usuario: actorId,
      detalles: [{ columna: 'Id_Semana_Origen', anterior: '', nuevo: String(idSemanaOrigen) }],
    });

    await conn.commit();
    return { idSemana: String(destino.Id_Semana) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function publishWeek(idSemana, jornadas, aceptarAdvertencias, actorId) {
  if (!/^\d+$/.test(String(idSemana || ''))) {
    const error = new Error('La semana indicada no es válida.');
    error.code = 'WEEK_NOT_FOUND';
    throw error;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT Id_Semana, Fecha_Inicio, Estado FROM turnos_semanas WHERE Id_Semana = ? LIMIT 1 FOR UPDATE`, [idSemana]);
    if (!rows.length) {
      const error = new Error('La semana indicada no existe.');
      error.code = 'WEEK_NOT_FOUND';
      throw error;
    }
    const semana = rows[0];
    const estadoAnterior = semana.Estado;

    if (!Array.isArray(jornadas) || jornadas.length === 0) {
      const error = new Error('La publicación debe incluir las jornadas de los asesores activos.');
      error.code = 'INVALID_WEEK_PAYLOAD';
      throw error;
    }

    const seenUsers = new Set();
    const prepared = jornadas.map((item) => {
      const idUsuario = String(item?.idUsuario || '');
      if (!/^\d+$/.test(idUsuario) || seenUsers.has(idUsuario)) {
        const error = new Error('La publicación contiene asesores inválidos o repetidos.');
        error.code = 'INVALID_WEEK_PAYLOAD';
        throw error;
      }
      seenUsers.add(idUsuario);
      let turnos = validateWeeklySchedule(item?.turnos);
      const vacation = validateVacation(item?.vacacion);
      if (vacation) {
        const weekStart = parseDateOnly(semana.Fecha_Inicio);
        turnos = turnos.map((day) => {
          const dayDate = formatDateOnly(addDays(weekStart, day.diaSemana - 1));
          return dayDate >= vacation.fechaInicio && dayDate <= vacation.fechaFin
            ? { ...day, esLaborable: false, horaInicio: null, horaFin: null }
            : day;
        });
      }
      const idCanalSemanal = item?.idCanalSemanal == null || item?.idCanalSemanal === ''
        ? null
        : String(item.idCanalSemanal);
      if (idCanalSemanal != null && !/^\d+$/.test(idCanalSemanal)) {
        const error = new Error('Uno de los canales semanales no es válido.');
        error.code = 'INVALID_WEEK_CHANNEL';
        throw error;
      }
      return {
        idUsuario,
        turnos,
        esSupernumerario: item?.esSupernumerario === true || item?.esSupernumerario === 1,
        idCanalSemanal,
        vacation,
        advertencias: vacation
          && vacation.fechaInicio <= formatDateOnly(parseDateOnly(semana.Fecha_Inicio))
          && vacation.fechaFin >= formatDateOnly(addDays(parseDateOnly(semana.Fecha_Inicio), 6))
          ? [] : getScheduleWarnings(turnos),
      };
    });

    const advertencias = prepared.flatMap((item) => item.advertencias.map((warning) => ({ idUsuario: item.idUsuario, ...warning })));
    if (advertencias.length && aceptarAdvertencias !== true) {
      const error = new Error('La semana tiene advertencias que deben revisarse antes de publicar.');
      error.code = 'SCHEDULE_WARNINGS';
      error.advertencias = advertencias;
      throw error;
    }

    await ensureAdvisorRows(semana.Id_Semana, semana.Fecha_Inicio, conn);
    for (const item of prepared) {
      if (item.idCanalSemanal != null) {
        const [channels] = await conn.query(
          `SELECT Id_Canal FROM canales_turno WHERE Id_Canal = ? AND Activo = 1 LIMIT 1`,
          [item.idCanalSemanal]
        );
        if (!channels.length) {
          const error = new Error('Uno de los canales semanales ya no está disponible.');
          error.code = 'INVALID_WEEK_CHANNEL';
          throw error;
        }
      }

      await conn.query(
        `INSERT INTO turnos_asesores_semana
           (Id_Semana, Id_Usuario, Id_Canal, Es_Supernumerario, Creado_Por, Actualizado_Por)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE Id_Canal = VALUES(Id_Canal),
           Es_Supernumerario = VALUES(Es_Supernumerario), Actualizado_Por = VALUES(Actualizado_Por)`,
        [semana.Id_Semana, item.idUsuario, item.idCanalSemanal, item.esSupernumerario ? 1 : 0,
          actorId || null, actorId || null]
      );

      const [overlappingVacations] = await conn.query(
        `SELECT Id_Vacacion FROM turnos_vacaciones
         WHERE Id_Usuario = ? AND Estado = 'programada' AND Fecha_Inicio <= ? AND Fecha_Fin >= ?
         FOR UPDATE`,
        [item.idUsuario, semana.Fecha_Inicio instanceof Date
          ? formatDateOnly(addDays(parseDateOnly(semana.Fecha_Inicio), 6))
          : formatDateOnly(addDays(parseDateOnly(String(semana.Fecha_Inicio)), 6)),
        semana.Fecha_Inicio instanceof Date ? formatDateOnly(parseDateOnly(semana.Fecha_Inicio)) : String(semana.Fecha_Inicio)]
      );
      if (item.vacation) {
        const conflicting = await conn.query(
          `SELECT Id_Vacacion FROM turnos_vacaciones
           WHERE Id_Usuario = ? AND Estado = 'programada' AND Fecha_Inicio <= ? AND Fecha_Fin >= ?
             AND (? IS NULL OR Id_Vacacion <> ?) LIMIT 1`,
          [item.idUsuario, item.vacation.fechaFin, item.vacation.fechaInicio,
            item.vacation.idVacacion, item.vacation.idVacacion]
        );
        if (conflicting[0].length) {
          const error = new Error('El asesor ya tiene otro periodo de vacaciones en esas fechas.');
          error.code = 'VACATION_OVERLAP';
          throw error;
        }
        if (item.vacation.idVacacion) {
          await conn.query(
            `UPDATE turnos_vacaciones SET Fecha_Inicio = ?, Fecha_Fin = ?, Fecha_Regreso = ?,
               Dias_Habiles = ?, Observaciones = ?, Estado = 'programada', Actualizado_Por = ?
             WHERE Id_Vacacion = ? AND Id_Usuario = ?`,
            [item.vacation.fechaInicio, item.vacation.fechaFin, item.vacation.fechaRegreso,
              item.vacation.diasHabiles, item.vacation.observaciones, actorId || null,
              item.vacation.idVacacion, item.idUsuario]
          );
        } else {
          await conn.query(
            `INSERT INTO turnos_vacaciones
               (Id_Usuario, Fecha_Inicio, Fecha_Fin, Fecha_Regreso, Dias_Habiles, Observaciones, Creado_Por, Actualizado_Por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.idUsuario, item.vacation.fechaInicio, item.vacation.fechaFin,
              item.vacation.fechaRegreso, item.vacation.diasHabiles, item.vacation.observaciones,
              actorId || null, actorId || null]
          );
        }
      } else if (overlappingVacations.length) {
        await conn.query(
          `UPDATE turnos_vacaciones SET Estado = 'cancelada', Actualizado_Por = ?
           WHERE Id_Vacacion IN (?)`,
          [actorId || null, overlappingVacations.map((row) => row.Id_Vacacion)]
        );
      }

      const [dayRows] = await conn.query(
        `SELECT Id_Turno_Dia, Dia_Semana FROM turnos_dias
         WHERE Id_Semana = ? AND Id_Usuario = ? ORDER BY Dia_Semana FOR UPDATE`,
        [semana.Id_Semana, item.idUsuario]
      );
      if (dayRows.length !== 7) {
        const error = new Error('No se pudo preparar la semana para uno de los asesores.');
        error.code = 'WEEK_ROWS_MISSING';
        throw error;
      }
      const rowByDay = new Map(dayRows.map((row) => [Number(row.Dia_Semana), row.Id_Turno_Dia]));
      for (const day of item.turnos) {
        await conn.query(
          `UPDATE turnos_dias
           SET Es_Laborable = ?, Hora_Inicio = ?, Hora_Fin = ?, Es_Supernumerario = ?, Actualizado_Por = ?
           WHERE Id_Turno_Dia = ?`,
          [day.esLaborable ? 1 : 0, day.horaInicio, day.horaFin,
            item.esSupernumerario ? 1 : 0, actorId || null, rowByDay.get(day.diaSemana)]
        );
      }
    }

    await conn.query(
      `UPDATE turnos_semanas
       SET Estado = 'publicado', Publicado_Por = ?, Fecha_Ultima_Publicacion = NOW(), Actualizado_Por = ?
       WHERE Id_Semana = ?`,
      [actorId || null, actorId || null, idSemana]
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'turnos_semanas',
      id_registro: idSemana,
      accion: 'PUBLICAR_TURNOS_SEMANA',
      id_usuario: actorId,
      detalles: [
        { columna: 'Estado', anterior: estadoAnterior, nuevo: 'publicado' },
        { columna: 'Jornadas_Publicadas', anterior: '', nuevo: String(prepared.length) },
        { columna: 'Advertencias_Aceptadas', anterior: '', nuevo: String(advertencias.length) },
      ],
    });

    await conn.commit();
    return { idSemana: String(idSemana), estado: 'publicado' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function listCanales() {
  const [rows] = await db.query(
    `SELECT Id_Canal, Nombre_Canal FROM canales_turno WHERE Activo = 1 ORDER BY Nombre_Canal ASC`
  );
  return rows.map((row) => ({ idCanal: String(row.Id_Canal), nombreCanal: row.Nombre_Canal }));
}

async function listWeekHistory() {
  const [rows] = await db.query(
    `SELECT Id_Semana, Fecha_Inicio, Fecha_Fin, Estado, Fecha_Ultima_Publicacion
     FROM turnos_semanas
     WHERE Fecha_Fin < CURDATE()
     ORDER BY Fecha_Inicio DESC
     LIMIT 26`
  );
  return rows.map((row) => ({
    idSemana: String(row.Id_Semana),
    fechaInicio: formatDateOnly(parseDateOnly(row.Fecha_Inicio)),
    fechaFin: formatDateOnly(parseDateOnly(row.Fecha_Fin)),
    estado: row.Estado,
    fechaUltimaPublicacion: row.Fecha_Ultima_Publicacion,
  }));
}

module.exports = {
  BOGOTA_TIME_ZONE,
  MAX_END_TIME,
  SCHEDULE_STEP_MINUTES,
  DAY_NAMES,
  normalizeTime,
  validateWeeklySchedule,
  validateVacation,
  getScheduleWarnings,
  getBogotaClock,
  getWeekBounds,
  getCurrentScheduleStatus,
  listWeekSchedule,
  getAdvisorWeekSchedule,
  replaceAdvisorWeek,
  copyWeekFrom,
  publishWeek,
  listCanales,
  listWeekHistory,
};
