const db = require('../../database/db');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { reservasOperativasSource, reservaNoEliminadaPredicate } = require('../schema-capabilities');
const { recordHistorial } = require('../Historial/logger');
const {
  detectarTipoDocumento,
  normalizarFormaPago,
  validarDatosPago,
  validarReceptor,
} = require('./comisiones.service');

const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_SIZE = 100;
const PRIVATE_ROOT = path.resolve(__dirname, '../../private_uploads/comisiones');
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
});

function serviceError(message, status = 400, errorCode = 'VALIDATION_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function normalizarFecha(value, label = 'fecha') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw serviceError(`Selecciona una ${label} válida.`, 400, 'INVALID_DATE');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw serviceError(`Selecciona una ${label} válida.`, 400, 'INVALID_DATE');
  }
  return date;
}

function normalizarLimite(value, fallback = 25) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_SIZE) : fallback;
}

function normalizarPagina(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizarTipo(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!normalized) return null;
  if (normalized === 'HOTEL' || normalized === 'AGENCIA_NACIONAL') return normalized;
  throw serviceError('El tipo debe ser HOTEL o AGENCIA_NACIONAL.', 400, 'INVALID_ENTITY_TYPE');
}

function normalizarEstadoFiltro(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'PENDIENTE') return 'PENDIENTE';
  if (normalized === 'PAGADA' || normalized === 'PAGADO') return 'PAGADO';
  throw serviceError('El estado debe ser pendiente o pagada.', 400, 'INVALID_GROUP_STATUS');
}

function parsearFiltros(filtros = {}) {
  const desdeValue = filtros.desde ?? filtros.Fecha_Desde ?? filtros.fechaDesde ?? filtros.desdeFecha;
  const hastaValue = filtros.hasta ?? filtros.Fecha_Hasta ?? filtros.fechaHasta ?? filtros.hastaFecha;
  const desde = desdeValue ? normalizarFecha(desdeValue, 'fecha inicial') : null;
  const hasta = hastaValue ? normalizarFecha(hastaValue, 'fecha final') : null;
  if (desde && hasta && desde > hasta) {
    throw serviceError('La fecha inicial no puede ser posterior a la fecha final.', 400, 'INVALID_DATE_RANGE');
  }
  const idEntityValue = filtros.Id_Entidad_Reportante ?? filtros.idEntidad;
  let idEntity = null;
  if (idEntityValue !== undefined && idEntityValue !== null && String(idEntityValue).trim() !== '') {
    idEntity = Number(idEntityValue);
    if (!Number.isSafeInteger(idEntity) || idEntity <= 0) {
      throw serviceError('Selecciona una entidad reportante válida.', 400, 'ENTITY_INVALID');
    }
  }
  return {
    desde,
    hasta,
    idEntity,
    tipo: normalizarTipo(filtros.Tipo ?? filtros.tipo),
    estado: normalizarEstadoFiltro(filtros.Estado ?? filtros.estado),
    q: String(filtros.q ?? filtros.busqueda ?? filtros.buscar ?? '').trim().slice(0, 100),
    page: normalizarPagina(filtros.page ?? filtros.pagina),
    limit: normalizarLimite(filtros.limit ?? filtros.limite),
    unlinkedPage: normalizarPagina(filtros.unlinkedPage ?? filtros.paginaSinEntidad),
  };
}

function groupReference(entityId, fechaTour) {
  return `e${Number(entityId)}~${normalizarFecha(fechaTour, 'fecha de tour')}`;
}

function parseGroupReference(value) {
  const match = /^e([1-9]\d*)~(\d{4}-\d{2}-\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const entityId = Number(match[1]);
  if (!Number.isSafeInteger(entityId)) return null;
  try {
    return { Id_Entidad_Reportante: entityId, Fecha_Tour: normalizarFecha(match[2], 'fecha de tour') };
  } catch {
    return null;
  }
}

function normalizarIdLote(value) {
  const id = String(value || '').trim();
  if (!/^\d+$/.test(id) || BigInt(id) <= 0n) {
    throw serviceError('El lote de comisión no es válido.', 400, 'GROUP_INVALID');
  }
  return id;
}

async function resolverReferencia(conn, value, { lock = false } = {}) {
  const parsed = parseGroupReference(value);
  if (parsed) return { ...parsed, Id_Grupo_Comision: null };
  const id = normalizarIdLote(value);
  const [[group]] = await conn.query(
    `SELECT Id_Grupo_Comision, Id_Entidad_Reportante, DATE_FORMAT(Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour
       FROM comisiones_grupos_pago
      WHERE Id_Grupo_Comision = ? ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  if (!group) throw serviceError('El grupo o lote de comisión no existe.', 404, 'GROUP_NOT_FOUND');
  return {
    Id_Entidad_Reportante: Number(group.Id_Entidad_Reportante),
    Fecha_Tour: group.Fecha_Tour,
    Id_Grupo_Comision: String(group.Id_Grupo_Comision),
  };
}

function comprobanteDesdeRequest(file) {
  if (!file) return null;
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw serviceError('El comprobante está vacío o no se pudo leer.', 400, 'INVALID_DOCUMENT_CONTENT');
  }
  if (file.buffer.length > MAX_COMPROBANTE_BYTES) {
    throw serviceError('El comprobante debe pesar máximo 5 MB.', 400, 'DOCUMENT_TOO_LARGE');
  }
  const mime = String(file.mimetype || '').toLowerCase();
  const detected = detectarTipoDocumento(file.buffer);
  if (!MIME_EXTENSIONS[mime] || !detected || detected.mime !== mime) {
    throw serviceError('El comprobante debe ser un PDF, JPG o PNG válido.', 400, 'INVALID_DOCUMENT_CONTENT');
  }
  const originalName = String(file.originalname || `comprobante${MIME_EXTENSIONS[mime]}`)
    .replace(/\\/g, '/').split('/').pop().slice(0, 255);
  return { buffer: file.buffer, mime, extension: MIME_EXTENSIONS[mime], originalName };
}

function rutaComprobanteAbsoluta(relativePath) {
  const relative = String(relativePath || '').replace(/\\/g, '/');
  if (!/^grupo-\d+\/[a-f0-9-]+\.(jpg|png|pdf)$/.test(relative)) return null;
  const absolute = path.resolve(PRIVATE_ROOT, relative);
  return absolute.startsWith(`${PRIVATE_ROOT}${path.sep}`) ? absolute : null;
}

async function escribirComprobante(groupId, file) {
  const relativeDirectory = `grupo-${groupId}`;
  const directory = path.resolve(PRIVATE_ROOT, relativeDirectory);
  const storedName = `${randomUUID()}${file.extension}`;
  const relativePath = `${relativeDirectory}/${storedName}`;
  const absolutePath = rutaComprobanteAbsoluta(relativePath);
  if (!absolutePath) throw serviceError('No fue posible preparar la ruta del comprobante.', 500, 'DOCUMENT_PATH_ERROR');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolutePath, file.buffer, { flag: 'wx' });
  return { relativePath, absolutePath };
}

async function eliminarComprobanteEscrito(absolutePath) {
  if (!absolutePath) return;
  try { await fs.unlink(absolutePath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function sqlReservasComisionables({ incluirEntityless = false } = {}) {
  const reservationSource = reservasOperativasSource('R');
  const notDeleted = reservaNoEliminadaPredicate('R');
  const entityConditions = incluirEntityless
    ? `R.Id_Entidad_Reportante IS NULL
       AND REPLACE(UPPER(TRIM(COALESCE(C.Nombre_Canal, ''))), '_', ' ') IN ('HOTEL', 'AGENCIA NACIONAL')`
    : `R.Id_Entidad_Reportante IS NOT NULL
       AND E.Tipo IN ('HOTEL', 'AGENCIA_NACIONAL')
       AND E.Estado_Validacion <> 'RECHAZADA'
       AND ((E.Tipo = 'HOTEL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'HOTEL')
         OR (E.Tipo = 'AGENCIA_NACIONAL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'AGENCIA NACIONAL'))`;
  const entityJoin = incluirEntityless
    ? 'LEFT JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante'
    : 'INNER JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante';
  return `
    SELECT R.Id_Reserva,
           DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
           H.Id_Tour,
           R.Id_Entidad_Reportante,
           ${incluirEntityless ? "CASE WHEN REPLACE(UPPER(TRIM(COALESCE(C.Nombre_Canal, ''))), '_', ' ') = 'HOTEL' THEN 'HOTEL' ELSE 'AGENCIA_NACIONAL' END" : 'E.Tipo'} AS Tipo_Entidad,
           ${incluirEntityless ? 'NULL' : 'E.Nombre'} AS Nombre_Entidad,
           ${incluirEntityless ? 'NULL' : 'E.Activo'} AS Entidad_Activa,
           ${incluirEntityless ? 'NULL' : 'E.Estado_Validacion'} AS Estado_Validacion_Entidad,
           R.Nombre_Reportante,
           R.Tipo_Reserva,
           T.Nombre_Tour,
           COUNT(DISTINCT P.Id_Pasajero) AS Cantidad_Pasajeros,
           SUM(P.Comision) AS Monto_Comision,
           COALESCE(L.Estado, 'PENDIENTE') AS Estado_Liquidacion,
           L.Id_Grupo_Comision,
           L.Monto_Comision_Pagada,
           L.Forma_Pago AS Forma_Pago_Liquidacion,
           L.Cuenta_Bancaria AS Cuenta_Bancaria_Liquidacion,
           L.Nombre_Receptor_Snap,
           L.DNI_Receptor_Snap,
           L.Fecha_Pago
      FROM ${reservationSource}
      INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
      INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
      INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
      ${entityJoin}
      INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
      LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
     WHERE ${notDeleted}
       AND R.Fecha_Tour <= CURDATE()
       AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
       AND C.Tiene_Comision = 1
       AND P.Confirmacion = 1
       AND P.Comision > 0
       AND UPPER(TRIM(COALESCE(P.Tipo_Pasajero, ''))) <> 'INFANTE'
       AND ${entityConditions}
     GROUP BY R.Id_Reserva, R.Fecha_Tour, H.Id_Tour, R.Id_Entidad_Reportante,
              E.Tipo, E.Nombre, E.Activo, E.Estado_Validacion,
              R.Nombre_Reportante, R.Tipo_Reserva, T.Nombre_Tour,
              L.Estado, L.Id_Grupo_Comision, L.Monto_Comision_Pagada,
              L.Forma_Pago, L.Cuenta_Bancaria, L.Nombre_Receptor_Snap,
              L.DNI_Receptor_Snap, L.Fecha_Pago`;
}

function condicionesPeriodoSql(alias, filtros) {
  const conditions = [];
  const params = [];
  if (filtros.desde) { conditions.push(`${alias}.Fecha_Tour >= ?`); params.push(filtros.desde); }
  if (filtros.hasta) { conditions.push(`${alias}.Fecha_Tour <= ?`); params.push(filtros.hasta); }
  return { conditions, params };
}

function buildGroupListQueries(filtros) {
  const cte = `
    WITH reservas_elegibles AS (${sqlReservasComisionables()}),
    reservas_dia AS (
      SELECT Id_Entidad_Reportante, Fecha_Tour, Tipo_Entidad,
             COUNT(*) AS Cantidad_Reservas_Actuales,
             SUM(CASE WHEN Id_Grupo_Comision IS NULL AND Estado_Liquidacion = 'PENDIENTE' THEN 1 ELSE 0 END) AS Cantidad_Reservas_Pendientes,
             SUM(CASE WHEN Id_Grupo_Comision IS NULL AND Estado_Liquidacion = 'PENDIENTE' THEN Monto_Comision ELSE 0 END) AS Monto_Pendiente
        FROM reservas_elegibles
       GROUP BY Id_Entidad_Reportante, Fecha_Tour, Tipo_Entidad
    ),
    lotes_dia AS (
      SELECT Id_Entidad_Reportante, DATE_FORMAT(Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
             COUNT(*) AS Cantidad_Lotes,
             SUM(CASE WHEN Estado = 'PAGADO' THEN 1 ELSE 0 END) AS Cantidad_Lotes_Pagados,
             SUM(CASE WHEN Estado = 'PAGADO' THEN Monto_Pagado ELSE 0 END) AS Monto_Pagado,
             SUM(CASE WHEN Estado = 'PAGADO' THEN Cantidad_Reservas_Pagadas ELSE 0 END) AS Cantidad_Reservas_Pagadas,
             SUM(CASE WHEN Estado = 'ANULADO' THEN 1 ELSE 0 END) AS Cantidad_Lotes_Anulados,
             MAX(Numero_Lote) AS Ultimo_Numero_Lote,
             MAX(CASE WHEN Estado = 'PAGADO' THEN Id_Grupo_Comision ELSE NULL END) AS Ultimo_Id_Grupo_Pagado
        FROM comisiones_grupos_pago
       GROUP BY Id_Entidad_Reportante, Fecha_Tour
    ),
    dias AS (
      SELECT Id_Entidad_Reportante, Fecha_Tour FROM reservas_dia
      UNION
      SELECT Id_Entidad_Reportante, Fecha_Tour FROM lotes_dia
    ),
    resumen AS (
      SELECT D.Id_Entidad_Reportante,
             DATE_FORMAT(D.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
             E.Tipo AS Tipo_Entidad, E.Nombre AS Nombre_Entidad,
             E.Activo AS Entidad_Activa, E.Estado_Validacion AS Estado_Validacion_Entidad,
             COALESCE(RD.Cantidad_Reservas_Actuales, 0) AS Cantidad_Reservas_Actuales,
             COALESCE(RD.Cantidad_Reservas_Pendientes, 0) AS Cantidad_Reservas_Pendientes,
             COALESCE(RD.Monto_Pendiente, 0) AS Monto_Pendiente,
             COALESCE(LD.Cantidad_Lotes, 0) AS Cantidad_Lotes,
             COALESCE(LD.Cantidad_Lotes_Pagados, 0) AS Cantidad_Lotes_Pagados,
             COALESCE(LD.Monto_Pagado, 0) AS Monto_Pagado,
             COALESCE(LD.Cantidad_Reservas_Pagadas, 0) AS Cantidad_Reservas_Pagadas,
             COALESCE(LD.Cantidad_Lotes_Anulados, 0) AS Cantidad_Lotes_Anulados,
             COALESCE(LD.Ultimo_Numero_Lote, 0) AS Ultimo_Numero_Lote,
             LD.Ultimo_Id_Grupo_Pagado,
             CASE WHEN COALESCE(RD.Cantidad_Reservas_Pendientes, 0) > 0 THEN 'PENDIENTE'
                  WHEN COALESCE(LD.Cantidad_Lotes_Pagados, 0) > 0 THEN 'PAGADO'
                  ELSE 'PENDIENTE' END AS Estado
        FROM dias D
        INNER JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = D.Id_Entidad_Reportante
        LEFT JOIN reservas_dia RD ON RD.Id_Entidad_Reportante = D.Id_Entidad_Reportante AND RD.Fecha_Tour = D.Fecha_Tour
        LEFT JOIN lotes_dia LD ON LD.Id_Entidad_Reportante = D.Id_Entidad_Reportante AND LD.Fecha_Tour = D.Fecha_Tour
       WHERE E.Estado_Validacion <> 'RECHAZADA'
    )`;
  const conditions = [];
  const params = [];
  if (filtros.desde) { conditions.push('R.Fecha_Tour >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { conditions.push('R.Fecha_Tour <= ?'); params.push(filtros.hasta); }
  if (filtros.idEntity) { conditions.push('R.Id_Entidad_Reportante = ?'); params.push(filtros.idEntity); }
  if (filtros.tipo) { conditions.push('R.Tipo_Entidad = ?'); params.push(filtros.tipo); }
  if (filtros.estado) { conditions.push('R.Estado = ?'); params.push(filtros.estado); }
  if (filtros.q) {
    conditions.push('(R.Nombre_Entidad LIKE ? OR CAST(R.Id_Entidad_Reportante AS CHAR) LIKE ? OR R.Fecha_Tour LIKE ?)');
    const like = `%${filtros.q}%`;
    params.push(like, like, like);
  }
  const where = ["(R.Cantidad_Reservas_Pendientes > 0 OR R.Cantidad_Lotes > 0)", ...conditions].join(' AND ');
  return {
    countSql: `${cte} SELECT COUNT(*) AS Total FROM resumen R WHERE ${where}`,
    listSql: `${cte}
      SELECT R.*,
             R.Monto_Pendiente + R.Monto_Pagado AS Total_A_Comisionar,
             R.Cantidad_Reservas_Pendientes + R.Cantidad_Reservas_Pagadas AS Cantidad_Reservas,
             (R.Cantidad_Reservas_Pendientes > 0 AND R.Cantidad_Lotes_Pagados > 0) AS Tiene_Ajuste_Pendiente
        FROM resumen R WHERE ${where}
       ORDER BY R.Fecha_Tour DESC, R.Nombre_Entidad ASC, R.Id_Entidad_Reportante ASC
       LIMIT ? OFFSET ?`,
    params,
  };
}

function buildUnlinkedQueries(filtros) {
  const where = [];
  const params = [];
  if (filtros.desde) { where.push('R.Fecha_Tour >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { where.push('R.Fecha_Tour <= ?'); params.push(filtros.hasta); }
  if (filtros.tipo) { where.push("REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = ?"); params.push(filtros.tipo === 'HOTEL' ? 'HOTEL' : 'AGENCIA NACIONAL'); }
  if (filtros.q) {
    where.push('(R.Id_Reserva LIKE ? OR R.Nombre_Reportante LIKE ? OR T.Nombre_Tour LIKE ?)');
    const like = `%${filtros.q}%`;
    params.push(like, like, like);
  }
  const statement = `
    SELECT R.Id_Reserva, DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
           CASE WHEN REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'HOTEL' THEN 'HOTEL' ELSE 'AGENCIA_NACIONAL' END AS Tipo_Entidad,
           R.Nombre_Reportante, R.Telefono_Reportante, R.Tipo_Reserva,
           H.Id_Tour, T.Nombre_Tour,
           COUNT(DISTINCT P.Id_Pasajero) AS Cantidad_Pasajeros,
           SUM(P.Comision) AS Monto_Comision
      FROM ${reservasOperativasSource('R')}
      INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
      INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
      INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
      INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
      LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
     WHERE ${reservaNoEliminadaPredicate('R')}
       AND R.Id_Entidad_Reportante IS NULL
       AND R.Fecha_Tour <= CURDATE()
       AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
       AND REPLACE(UPPER(TRIM(COALESCE(C.Nombre_Canal, ''))), '_', ' ') IN ('HOTEL', 'AGENCIA NACIONAL')
       AND C.Tiene_Comision = 1
       AND P.Confirmacion = 1 AND P.Comision > 0
       AND UPPER(TRIM(COALESCE(P.Tipo_Pasajero, ''))) <> 'INFANTE'
       AND L.Id_Grupo_Comision IS NULL AND COALESCE(L.Estado, 'PENDIENTE') = 'PENDIENTE'
       ${where.length ? `AND ${where.join(' AND ')}` : ''}
     GROUP BY R.Id_Reserva, R.Fecha_Tour, C.Nombre_Canal, R.Nombre_Reportante,
              R.Telefono_Reportante, R.Tipo_Reserva, H.Id_Tour, T.Nombre_Tour
  `;
  const countSql = `SELECT COUNT(*) AS Total FROM (${statement}) sin_entidad`;
  const listSql = `${statement} ORDER BY R.Fecha_Tour DESC, R.Id_Reserva DESC LIMIT ? OFFSET ?`;
  return { countSql, listSql, params };
}

async function listarGrupos(filtrosRaw = {}) {
  const filtros = parsearFiltros(filtrosRaw);
  const groupQueries = buildGroupListQueries(filtros);
  const [[count]] = await db.query(groupQueries.countSql, groupQueries.params);
  const offset = (filtros.page - 1) * filtros.limit;
  const [groupsRaw] = await db.query(groupQueries.listSql, [...groupQueries.params, filtros.limit, offset]);
  const groups = groupsRaw.map((row) => ({
    ...row,
    Id_Entidad_Reportante: Number(row.Id_Entidad_Reportante),
    Id: groupReference(row.Id_Entidad_Reportante, row.Fecha_Tour),
    Tipo: row.Tipo_Entidad,
    Entidad_Inactiva: Number(row.Entidad_Activa) !== 1,
    Entidad_Pendiente_Validacion: row.Estado_Validacion_Entidad === 'PENDIENTE_VALIDACION',
    Puede_Pagar: false,
    Motivo_No_Pagable: null,
  }));
  const pendingGroups = groups.filter((group) => Number(group.Cantidad_Reservas_Pendientes) > 0);
  const jornadaStatus = await obtenerEstadoJornadasDeGrupos(db, pendingGroups);
  for (const group of groups) {
    const jornadas = jornadaStatus.get(group.Id) || [];
    const allClosed = jornadas.length > 0 && jornadas.every((jornada) => jornada.Cerrada);
    group.Jornadas_Cerradas = allClosed;
    group.Jornadas_Abiertas = jornadas.filter((jornada) => !jornada.Cerrada);
    if (!Number(group.Cantidad_Reservas_Pendientes)) {
      group.Motivo_No_Pagable = 'SIN_AJUSTE_PENDIENTE';
    } else if (group.Estado_Validacion_Entidad !== 'VALIDADA') {
      group.Motivo_No_Pagable = group.Estado_Validacion_Entidad === 'PENDIENTE_VALIDACION'
        ? 'ENTIDAD_PENDIENTE_VALIDACION' : 'ENTIDAD_NO_VALIDADA';
    } else if (!allClosed) {
      group.Motivo_No_Pagable = 'JORNADA_NO_CERRADA';
    }
    group.Puede_Pagar = Number(group.Cantidad_Reservas_Pendientes) > 0
      && group.Estado_Validacion_Entidad === 'VALIDADA' && allClosed;
  }

  const unlinkedFilters = { ...filtros, page: filtros.unlinkedPage };
  const unlinkedQueries = buildUnlinkedQueries(unlinkedFilters);
  const [[unlinkedCount]] = await db.query(unlinkedQueries.countSql, unlinkedQueries.params);
  const unlinkedOffset = (unlinkedFilters.page - 1) * filtros.limit;
  const [unlinkedReservations] = await db.query(unlinkedQueries.listSql, [...unlinkedQueries.params, filtros.limit, unlinkedOffset]);
  const total = Number(count?.Total || 0);
  const totalUnlinked = Number(unlinkedCount?.Total || 0);
  return {
    grupos: groups,
    paginacion: { pagina: filtros.page, limite: filtros.limit, total, paginas: Math.ceil(total / filtros.limit) },
    pendientesPorAsociarEntidad: {
      reservas: unlinkedReservations,
      paginacion: {
        pagina: unlinkedFilters.page,
        limite: filtros.limit,
        total: totalUnlinked,
        paginas: Math.ceil(totalUnlinked / filtros.limit),
      },
    },
  };
}

async function obtenerEstadoJornadasDeGrupos(conn, groups) {
  const result = new Map(groups.map((group) => [group.Id, []]));
  if (!groups.length) return result;
  const tupleWhere = groups.map(() => '(R.Id_Entidad_Reportante = ? AND R.Fecha_Tour = ?)').join(' OR ');
  const tupleParams = groups.flatMap((group) => [group.Id_Entidad_Reportante, group.Fecha_Tour]);
  const [tours] = await conn.query(
    `SELECT DISTINCT R.Id_Entidad_Reportante,
            DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
            H.Id_Tour
       FROM ${reservasOperativasSource('R')}
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
       INNER JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante
       INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
       LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
      WHERE ${reservaNoEliminadaPredicate('R')}
        AND R.Fecha_Tour <= CURDATE()
        AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
        AND C.Tiene_Comision = 1 AND P.Confirmacion = 1 AND P.Comision > 0
        AND UPPER(TRIM(COALESCE(P.Tipo_Pasajero, ''))) <> 'INFANTE'
        AND E.Estado_Validacion <> 'RECHAZADA'
        AND ((E.Tipo = 'HOTEL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'HOTEL')
          OR (E.Tipo = 'AGENCIA_NACIONAL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'AGENCIA NACIONAL'))
        AND L.Id_Grupo_Comision IS NULL AND COALESCE(L.Estado, 'PENDIENTE') = 'PENDIENTE'
        AND (${tupleWhere})`,
    tupleParams,
  );
  const pairs = [...new Map(tours.map((row) => [`${row.Id_Tour}|${row.Fecha_Tour}`, {
    Id_Tour: Number(row.Id_Tour), Fecha_Tour: row.Fecha_Tour,
  }])).values()];
  if (!pairs.length) return result;
  const jornadaTuples = pairs.map(() => '(H.Id_Tour = ? AND R.Fecha_Tour = ?)').join(' OR ');
  const [statuses] = await conn.query(
    `SELECT H.Id_Tour, DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
            MAX(T.Nombre_Tour) AS Nombre_Tour,
            MAX(CJ.Confirmada_En) AS Confirmada_En,
            MAX(CJ.Total_Pasajeros) AS Total_Pasajeros_Confirmados,
            COUNT(DISTINCT P.Id_Pasajero) AS Total_Pasajeros_Actuales
       FROM ${reservasOperativasSource('R')}
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
       LEFT JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
       LEFT JOIN confirmaciones_jornada CJ ON CJ.Id_Tour = H.Id_Tour AND CJ.Fecha_Tour = R.Fecha_Tour
      WHERE ${reservaNoEliminadaPredicate('R')}
        AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
        AND (${jornadaTuples})
      GROUP BY H.Id_Tour, R.Fecha_Tour`,
    pairs.flatMap((pair) => [pair.Id_Tour, pair.Fecha_Tour]),
  );
  const byJourney = new Map(statuses.map((row) => {
    const current = Number(row.Total_Pasajeros_Actuales || 0);
    const confirmed = Number(row.Total_Pasajeros_Confirmados || 0);
    return [`${row.Id_Tour}|${row.Fecha_Tour}`, {
      Id_Tour: Number(row.Id_Tour),
      Nombre_Tour: row.Nombre_Tour,
      Fecha_Tour: row.Fecha_Tour,
      Cerrada: Boolean(row.Confirmada_En) && current === confirmed,
      Total_Pasajeros_Actuales: current,
      Total_Pasajeros_Confirmados: confirmed,
      Confirmada_En: row.Confirmada_En || null,
    }];
  }));
  for (const tour of tours) {
    const key = groupReference(tour.Id_Entidad_Reportante, tour.Fecha_Tour);
    const journey = byJourney.get(`${tour.Id_Tour}|${tour.Fecha_Tour}`) || {
      Id_Tour: Number(tour.Id_Tour), Fecha_Tour: tour.Fecha_Tour, Cerrada: false,
      Total_Pasajeros_Actuales: 0, Total_Pasajeros_Confirmados: 0, Confirmada_En: null,
    };
    result.get(key)?.push(journey);
  }
  for (const [key, journeys] of result) {
    const unique = [...new Map(journeys.map((journey) => [`${journey.Id_Tour}|${journey.Fecha_Tour}`, journey])).values()];
    result.set(key, unique);
  }
  return result;
}

async function obtenerReservasPendientes(conn, entityId, fechaTour, { lock = false, page = null, limit = null } = {}) {
  if (lock) {
    await conn.query(
      `SELECT R.Id_Reserva
         FROM reservas R
         INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
         INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
         INNER JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante
         INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
         LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
        WHERE ${reservaNoEliminadaPredicate('R')}
          AND R.Id_Entidad_Reportante = ? AND R.Fecha_Tour = ?
          AND R.Fecha_Tour <= CURDATE()
          AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
          AND C.Tiene_Comision = 1 AND P.Confirmacion = 1 AND P.Comision > 0
          AND UPPER(TRIM(COALESCE(P.Tipo_Pasajero, ''))) <> 'INFANTE'
          AND E.Estado_Validacion <> 'RECHAZADA'
          AND ((E.Tipo = 'HOTEL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'HOTEL')
            OR (E.Tipo = 'AGENCIA_NACIONAL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'AGENCIA NACIONAL'))
          AND L.Id_Grupo_Comision IS NULL AND COALESCE(L.Estado, 'PENDIENTE') = 'PENDIENTE'
        FOR UPDATE`,
      [entityId, fechaTour],
    );
  }
  const usePagination = Number.isInteger(page) && Number.isInteger(limit);
  const offset = usePagination ? (page - 1) * limit : 0;
  const [rows] = await conn.query(
    `SELECT R.Id_Reserva, DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
            H.Id_Tour, T.Nombre_Tour, R.Tipo_Reserva,
            COUNT(DISTINCT P.Id_Pasajero) AS Cantidad_Pasajeros,
            SUM(P.Comision) AS Monto_Comision
       FROM ${reservasOperativasSource('R')}
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
       INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
       INNER JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante
       INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
       LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
      WHERE ${reservaNoEliminadaPredicate('R')}
        AND R.Id_Entidad_Reportante = ? AND R.Fecha_Tour = ? AND R.Fecha_Tour <= CURDATE()
        AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
        AND C.Tiene_Comision = 1 AND P.Confirmacion = 1 AND P.Comision > 0
        AND UPPER(TRIM(COALESCE(P.Tipo_Pasajero, ''))) <> 'INFANTE'
        AND E.Estado_Validacion <> 'RECHAZADA'
        AND ((E.Tipo = 'HOTEL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'HOTEL')
          OR (E.Tipo = 'AGENCIA_NACIONAL' AND REPLACE(UPPER(TRIM(C.Nombre_Canal)), '_', ' ') = 'AGENCIA NACIONAL'))
        AND L.Id_Grupo_Comision IS NULL AND COALESCE(L.Estado, 'PENDIENTE') = 'PENDIENTE'
      GROUP BY R.Id_Reserva, R.Fecha_Tour, H.Id_Tour, T.Nombre_Tour, R.Tipo_Reserva
      ORDER BY R.Id_Reserva ${usePagination ? 'LIMIT ? OFFSET ?' : ''}`,
    usePagination ? [entityId, fechaTour, limit, offset] : [entityId, fechaTour],
  );
  return rows;
}

async function obtenerEstadoJornadas(conn, reservations) {
  const pairs = [...new Map(reservations.map((row) => [`${row.Id_Tour}|${row.Fecha_Tour}`, {
    Id_Tour: Number(row.Id_Tour), Fecha_Tour: row.Fecha_Tour,
  }])).values()];
  if (!pairs.length) return [];
  const condition = pairs.map(() => '(H.Id_Tour = ? AND R.Fecha_Tour = ?)').join(' OR ');
  const [rows] = await conn.query(
    `SELECT H.Id_Tour, DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
            MAX(T.Nombre_Tour) AS Nombre_Tour,
            MAX(CJ.Confirmada_En) AS Confirmada_En,
            MAX(CJ.Total_Pasajeros) AS Total_Pasajeros_Confirmados,
            COUNT(DISTINCT P.Id_Pasajero) AS Total_Pasajeros_Actuales
       FROM ${reservasOperativasSource('R')}
       INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
       INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
       LEFT JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
       LEFT JOIN confirmaciones_jornada CJ ON CJ.Id_Tour = H.Id_Tour AND CJ.Fecha_Tour = R.Fecha_Tour
      WHERE ${reservaNoEliminadaPredicate('R')}
        AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
        AND (${condition})
      GROUP BY H.Id_Tour, R.Fecha_Tour`,
    pairs.flatMap((pair) => [pair.Id_Tour, pair.Fecha_Tour]),
  );
  const byKey = new Map(rows.map((row) => {
    const current = Number(row.Total_Pasajeros_Actuales || 0);
    const confirmed = Number(row.Total_Pasajeros_Confirmados || 0);
    return [`${row.Id_Tour}|${row.Fecha_Tour}`, {
      Id_Tour: Number(row.Id_Tour), Fecha_Tour: row.Fecha_Tour, Nombre_Tour: row.Nombre_Tour,
      Cerrada: Boolean(row.Confirmada_En) && current === confirmed,
      Total_Pasajeros_Actuales: current, Total_Pasajeros_Confirmados: confirmed,
      Confirmada_En: row.Confirmada_En || null,
    }];
  }));
  return pairs.map((pair) => byKey.get(`${pair.Id_Tour}|${pair.Fecha_Tour}`) || {
    ...pair, Cerrada: false, Total_Pasajeros_Actuales: 0, Total_Pasajeros_Confirmados: 0, Confirmada_En: null,
  });
}

function fechaBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function validarFechaPago(value) {
  return value ? normalizarFecha(value, 'fecha de pago') : fechaBogota();
}

async function obtenerPerfilPago(conn, entityId) {
  const [[profile]] = await conn.query(
    `SELECT Forma_Pago, Numero_Cuenta, Nombre_Receptor, DNI_Receptor
       FROM perfiles_comision_entidad
      WHERE Id_Entidad_Reportante = ? AND Activo = 1 LIMIT 1`,
    [entityId],
  );
  return profile || {};
}

function construirSnapshotPago(payload, profile) {
  const formaRaw = payload?.Forma_Pago ?? profile.Forma_Pago ?? null;
  const cuentaRaw = payload?.Cuenta_Bancaria ?? profile.Numero_Cuenta ?? null;
  const nombreRaw = payload?.Nombre_Receptor ?? profile.Nombre_Receptor ?? null;
  const dniRaw = payload?.DNI_Receptor ?? profile.DNI_Receptor ?? null;
  const formaNormalizada = formaRaw ? normalizarFormaPago(formaRaw) : null;
  const pago = validarDatosPago(formaNormalizada, cuentaRaw, { permitirVacio: true, permitirCuentaVacia: true });
  const receptor = validarReceptor(nombreRaw, dniRaw, pago.Forma_Pago);
  return {
    Forma_Pago: pago.Forma_Pago,
    Cuenta_Bancaria: pago.Numero_Cuenta,
    Nombre_Receptor: receptor.Nombre_Receptor,
    DNI_Receptor: receptor.DNI_Receptor,
  };
}

function validarTotalesEsperados(payload) {
  const total = Number(payload?.Monto_Pendiente_Esperado);
  const cantidad = Number(payload?.Cantidad_Reservas_Pendientes_Esperada);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw serviceError('Envía el total pendiente que se mostró antes de confirmar el pago.', 400, 'EXPECTED_TOTAL_REQUIRED');
  }
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
    throw serviceError('Envía la cantidad de reservas pendientes que se mostró antes de confirmar el pago.', 400, 'EXPECTED_RESERVATION_COUNT_REQUIRED');
  }
  return { total, cantidad };
}

async function marcarGrupoPagado(reference, payload = {}, userId = null, file = null) {
  const expected = validarTotalesEsperados(payload);
  const preparedFile = comprobanteDesdeRequest(file);
  const conn = await db.getConnection();
  let writtenFile = null;
  let committed = false;
  try {
    await conn.beginTransaction();
    const referenceData = await resolverReferencia(conn, reference);
    const entityId = referenceData.Id_Entidad_Reportante;
    const fechaTour = referenceData.Fecha_Tour;
    const [[entity]] = await conn.query(
      `SELECT Id_Entidad_Reportante, Tipo, Nombre, Activo, Estado_Validacion
         FROM entidades_reportantes WHERE Id_Entidad_Reportante = ? FOR UPDATE`,
      [entityId],
    );
    if (!entity) throw serviceError('La entidad reportante no existe.', 404, 'ENTITY_NOT_FOUND');
    if (!['HOTEL', 'AGENCIA_NACIONAL'].includes(entity.Tipo)) {
      throw serviceError('Solo HOTEL y AGENCIA NACIONAL pueden comisionar en grupos.', 409, 'ENTITY_COMMISSION_FORBIDDEN');
    }
    if (entity.Estado_Validacion === 'RECHAZADA') {
      throw serviceError('La entidad está rechazada y no puede recibir comisiones.', 409, 'ENTITY_REJECTED');
    }
    if (entity.Estado_Validacion !== 'VALIDADA') {
      throw serviceError('La entidad debe estar validada antes de marcar el grupo como pagado.', 409, 'ENTITY_VALIDATION_REQUIRED', {
        Estado_Validacion: entity.Estado_Validacion,
      });
    }
    const [existingGroups] = await conn.query(
      `SELECT Id_Grupo_Comision, Numero_Lote, Estado
         FROM comisiones_grupos_pago
        WHERE Id_Entidad_Reportante = ? AND Fecha_Tour = ?
        ORDER BY Numero_Lote FOR UPDATE`,
      [entityId, fechaTour],
    );
    if (referenceData.Id_Grupo_Comision && !existingGroups.some((row) => String(row.Id_Grupo_Comision) === referenceData.Id_Grupo_Comision)) {
      throw serviceError('El lote dejó de estar disponible. Actualiza la lista.', 409, 'GROUP_CHANGED');
    }
    const reservations = await obtenerReservasPendientes(conn, entityId, fechaTour, { lock: true });
    const total = reservations.reduce((sum, row) => sum + Number(row.Monto_Comision || 0), 0);
    if (expected.total !== total || expected.cantidad !== reservations.length) {
      throw serviceError(
        'El grupo cambió desde que lo consultaste. Actualiza la lista y confirma de nuevo con los valores actuales.',
        409,
        'GROUP_TOTAL_CHANGED',
        {
          Monto_Pendiente_Esperado: expected.total,
          Cantidad_Reservas_Pendientes_Esperada: expected.cantidad,
          Monto_Pendiente_Actual: total,
          Cantidad_Reservas_Pendientes_Actual: reservations.length,
        },
      );
    }
    if (!reservations.length) {
      throw serviceError('No hay reservas pendientes para crear un lote de pago.', 409, 'NO_PENDING_RESERVATIONS');
    }
    const journeys = await obtenerEstadoJornadas(conn, reservations);
    const openJourneys = journeys.filter((journey) => !journey.Cerrada);
    if (openJourneys.length) {
      throw serviceError('Cierra la jornada en Control de viaje antes de pagar este grupo.', 409, 'TRIP_CONTROL_NOT_CLOSED', openJourneys);
    }
    const profile = await obtenerPerfilPago(conn, entityId);
    const payment = construirSnapshotPago(payload, profile);
    const fechaPago = validarFechaPago(payload?.Fecha_Pago);
    const lotNumber = Math.max(0, ...existingGroups.map((row) => Number(row.Numero_Lote) || 0)) + 1;
    const [insertResult] = await conn.query(
      `INSERT INTO comisiones_grupos_pago
       (Id_Entidad_Reportante, Fecha_Tour, Numero_Lote, Estado, Fecha_Pago,
        Monto_Pagado, Cantidad_Reservas_Pagadas, Pagado_Por,
        Nombre_Beneficiario_Snap, Forma_Pago, Cuenta_Bancaria,
        Nombre_Receptor_Snap, DNI_Receptor_Snap)
       VALUES (?, ?, ?, 'PAGADO', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, fechaTour, lotNumber, fechaPago, total, reservations.length, userId || null,
        entity.Nombre, payment.Forma_Pago, payment.Cuenta_Bancaria,
        payment.Nombre_Receptor, payment.DNI_Receptor],
    );
    const groupId = String(insertResult.insertId);
    const childValues = reservations.map((row) => [groupId, row.Id_Reserva, Number(row.Monto_Comision)]);
    await conn.query(
      `INSERT INTO comisiones_grupos_pago_reservas (Id_Grupo_Comision, Id_Reserva, Monto_Comision_Pagada) VALUES ?`,
      [childValues],
    );
    const liquidationValues = reservations.map((row) => [
      row.Id_Reserva, groupId, entity.Nombre, payment.Forma_Pago, payment.Cuenta_Bancaria,
      payment.Nombre_Receptor, payment.DNI_Receptor, 'PAGADO', fechaPago,
      Number(row.Monto_Comision), userId || null, userId || null,
    ]);
    await conn.query(
      `INSERT INTO liquidaciones
       (Id_Reserva, Id_Grupo_Comision, Nombre_Beneficiario_Snap,
        Forma_Pago, Cuenta_Bancaria, Nombre_Receptor_Snap, DNI_Receptor_Snap,
        Estado, Fecha_Pago, Monto_Comision_Pagada, Creado_Por, Actualizado_Por)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         Id_Grupo_Comision = VALUES(Id_Grupo_Comision),
         Nombre_Beneficiario_Snap = VALUES(Nombre_Beneficiario_Snap),
         Forma_Pago = VALUES(Forma_Pago), Cuenta_Bancaria = VALUES(Cuenta_Bancaria),
         Nombre_Receptor_Snap = VALUES(Nombre_Receptor_Snap), DNI_Receptor_Snap = VALUES(DNI_Receptor_Snap),
         Estado = VALUES(Estado), Fecha_Pago = VALUES(Fecha_Pago),
         Monto_Comision_Pagada = VALUES(Monto_Comision_Pagada), Actualizado_Por = VALUES(Actualizado_Por)`,
      [liquidationValues],
    );
    const details = [
      { columna: 'Estado', anterior: null, nuevo: 'PAGADO' },
      { columna: 'Entidad', anterior: null, nuevo: `${entityId} - ${entity.Nombre}` },
      { columna: 'Fecha_Tour', anterior: null, nuevo: fechaTour },
      { columna: 'Numero_Lote', anterior: null, nuevo: lotNumber },
      { columna: 'Cantidad_Reservas_Pagadas', anterior: null, nuevo: reservations.length },
      { columna: 'Monto_Pagado', anterior: null, nuevo: total },
    ];
    if (preparedFile) {
      writtenFile = await escribirComprobante(groupId, preparedFile);
      await conn.query(
        `UPDATE comisiones_grupos_pago
            SET Comprobante_Ruta = ?, Comprobante_Nombre_Original = ?,
                Comprobante_Mime_Type = ?, Comprobante_Tamano_Bytes = ?,
                Comprobante_Subido_En = NOW(), Comprobante_Subido_Por = ?
          WHERE Id_Grupo_Comision = ?`,
        [writtenFile.relativePath, preparedFile.originalName, preparedFile.mime,
          preparedFile.buffer.length, userId || null, groupId],
      );
      details.push({ columna: 'Comprobante', anterior: null, nuevo: preparedFile.originalName });
    }
    await recordHistorial({
      conexion: conn, tabla: 'comisiones_grupos_pago', id_registro: groupId,
      accion: 'MARCAR_GRUPO_COMISION_PAGADO', id_usuario: userId, detalles: details,
    });
    await conn.commit();
    committed = true;
    return {
      Id_Grupo_Comision: groupId, Id_Entidad_Reportante: entityId,
      Fecha_Tour: fechaTour, Numero_Lote: lotNumber, Estado: 'PAGADO',
      Fecha_Pago: fechaPago, Monto_Pagado: total,
      Cantidad_Reservas_Pagadas: reservations.length,
      comprobante: preparedFile ? { Nombre_Original: preparedFile.originalName, Mime_Type: preparedFile.mime, Tamano_Bytes: preparedFile.buffer.length } : null,
    };
  } catch (error) {
    if (!committed) {
      await conn.rollback();
      if (writtenFile?.absolutePath) await eliminarComprobanteEscrito(writtenFile.absolutePath);
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      throw serviceError('El lote cambió durante el pago. Actualiza la lista e inténtalo nuevamente.', 409, 'GROUP_CHANGED');
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function obtenerDetalleGrupo(reference, query = {}) {
  const conn = await db.getConnection();
  try {
    const ref = await resolverReferencia(conn, reference);
    const entityId = ref.Id_Entidad_Reportante;
    const fechaTour = ref.Fecha_Tour;
    const page = normalizarPagina(query.page ?? query.pagina);
    const limit = normalizarLimite(query.limit ?? query.limite);
    const offset = (page - 1) * limit;
    const requestedLotId = query.loteId ?? query.Id_Grupo_Comision ?? query.lote;
    let pendingPagination = null;
    const [[entity]] = await conn.query(
      `SELECT Id_Entidad_Reportante, Tipo, Nombre, Activo, Estado_Validacion
         FROM entidades_reportantes WHERE Id_Entidad_Reportante = ?`,
      [entityId],
    );
    if (!entity) throw serviceError('La entidad reportante no existe.', 404, 'ENTITY_NOT_FOUND');
    const pendingReservations = requestedLotId
      ? []
      : await obtenerReservasPendientes(conn, entityId, fechaTour, { page, limit });
    const [lots] = await conn.query(
      `SELECT Id_Grupo_Comision, Id_Entidad_Reportante, DATE_FORMAT(Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
              Numero_Lote, Estado, Fecha_Pago, Monto_Pagado, Cantidad_Reservas_Pagadas,
              Pagado_Por, Nombre_Beneficiario_Snap, Forma_Pago, Cuenta_Bancaria,
              Nombre_Receptor_Snap, DNI_Receptor_Snap,
              Comprobante_Nombre_Original, Comprobante_Mime_Type, Comprobante_Tamano_Bytes,
              Comprobante_Subido_En, Comprobante_Subido_Por,
              Motivo_Anulacion, Anulado_Por, Anulado_En
         FROM comisiones_grupos_pago
        WHERE Id_Entidad_Reportante = ? AND Fecha_Tour = ?
        ORDER BY Numero_Lote DESC`,
      [entityId, fechaTour],
    );
    let memberRows = [];
    let selectedLot = null;
    let lotMembersPagination = null;
    if (requestedLotId !== undefined && requestedLotId !== null && String(requestedLotId).trim() !== '') {
      const requestedId = normalizarIdLote(requestedLotId);
      selectedLot = lots.find((lot) => String(lot.Id_Grupo_Comision) === requestedId) || null;
      if (!selectedLot) throw serviceError('El lote no pertenece al grupo entidad-día solicitado.', 404, 'GROUP_NOT_FOUND');
      const [[memberCount]] = await conn.query(
        `SELECT COUNT(*) AS Total FROM comisiones_grupos_pago_reservas WHERE Id_Grupo_Comision = ?`,
        [requestedId],
      );
      [memberRows] = await conn.query(
        `SELECT GR.Id_Grupo_Comision, GR.Id_Reserva, GR.Monto_Comision_Pagada,
                DATE_FORMAT(R.Fecha_Tour, '%Y-%m-%d') AS Fecha_Tour,
                R.Tipo_Reserva, R.Nombre_Reportante,
                H.Id_Tour, T.Nombre_Tour
           FROM comisiones_grupos_pago_reservas GR
           INNER JOIN reservas R ON R.Id_Reserva = GR.Id_Reserva
           LEFT JOIN horarios H ON H.Id_Horario = R.Id_Horario
           LEFT JOIN tours T ON T.Id_Tour = H.Id_Tour
          WHERE GR.Id_Grupo_Comision = ?
          ORDER BY GR.Id_Reserva LIMIT ? OFFSET ?`,
        [requestedId, limit, offset],
      );
      const totalMembers = Number(memberCount?.Total || 0);
      lotMembersPagination = { pagina: page, limite: limit, total: totalMembers, paginas: Math.ceil(totalMembers / limit) };
    } else {
      const [[pendingCount]] = await conn.query(
        `SELECT COUNT(*) AS Total FROM (${sqlReservasComisionables()}) E
          WHERE E.Id_Entidad_Reportante = ? AND E.Fecha_Tour = ?
            AND E.Id_Grupo_Comision IS NULL AND E.Estado_Liquidacion = 'PENDIENTE'`,
        [entityId, fechaTour],
      );
      lotMembersPagination = null;
      const totalPending = Number(pendingCount?.Total || 0);
      pendingPagination = { pagina: page, limite: limit, total: totalPending, paginas: Math.ceil(totalPending / limit) };
    }
    const reservations = memberRows.map((row) => ({
      Id_Reserva: row.Id_Reserva, Fecha_Tour: row.Fecha_Tour,
      Tipo_Reserva: row.Tipo_Reserva, Nombre_Reportante: row.Nombre_Reportante,
      Id_Tour: row.Id_Tour ? Number(row.Id_Tour) : null, Nombre_Tour: row.Nombre_Tour || null,
      Monto_Comision_Pagada: Number(row.Monto_Comision_Pagada),
    }));
    return {
      grupo: {
        Id: groupReference(entityId, fechaTour),
        Id_Entidad_Reportante: entityId, Nombre_Entidad: entity.Nombre,
        Tipo_Entidad: entity.Tipo, Entidad_Activa: Number(entity.Activo) === 1,
        Estado_Validacion: entity.Estado_Validacion, Fecha_Tour: fechaTour,
      },
      reservasPendientes: pendingReservations,
      paginacionReservasPendientes: requestedLotId ? null : pendingPagination,
      lotes: lots.map((lot) => ({
        ...lot, Id_Grupo_Comision: String(lot.Id_Grupo_Comision),
        Id_Entidad_Reportante: Number(lot.Id_Entidad_Reportante),
        Monto_Pagado: lot.Monto_Pagado == null ? null : Number(lot.Monto_Pagado),
        Cantidad_Reservas_Pagadas: lot.Cantidad_Reservas_Pagadas == null ? null : Number(lot.Cantidad_Reservas_Pagadas),
        Tiene_Comprobante: Boolean(lot.Comprobante_Nombre_Original),
      })),
      ...(selectedLot ? {
        loteDetalle: {
          Id_Grupo_Comision: String(selectedLot.Id_Grupo_Comision),
          Numero_Lote: Number(selectedLot.Numero_Lote),
          Estado: selectedLot.Estado,
          reservas: reservations,
          paginacion: lotMembersPagination,
        },
      } : {}),
    };
  } finally {
    conn.release();
  }
}

function normalizarMotivoAnulacion(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw serviceError('Describe el motivo de anulación con entre 5 y 1000 caracteres.', 400, 'INVALID_ANNULMENT_REASON');
  }
  return reason;
}

async function anularPago(groupIdValue, payload = {}, userId = null) {
  const groupId = normalizarIdLote(groupIdValue);
  const reason = normalizarMotivoAnulacion(payload?.Motivo ?? payload?.motivo);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[group]] = await conn.query(
      `SELECT Id_Grupo_Comision, Id_Entidad_Reportante, Estado, Motivo_Anulacion,
              Monto_Pagado, Cantidad_Reservas_Pagadas, Fecha_Pago
         FROM comisiones_grupos_pago WHERE Id_Grupo_Comision = ? FOR UPDATE`,
      [groupId],
    );
    if (!group) throw serviceError('El lote de comisión no existe.', 404, 'GROUP_NOT_FOUND');
    if (group.Estado !== 'PAGADO') throw serviceError('Solo se puede anular un lote que está pagado.', 409, 'GROUP_NOT_PAID');
    const [members] = await conn.query(
      `SELECT Id_Reserva FROM comisiones_grupos_pago_reservas WHERE Id_Grupo_Comision = ? FOR UPDATE`,
      [groupId],
    );
    await conn.query(
      `UPDATE comisiones_grupos_pago
          SET Estado = 'ANULADO', Motivo_Anulacion = ?, Anulado_Por = ?, Anulado_En = NOW()
        WHERE Id_Grupo_Comision = ? AND Estado = 'PAGADO'`,
      [reason, userId || null, groupId],
    );
    const [detach] = await conn.query(
      `UPDATE liquidaciones
          SET Id_Grupo_Comision = NULL, Estado = 'PENDIENTE', Fecha_Pago = NULL,
              Monto_Comision_Pagada = NULL, Nombre_Beneficiario_Snap = NULL,
              Forma_Pago = NULL, Cuenta_Bancaria = NULL,
              Nombre_Receptor_Snap = NULL, DNI_Receptor_Snap = NULL,
              Actualizado_Por = ?
        WHERE Id_Grupo_Comision = ?`,
      [userId || null, groupId],
    );
    if (Number(detach.affectedRows) !== members.length) {
      throw serviceError('El lote y sus liquidaciones ya no coinciden; no se anuló el pago.', 409, 'GROUP_MEMBERSHIP_CHANGED');
    }
    await recordHistorial({
      conexion: conn, tabla: 'comisiones_grupos_pago', id_registro: groupId,
      accion: 'ANULAR_PAGO_GRUPO_COMISION', id_usuario: userId,
      detalles: [
        { columna: 'Estado', anterior: 'PAGADO', nuevo: 'ANULADO' },
        { columna: 'Motivo_Anulacion', anterior: null, nuevo: reason },
        { columna: 'Reservas_Liberadas', anterior: null, nuevo: members.length },
        { columna: 'Monto_Pagado_Conservado', anterior: null, nuevo: Number(group.Monto_Pagado) },
      ],
    });
    await conn.commit();
    return {
      Id_Grupo_Comision: groupId, Estado: 'ANULADO', Motivo_Anulacion: reason,
      Reservas_Liberadas: members.length, Monto_Pagado_Conservado: Number(group.Monto_Pagado),
      Fecha_Pago_Conservada: group.Fecha_Pago,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function subirComprobante(groupIdValue, file, userId = null) {
  const groupId = normalizarIdLote(groupIdValue);
  const preparedFile = comprobanteDesdeRequest(file);
  if (!preparedFile) throw serviceError('Adjunta un comprobante.', 400, 'DOCUMENT_REQUIRED');
  const conn = await db.getConnection();
  let writtenFile = null;
  let committed = false;
  try {
    await conn.beginTransaction();
    const [[group]] = await conn.query(
      `SELECT Id_Grupo_Comision, Estado, Fecha_Pago, Comprobante_Ruta, Comprobante_Nombre_Original
         FROM comisiones_grupos_pago WHERE Id_Grupo_Comision = ? FOR UPDATE`,
      [groupId],
    );
    if (!group) throw serviceError('El lote de comisión no existe.', 404, 'GROUP_NOT_FOUND');
    if (!['PAGADO', 'ANULADO'].includes(group.Estado) || !group.Fecha_Pago) {
      throw serviceError('Primero debe existir un pago para asociar su comprobante.', 409, 'GROUP_NOT_PAID');
    }
    if (group.Comprobante_Ruta) {
      throw serviceError('Este lote ya tiene un comprobante asociado.', 409, 'PROOF_ALREADY_EXISTS');
    }
    writtenFile = await escribirComprobante(groupId, preparedFile);
    await conn.query(
      `UPDATE comisiones_grupos_pago
          SET Comprobante_Ruta = ?, Comprobante_Nombre_Original = ?,
              Comprobante_Mime_Type = ?, Comprobante_Tamano_Bytes = ?,
              Comprobante_Subido_En = NOW(), Comprobante_Subido_Por = ?
        WHERE Id_Grupo_Comision = ? AND Comprobante_Ruta IS NULL`,
      [writtenFile.relativePath, preparedFile.originalName, preparedFile.mime,
        preparedFile.buffer.length, userId || null, groupId],
    );
    await recordHistorial({
      conexion: conn, tabla: 'comisiones_grupos_pago', id_registro: groupId,
      accion: 'SUBIR_COMPROBANTE_GRUPO_COMISION', id_usuario: userId,
      detalles: [
        { columna: 'Comprobante', anterior: null, nuevo: preparedFile.originalName },
        { columna: 'Mime_Type', anterior: null, nuevo: preparedFile.mime },
        { columna: 'Tamano_Bytes', anterior: null, nuevo: preparedFile.buffer.length },
      ],
    });
    await conn.commit();
    committed = true;
    return {
      Id_Grupo_Comision: groupId, Nombre_Original: preparedFile.originalName,
      Mime_Type: preparedFile.mime, Tamano_Bytes: preparedFile.buffer.length,
    };
  } catch (error) {
    if (!committed) {
      await conn.rollback();
      if (writtenFile?.absolutePath) await eliminarComprobanteEscrito(writtenFile.absolutePath);
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function obtenerComprobante(groupIdValue) {
  const groupId = normalizarIdLote(groupIdValue);
  const [[group]] = await db.query(
    `SELECT Id_Grupo_Comision, Comprobante_Ruta, Comprobante_Nombre_Original,
            Comprobante_Mime_Type, Comprobante_Tamano_Bytes
       FROM comisiones_grupos_pago WHERE Id_Grupo_Comision = ? LIMIT 1`,
    [groupId],
  );
  if (!group?.Comprobante_Ruta) throw serviceError('Este lote no tiene comprobante asociado.', 404, 'PROOF_NOT_FOUND');
  const absolutePath = rutaComprobanteAbsoluta(group.Comprobante_Ruta);
  if (!absolutePath) throw serviceError('La ruta del comprobante no es válida.', 500, 'DOCUMENT_PATH_ERROR');
  try { await fs.access(absolutePath); }
  catch { throw serviceError('El archivo del comprobante no está disponible.', 404, 'DOCUMENT_FILE_NOT_FOUND'); }
  return { ...group, absolutePath };
}

module.exports = {
  listarGrupos,
  obtenerDetalleGrupo,
  marcarGrupoPagado,
  anularPago,
  subirComprobante,
  obtenerComprobante,
  // Funciones puras exportadas para pruebas unitarias.
  parsearFiltros,
  groupReference,
  parseGroupReference,
  comprobanteDesdeRequest,
  buildGroupListQueries,
  buildUnlinkedQueries,
  obtenerEstadoJornadas,
  MAX_COMPROBANTE_BYTES,
};
