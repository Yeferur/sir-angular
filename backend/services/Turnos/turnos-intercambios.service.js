const db = require('../../database/db');
const { recordHistorial } = require('../Historial/logger');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');

function businessError(code, message) {
  const error = new Error(message); error.code = code; return error;
}

function bogotaNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const match = String(value || '').slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/);
  return match ? match[0] : null;
}

function hhmm(value) { return value == null ? null : String(value).slice(0, 5); }

async function getShift(conn, userId, date, lock = false) {
  const [rows] = await conn.query(
    `SELECT td.Id_Turno_Dia, td.Id_Semana, td.Id_Usuario, td.Fecha, td.Es_Laborable,
            td.Hora_Inicio, td.Hora_Fin, ts.Estado AS Estado_Semana,
            tas.Id_Canal, u.Nombres_Apellidos, u.Activo, r.Nombre_Rol
       FROM turnos_dias td
       INNER JOIN turnos_semanas ts ON ts.Id_Semana = td.Id_Semana
       INNER JOIN usuarios u ON u.Id_Usuario = td.Id_Usuario
       LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
       LEFT JOIN turnos_asesores_semana tas
         ON tas.Id_Semana = td.Id_Semana AND tas.Id_Usuario = td.Id_Usuario
      WHERE td.Id_Usuario = ? AND td.Fecha = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId, date]
  );
  return rows[0] || null;
}

function assertExchangeable(shift, now) {
  if (!shift || !shift.Activo || String(shift.Nombre_Rol || '').toLowerCase() !== 'asesor')
    throw businessError('ADVISOR_SHIFT_NOT_FOUND', 'El asesor no tiene una jornada válida para ese día.');
  if (shift.Estado_Semana !== 'publicado')
    throw businessError('WEEK_NOT_PUBLISHED', 'Solo se pueden intercambiar jornadas de una semana publicada.');
  if (!shift.Es_Laborable || !shift.Hora_Inicio || !shift.Hora_Fin)
    throw businessError('WORK_SHIFT_REQUIRED', 'El intercambio requiere que ambos asesores trabajen ese día.');
  const shiftDate = normalizeDate(shift.Fecha);
  if (shiftDate < now.date || (shiftDate === now.date && hhmm(shift.Hora_Inicio) <= now.time))
    throw businessError('SHIFT_ALREADY_STARTED', 'La jornada ya comenzó o pertenece a una fecha anterior.');
}

async function listCandidates(userId, rawDate) {
  const date = normalizeDate(rawDate);
  if (!date) throw businessError('INVALID_DATE', 'Selecciona una fecha válida.');
  const own = await getShift(db, userId, date);
  const now = bogotaNowParts(); assertExchangeable(own, now);
  if (!own.Id_Canal) throw businessError('CHANNEL_REQUIRED', 'Necesitas un canal asignado para solicitar el cambio.');
  const [rows] = await db.query(
    `SELECT td.Id_Usuario, u.Nombres_Apellidos, td.Hora_Inicio, td.Hora_Fin
       FROM turnos_dias td
       INNER JOIN usuarios u ON u.Id_Usuario = td.Id_Usuario AND u.Activo = 1
       INNER JOIN roles r ON r.Id_Rol = u.Id_Rol AND LOWER(r.Nombre_Rol) = 'asesor'
       INNER JOIN turnos_asesores_semana tas
         ON tas.Id_Semana = td.Id_Semana AND tas.Id_Usuario = td.Id_Usuario
       LEFT JOIN turnos_vacaciones v ON v.Id_Usuario = td.Id_Usuario AND v.Estado = 'programada'
         AND td.Fecha BETWEEN v.Fecha_Inicio AND v.Fecha_Fin
      WHERE td.Id_Semana = ? AND td.Fecha = ? AND td.Id_Usuario <> ?
        AND tas.Id_Canal = ? AND td.Es_Laborable = 1 AND v.Id_Vacacion IS NULL
        AND NOT (td.Hora_Inicio = ? AND td.Hora_Fin = ?)
        AND NOT EXISTS (
          SELECT 1 FROM turnos_intercambios ti
           WHERE ti.Fecha = td.Fecha AND ti.Estado = 'pendiente'
             AND (ti.Id_Solicitante = td.Id_Usuario OR ti.Id_Receptor = td.Id_Usuario)
        )
      ORDER BY td.Hora_Inicio, u.Nombres_Apellidos`,
    [own.Id_Semana, date, userId, own.Id_Canal, own.Hora_Inicio, own.Hora_Fin]
  );
  return rows.map((row) => ({ idUsuario: String(row.Id_Usuario), nombre: row.Nombres_Apellidos,
    horaInicio: hhmm(row.Hora_Inicio), horaFin: hhmm(row.Hora_Fin) }));
}

async function createRequest(userId, payload) {
  const date = normalizeDate(payload?.fecha);
  const targetId = Number(payload?.idReceptor);
  if (!date || !targetId || targetId === Number(userId)) throw businessError('INVALID_REQUEST', 'La solicitud de intercambio no es válida.');
  const conn = await db.getConnection();
  let notificationId;
  try {
    await conn.beginTransaction();
    const own = await getShift(conn, userId, date, true);
    const target = await getShift(conn, targetId, date, true);
    const now = bogotaNowParts(); assertExchangeable(own, now); assertExchangeable(target, now);
    if (Number(own.Id_Semana) !== Number(target.Id_Semana) || !own.Id_Canal || Number(own.Id_Canal) !== Number(target.Id_Canal))
      throw businessError('DIFFERENT_CHANNEL', 'Solo puedes intercambiar con un asesor de tu mismo canal esta semana.');
    if (hhmm(own.Hora_Inicio) === hhmm(target.Hora_Inicio) && hhmm(own.Hora_Fin) === hhmm(target.Hora_Fin))
      throw businessError('SAME_SHIFT', 'El compañero ya tiene el mismo horario para ese día.');
    const [vacations] = await conn.query(
      `SELECT Id_Usuario FROM turnos_vacaciones WHERE Estado = 'programada' AND Fecha_Inicio <= ? AND Fecha_Fin >= ?
       AND Id_Usuario IN (?, ?) LIMIT 1 FOR UPDATE`, [date, date, userId, targetId]
    );
    if (vacations.length) throw businessError('VACATION_CONFLICT', 'No se puede intercambiar una jornada durante vacaciones.');
    const [pending] = await conn.query(
      `SELECT Id_Intercambio FROM turnos_intercambios WHERE Fecha = ? AND Estado = 'pendiente'
       AND (Id_Solicitante IN (?, ?) OR Id_Receptor IN (?, ?)) LIMIT 1 FOR UPDATE`,
      [date, userId, targetId, userId, targetId]
    );
    if (pending.length) throw businessError('PENDING_EXCHANGE', 'Uno de los dos asesores ya tiene una solicitud pendiente para ese día.');
    const [result] = await conn.query(
      `INSERT INTO turnos_intercambios
       (Id_Semana, Fecha, Id_Solicitante, Id_Receptor, Id_Turno_Solicitante, Id_Turno_Receptor,
        Hora_Inicio_Solicitante, Hora_Fin_Solicitante, Hora_Inicio_Receptor, Hora_Fin_Receptor, Motivo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [own.Id_Semana, date, userId, targetId, own.Id_Turno_Dia, target.Id_Turno_Dia,
        own.Hora_Inicio, own.Hora_Fin, target.Hora_Inicio, target.Hora_Fin,
        String(payload?.motivo || '').trim().slice(0, 300) || null]
    );
    const id = String(result.insertId);
    notificationId = await notifications.createNotification(conn, {
      userId: targetId, type: 'turno_intercambio_solicitado', title: 'Solicitud de cambio de turno',
      message: `${own.Nombres_Apellidos} quiere intercambiar contigo la jornada del ${date}.`,
      entityType: 'turnos_intercambios', entityId: result.insertId, data: { idIntercambio: id, fecha: date },
    });
    await conn.commit();
    websocketManager.sendToUser(targetId, { type: 'notificacionNueva', idNotificacion: notificationId, categoria: 'turnos' });
    websocketManager.sendToUser(targetId, { type: 'turnoIntercambioActualizado', idIntercambio: id });
    return { idIntercambio: id, estado: 'pendiente' };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

async function listMine(userId) {
  const [rows] = await db.query(
    `SELECT ti.*, us.Nombres_Apellidos AS Solicitante, ur.Nombres_Apellidos AS Receptor
       FROM turnos_intercambios ti
       INNER JOIN usuarios us ON us.Id_Usuario = ti.Id_Solicitante
       INNER JOIN usuarios ur ON ur.Id_Usuario = ti.Id_Receptor
      WHERE ti.Id_Solicitante = ? OR ti.Id_Receptor = ?
      ORDER BY (ti.Estado = 'pendiente') DESC, ti.Fecha_Creacion DESC LIMIT 50`, [userId, userId]
  );
  return rows.map((row) => ({
    idIntercambio: String(row.Id_Intercambio), fecha: normalizeDate(row.Fecha), estado: row.Estado,
    esSolicitante: Number(row.Id_Solicitante) === Number(userId), solicitante: row.Solicitante, receptor: row.Receptor,
    horarioSolicitante: { inicio: hhmm(row.Hora_Inicio_Solicitante), fin: hhmm(row.Hora_Fin_Solicitante) },
    horarioReceptor: { inicio: hhmm(row.Hora_Inicio_Receptor), fin: hhmm(row.Hora_Fin_Receptor) },
    motivo: row.Motivo, fechaCreacion: row.Fecha_Creacion, fechaRespuesta: row.Fecha_Respuesta,
  }));
}

async function respond(userId, exchangeId, accept) {
  const conn = await db.getConnection(); let requesterId; let notificationId;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT ti.*, ur.Nombres_Apellidos AS Receptor FROM turnos_intercambios ti
       INNER JOIN usuarios ur ON ur.Id_Usuario = ti.Id_Receptor
       WHERE ti.Id_Intercambio = ? LIMIT 1 FOR UPDATE`, [exchangeId]
    );
    const exchange = rows[0];
    if (!exchange) throw businessError('EXCHANGE_NOT_FOUND', 'La solicitud no existe.');
    if (Number(exchange.Id_Receptor) !== Number(userId)) throw businessError('NOT_RECIPIENT', 'Solo el asesor invitado puede responder.');
    if (exchange.Estado !== 'pendiente') throw businessError('EXCHANGE_ALREADY_RESOLVED', 'La solicitud ya fue respondida.');
    requesterId = exchange.Id_Solicitante;
    if (accept) {
      const own = await getShift(conn, exchange.Id_Solicitante, normalizeDate(exchange.Fecha), true);
      const target = await getShift(conn, exchange.Id_Receptor, normalizeDate(exchange.Fecha), true);
      const now = bogotaNowParts(); assertExchangeable(own, now); assertExchangeable(target, now);
      if (Number(own.Id_Semana) !== Number(exchange.Id_Semana) || Number(target.Id_Semana) !== Number(exchange.Id_Semana)
        || !own.Id_Canal || Number(own.Id_Canal) !== Number(target.Id_Canal))
        throw businessError('SHIFT_CHANGED', 'La asignación semanal cambió después de crear la solicitud.');
      const [vacations] = await conn.query(
        `SELECT Id_Usuario FROM turnos_vacaciones WHERE Estado = 'programada' AND Fecha_Inicio <= ? AND Fecha_Fin >= ?
         AND Id_Usuario IN (?, ?) LIMIT 1 FOR UPDATE`,
        [normalizeDate(exchange.Fecha), normalizeDate(exchange.Fecha), exchange.Id_Solicitante, exchange.Id_Receptor]
      );
      if (vacations.length) throw businessError('VACATION_CONFLICT', 'No se puede aceptar porque uno de los asesores estará de vacaciones.');
      const unchanged = Number(own.Id_Turno_Dia) === Number(exchange.Id_Turno_Solicitante)
        && Number(target.Id_Turno_Dia) === Number(exchange.Id_Turno_Receptor)
        && hhmm(own.Hora_Inicio) === hhmm(exchange.Hora_Inicio_Solicitante)
        && hhmm(own.Hora_Fin) === hhmm(exchange.Hora_Fin_Solicitante)
        && hhmm(target.Hora_Inicio) === hhmm(exchange.Hora_Inicio_Receptor)
        && hhmm(target.Hora_Fin) === hhmm(exchange.Hora_Fin_Receptor);
      if (!unchanged) throw businessError('SHIFT_CHANGED', 'Uno de los horarios cambió después de crear la solicitud.');
      await conn.query('UPDATE turnos_dias SET Hora_Inicio = ?, Hora_Fin = ?, Actualizado_Por = ? WHERE Id_Turno_Dia = ?',
        [target.Hora_Inicio, target.Hora_Fin, userId, own.Id_Turno_Dia]);
      await conn.query('UPDATE turnos_dias SET Hora_Inicio = ?, Hora_Fin = ?, Actualizado_Por = ? WHERE Id_Turno_Dia = ?',
        [own.Hora_Inicio, own.Hora_Fin, userId, target.Id_Turno_Dia]);
    }
    const state = accept ? 'aceptado' : 'rechazado';
    await conn.query(`UPDATE turnos_intercambios SET Estado = ?, Respondido_Por = ?, Fecha_Respuesta = NOW()
      WHERE Id_Intercambio = ?`, [state, userId, exchangeId]);
    await recordHistorial({ conexion: conn, tabla: 'turnos_intercambios', id_registro: exchangeId,
      accion: accept ? 'ACEPTAR_INTERCAMBIO_TURNO' : 'RECHAZAR_INTERCAMBIO_TURNO', id_usuario: userId,
      detalles: [{ columna: 'Estado', anterior: 'pendiente', nuevo: state }] });
    notificationId = await notifications.createNotification(conn, {
      userId: requesterId, type: `turno_intercambio_${state}`, title: accept ? 'Cambio de turno aceptado' : 'Cambio de turno rechazado',
      message: `${exchange.Receptor} ${accept ? 'aceptó' : 'rechazó'} el cambio del ${normalizeDate(exchange.Fecha)}.`,
      entityType: 'turnos_intercambios', entityId: exchangeId, data: { idIntercambio: String(exchangeId), estado: state },
    });
    await conn.commit();
    for (const id of [requesterId, userId]) websocketManager.sendToUser(id, { type: 'turnoIntercambioActualizado', idIntercambio: String(exchangeId), estado: state });
    websocketManager.sendToUser(requesterId, { type: 'notificacionNueva', idNotificacion: notificationId, categoria: 'turnos' });
    return { idIntercambio: String(exchangeId), estado: state };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

async function cancel(userId, exchangeId) {
  const conn = await db.getConnection(); let recipientId; let notificationId;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT Id_Receptor, Fecha FROM turnos_intercambios
        WHERE Id_Intercambio = ? AND Id_Solicitante = ? AND Estado = 'pendiente' LIMIT 1 FOR UPDATE`,
      [exchangeId, userId]
    );
    if (!rows.length) throw businessError('CANNOT_CANCEL', 'La solicitud no existe o ya fue respondida.');
    recipientId = rows[0].Id_Receptor;
    await conn.query(`UPDATE turnos_intercambios SET Estado = 'cancelado', Respondido_Por = ?, Fecha_Respuesta = NOW()
      WHERE Id_Intercambio = ?`, [userId, exchangeId]);
    notificationId = await notifications.createNotification(conn, {
      userId: recipientId, type: 'turno_intercambio_cancelado', title: 'Solicitud de cambio cancelada',
      message: `La solicitud de cambio del ${normalizeDate(rows[0].Fecha)} fue cancelada.`,
      entityType: 'turnos_intercambios', entityId: exchangeId, data: { idIntercambio: String(exchangeId), estado: 'cancelado' },
    });
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  websocketManager.sendToUser(recipientId, { type: 'notificacionNueva', idNotificacion: notificationId, categoria: 'turnos' });
  websocketManager.sendToUser(recipientId, { type: 'turnoIntercambioActualizado', idIntercambio: String(exchangeId), estado: 'cancelado' });
  return { idIntercambio: String(exchangeId), estado: 'cancelado' };
}

module.exports = { listCandidates, createRequest, listMine, respond, cancel };
