const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');

const BOGOTA_TIME_ZONE = 'America/Bogota';
const MAX_END_TIME = '23:00';
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function isAdministratorRole(value) {
  return String(value || '').trim().toLowerCase() === 'administrador';
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

function getCurrentScheduleStatus(turnos, now = new Date()) {
  if (!Array.isArray(turnos) || turnos.length !== 7) return 'sin_configurar';
  const clock = getBogotaClock(now);
  const today = turnos.find((turno) => Number(turno.diaSemana) === clock.diaSemana);
  if (!today?.esLaborable) return 'fuera_turno';
  return clock.hora >= today.horaInicio && clock.hora < today.horaFin ? 'en_turno' : 'fuera_turno';
}

function mapScheduleRow(row) {
  return {
    diaSemana: Number(row.Dia_Semana),
    nombreDia: DAY_NAMES[Number(row.Dia_Semana) - 1],
    esLaborable: Number(row.Es_Laborable) === 1,
    horaInicio: row.Hora_Inicio ? String(row.Hora_Inicio).slice(0, 5) : null,
    horaFin: row.Hora_Fin ? String(row.Hora_Fin).slice(0, 5) : null,
  };
}

async function listAdvisorsWithSchedules() {
  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario,
       u.Nombres_Apellidos,
       u.Usuario,
       u.Correo,
       u.Activo,
       ta.Dia_Semana,
       ta.Es_Laborable,
       ta.Hora_Inicio,
       ta.Hora_Fin
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     LEFT JOIN turnos_asesores ta ON ta.Id_Usuario = u.Id_Usuario
     WHERE LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
     ORDER BY u.Activo DESC, u.Nombres_Apellidos ASC, ta.Dia_Semana ASC`
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
        configurado: false,
        estadoActual: 'sin_configurar',
        turnos: [],
      });
    }
    if (row.Dia_Semana != null) advisors.get(id).turnos.push(mapScheduleRow(row));
  }

  return [...advisors.values()].map((advisor) => {
    advisor.configurado = advisor.turnos.length === 7;
    advisor.estadoActual = getCurrentScheduleStatus(advisor.turnos);
    return advisor;
  });
}

async function getAdvisorSchedule(userId) {
  if (!/^\d+$/.test(String(userId || ''))) return null;

  const [rows] = await db.query(
    `SELECT
       u.Id_Usuario,
       u.Nombres_Apellidos,
       u.Usuario,
       u.Correo,
       u.Activo,
       ta.Dia_Semana,
       ta.Es_Laborable,
       ta.Hora_Inicio,
       ta.Hora_Fin
     FROM usuarios u
     INNER JOIN roles r ON r.Id_Rol = u.Id_Rol
     LEFT JOIN turnos_asesores ta ON ta.Id_Usuario = u.Id_Usuario
     WHERE u.Id_Usuario = ?
       AND LOWER(TRIM(r.Nombre_Rol)) = 'asesor'
     ORDER BY ta.Dia_Semana ASC`,
    [userId]
  );

  if (!rows.length) return null;
  const first = rows[0];
  const turnos = rows.filter((row) => row.Dia_Semana != null).map(mapScheduleRow);
  return {
    idUsuario: String(first.Id_Usuario),
    nombre: first.Nombres_Apellidos || '',
    usuario: first.Usuario || '',
    correo: first.Correo || '',
    activo: Number(first.Activo) === 1,
    configurado: turnos.length === 7,
    estadoActual: getCurrentScheduleStatus(turnos),
    turnos,
  };
}

async function replaceAdvisorSchedule(userId, schedule, actorId) {
  if (!/^\d+$/.test(String(userId || ''))) {
    const error = new Error('El asesor seleccionado no es válido.');
    error.code = 'INVALID_ADVISOR';
    throw error;
  }

  const normalized = validateWeeklySchedule(schedule);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query(
      `SELECT u.Id_Usuario, u.Nombres_Apellidos
       FROM usuarios u
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

    const [previousRows] = await conn.query(
      `SELECT Dia_Semana, Es_Laborable, Hora_Inicio, Hora_Fin
       FROM turnos_asesores WHERE Id_Usuario = ? ORDER BY Dia_Semana`,
      [userId]
    );

    for (const day of normalized) {
      await conn.query(
        `INSERT INTO turnos_asesores
          (Id_Usuario, Dia_Semana, Es_Laborable, Hora_Inicio, Hora_Fin, Creado_Por, Actualizado_Por)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          Es_Laborable = VALUES(Es_Laborable),
          Hora_Inicio = VALUES(Hora_Inicio),
          Hora_Fin = VALUES(Hora_Fin),
          Actualizado_Por = VALUES(Actualizado_Por),
          Fecha_Actualizacion = CURRENT_TIMESTAMP`,
        [userId, day.diaSemana, day.esLaborable ? 1 : 0, day.horaInicio, day.horaFin, actorId || null, actorId || null]
      );
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'turnos_asesores',
      id_registro: userId,
      accion: 'ACTUALIZAR_TURNOS_ASESOR',
      id_usuario: actorId,
      detalles: [{
        columna: 'Jornada_Semanal',
        anterior: JSON.stringify(previousRows.map(mapScheduleRow)),
        nuevo: JSON.stringify(normalized),
      }],
    });

    await conn.commit();
    return {
      idUsuario: String(userId),
      configurado: true,
      estadoActual: getCurrentScheduleStatus(normalized),
      turnos: normalized,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  BOGOTA_TIME_ZONE,
  MAX_END_TIME,
  DAY_NAMES,
  isAdministratorRole,
  normalizeTime,
  validateWeeklySchedule,
  getBogotaClock,
  getCurrentScheduleStatus,
  listAdvisorsWithSchedules,
  getAdvisorSchedule,
  replaceAdvisorSchedule,
};
