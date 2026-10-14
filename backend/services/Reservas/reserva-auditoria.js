function canonical(value, { numeric = false, unordered = false } = {}) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (numeric && !Array.isArray(value) && /^-?\d+(?:\.\d+)?$/.test(String(value).trim())) {
    return Number(value);
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return canonical(JSON.parse(value), { numeric, unordered }); } catch { /* Ordinary text. */ }
  }
  if (Array.isArray(value)) {
    const values = value.map(item => canonical(item, { numeric, unordered }));
    return unordered ? values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : values;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], { numeric, unordered })]));
  }
  return value;
}

function sameHistoryValue(before, after, options) {
  return JSON.stringify(canonical(before, options)) === JSON.stringify(canonical(after, options));
}

function changedDetail(columna, anterior, nuevo, options) {
  return sameHistoryValue(anterior, nuevo, options) ? null : { columna, anterior, nuevo };
}

function uniquePointIds(points) {
  return [...new Set(points.filter(id => id != null && String(id).trim()).map(String))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

function pointLabel(id, labels) {
  if (id == null || String(id).trim() === '') return 'Sin punto de encuentro';
  return labels.get(String(id)) || `Punto #${id}`;
}

function pointSetLabel(ids, labels) {
  const unique = uniquePointIds(ids);
  return unique.length ? unique.map(id => pointLabel(id, labels)).join(' · ') : 'Sin punto de encuentro';
}

function maskedDocument(document) {
  const value = String(document || '').trim();
  return value.length > 4 ? `••••${value.slice(-4)}` : value ? 'registrado' : 'sin documento';
}

function passengerLabel(passenger) {
  return `${String(passenger.Nombre_Pasajero || '').trim() || 'Sin nombre'} (${maskedDocument(passenger.DNI)})`;
}

function passengerMatchKey(passenger, field) {
  const value = passenger?.[field];
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim().replace(/\s+/g, ' ').toLocaleUpperCase('es-CO');
}

function reconcilePassengers(previous, next) {
  const before = previous.map((passenger, index) => ({ passenger, index }));
  const after = next.map((passenger, index) => ({ passenger, index }));
  const matches = [];
  const matchBy = (field, legacyOnly = false) => {
    const countsBefore = new Map();
    const countsAfter = new Map();
    for (const item of before) {
      const key = passengerMatchKey(item.passenger, field);
      if (key) countsBefore.set(key, (countsBefore.get(key) || 0) + 1);
    }
    for (const item of after) {
      const key = legacyOnly && passengerMatchKey(item.passenger, 'Id_Pasajero')
        ? null : passengerMatchKey(item.passenger, field);
      if (key) countsAfter.set(key, (countsAfter.get(key) || 0) + 1);
    }
    for (let index = before.length - 1; index >= 0; index--) {
      const key = passengerMatchKey(before[index].passenger, field);
      if (!key || countsBefore.get(key) !== 1 || countsAfter.get(key) !== 1) continue;
      const nextIndex = after.findIndex(item => (!legacyOnly || !passengerMatchKey(item.passenger, 'Id_Pasajero'))
        && passengerMatchKey(item.passenger, field) === key);
      if (nextIndex < 0) continue;
      matches.push([before[index], after[nextIndex]]);
      before.splice(index, 1);
      after.splice(nextIndex, 1);
    }
  };
  matchBy('Id_Pasajero');
  matchBy('DNI', true);
  matchBy('Nombre_Pasajero', true);
  return { matches: matches.sort((a, b) => a[0].index - b[0].index),
    removed: before.sort((a, b) => a.index - b.index),
    added: after.sort((a, b) => a.index - b.index) };
}

function passengerChangeDetails(before, after, pointLabels) {
  const fields = [
    ['Nombre', 'Nombre_Pasajero'], ['DNI', 'DNI'], ['Nacionalidad', 'Nacionalidad'],
    ['Tipo_Pasajero', 'Tipo_Pasajero'], ['Id_Plan', 'Id_Plan', { numeric: true }],
    ['Precio_Tour', 'Precio_Tour', { numeric: true }],
    ['Precio_Pasajero', 'Precio_Pasajero', { numeric: true }],
    ['Comision', 'Comision', { numeric: true }],
    ['Confirmacion', 'Confirmacion', { numeric: true }],
  ];
  const details = fields.map(([label, key, options]) => changedDetail(label, before[key], after[key], options)).filter(Boolean);
  if (!sameHistoryValue(before.Id_Punto, after.Id_Punto, { numeric: true })) {
    details.push({ columna: 'Punto de encuentro', anterior: pointLabel(before.Id_Punto, pointLabels),
      nuevo: pointLabel(after.Id_Punto, pointLabels) });
  }
  if (!sameHistoryValue(before.Telefono_Pasajero, after.Telefono_Pasajero)) {
    details.push({ columna: 'Teléfono', anterior: '', nuevo: 'Modificado' });
  }
  return details;
}

module.exports = { sameHistoryValue, changedDetail, uniquePointIds, pointSetLabel,
  pointLabel, passengerLabel, reconcilePassengers, passengerChangeDetails };
