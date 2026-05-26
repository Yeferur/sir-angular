const ALLOWED_ACTIONS = new Set([
  'buscar_reservas',
  'ver_transfers',
  'ver_aforos',
  'ver_tours',
  'ver_puntos',
  'ver_listados',
]);

const SESSION_ENTITY_TYPE_MAP = {
  reservas: 'reserva',
  transfers: 'transfer',
  tours: 'tour',
  puntos: 'punto',
  aforos: 'operacion',
  programacion: 'operacion',
  dashboard: 'operacion',
  operacion: 'operacion',
  unknown: 'unknown',
};

const MONTHS = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function sanitizeQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getTodayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function addDaysYmd(dateYmd, days) {
  const [year, month, day] = String(dateYmd).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function extractDateFromMessage(message) {
  const normalized = normalizeText(message);
  const today = getTodayYmd();

  if (/\bpasado manana\b/.test(normalized)) return addDaysYmd(today, 2);
  if (/\bmanana\b/.test(normalized)) return addDaysYmd(today, 1);
  if (/\bhoy\b/.test(normalized)) return today;

  const isoMatch = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (slashMatch) {
    return `${slashMatch[3]}-${String(slashMatch[2]).padStart(2, '0')}-${String(slashMatch[1]).padStart(2, '0')}`;
  }

  const textMatch = normalized.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/
  );
  if (textMatch) {
    return `${textMatch[3] || today.slice(0, 4)}-${MONTHS[textMatch[2]]}-${String(textMatch[1]).padStart(2, '0')}`;
  }

  return null;
}

function messageMentionsReserva(message) {
  return /\breserva(?:s)?\b/i.test(normalizeText(message));
}

function messageMentionsTour(message) {
  return /\btour(?:es)?\b|guatape|santa fe|coffee|playa blanca|silletero|compras|luces|pablo|rio claro\b/i.test(normalizeText(message));
}

function extractIds(rows, idField) {
  return rows
    .map((row) => row?.[idField])
    .filter((value) => value !== null && value !== undefined)
    .slice(0, 10);
}

function getTourIds(rows, contexto) {
  const ids = extractIds(rows, 'Id_Tour');
  if (ids.length) return ids;
  if (contexto?.lastTourId) return [contexto.lastTourId];
  return [];
}

function buildReservaAction({ rows, message, contexto }) {
  const date = extractDateFromMessage(message) || contexto?.lastDate;
  const ids = extractIds(rows, 'Id_Reserva');
  const tourIds = getTourIds(rows, contexto);
  const firstReservationCode = rows[0]?.Id_Reserva ? String(rows[0].Id_Reserva).trim() : null;
  const normalizedMessage = normalizeText(message);
  const isSpecificReservationLookup =
    ids.length === 1 ||
    /\breserva\s+[a-z0-9-]+\b/i.test(normalizedMessage) ||
    /\b[a-z]{1,5}-?\d{3,10}\b/i.test(normalizedMessage);

  return {
    accion: 'buscar_reservas',
    label: isSpecificReservationLookup ? 'Ver reserva' : 'Ver reservas',
    datos: {
      ...(date ? { fecha: date } : {}),
      ...(isSpecificReservationLookup ? { Id_Reserva: firstReservationCode } : {}),
      ...(firstReservationCode ? { codigoReserva: firstReservationCode } : {}),
      ...(ids.length ? { ids } : {}),
      ...(tourIds.length ? { tourIds } : {}),
      query: sanitizeQuery(message).slice(0, 80),
    },
  };
}

function buildTransfersAction({ rows, message, contexto }) {
  const date = extractDateFromMessage(message) || contexto?.lastDate;
  const ids = extractIds(rows, 'Id_Transfer');

  return {
    accion: 'ver_transfers',
    label: 'Ver transfers',
    datos: {
      ...(date ? { fecha: date } : {}),
      ...(ids.length ? { ids } : {}),
    },
  };
}

function buildAforosAction({ rows, message, contexto }) {
  const date = extractDateFromMessage(message) || contexto?.lastDate || getTodayYmd();
  const tourIds = getTourIds(rows, contexto);

  return {
    accion: 'ver_aforos',
    label: 'Ver cupos',
    datos: {
      fecha: date,
      ...(tourIds.length ? { tourIds } : {}),
    },
  };
}

function buildToursAction({ rows, message, contexto }) {
  const ids = getTourIds(rows, contexto);

  return {
    accion: 'ver_tours',
    label: ids.length === 1 ? 'Ver tour' : 'Ver tours',
    datos: {
      ...(ids.length ? { ids } : {}),
      query: sanitizeQuery(message).slice(0, 80),
    },
  };
}

function buildPuntosAction({ rows, message }) {
  const ids = extractIds(rows, 'Id_Punto');
  return {
    accion: 'ver_puntos',
    label: 'Ver puntos',
    datos: {
      ...(ids.length ? { ids } : {}),
      query: sanitizeQuery(message).slice(0, 80),
    },
  };
}

function buildListadosAction({ message, contexto, fecha, tourId, tourName }) {
  const date = fecha || extractDateFromMessage(message) || contexto?.lastDate || getTodayYmd();
  return {
    accion: 'ver_listados',
    label: 'Ver listados',
    datos: {
      fecha: date,
      ...(tourId ? { tourId } : {}),
      ...(tourName ? { tourName: String(tourName).slice(0, 120) } : {}),
    },
  };
}

function inferEntityType({ entityType, tables, rows, intent, message }) {
  const normalizedEntityType = normalizeText(entityType);
  if (normalizedEntityType && normalizedEntityType !== 'unknown') {
    return normalizedEntityType;
  }

  const normalizedTables = (tables || []).map(normalizeText);
  if (normalizedTables.some((table) => table.includes('reserva'))) return 'reservas';
  if (normalizedTables.some((table) => table.includes('transfer'))) return 'transfers';
  if (normalizedTables.some((table) => table.includes('aforo'))) return 'aforos';
  if (normalizedTables.some((table) => table.includes('punto'))) return 'puntos';
  if (normalizedTables.some((table) => table.includes('tour'))) return 'tours';
  if (normalizedTables.some((table) => table.includes('programacion'))) return 'programacion';

  if (rows.length && rows[0]) {
    const keys = Object.keys(rows[0]).map(normalizeText);
    if (keys.includes('id_reserva')) return 'reservas';
    if (keys.includes('id_transfer')) return 'transfers';
    if (keys.includes('id_tour')) return 'tours';
    if (keys.includes('id_punto')) return 'puntos';
    if (keys.includes('id_aforo') || keys.includes('cupo')) return 'aforos';
  }

  const normalizedIntent = normalizeText(intent || message);
  if (/reserva/.test(normalizedIntent)) return 'reservas';
  if (/transfer/.test(normalizedIntent)) return 'transfers';
  if (/aforo|cupo/.test(normalizedIntent)) return 'aforos';
  if (/programacion|listado/.test(normalizedIntent)) return 'programacion';
  if (/operacion|operacion|diagnostico|dashboard/.test(normalizedIntent)) return 'operacion';
  if (/punto/.test(normalizedIntent)) return 'puntos';
  if (/tour/.test(normalizedIntent)) return 'tours';

  return 'unknown';
}

function dedupeActions(actions) {
  const seen = new Set();
  const result = [];

  for (const action of actions) {
    if (!action || !ALLOWED_ACTIONS.has(action.accion)) continue;
    const key = `${action.accion}:${JSON.stringify(action.datos || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }

  return result;
}

function buildIaAction({ mensaje, intent, entityType, expectedAction, rows, tables, contexto }) {
  const normalizedIntent = normalizeText(intent);
  if (normalizedIntent === 'blocked_sensitive_request') return null;

  const safeRows = Array.isArray(rows) ? rows : [];
  const inferredEntityType = inferEntityType({
    entityType,
    tables,
    rows: safeRows,
    intent,
    message: mensaje,
  });

  const ctx = {
    message: mensaje,
    rows: safeRows,
    contexto,
  };

  const normalizedExpectedAction = normalizeText(expectedAction);
  const date = extractDateFromMessage(mensaje) || contexto?.lastDate;
  const hasTourContext = Boolean(getTourIds(safeRows, contexto).length || contexto?.lastTourName);
  const isPendingPayments = /consultar_pagos|pending.*pago|pendiente.*pago/.test(normalizedIntent);

  let accionPrincipal = null;
  const acciones = [];

  if (normalizedExpectedAction === 'ver_aforos' || inferredEntityType === 'aforos') {
    accionPrincipal = buildAforosAction(ctx);
    acciones.push(accionPrincipal);
    acciones.push(buildReservaAction(ctx));
    if (hasTourContext) {
      acciones.push(buildToursAction(ctx));
    }
  } else if (normalizedExpectedAction === 'buscar_reservas' || inferredEntityType === 'reservas') {
    accionPrincipal = buildReservaAction(ctx);
    acciones.push(accionPrincipal);
    if (isPendingPayments && hasTourContext && date) {
      acciones.push(buildAforosAction(ctx));
    }
  } else if (normalizedExpectedAction === 'ver_transfers' || inferredEntityType === 'transfers') {
    accionPrincipal = buildTransfersAction(ctx);
    acciones.push(accionPrincipal);
  } else if (normalizedExpectedAction === 'ver_puntos' || inferredEntityType === 'puntos') {
    accionPrincipal = buildPuntosAction(ctx);
    acciones.push(accionPrincipal);
  } else if (normalizedExpectedAction === 'ver_tours' || inferredEntityType === 'tours') {
    accionPrincipal = buildToursAction(ctx);
    acciones.push(buildAforosAction(ctx));
    acciones.push(buildReservaAction(ctx));
    acciones.push(accionPrincipal);
  } else if (normalizedExpectedAction === 'ver_listados' || inferredEntityType === 'programacion') {
    accionPrincipal = buildListadosAction({
      message: mensaje,
      contexto,
      fecha: date,
      tourId: contexto?.lastTourId || null,
      tourName: contexto?.lastTourName || null,
    });
    acciones.push(accionPrincipal);
    acciones.push(buildReservaAction(ctx));
  } else if (normalizedExpectedAction === 'diagnosticar_operacion' || inferredEntityType === 'operacion') {
    const diagnostic = rows?.[0]?.__diagnostic || null;
    const diagnosticDate = diagnostic?.fecha || date || contexto?.lastDate || getTodayYmd();
    const diagnosticTourId = diagnostic?.tour?.id || contexto?.lastTourId || null;
    const diagnosticTourName = diagnostic?.tour?.nombre || contexto?.lastTourName || null;
    const totalTransfers = Number(diagnostic?.resumen?.totalTransfers || 0);
    const reservasSinPunto = Number(diagnostic?.resumen?.reservasSinPunto || 0);
    const listadosPendientes = Number(diagnostic?.resumen?.listadosPendientes || 0);

    accionPrincipal = {
      accion: 'buscar_reservas',
      label: 'Ver reservas',
      datos: {
        fecha: diagnosticDate,
        ...(diagnosticTourId ? { tourIds: [diagnosticTourId] } : {}),
        ...(diagnosticTourName ? { tourName: diagnosticTourName } : {}),
      },
    };
    acciones.push(accionPrincipal);
    acciones.push({
      accion: 'ver_aforos',
      label: 'Ver cupos',
      datos: {
        fecha: diagnosticDate,
        ...(diagnosticTourId ? { tourIds: [diagnosticTourId] } : {}),
      },
    });
    if (totalTransfers > 0 && !diagnosticTourId) {
      acciones.push({
        accion: 'ver_transfers',
        label: 'Ver transfers',
        datos: { fecha: diagnosticDate },
      });
    }
    if (reservasSinPunto > 0) {
      acciones.push({
        accion: 'ver_puntos',
        label: 'Ver puntos',
        datos: {
          fecha: diagnosticDate,
          query: diagnosticTourName || sanitizeQuery(mensaje).slice(0, 80),
        },
      });
    }
    if (listadosPendientes > 0 || diagnostic?.secciones?.listados?.detalles?.length) {
      acciones.push(buildListadosAction({
        message: mensaje,
        contexto,
        fecha: diagnosticDate,
        tourId: diagnosticTourId,
        tourName: diagnosticTourName,
      }));
    }
  }

  const finalActions = dedupeActions(acciones);
  const primaryAction = accionPrincipal || finalActions[0] || null;

  return {
    accion: primaryAction?.accion ?? null,
    label: primaryAction?.label ?? null,
    datos: primaryAction?.datos ?? {},
    acciones: finalActions.length > 1 ? finalActions : null,
  };
}

function buildContextPatch({ mensaje, intent, entityType, expectedAction, rows, tables, accion, contextoAnterior }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const inferredEntityType = inferEntityType({
    entityType,
    tables,
    rows: safeRows,
    intent,
    message: mensaje,
  });

  const date = extractDateFromMessage(mensaje) || contextoAnterior?.lastDate;

  const lastResults = safeRows
    .slice(0, 10)
    .map((row) => {
      const id = row?.Id_Reserva ?? row?.Id_Transfer ?? row?.Id_Tour ?? row?.Id_Punto ?? row?.Id_Aforo ?? null;
      const type = inferredEntityType !== 'unknown' ? inferredEntityType : 'unknown';
      const title = row?.Nombre_Tour ?? row?.Nombre_Titular ?? row?.Nombre_Reportante ?? row?.Nombre_Punto ?? null;
      if (id === null) return null;
      return { id, type, ...(title ? { title: String(title).slice(0, 160) } : {}) };
    })
    .filter(Boolean);

  const normalizedMessage = normalizeText(mensaje);
  const isIncompleteFilter = /\bincompleta|sin datos|falta informacion|les hace falta\b/.test(normalizedMessage);

  const lastFilters = {
    ...(date ? { fecha: date } : {}),
    ...(isIncompleteFilter ? { filtro: 'informacion_incompleta' } : {}),
    ...(accion?.datos && typeof accion.datos === 'object' ? { ...accion.datos } : {}),
  };

  let lastTourName = contextoAnterior?.lastTourName ?? null;
  let lastTourId = contextoAnterior?.lastTourId ?? null;
  if (safeRows[0]?.Nombre_Tour) lastTourName = String(safeRows[0].Nombre_Tour);
  if (safeRows[0]?.Id_Tour) lastTourId = Number(safeRows[0].Id_Tour);

  return {
    lastIntent: String(intent || '').slice(0, 300) || undefined,
    lastEntityType: SESSION_ENTITY_TYPE_MAP[inferredEntityType] ?? 'unknown',
    ...(date ? { lastDate: date } : {}),
    ...(lastTourId ? { lastTourId } : {}),
    ...(lastTourName ? { lastTourName } : {}),
    ...(lastResults.length ? { lastResults } : {}),
    lastFilters,
  };
}

module.exports = {
  buildIaAction,
  buildContextPatch,
  extractDateFromMessage,
  messageMentionsReserva,
  messageMentionsTour,
  normalizeText,
  sanitizeQuery,
};
