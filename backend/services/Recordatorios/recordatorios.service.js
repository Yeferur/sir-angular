const db = require('../../database/db');
const { toMysqlDateTime } = require('../../utils/dateTime');

class ReminderOperationError extends Error {
  constructor(message, status = 400, code = 'REMINDER_OPERATION_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeDate(value, field = 'fecha') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new ReminderOperationError(`La ${field} no es válida.`, 400, 'INVALID_REMINDER_DATE');
  }
  return toMysqlDateTime(date);
}

function optionalText(value, maxLength) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeInput(input, { partial = false } = {}) {
  const result = {};
  if (!partial || Object.hasOwn(input, 'titulo')) {
    const title = String(input.titulo || '').trim();
    if (!title) throw new ReminderOperationError('El título es obligatorio.', 422, 'REMINDER_TITLE_REQUIRED');
    result.title = title.slice(0, 255);
  }
  if (!partial || Object.hasOwn(input, 'fecha')) result.date = normalizeDate(input.fecha);
  if (!partial || Object.hasOwn(input, 'descripcion')) result.description = optionalText(input.descripcion, 4000);
  if (!partial || Object.hasOwn(input, 'recurrencia')) result.recurrence = optionalText(input.recurrencia, 50);
  if (!partial || Object.hasOwn(input, 'intervalo')) result.interval = optionalText(input.intervalo, 50);
  if (!partial || Object.hasOwn(input, 'recordarTodoElDia')) result.allDay = !!input.recordarTodoElDia;
  if (!partial || Object.hasOwn(input, 'intervaloTodoElDia')) result.allDayInterval = optionalText(input.intervaloTodoElDia, 50);
  if (!partial || Object.hasOwn(input, 'entidadTipo')) result.entityType = optionalText(input.entidadTipo, 60);
  if (!partial || Object.hasOwn(input, 'entidadId')) result.entityId = optionalText(input.entidadId, 80);
  return result;
}

function mapReminder(row) {
  const suppressedUntil = row.Suprimido_Hasta ? new Date(row.Suprimido_Hasta) : null;
  return {
    idRecordatorio: String(row.Id_Recordatorio),
    titulo: row.Titulo,
    descripcion: row.Descripcion,
    fecha: row.Fecha,
    recurrencia: row.Recurrencia,
    intervalo: row.Intervalo,
    recordarTodoElDia: !!row.Recordar_Todo_El_Dia,
    intervaloTodoElDia: row.Intervalo_Todo_El_Dia,
    siguienteTrigger: row.Siguiente_Trigger,
    estado: row.Estado,
    suprimidoHasta: row.Suprimido_Hasta,
    estaSuprimido: !!(suppressedUntil && suppressedUntil.getTime() > Date.now()),
    entidadTipo: row.Entidad_Tipo,
    entidadId: row.Entidad_Id == null ? null : String(row.Entidad_Id),
    fechaCreacion: row.Fecha_Creacion,
    fechaActualizacion: row.Fecha_Actualizacion,
  };
}

async function listMine(userId, { includeCompleted = false } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM recordatorios
      WHERE Id_Usuario = ? ${includeCompleted ? '' : "AND Estado = 'ACTIVO'"}
      ORDER BY FIELD(Estado, 'ACTIVO', 'COMPLETADO'), Fecha ASC`,
    [userId]
  );
  return rows.map(mapReminder);
}

async function create(userId, input) {
  const data = normalizeInput(input);
  const [result] = await db.query(
    `INSERT INTO recordatorios
      (Id_Usuario, Titulo, Descripcion, Fecha, Recurrencia, Intervalo,
       Recordar_Todo_El_Dia, Intervalo_Todo_El_Dia, Siguiente_Trigger,
       Estado, Activo, Entidad_Tipo, Entidad_Id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVO', 1, ?, ?)`,
    [userId, data.title, data.description, data.date, data.recurrence, data.interval,
      data.allDay ? 1 : 0, data.allDayInterval, data.date, data.entityType, data.entityId]
  );
  return getMineById(userId, result.insertId);
}

async function getMineById(userId, reminderId, connection = null, lock = false) {
  const executor = connection || db;
  const [rows] = await executor.query(
    `SELECT * FROM recordatorios WHERE Id_Recordatorio = ? AND Id_Usuario = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [reminderId, userId]
  );
  if (!rows[0]) throw new ReminderOperationError('Recordatorio no encontrado.', 404, 'REMINDER_NOT_FOUND');
  return mapReminder(rows[0]);
}

async function update(userId, reminderId, input) {
  const data = normalizeInput(input, { partial: true });
  const assignments = [];
  const values = [];
  const fields = {
    title: 'Titulo', description: 'Descripcion', date: 'Fecha', recurrence: 'Recurrencia',
    interval: 'Intervalo', allDay: 'Recordar_Todo_El_Dia', allDayInterval: 'Intervalo_Todo_El_Dia',
    entityType: 'Entidad_Tipo', entityId: 'Entidad_Id',
  };
  Object.entries(fields).forEach(([key, column]) => {
    if (!Object.hasOwn(data, key)) return;
    assignments.push(`${column} = ?`);
    values.push(key === 'allDay' ? (data[key] ? 1 : 0) : data[key]);
  });
  if (!assignments.length) throw new ReminderOperationError('No hay cambios válidos para guardar.', 422, 'REMINDER_NO_CHANGES');
  if (Object.hasOwn(data, 'date')) {
    assignments.push('Siguiente_Trigger = ?');
    values.push(data.date);
  }
  values.push(reminderId, userId);
  const [result] = await db.query(
    `UPDATE recordatorios SET ${assignments.join(', ')}
      WHERE Id_Recordatorio = ? AND Id_Usuario = ?`,
    values
  );
  if (!result.affectedRows) throw new ReminderOperationError('Recordatorio no encontrado.', 404, 'REMINDER_NOT_FOUND');
  return getMineById(userId, reminderId);
}

async function postpone(userId, reminderId, suppressedUntil) {
  const parsedUntil = new Date(suppressedUntil);
  if (!suppressedUntil || Number.isNaN(parsedUntil.getTime())) {
    throw new ReminderOperationError('La fecha para posponer no es válida.', 400, 'INVALID_REMINDER_DATE');
  }
  if (parsedUntil <= new Date()) {
    throw new ReminderOperationError('Selecciona una fecha y hora futura para posponer.', 422, 'INVALID_SUPPRESSION_DATE');
  }
  const until = toMysqlDateTime(parsedUntil);
  const [result] = await db.query(
    `UPDATE recordatorios
        SET Suprimido_Hasta = ?, Siguiente_Trigger = ?, Estado = 'ACTIVO', Activo = 1
      WHERE Id_Recordatorio = ? AND Id_Usuario = ?`,
    [until, until, reminderId, userId]
  );
  if (!result.affectedRows) throw new ReminderOperationError('Recordatorio no encontrado.', 404, 'REMINDER_NOT_FOUND');
  return getMineById(userId, reminderId);
}

async function complete(userId, reminderId) {
  const [result] = await db.query(
    `UPDATE recordatorios
        SET Estado = 'COMPLETADO', Activo = 0, Suprimido_Hasta = NULL, Siguiente_Trigger = NULL
      WHERE Id_Recordatorio = ? AND Id_Usuario = ? AND Estado = 'ACTIVO'`,
    [reminderId, userId]
  );
  if (!result.affectedRows) throw new ReminderOperationError('Recordatorio activo no encontrado.', 404, 'REMINDER_NOT_FOUND');
  return getMineById(userId, reminderId);
}

async function remove(userId, reminderId) {
  const [result] = await db.query(
    'DELETE FROM recordatorios WHERE Id_Recordatorio = ? AND Id_Usuario = ?',
    [reminderId, userId]
  );
  if (!result.affectedRows) throw new ReminderOperationError('Recordatorio no encontrado.', 404, 'REMINDER_NOT_FOUND');
  return true;
}

module.exports = {
  ReminderOperationError,
  normalizeInput,
  mapReminder,
  listMine,
  create,
  update,
  postpone,
  complete,
  remove,
};
