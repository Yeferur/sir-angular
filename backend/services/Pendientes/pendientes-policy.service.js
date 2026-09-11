const db = require('../../database/db');

const PRIORIDADES = new Set(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']);

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRule(row) {
  if (!row) return null;
  return {
    id: Number(row.Id_Regla),
    codigo: row.Codigo,
    nombre: row.Nombre,
    descripcion: row.Descripcion,
    activa: !!row.Activa,
    prioridadDefault: row.Prioridad_Default,
    recurrenciaMinutos: row.Recurrencia_Minutos == null ? null : Number(row.Recurrencia_Minutos),
    permiteDescarte: !!row.Permite_Descarte,
    requiereJustificacion: !!row.Requiere_Justificacion,
    posposicionMaxMinutos: row.Posposicion_Max_Minutos == null ? null : Number(row.Posposicion_Max_Minutos),
    ventanasUrgencia: parseJson(row.Ventanas_Urgencia, []),
    configuracion: parseJson(row.Configuracion, {}),
  };
}

async function getRuleByCode(code, connection = null) {
  const executor = connection || db;
  const [rows] = await executor.query(
    `SELECT Id_Regla, Codigo, Nombre, Descripcion, Activa, Prioridad_Default,
            Recurrencia_Minutos, Permite_Descarte, Requiere_Justificacion,
            Posposicion_Max_Minutos, Ventanas_Urgencia, Configuracion
       FROM reglas_pendientes WHERE Codigo = ? LIMIT 1`,
    [String(code || '').trim()]
  );
  return mapRule(rows[0]);
}

function priorityFor(rule, operationDate, now = new Date()) {
  let priority = PRIORIDADES.has(rule?.prioridadDefault) ? rule.prioridadDefault : 'MEDIA';
  if (!operationDate) return priority;
  const operation = new Date(operationDate);
  if (Number.isNaN(operation.getTime())) return priority;

  const remainingMinutes = Math.floor((operation.getTime() - now.getTime()) / 60000);
  const windows = Array.isArray(rule?.ventanasUrgencia) ? [...rule.ventanasUrgencia] : [];
  windows
    .filter((window) => Number.isFinite(Number(window?.minutosRestantes)) && PRIORIDADES.has(window?.prioridad))
    .sort((a, b) => Number(b.minutosRestantes) - Number(a.minutosRestantes))
    .forEach((window) => {
      if (remainingMinutes <= Number(window.minutosRestantes)) priority = window.prioridad;
    });
  return priority;
}

function nextReminderFor(rule, from = new Date()) {
  if (!rule?.recurrenciaMinutos) return null;
  return new Date(from.getTime() + Number(rule.recurrenciaMinutos) * 60000);
}

module.exports = { getRuleByCode, mapRule, priorityFor, nextReminderFor };
