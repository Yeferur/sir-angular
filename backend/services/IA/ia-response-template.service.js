const { normalizeText } = require('./ia-action-builder.service');

const PRETTY_LABEL_OVERRIDES = new Map([
  ['guatape', 'Guatapé'],
  ['rio claro', 'Río Claro'],
  ['rioclaro', 'Río Claro'],
  ['poblado', 'Poblado'],
]);

function prettifyLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = normalizeText(raw);
  if (PRETTY_LABEL_OVERRIDES.has(normalized)) {
    return PRETTY_LABEL_OVERRIDES.get(normalized);
  }

  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function humanizeDate(dateYmd) {
  if (!dateYmd) return '';
  const today = getTodayYmd();
  const tomorrow = addDaysYmd(today, 1);

  if (dateYmd === today) return 'hoy';
  if (dateYmd === tomorrow) return 'mañana';
  return dateYmd;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function buildPreviewItems(rows, entityType, max = 5) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return safeRows.slice(0, max).map((row) => {
    if (entityType === 'puntos') {
      return prettifyLabel(row?.Nombre_Punto || row?.Sector || row?.Direccion || '');
    }

    if (entityType === 'tours' || entityType === 'aforos') {
      return prettifyLabel(row?.Nombre_Tour || row?.Abreviacion || '');
    }

    if (entityType === 'reservas') {
      const id = row?.Id_Reserva ? `Reserva ${row.Id_Reserva}` : 'Reserva';
      const tour = row?.Nombre_Tour ? ` - ${prettifyLabel(row.Nombre_Tour)}` : '';
      const state = row?.Estado ? ` - ${row.Estado}` : '';
      return `${id}${tour}${state}`;
    }

    if (entityType === 'transfers') {
      const id = row?.Id_Transfer ? `Transfer ${row.Id_Transfer}` : 'Transfer';
      const titular = row?.Nombre_Titular ? ` - ${prettifyLabel(row.Nombre_Titular)}` : '';
      return `${id}${titular}`;
    }

    return prettifyLabel(
      row?.Nombre_Tour
      || row?.Nombre_Punto
      || row?.Nombre_Titular
      || row?.Nombre_Reportante
      || ''
    );
  }).filter(Boolean);
}

function buildPreviewBlock(items, heading = 'Algunas coincidencias:') {
  if (!Array.isArray(items) || !items.length) return '';
  return `${heading}\n${items.map((item) => `• ${item}`).join('\n')}`;
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function buildEmptyText({ toolName, filters = {} }) {
  const prettyQuery = prettifyLabel(filters.query || filters.tourLike || '');
  const prettyDate = humanizeDate(filters.date);

  switch (toolName) {
    case 'consultar_cupos':
      return `No encontré cupos para ${prettyQuery || 'los filtros solicitados'}${prettyDate ? ` ${prettyDate}` : ''}.`;
    case 'consultar_reservas':
      return `No encontré reservas${prettyDate ? ` para ${prettyDate}` : ''}${prettyQuery ? ` relacionadas con ${prettyQuery}` : ''}.`;
    case 'consultar_pagos':
      return `No encontré reservas pendientes de pago${prettyDate ? ` para ${prettyDate}` : ''}${prettyQuery ? ` de ${prettyQuery}` : ''}.`;
    case 'consultar_transfers':
      return `No encontré transfers${prettyDate ? ` para ${prettyDate}` : ''}.`;
    case 'consultar_puntos':
      return `No encontré puntos relacionados con ${prettyQuery || 'esa búsqueda'}.`;
    case 'consultar_tours':
      return `No encontré tours${prettyQuery ? ` relacionados con ${prettyQuery}` : ''}.`;
    default:
      return 'No encontré resultados para esa consulta.';
  }
}

function buildCountText({ toolName, total, filters = {}, rows = [] }) {
  const prettyDate = humanizeDate(filters.date);
  const prettyTour = prettifyLabel(filters.tourLike || rows[0]?.Nombre_Tour || '');

  switch (toolName) {
    case 'consultar_reservas':
      return `Hay ${total} ${pluralize(total, 'reserva')}${prettyDate ? ` para ${prettyDate}` : ''}${prettyTour ? ` de ${prettyTour}` : ''}.`;
    case 'consultar_transfers':
      return `Hay ${total} ${pluralize(total, 'transfer')}${prettyDate ? ` para ${prettyDate}` : ''}.`;
    case 'consultar_pagos':
      return `Encontré ${total} ${pluralize(total, 'reserva')} pendiente${total === 1 ? '' : 's'} de pago${prettyDate ? ` para ${prettyDate}` : ''}${prettyTour ? ` de ${prettyTour}` : ''}.`;
    default:
      return `Encontré ${total} resultado(s).`;
  }
}

function buildCuposText({ rows, filters = {} }) {
  const first = rows[0] || {};
  const prettyTour = prettifyLabel(filters.tourLike || first?.Nombre_Tour || 'ese tour');
  const prettyDate = humanizeDate(filters.date || first?.Fecha_Operacion);

  if (rows.length === 1) {
    return `Para ${prettyTour}${prettyDate ? ` ${prettyDate}` : ''} hay ${first.Cupos_Disponibles} cupos disponibles. Puedes revisar cupos o ver las reservas asociadas.`;
  }

  return `Encontré ${rows.length} tours con información de cupos${prettyDate ? ` para ${prettyDate}` : ''}. Te muestro los más relevantes.`;
}

function buildReservasText({ rows, filters = {}, toolName }) {
  const prettyDate = humanizeDate(filters.date);
  const prettyTour = prettifyLabel(filters.tourLike || rows[0]?.Nombre_Tour || '');

  if (toolName === 'consultar_pagos') {
    const text = `Encontré ${rows.length} ${pluralize(rows.length, 'reserva')} pendiente${rows.length === 1 ? '' : 's'} de pago${prettyDate ? ` para ${prettyDate}` : ''}${prettyTour ? ` de ${prettyTour}` : ''}.`;
    if (rows.length > 1) {
      return `${text} Te comparto una vista previa corta.`;
    }
    return `${text} Puedes abrir las reservas relacionadas.`;
  }

  const text = `Encontré ${rows.length} ${pluralize(rows.length, 'reserva')}${prettyDate ? ` para ${prettyDate}` : ''}${prettyTour ? ` de ${prettyTour}` : ''}.`;
  if (rows.length > 1) {
    return `${text} Te muestro una vista previa para ubicarte rápido.`;
  }
  return `${text} Puedes abrir la reserva relacionada.`;
}

function buildTransfersText({ rows, filters = {} }) {
  const prettyDate = humanizeDate(filters.date);
  const text = `Encontré ${rows.length} ${pluralize(rows.length, 'transfer')}${prettyDate ? ` para ${prettyDate}` : ''}.`;
  if (rows.length > 1) {
    return `${text} Te dejo una vista previa de los primeros resultados.`;
  }
  return `${text} Puedes abrir el detalle del transfer.`;
}

function buildPuntosText({ rows, filters = {} }) {
  const prettyQuery = prettifyLabel(filters.query || '');
  const text = `Encontré ${rows.length} ${pluralize(rows.length, 'punto')} relacionado${rows.length === 1 ? '' : 's'} con ${prettyQuery || 'esa búsqueda'}.`;
  if (rows.length > 1) {
    return `${text} Te muestro las coincidencias más relevantes.`;
  }
  return `${text} Puedes revisar el punto encontrado.`;
}

function buildToursText({ rows, filters = {} }) {
  const prettyQuery = prettifyLabel(filters.query || rows[0]?.Nombre_Tour || '');
  const text = prettyQuery
    ? `Encontré ${rows.length} ${pluralize(rows.length, 'tour')} relacionado${rows.length === 1 ? '' : 's'} con ${prettyQuery}.`
    : `Encontré ${rows.length} ${pluralize(rows.length, 'tour')} activo${rows.length === 1 ? '' : 's'}.`;
  if (rows.length > 1) {
    return `${text} Te comparto los más relevantes.`;
  }
  return `${text} Puedes revisar el tour, sus cupos o sus reservas.`;
}

function buildBuscarEntidadText({ rows, entityType, filters = {} }) {
  const label = prettifyLabel(firstNonEmpty(
    rows[0]?.Nombre_Tour,
    rows[0]?.Nombre_Punto,
    filters.query
  ));

  if (!rows.length) {
    return `No encontré coincidencias operativas para ${label || 'esa búsqueda'}.`;
  }

  if (entityType === 'tours') {
    return `Encontré ${label} como tour. Puedes revisar sus cupos, reservas o abrir el tour.`;
  }

  if (entityType === 'puntos') {
    if (rows.length > 1) {
      return `Encontré ${rows.length} puntos relacionados con ${label}. Te muestro las coincidencias más relevantes.`;
    }
    return `Encontré ${label} como punto. Puedes revisar el detalle del punto.`;
  }

  return `Encontré resultados relacionados con ${label}.`;
}

function buildDiagnosticOperationText(toolResult = {}) {
  const fecha = humanizeDate(toolResult?.fecha);
  const scope = String(toolResult?.scope || '');
  const tourName = prettifyLabel(toolResult?.tour?.nombre || toolResult?.filters?.tourLike || '');
  const summary = toolResult?.resumen || {};
  const alertas = Array.isArray(toolResult?.alertas) ? toolResult.alertas.slice(0, 5) : [];
  const recomendaciones = Array.isArray(toolResult?.recomendaciones) ? toolResult.recomendaciones.slice(0, 2) : [];
  const warnings = Array.isArray(toolResult?.warnings) ? toolResult.warnings : [];
  const toursDetalle = Array.isArray(toolResult?.toursDetalle) ? toolResult.toursDetalle.slice(0, 3) : [];

  const subject = tourName
    ? `Para ${tourName}${fecha ? ` ${fecha}` : ''}`
    : fecha
      ? `Para ${fecha}`
      : scope === 'general'
        ? 'En la operación actual'
        : 'Para la operación solicitada';

  if (alertas.length) {
    const headline = tourName
      ? `${subject} encontré ${summary.totalReservas || 0} reservas y ${summary.totalPasajeros || 0} pasajeros.`
      : `${subject} encontré ${alertas.length} punto${alertas.length === 1 ? '' : 's'} importante${alertas.length === 1 ? '' : 's'} en la operación:`;

    const alertLines = alertas.map((alerta, index) => `${index + 1}. ${alerta.mensaje}`);
    const detailLine = !tourName && toursDetalle.length
      ? `Los tours más cargados que veo son ${toursDetalle.map((tour) => `${prettifyLabel(tour.nombre)} (${tour.pasajeros} pax)`).join(', ')}.`
      : '';
    const recText = recomendaciones.length
      ? `Te recomiendo revisar primero ${recomendaciones.join(' y ').replace(/\.$/, '').toLowerCase()}.`
      : '';
    const warningText = warnings.length
      ? ' El diagnóstico es parcial en algunas secciones, pero ya te dejo lo más importante.'
      : '';

    return [headline, detailLine, ...alertLines, `${recText}${warningText}`.trim()].filter(Boolean).join('\n');
  }

  const stableLine = tourName
    ? `${subject} la operación se ve estable.`
    : `${subject} la operación se ve estable. No encontré alertas fuertes.`;

  const supportLine = summary.totalReservas || summary.totalTransfers
    ? `Veo ${summary.totalReservas || 0} reservas${summary.totalPasajeros ? `, ${summary.totalPasajeros} pasajeros` : ''} y ${summary.totalTransfers || 0} transfers en el radar.`
    : '';
  const toursLine = toursDetalle.length
    ? `En tours destacados veo ${toursDetalle.map((tour) => `${prettifyLabel(tour.nombre)} con ${tour.pasajeros} pasajero${tour.pasajeros === 1 ? '' : 's'}`).join(', ')}.`
    : '';

  const fallbackRecommendation = recomendaciones[0]
    || 'Aun así, te recomiendo revisar reservas nuevas, pagos recientes y listados antes de cerrar la programación.';

  const warningLine = warnings.length
    ? 'Algunas secciones no respondieron, así que este panorama es parcial.'
    : '';

  return [stableLine, supportLine, toursLine, fallbackRecommendation, warningLine].filter(Boolean).join(' ');
}

function buildProgramacionText(toolResult = {}) {
  const resumen = toolResult?.resumen || {};
  const fecha = humanizeDate(toolResult?.fecha || toolResult?.filters?.date);
  if (toolResult?.exists) {
    return `Encontré ${resumen.total || 0} bus${Number(resumen.total || 0) === 1 ? '' : 'es'} en el listado${fecha ? ` de ${fecha}` : ''}. Puedes abrir los listados para revisarlos.`;
  }
  return `Preparé una propuesta logística${fecha ? ` para ${fecha}` : ''} con ${resumen.totalBuses || 0} buses, ${resumen.totalReservas || 0} reservas y ${resumen.totalPasajeros || 0} pasajeros.`;
}

function buildPuntosRutaText(toolResult = {}) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const ruta = toolResult?.filters?.ruta;
  if (ruta) {
    return `Encontré ${rows.length} punto${rows.length === 1 ? '' : 's'} en la ruta ${ruta}.`;
  }
  return `Encontré ${rows.length} ruta${rows.length === 1 ? '' : 's'} de puntos disponibles.`;
}

function buildReservaDirectText(toolResult = {}) {
  const row = Array.isArray(toolResult?.rows) ? toolResult.rows[0] : null;
  if (!row) {
    return 'No encontré una reserva con ese código.';
  }
  return `Encontré la reserva ${row.Id_Reserva} para ${humanizeDate(row.Fecha_Tour)}${row.Nombre_Tour ? ` en ${prettifyLabel(row.Nombre_Tour)}` : ''}. Estado actual: ${row.Estado || 'Sin estado'}.`;
}

function buildTransferDirectText(toolResult = {}) {
  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  if (!rows.length) {
    return 'No encontré transfers para esa consulta.';
  }
  if (toolResult?.filters?.query) {
    const row = rows[0];
    return `Encontré el transfer ${row.Codigo_Transfer || row.Id_Transfer} para ${humanizeDate(row.Fecha_Transfer)}. Estado actual: ${row.Estado || 'Sin estado'}.`;
  }
  return `Encontré ${rows.length} transfer${rows.length === 1 ? '' : 's'}${toolResult?.filters?.date ? ` para ${humanizeDate(toolResult.filters.date)}` : ''}.`;
}

function buildResponseText({ toolName, entityType, rows, filters = {} }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (toolName === 'diagnosticar_operacion') {
    return '';
  }
  if (!safeRows.length) {
    return buildEmptyText({ toolName, filters });
  }

  if (filters.countOnly && Number.isFinite(Number(safeRows[0]?.total))) {
    return buildCountText({ toolName, total: Number(safeRows[0].total), filters, rows: safeRows });
  }

  switch (toolName) {
    case 'consultar_cupos':
      return buildCuposText({ rows: safeRows, filters });
    case 'consultar_reservas':
    case 'consultar_pagos':
      return buildReservasText({ rows: safeRows, filters, toolName });
    case 'consultar_transfers':
      return buildTransfersText({ rows: safeRows, filters });
    case 'consultar_puntos':
      return buildPuntosText({ rows: safeRows, filters });
    case 'consultar_tours':
      return buildToursText({ rows: safeRows, filters });
    case 'buscar_entidad':
      return buildBuscarEntidadText({ rows: safeRows, entityType, filters });
    default:
      return `Encontré ${safeRows.length} resultado(s).`;
  }
}

function buildToolResponseText({ toolName, toolResult }) {
  if (toolName === 'diagnosticar_operacion') {
    return buildDiagnosticOperationText(toolResult);
  }
  if (toolName === 'simular_listado_buses' || toolName === 'consultar_listado_generado') {
    return buildProgramacionText(toolResult);
  }
  if (toolName === 'consultar_puntos_por_ruta' || toolName === 'consultar_rutas_puntos') {
    return buildPuntosRutaText(toolResult);
  }
  if (toolName === 'consultar_reserva_por_codigo') {
    return buildReservaDirectText(toolResult);
  }
  if (toolName === 'consultar_transfer_por_codigo' || toolName === 'consultar_transfers_fecha' || toolName === 'consultar_transfers_pendientes_pago') {
    return buildTransferDirectText(toolResult);
  }

  const rows = Array.isArray(toolResult?.rows) ? toolResult.rows : [];
  const filters = toolResult?.filters || {};
  const entityType = toolResult?.entityType || 'unknown';
  const text = buildResponseText({ toolName, entityType, rows, filters });

  const previewItems = !filters.countOnly && rows.length > 1
    ? buildPreviewItems(rows, entityType, 5)
    : [];

  const previewBlock = previewItems.length
    ? buildPreviewBlock(previewItems)
    : '';

  return [text, previewBlock].filter(Boolean).join('\n');
}

function buildCapabilitiesHelpText() {
  return 'Puedo ayudarte a consultar reservas, tours, transfers, puntos, cupos y pagos. Más adelante podré ayudarte con gráficos, listados de buses, borradores de reservas y alertas inteligentes.';
}

function buildReservationCodeLookupText({ codigo, found }) {
  if (found) {
    return `Encontré la reserva ${codigo}. Puedes abrirla para revisar sus datos, pasajeros, pagos o estado.`;
  }

  return `No encontré una reserva con el código ${codigo}. Verifica si el código está bien escrito o busca por nombre, documento o tour.`;
}

function sanitizePlannerNaturalReply(reply, fallback) {
  const raw = String(reply || '').trim();
  if (!raw) {
    return fallback;
  }

  let sanitized = raw
    .replace(/\bSIR-IA\b/gi, 'Maxi')
    .replace(/\bsoy un modelo de(?: lenguaje)?\b/gi, 'soy Maxi')
    .replace(/\bcomo modelo de IA\b/gi, 'como Maxi')
    .replace(/\binternet\b/gi, 'fuentes externas')
    .replace(/\bOllama\b/gi, 'mi sistema')
    .replace(/\bGemma\b/gi, 'mi sistema');

  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  if (!sanitized) {
    return fallback;
  }

  if (!/\b(maxi|sir|maxitours|reserva|reservas|tour|tours|transfer|transfers|punto|puntos|cupo|cupos|pago|pagos|operacion)\b/i.test(sanitized)) {
    return `${sanitized} Si quieres, revisamos reservas, tours, transfers, puntos, cupos o pagos en SIR.`;
  }

  return sanitized;
}

function buildConversationalResponse(intent, context = {}) {
  switch (intent) {
    case 'greeting':
      return 'Hola, soy Maxi. Estoy listo para ayudarte con la operación de SIR. Puedes preguntarme por reservas, cupos, tours, transfers, puntos o pagos.';
    case 'wellbeing':
      return 'Estoy bien y listo para ayudarte con SIR. ¿Quieres revisar reservas, cupos, transfers, puntos o pagos?';
    case 'identity':
      return 'Soy Maxi, el asistente operativo de SIR. Estoy aquí para ayudarte a consultar información, encontrar reservas, revisar cupos y apoyar la operación diaria.';
    case 'thanks':
      return 'Con gusto. Cuando necesites revisar algo de SIR, dime y te ayudo.';
    case 'goodbye':
      return 'Listo. Estaré aquí cuando necesites revisar la operación.';
    case 'help_capabilities':
      return buildCapabilitiesHelpText();
    case 'acknowledgement':
      return 'Perfecto. Dime qué necesitas revisar en SIR.';
    case 'ambiguous_smalltalk':
      if (context?.reason === 'sir_only_redirect') {
        return 'Estoy enfocada en ayudarte con la operación de SIR: reservas, tours, transfers, puntos, cupos y pagos.';
      }
      return 'Te puedo ayudar con la operación de SIR. Por ejemplo: reservas de Guatapé mañana, cupos disponibles, puntos del Poblado o la reserva TG10146.';
    default:
      return 'Estoy enfocada en ayudarte con la operación de SIR: reservas, tours, transfers, puntos, cupos y pagos.';
  }
}

module.exports = {
  buildCapabilitiesHelpText,
  buildConversationalResponse,
  buildDiagnosticOperationText,
  buildReservationCodeLookupText,
  sanitizePlannerNaturalReply,
  buildToolResponseText,
  buildPreviewItems,
  buildPreviewBlock,
  humanizeDate,
  prettifyLabel,
};
