const crypto = require('crypto');
const db = require('../../database/db');
const pendingService = require('../Pendientes/pendientes.service');
const { usersWithPermissions } = require('../Pendientes/pendientes-trigger.service');
const notifications = require('../Notificaciones/notificaciones.service');
const websocketManager = require('../../websocketManager');

const RULE_CODE = 'PROGRAMACION_CAMBIOS_OPERATIVOS';
const REQUIRED_PERMISSIONS = ['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR'];
const AUDIENCE_PERMISSION = REQUIRED_PERMISSIONS.join('&');
const ACTIVE_RESERVATION_STATES = new Set([
  'ACTIVA', 'ACTIVO', 'PENDIENTE', 'PENDIENTEDATOS', 'CONFIRMADA', 'COMPLETADA',
]);

const SNAPSHOT_FIELDS = [
  ['NumeroPasajeros', 'Pasajeros', 'Num_Pasajeros_Snap'],
  ['Id_Tour', 'Tour', 'Id_Tour_Snap'],
  ['Fecha_Tour', 'Fecha', 'Fecha_Tour_Snap'],
  ['Estado', 'Estado', 'Estado_Snap'],
  ['Tipo_Reserva', 'Tipo de reserva', 'Tipo_Reserva_Snap'],
  ['Nombre_Reportante', 'Titular', 'Nombre_Reportante_Snap'],
  ['Idioma_Reserva', 'Idioma', 'Idioma_Reserva_Snap'],
  ['Observaciones', 'Notas', 'Observaciones_Snap'],
  ['Id_Punto', 'Punto principal', 'Id_Punto_Principal_Snap'],
];

const HISTORY_LABELS = new Map([
  ['Id_Horario', 'Horario'],
  ['Hora_Salida', 'Hora de salida'],
  ['Puntos_Recogida', 'Puntos de recogida'],
  ['NumeroPasajeros', 'Pasajeros'],
  ['Id_Tour', 'Tour'],
  ['Fecha_Tour', 'Fecha'],
  ['Estado', 'Estado'],
  ['Tipo_Reserva', 'Tipo de reserva'],
  ['Nombre_Reportante', 'Titular'],
  ['Idioma_Reserva', 'Idioma'],
  ['Observaciones', 'Notas'],
]);

function normalizeDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String).sort());
    } catch { /* CSV o texto normal */ }
    if (/^\d+(,\d+)*$/.test(value)) return JSON.stringify(value.split(',').sort());
  }
  return String(value).trim();
}

function formatValue(value) {
  if (value == null || value === '') return 'Sin dato';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.length ? parsed.join(', ') : 'Sin puntos';
    } catch { /* texto normal */ }
  }
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function makeChange(field, label, before, current, revision = null) {
  if (normalizeValue(before) === normalizeValue(current)) return null;
  return {
    campo: label,
    anterior: formatValue(before),
    actual: formatValue(current),
    revision: revision == null ? null : Number(revision),
  };
}

function isActiveReservation(state) {
  return ACTIVE_RESERVATION_STATES.has(String(state || '').trim().toUpperCase().replace(/\s+/g, ''));
}

function summarizeHistory(history = []) {
  const summaries = new Map();
  for (const event of history) {
    if (normalizeValue(event.anterior) === normalizeValue(event.nuevo)) continue;
    if (!summaries.has(event.campo)) {
      summaries.set(event.campo, { anterior: event.anterior, nuevo: event.nuevo, id: event.id });
    } else {
      const summary = summaries.get(event.campo);
      summary.nuevo = event.nuevo;
      summary.id = event.id;
    }
  }
  for (const [field, summary] of summaries) {
    if (normalizeValue(summary.anterior) === normalizeValue(summary.nuevo)) summaries.delete(field);
  }
  return summaries;
}

function groupByTour(changes) {
  const grouped = new Map();
  for (const change of changes) {
    const tourId = String(change.tourId || 'sin-tour');
    if (!grouped.has(tourId)) grouped.set(tourId, {
      tourId: change.tourId || null,
      tourName: change.tourName || `Tour ${tourId}`,
      novedades: [],
    });
    grouped.get(tourId).novedades.push(change.novedad);
  }
  return [...grouped.values()].sort((a, b) => String(a.tourId).localeCompare(String(b.tourId)));
}

function changedReservation(snapshot, current, history = []) {
  const id = String(snapshot.Id_Reserva || snapshot.idReserva || current?.Id_Reserva || '');
  const changes = [];
  const historyByField = summarizeHistory(history);

  if (!current) {
    changes.push({ campo: 'Reserva', anterior: 'Incluida en el listado guardado', actual: 'Ya no está disponible', revision: null });
  } else {
    for (const [field, label, snapshotKey] of SNAPSHOT_FIELDS) {
      const currentKey = field === 'NumeroPasajeros' ? 'NumeroPasajeros'
        : field === 'Id_Tour' ? 'Id_Tour'
          : field === 'Id_Punto' ? 'Id_Punto_Principal'
            : field;
      let before = snapshot[snapshotKey];
      let now = current[currentKey];
      if (field === 'Fecha_Tour') {
        before = normalizeDate(before);
        now = normalizeDate(now);
      }
      const audit = historyByField.get(field);
      const revision = audit && normalizeValue(audit.nuevo) === normalizeValue(now) ? audit.id : null;
      const change = makeChange(field, label, before, now, revision);
      if (change) changes.push(change);
    }
  }

  const represented = new Set(changes.map((change) => change.campo));
  const historyOnlyFields = new Set(['Id_Horario', 'Hora_Salida', 'Puntos_Recogida']);
  for (const field of historyOnlyFields) {
    const audit = historyByField.get(field);
    if (!audit || represented.has(HISTORY_LABELS.get(field))) continue;
    const currentValue = field === 'Id_Horario' ? current?.Id_Horario
      : field === 'Hora_Salida' ? current?.Hora_Salida
        : current?.Puntos_Recogida;
    if (current && normalizeValue(audit.nuevo) !== normalizeValue(currentValue)) continue;
    const change = makeChange(field, HISTORY_LABELS.get(field), audit.anterior, audit.nuevo, audit.id);
    if (change) changes.push(change);
  }

  if (!changes.length) return null;
  return {
    reservationId: id,
    changes,
    revision: changes.map((change) => change.revision).filter(Boolean).sort((a, b) => a - b).at(-1) || null,
  };
}

function newReservation(current, history = []) {
  const historyRevision = history
    .filter((event) => normalizeValue(event.anterior) !== normalizeValue(event.nuevo))
    .map((event) => Number(event.id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .at(-1) || null;
  const changes = [
    { campo: 'Reserva', anterior: 'No estaba en el listado guardado', actual: 'Nueva reserva', revision: historyRevision },
    { campo: 'Pasajeros', anterior: 'Sin dato', actual: String(current.NumeroPasajeros || 0), revision: historyRevision },
    { campo: 'Fecha', anterior: 'Sin dato', actual: normalizeDate(current.Fecha_Tour), revision: historyRevision },
    { campo: 'Tour', anterior: 'Sin dato', actual: String(current.Nombre_Tour || current.Id_Tour || 'Sin dato'), revision: historyRevision },
    { campo: 'Estado', anterior: 'Sin dato', actual: String(current.Estado || 'Sin dato'), revision: historyRevision },
    { campo: 'Punto principal', anterior: 'Sin dato', actual: String(current.Nombre_Punto_Principal || current.Id_Punto_Principal || 'Sin dato'), revision: historyRevision },
  ];
  for (const [field, label] of [['Hora_Salida', 'Hora de salida'], ['Idioma_Reserva', 'Idioma'], ['Observaciones', 'Notas']]) {
    if (current[field]) changes.push({ campo: label, anterior: 'Sin dato', actual: formatValue(current[field]), revision: historyRevision });
  }
  return { reservationId: String(current.Id_Reserva), changes, revision: historyRevision };
}

function buildGroupChangeSets({ snapshots, currentRows, historyByReservation, program }) {
  const snapshotsById = new Map((snapshots || []).map((row) => [String(row.Id_Reserva), row]));
  const currentById = new Map((currentRows || []).map((row) => [String(row.Id_Reserva), row]));
  const changes = [];

  for (const [id, snapshot] of snapshotsById) {
    const current = currentById.get(id);
      const history = historyByReservation?.get(id) || [];
    const result = changedReservation(snapshot, current, history);
    if (result) {
      const tourId = snapshot.Id_Tour_Snap || current?.Id_Tour || null;
      changes.push({ tourId, tourName: current?.Nombre_Tour || snapshot.Nombre_Tour || `Tour ${tourId || ''}`, novedad: result });
    }
  }

  const scheduledTours = new Set((program.tours || []).map((tour) => String(tour.Id_Tour)));
  for (const [id, current] of currentById) {
    if (snapshotsById.has(id) || !isActiveReservation(current.Estado)) continue;
    if (normalizeDate(current.Fecha_Tour) !== normalizeDate(program.fecha)) continue;
    if (scheduledTours.size && !scheduledTours.has(String(current.Id_Tour))) continue;
    changes.push({
      tourId: current.Id_Tour,
      tourName: current.Nombre_Tour || `Tour ${current.Id_Tour}`,
      novedad: newReservation(current, historyByReservation?.get(id) || []),
    });
  }

  return groupByTour(changes);
}

function buildPrivateChangeSets({ snapshots, currentRows, historyByReservation, program }) {
  const savedById = new Map((snapshots || []).map((row) => [String(row.Id_Reserva_Privada), row]));
  const currentById = new Map((currentRows || []).map((row) => [String(row.Id_Reserva), row]));
  const changes = [];

  for (const [id, snapshot] of savedById) {
    const current = currentById.get(id);
    const history = historyByReservation?.get(id) || [];
    const previousTour = [...history].reverse().find((event) => (
      event.campo === 'Id_Tour' && normalizeValue(event.anterior)
    ))?.anterior;
    const onlyProgramTour = (program.tours || []).length === 1 ? program.tours[0] : null;
    const tourId = current?.Id_Tour || previousTour || onlyProgramTour?.Id_Tour || null;
    const tourName = current?.Nombre_Tour
      || (program.tours || []).find((tour) => String(tour.Id_Tour) === String(tourId))?.Nombre_Tour
      || `Tour ${tourId || ''}`;
    let result;
    if (!current) {
      result = { reservationId: id, changes: [{ campo: 'Reserva privada', anterior: 'Incluida en la programación guardada', actual: 'Ya no está disponible', revision: null }], revision: null };
    } else {
      const auditFields = summarizeHistory(history);
      const privateChanges = [];
      const paxChange = makeChange('NumeroPasajeros', 'Pasajeros', snapshot.NumeroPasajeros_Snap, current.NumeroPasajeros,
        auditFields.get('NumeroPasajeros')?.id || null);
      if (paxChange) privateChanges.push(paxChange);
      for (const field of ['Id_Tour', 'Fecha_Tour', 'Estado', 'Tipo_Reserva', 'Nombre_Reportante', 'Idioma_Reserva', 'Observaciones', 'Id_Horario', 'Hora_Salida', 'Puntos_Recogida']) {
        const audit = auditFields.get(field);
        if (!audit) continue;
        const currentField = field === 'Puntos_Recogida' ? current.Puntos_Recogida : current[field];
        if (normalizeValue(audit.nuevo) !== normalizeValue(currentField)) continue;
        const change = makeChange(field, HISTORY_LABELS.get(field) || field, audit.anterior, audit.nuevo, audit.id);
        if (change) privateChanges.push(change);
      }
      result = privateChanges.length ? {
        reservationId: id,
        changes: privateChanges,
        revision: privateChanges.map((change) => change.revision).filter(Boolean).sort((a, b) => a - b).at(-1) || null,
      } : null;
    }
    if (result) changes.push({
      tourId,
      tourName,
      novedad: result,
    });
  }

  for (const [id, current] of currentById) {
    if (savedById.has(id) || !isActiveReservation(current.Estado)) continue;
    if (normalizeDate(current.Fecha_Tour) !== normalizeDate(program.fecha)) continue;
    changes.push({
      tourId: current.Id_Tour,
      tourName: current.Nombre_Tour || `Tour ${current.Id_Tour}`,
      novedad: newReservation(current, historyByReservation?.get(id) || []),
    });
  }
  return groupByTour(changes);
}

function buildDeduplicationKey({ fecha, programId, tourId, userId, novedades }) {
  const signature = novedades.map((item) => ({
    reservationId: item.reservationId,
    changes: item.changes.map((change) => [change.campo, change.anterior, change.actual, change.revision]),
  }));
  const digest = crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex').slice(0, 24);
  return `PROGRAMACION_CAMBIO:${fecha}:${programId}:${tourId}:${userId}:${digest}`.slice(0, 191);
}

function toDateLabel(value) {
  const date = normalizeDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function findPrograms(connection, { fecha, reservationId = null }) {
  const params = [];
  let condition = 'p.Fecha_Tour = ?';
  params.push(fecha);
  if (reservationId) {
    condition = `(${condition} OR EXISTS (
      SELECT 1 FROM programacion_buses pbx
      INNER JOIN programacion_reservas prx ON prx.Id_Bus_Prog = pbx.Id_Bus_Prog
      WHERE pbx.Id_Programacion = p.Id_Programacion AND prx.Id_Reserva = ?
    ) OR EXISTS (
      SELECT 1 FROM programacion_buses pbp
      WHERE pbp.Id_Programacion = p.Id_Programacion
        AND pbp.Tipo_Bus = 'privado'
        AND pbp.Id_Reserva_Privada = ?
    ))`;
    params.push(String(reservationId));
    params.push(String(reservationId));
  }
  const [rows] = await connection.query(
    `SELECT p.Id_Programacion, p.Fecha_Tour, p.Confirmado_En, p.Tipo_Programacion,
            pt.Id_Tour, t.Nombre_Tour
       FROM programaciones p
       LEFT JOIN programacion_tours pt ON pt.Id_Programacion = p.Id_Programacion
       LEFT JOIN tours t ON t.Id_Tour = pt.Id_Tour
      WHERE p.Estado = 'activa' AND ${condition}
      ORDER BY p.Id_Programacion, pt.Id_Tour`,
    params
  );
  const programs = new Map();
  for (const row of rows || []) {
    const key = String(row.Id_Programacion);
    if (!programs.has(key)) programs.set(key, {
      id: row.Id_Programacion,
      fecha: normalizeDate(row.Fecha_Tour),
      confirmadoEn: row.Confirmado_En,
      tipo: String(row.Tipo_Programacion || 'grupal').toLowerCase(),
      tours: [],
    });
    if (row.Id_Tour != null) programs.get(key).tours.push({ Id_Tour: row.Id_Tour, Nombre_Tour: row.Nombre_Tour });
  }
  return [...programs.values()];
}

async function loadGroupRows(connection, program) {
  const [snapshots] = await connection.query(
    `SELECT pr.Id_Reserva, pr.Num_Pasajeros_Snap, pr.Id_Tour_Snap, pr.Fecha_Tour_Snap,
            pr.Estado_Snap, pr.Tipo_Reserva_Snap, pr.Nombre_Reportante_Snap,
            pr.Idioma_Reserva_Snap, pr.Observaciones_Snap, pr.Id_Punto_Principal_Snap,
            t.Nombre_Tour
       FROM programacion_buses pb
       INNER JOIN programacion_reservas pr ON pr.Id_Bus_Prog = pb.Id_Bus_Prog
       LEFT JOIN tours t ON t.Id_Tour = pr.Id_Tour_Snap
      WHERE pb.Id_Programacion = ?`,
    [program.id]
  );
  const ids = [...new Set((snapshots || []).map((row) => String(row.Id_Reserva)))];
  const tourIds = [...new Set((program.tours || []).map((tour) => Number(tour.Id_Tour)).filter(Number.isFinite))];
  const scopes = [];
  const params = [];
  if (ids.length) {
    scopes.push('r.Id_Reserva IN (?)');
    params.push(ids);
  }
  if (tourIds.length) {
    scopes.push('(r.Fecha_Tour = ? AND h.Id_Tour IN (?))');
    params.push(program.fecha, tourIds);
  }
  if (!scopes.length) return { snapshots: snapshots || [], currentRows: [] };
  const scope = `(${scopes.join(' OR ')})`;
  const [currentRows] = await connection.query(
    `SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, r.Nombre_Reportante,
            r.Idioma_Reserva, r.Observaciones, h.Id_Tour, h.Id_Horario, h.Hora_Salida,
            t.Nombre_Tour,
            COUNT(DISTINCT pas.Id_Pasajero) AS NumeroPasajeros,
            GROUP_CONCAT(DISTINCT CAST(pas.Id_Punto AS CHAR) ORDER BY pas.Id_Punto SEPARATOR ',') AS Puntos_Recogida,
            (SELECT p2.Id_Punto FROM pasajeros p2 WHERE p2.Id_Reserva = r.Id_Reserva
              ORDER BY p2.Id_Pasajero ASC LIMIT 1) AS Id_Punto_Principal,
            (SELECT p3.Nombre_Punto FROM pasajeros p2
              INNER JOIN puntos p3 ON p3.Id_Punto = p2.Id_Punto
              WHERE p2.Id_Reserva = r.Id_Reserva ORDER BY p2.Id_Pasajero ASC LIMIT 1) AS Nombre_Punto_Principal
       FROM reservas r
       LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
       LEFT JOIN pasajeros pas ON pas.Id_Reserva = r.Id_Reserva
      WHERE UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'GRUPAL'
        AND ${scope}
      GROUP BY r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, r.Nombre_Reportante,
               r.Idioma_Reserva, r.Observaciones, h.Id_Tour, h.Id_Horario,
               h.Hora_Salida, t.Nombre_Tour
      ORDER BY r.Id_Reserva`,
    params
  );
  return { snapshots: snapshots || [], currentRows: currentRows || [] };
}

async function loadPrivateRows(connection, program) {
  const [snapshots] = await connection.query(
    `SELECT pb.Id_Reserva_Privada, SUM(pb.Pasajeros_Total) AS NumeroPasajeros_Snap
       FROM programacion_buses pb
      WHERE pb.Id_Programacion = ? AND pb.Tipo_Bus = 'privado'
        AND pb.Id_Reserva_Privada IS NOT NULL
      GROUP BY pb.Id_Reserva_Privada`,
    [program.id]
  );
  const ids = [...new Set((snapshots || []).map((row) => String(row.Id_Reserva_Privada)))];
  const scope = ids.length ? '(r.Id_Reserva IN (?) OR r.Fecha_Tour = ?)' : 'r.Fecha_Tour = ?';
  const params = ids.length ? [ids, program.fecha] : [program.fecha];
  const [currentRows] = await connection.query(
    `SELECT r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, r.Nombre_Reportante,
            r.Idioma_Reserva, r.Observaciones, h.Id_Tour, h.Id_Horario, h.Hora_Salida,
            t.Nombre_Tour, COUNT(DISTINCT pas.Id_Pasajero) AS NumeroPasajeros,
            GROUP_CONCAT(DISTINCT CAST(pas.Id_Punto AS CHAR) ORDER BY pas.Id_Punto SEPARATOR ',') AS Puntos_Recogida,
            (SELECT p2.Id_Punto FROM pasajeros p2 WHERE p2.Id_Reserva = r.Id_Reserva
              ORDER BY p2.Id_Pasajero ASC LIMIT 1) AS Id_Punto_Principal
       FROM reservas r
       LEFT JOIN horarios h ON h.Id_Horario = r.Id_Horario
       LEFT JOIN tours t ON t.Id_Tour = h.Id_Tour
       LEFT JOIN pasajeros pas ON pas.Id_Reserva = r.Id_Reserva
      WHERE UPPER(TRIM(COALESCE(r.Tipo_Reserva, ''))) = 'PRIVADA' AND ${scope}
      GROUP BY r.Id_Reserva, r.Fecha_Tour, r.Estado, r.Tipo_Reserva, r.Nombre_Reportante,
               r.Idioma_Reserva, r.Observaciones, h.Id_Tour, h.Id_Horario,
               h.Hora_Salida, t.Nombre_Tour
      ORDER BY r.Id_Reserva`,
    params
  );
  return { snapshots: snapshots || [], currentRows: currentRows || [] };
}

async function loadHistory(connection, program, reservationIds) {
  const ids = [...new Set((reservationIds || []).map(String).filter(Boolean))];
  if (!ids.length || !program.confirmadoEn) return new Map();
  const [rows] = await connection.query(
    `SELECT h.Id_Historial, h.Id_Registro, d.Columna, d.Valor_Anterior, d.Valor_Nuevo
       FROM historial h
       INNER JOIN detalle_historial d ON d.Id_Historial = h.Id_Historial
      WHERE h.Tabla = 'reservas' AND h.Id_Registro IN (?)
        AND h.Fecha_Hora_Registro >= ?
        AND d.Columna IN ('Id_Horario', 'Hora_Salida', 'Puntos_Recogida', 'NumeroPasajeros',
                          'Id_Tour', 'Fecha_Tour', 'Estado', 'Tipo_Reserva', 'Nombre_Reportante',
                          'Idioma_Reserva', 'Observaciones')
      ORDER BY h.Id_Historial ASC, d.Id_Detalle ASC`,
    [ids, program.confirmadoEn]
  );
  const result = new Map();
  for (const row of rows || []) {
    const id = String(row.Id_Registro);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push({
      id: Number(row.Id_Historial),
      campo: String(row.Columna),
      anterior: row.Valor_Anterior,
      nuevo: row.Valor_Nuevo,
    });
  }
  return result;
}

function cleanNovedades(novedades) {
  return novedades.map((item) => ({
    reservationId: item.reservationId,
    changes: item.changes.map(({ campo, anterior, actual, revision }) => ({ campo, anterior, actual, revision })),
  }));
}

async function syncProgram(connection, program, eligibleUsers, delivered) {
  const loaded = program.tipo === 'privada'
    ? await loadPrivateRows(connection, program)
    : await loadGroupRows(connection, program);
  const ids = [
    ...loaded.snapshots.map((row) => row.Id_Reserva || row.Id_Reserva_Privada),
    ...loaded.currentRows.map((row) => row.Id_Reserva),
  ];
  const historyByReservation = await loadHistory(connection, program, ids);
  const grouped = program.tipo === 'privada'
    ? buildPrivateChangeSets({ ...loaded, historyByReservation, program })
    : buildGroupChangeSets({ ...loaded, historyByReservation, program });
  const expectedKeys = new Set();

  for (const group of grouped) {
    const tourId = group.tourId || 'sin-tour';
    const novedades = cleanNovedades(group.novedades);
    for (const userId of eligibleUsers) {
      const deduplicationKey = buildDeduplicationKey({
        fecha: program.fecha,
        programId: program.id,
        tourId,
        userId,
        novedades,
      });
      expectedKeys.add(deduplicationKey);
      const result = await pendingService.upsertCondition({
        ruleCode: RULE_CODE,
        deduplicationKey,
        entityType: 'PROGRAMACION_CAMBIO',
        entityId: `${program.fecha}:${program.id}:${tourId}`,
        userId,
        audiencePermission: AUDIENCE_PERMISSION,
        title: `Novedades de Programación: ${group.tourName}`.slice(0, 160),
        description: `${novedades.length} reserva${novedades.length === 1 ? '' : 's'} requiere${novedades.length === 1 ? '' : 'n'} revisión en el listado guardado.`,
        operationDate: program.fecha,
        data: {
          fecha: program.fecha,
          programacionId: String(program.id),
          tourId: group.tourId,
          tourName: group.tourName,
          novedades,
          ruta: `/Programacion/Listado?fecha=${program.fecha}`,
        },
      }, connection);

      if (result.eventType === 'DETECTADO' || result.eventType === 'REACTIVADO') {
        delivered.add(Number(userId));
        const notificationId = await notifications.createNotification(connection, {
          userId,
          type: 'PENDIENTE',
          title: `Novedades en ${group.tourName}`,
          message: `${novedades.length} reserva${novedades.length === 1 ? '' : 's'} cambió${novedades.length === 1 ? '' : 'n'} después de guardar la programación.`,
          entityType: 'PROGRAMACION_CAMBIO',
          entityId: `${program.fecha}:${program.id}:${tourId}`,
          data: { fecha: program.fecha, pendienteId: result.idPendiente, ruta: `/Programacion/Listado?fecha=${program.fecha}` },
        });
        delivered.notifications.push({ userId: Number(userId), notificationId });
      }
    }
  }
  return expectedKeys;
}

async function resolveStaleForDate(connection, fecha, expectedKeys, eligibleUsers, delivered) {
  const [rows] = await connection.query(
    `SELECT p.Id_Pendiente, p.Clave_Deduplicacion, p.Id_Usuario_Destino
       FROM pendientes_operativos p
       INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla
      WHERE r.Codigo = ? AND p.Estado = 'ACTIVO'
        AND p.Entidad_Tipo = 'PROGRAMACION_CAMBIO'
        AND JSON_UNQUOTE(JSON_EXTRACT(p.Datos, '$.fecha')) = ?`,
    [RULE_CODE, fecha]
  );
  for (const row of rows || []) {
    if (expectedKeys.has(row.Clave_Deduplicacion)) continue;
    await pendingService.resolveCondition(row.Clave_Deduplicacion, connection);
    const userId = Number(row.Id_Usuario_Destino);
    if (eligibleUsers.has(userId)) delivered.add(userId);
  }
}

async function syncForDate(fecha) {
  const date = toDateLabel(fecha);
  if (!date) return { programs: 0, changed: 0 };
  const connection = await db.getConnection();
  const delivered = new Set();
  delivered.notifications = [];
  try {
    await connection.beginTransaction();
    const programs = await findPrograms(connection, { fecha: date });
    const eligibleUsers = new Set(await usersWithPermissions(connection, REQUIRED_PERMISSIONS));
    const expectedKeys = new Set();
    for (const program of programs) {
      const keys = await syncProgram(connection, program, eligibleUsers, delivered);
      for (const key of keys) expectedKeys.add(key);
    }
    await resolveStaleForDate(connection, date, expectedKeys, eligibleUsers, delivered);
    await connection.commit();
    for (const userId of delivered) {
      websocketManager.sendToUser(userId, { type: 'programacionNovedadesActualizadas', fecha: date });
    }
    for (const item of delivered.notifications) {
      websocketManager.sendToUser(item.userId, {
        type: 'notificacionNueva',
        idNotificacion: item.notificationId,
        categoria: 'pendientes',
      });
    }
    return { programs: programs.length, changed: delivered.size };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function syncForReservationChange({ reservationId, fecha } = {}) {
  const id = String(reservationId || '').trim();
  const date = toDateLabel(fecha);
  if (!id || !date) return { programs: 0, changed: 0 };
  const connection = await db.getConnection();
  const delivered = new Set();
  delivered.notifications = [];
  try {
    await connection.beginTransaction();
    const programs = await findPrograms(connection, { fecha: date, reservationId: id });
    const eligibleUsers = new Set(await usersWithPermissions(connection, REQUIRED_PERMISSIONS));
    const expectedKeys = new Set();
    for (const program of programs) {
      const keys = await syncProgram(connection, program, eligibleUsers, delivered);
      for (const key of keys) expectedKeys.add(key);
    }
    await resolveStaleForDate(connection, date, expectedKeys, eligibleUsers, delivered);
    await connection.commit();
    for (const userId of delivered) {
      websocketManager.sendToUser(userId, { type: 'programacionNovedadesActualizadas', fecha: date });
    }
    for (const item of delivered.notifications) {
      websocketManager.sendToUser(item.userId, {
        type: 'notificacionNueva',
        idNotificacion: item.notificationId,
        categoria: 'pendientes',
      });
    }
    return { programs: programs.length, changed: delivered.size };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listForUser(fecha, userId) {
  const date = toDateLabel(fecha);
  if (!date) throw Object.assign(new Error('La fecha es obligatoria.'), { status: 400, code: 'MISSING_DATE' });
  const connection = await db.getConnection();
  try {
    const eligibleUsers = new Set(await usersWithPermissions(connection, REQUIRED_PERMISSIONS));
    if (!eligibleUsers.has(Number(userId))) {
      throw Object.assign(new Error('Se requieren PROGRAMACION.LEER y PROGRAMACION.ACTUALIZAR.'), { status: 403, code: 'PROGRAMACION_ALERTS_FORBIDDEN' });
    }
    const permissionList = [...REQUIRED_PERMISSIONS];
    const audienceSql = `p.Id_Usuario_Destino = ?
      AND p.Permiso_Audiencia = ?
      AND JSON_CONTAINS(CAST(? AS JSON), CONCAT('["', REPLACE(p.Permiso_Audiencia, '&', '","'), '"]')) = 1`;
    const [rows] = await connection.query(
      `SELECT p.*, r.Codigo AS Regla_Codigo, r.Permite_Descarte,
              r.Requiere_Justificacion, r.Posposicion_Max_Minutos
         FROM pendientes_operativos p
         INNER JOIN reglas_pendientes r ON r.Id_Regla = p.Id_Regla
        WHERE r.Codigo = ? AND p.Estado = 'ACTIVO'
          AND p.Entidad_Tipo = 'PROGRAMACION_CAMBIO'
          AND (p.Suprimido_Hasta IS NULL OR p.Suprimido_Hasta <= NOW())
          AND ${audienceSql}
          AND JSON_UNQUOTE(JSON_EXTRACT(p.Datos, '$.fecha')) = ?
        ORDER BY FIELD(p.Prioridad, 'CRITICA', 'ALTA', 'MEDIA', 'BAJA'), p.Primera_Deteccion`,
      [RULE_CODE, userId, AUDIENCE_PERMISSION, JSON.stringify(permissionList), date]
    );
    return (rows || []).map(pendingService.mapPending);
  } finally {
    connection.release();
  }
}

async function hasRequiredPermissions(userId) {
  const connection = await db.getConnection();
  try {
    const eligibleUsers = await usersWithPermissions(connection, REQUIRED_PERMISSIONS);
    return eligibleUsers.includes(Number(userId));
  } finally {
    connection.release();
  }
}

function describeTransferSupport() {
  return 'Transfers no generan novedades: la programación actual no guarda un snapshot ni una relación entre transfers preparados y programaciones.';
}

module.exports = {
  RULE_CODE,
  REQUIRED_PERMISSIONS,
  AUDIENCE_PERMISSION,
  isActiveReservation,
  summarizeHistory,
  changedReservation,
  newReservation,
  buildGroupChangeSets,
  buildPrivateChangeSets,
  buildDeduplicationKey,
  findPrograms,
  loadGroupRows,
  loadPrivateRows,
  loadHistory,
  syncProgram,
  syncForDate,
  syncForReservationChange,
  listForUser,
  hasRequiredPermissions,
  describeTransferSupport,
};
