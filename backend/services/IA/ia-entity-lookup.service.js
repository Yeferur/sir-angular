const { pool, SQL_TIMEOUT_MS } = require('../../config/db-readonly');
const {
  buildContextPatch,
  buildIaAction,
  normalizeText,
} = require('./ia-action-builder.service');
const { extractReservationCodeCandidate } = require('./ia-query-normalizer.service');
const {
  buildPreviewBlock,
  buildPreviewItems,
  buildReservationCodeLookupText,
  prettifyLabel,
} = require('./ia-response-template.service');

function extractLookupTerm(message) {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw)
    .replace(/^que es\s+|^qué es\s+|^quien es\s+|^quién es\s+/g, '')
    .replace(/^el\s+|^la\s+|^los\s+|^las\s+/g, '')
    .replace(/[?¿!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || normalizeText(raw);
}

function extractNumericReference(message) {
  const normalized = normalizeText(message);
  const reservaMatch = normalized.match(/\breserva\s+(\d+)\b/);
  if (reservaMatch) {
    return {
      entityType: 'reservas',
      id: Number(reservaMatch[1]),
    };
  }

  const transferMatch = normalized.match(/\btransfer\s+(\d+)\b/);
  if (transferMatch) {
    return {
      entityType: 'transfers',
      id: Number(transferMatch[1]),
    };
  }

  return null;
}

function extractReservationCodeReference(message) {
  const candidate = extractReservationCodeCandidate(message);
  if (!candidate) return null;

  return {
    entityType: 'reservas',
    lookupType: 'code',
    codigo: candidate.canonical,
  };
}

async function queryReadonly(sql, params) {
  const [rows] = await pool.query({
    sql,
    values: params,
    timeout: SQL_TIMEOUT_MS,
  });

  return Array.isArray(rows) ? rows : [];
}

async function lookupByReference(reference, message) {
  if (reference.entityType === 'reservas' && reference.lookupType === 'code') {
    const rows = await queryReadonly(
      [
        'SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante, c.Nombre_Canal, t.Nombre_Tour',
        'FROM reservas r',
        'LEFT JOIN canales_reservas c ON c.Id_Canal = r.Id_Canal',
        'LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario',
        'LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour',
        "WHERE REPLACE(UPPER(r.Id_Reserva), '-', '') = ?",
        'LIMIT 5',
      ].join(' '),
      [reference.codigo]
    );

    if (!rows.length) {
      return {
        texto: buildReservationCodeLookupText({
          codigo: reference.codigo,
          found: false,
        }),
        accion: null,
      };
    }

    const accion = {
      ...buildIaAction({
        mensaje: message,
        intent: 'entity_lookup_reserva_codigo',
        entityType: 'reservas',
        expectedAction: 'buscar_reservas',
        rows,
        tables: ['reservas', 'canales_reservas', 'horarios', 'tours'],
        contexto: {},
      }),
    };

    return {
      texto: buildReservationCodeLookupText({
        codigo: String(rows[0]?.Id_Reserva || reference.codigo).trim(),
        found: true,
      }),
      accion,
      contextPatch: buildContextPatch({
        mensaje: message,
        intent: 'entity_lookup_reserva_codigo',
        entityType: 'reservas',
        rows,
        tables: ['reservas', 'canales_reservas', 'horarios', 'tours'],
        accion,
      }),
    };
  }

  if (reference.entityType === 'reservas') {
    const rows = await queryReadonly(
      [
        'SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Nombre_Reportante',
        'FROM reservas r',
        'WHERE r.Id_Reserva = ?',
        'LIMIT 5',
      ].join(' '),
      [reference.id]
    );

    if (!rows.length) return null;

    const accion = {
      ...buildIaAction({
        mensaje: message,
        intent: 'entity_lookup_reserva',
        entityType: 'reservas',
        expectedAction: 'buscar_reservas',
        rows,
        tables: ['reservas'],
        contexto: {},
      }),
    };

    return {
      texto: `Encontré la reserva ${reference.id}. Puedes abrir la reserva relacionada.`,
      accion,
      contextPatch: buildContextPatch({
        mensaje: message,
        intent: 'entity_lookup_reserva',
        entityType: 'reservas',
        rows,
        tables: ['reservas'],
        accion,
      }),
    };
  }

  if (reference.entityType === 'transfers') {
    const rows = await queryReadonly(
      [
        'SELECT tr.Id_Transfer, tr.Fecha_Transfer, tr.Estado, tr.Nombre_Titular',
        'FROM transfers tr',
        'WHERE tr.Id_Transfer = ?',
        'LIMIT 5',
      ].join(' '),
      [reference.id]
    );

    if (!rows.length) return null;

    const accion = {
      ...buildIaAction({
        mensaje: message,
        intent: 'entity_lookup_transfer',
        entityType: 'transfers',
        expectedAction: 'ver_transfers',
        rows,
        tables: ['transfers'],
        contexto: {},
      }),
    };

    return {
      texto: `Encontré el transfer ${reference.id}. Puedes abrir el detalle relacionado.`,
      accion,
      contextPatch: buildContextPatch({
        mensaje: message,
        intent: 'entity_lookup_transfer',
        entityType: 'transfers',
        rows,
        tables: ['transfers'],
        accion,
      }),
    };
  }

  return null;
}

async function lookupTours(term) {
  return queryReadonly(
    [
      'SELECT t.Id_Tour, t.Nombre_Tour, t.Abreviacion',
      'FROM tours t',
      'WHERE t.Activo = 1',
      'AND (t.Nombre_Tour LIKE ? OR t.Abreviacion LIKE ?)',
      'ORDER BY t.Nombre_Tour ASC',
      'LIMIT 5',
    ].join(' '),
    [`%${term}%`, `%${term}%`]
  );
}

async function lookupPuntos(term) {
  return queryReadonly(
    [
      'SELECT p.Id_Punto, p.Nombre_Punto, p.Sector, p.ruta',
      'FROM puntos p',
      'WHERE p.Nombre_Punto LIKE ? OR p.Sector LIKE ?',
      'ORDER BY p.Nombre_Punto ASC',
      'LIMIT 5',
    ].join(' '),
    [`%${term}%`, `%${term}%`]
  );
}

function buildTourLookupResponse({ message, term, rows, isDefinitionQuestion }) {
  const first = rows[0];
  const tourName = String(first?.Nombre_Tour || term).trim();
  const accion = buildIaAction({
    mensaje: message,
    intent: 'entity_lookup_tour',
    entityType: 'tours',
    expectedAction: 'ver_tours',
    rows,
    tables: ['tours'],
    contexto: {},
  });

  return {
    texto: isDefinitionQuestion
      ? `En SIR encontré ${prettifyLabel(tourName)} como tour. ¿Te refieres a ese tour?`
      : `Encontré ${prettifyLabel(tourName)} como tour. Puedes revisar sus cupos, reservas o abrir el tour.`,
    accion,
    contextPatch: buildContextPatch({
      mensaje: message,
      intent: 'entity_lookup_tour',
      entityType: 'tours',
      rows,
      tables: ['tours'],
      accion,
    }),
  };
}

function buildPuntoLookupResponse({ message, term, rows, isDefinitionQuestion }) {
  const accion = buildIaAction({
    mensaje: message,
    intent: 'entity_lookup_punto',
    entityType: 'puntos',
    expectedAction: 'ver_puntos',
    rows,
    tables: ['puntos'],
    contexto: {},
  });

  const preview = rows.length > 1
    ? buildPreviewBlock(buildPreviewItems(rows, 'puntos', 5))
    : '';

  return {
    texto: isDefinitionQuestion
      ? `En SIR encontré ${prettifyLabel(term)} como punto de encuentro. ¿Te refieres a ese punto?`
      : [
        rows.length === 1
          ? `Encontré un punto relacionado con ${prettifyLabel(term)}. Puedes revisar el punto encontrado.`
          : `Encontré ${rows.length} puntos relacionados con ${prettifyLabel(term)}. Te muestro las coincidencias más relevantes.`,
        preview,
      ].filter(Boolean).join('\n'),
    accion,
    contextPatch: buildContextPatch({
      mensaje: message,
      intent: 'entity_lookup_punto',
      entityType: 'puntos',
      rows,
      tables: ['puntos'],
      accion,
    }),
  };
}

async function lookupOperationalEntity({ mensaje }) {
  const reservationCodeReference = extractReservationCodeReference(mensaje);
  if (reservationCodeReference) {
    return lookupByReference(reservationCodeReference, mensaje);
  }

  const reference = extractNumericReference(mensaje);
  if (reference) {
    return lookupByReference(reference, mensaje);
  }

  const term = extractLookupTerm(mensaje);
  const isDefinitionQuestion = /^que es\b|^qué es\b/.test(normalizeText(mensaje));

  if (!term) {
    return null;
  }

  const [tours, puntos] = await Promise.all([
    lookupTours(term),
    lookupPuntos(term),
  ]);

  if (tours.length) {
    return buildTourLookupResponse({
      message: mensaje,
      term,
      rows: tours,
      isDefinitionQuestion,
    });
  }

  if (puntos.length) {
    return buildPuntoLookupResponse({
      message: mensaje,
      term,
      rows: puntos,
      isDefinitionQuestion,
    });
  }

  return null;
}

module.exports = {
  lookupOperationalEntity,
};
