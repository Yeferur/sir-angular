function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function formatDateUtc(date) {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate())
  ].join('-');
}

function formatDateTimeUtc(date) {
  return [
    formatDateUtc(date),
    [
      pad2(date.getUTCHours()),
      pad2(date.getUTCMinutes()),
      pad2(date.getUTCSeconds())
    ].join(':')
  ].join(' ');
}

function normalizarFechaMysql(value, { tipo = 'datetime' } = {}) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string' && value.trim() === '') return null;

  const tipoNormalizado = String(tipo || 'datetime').toLowerCase();
  const esDate = tipoNormalizado === 'date';
  const texto = value instanceof Date ? null : String(value).trim();

  if (texto) {
    if (esDate) {
      const soloFecha = texto.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (soloFecha) return soloFecha[1];
    } else {
      const mysqlDateTime = texto.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/);
      if (mysqlDateTime && !/[TZ+-]/.test(texto.slice(10))) {
        return `${mysqlDateTime[1]} ${mysqlDateTime[2]}`;
      }
    }
  }

  const fecha = value instanceof Date ? value : new Date(value);
  if (!isValidDate(fecha)) return null;

  return esDate ? formatDateUtc(fecha) : formatDateTimeUtc(fecha);
}

module.exports = {
  normalizarFechaMysql,
};
