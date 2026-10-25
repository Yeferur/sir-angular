const { reservaNoEliminadaPredicate, reservasOperativasSource } = require('../schema-capabilities');
const db = require('../../database/db');
const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { recordHistorial } = require('../Historial/logger');

const FORMAS_PAGO = new Set(['TRANSFERENCIA_BANCOLOMBIA', 'NEQUI', 'EFECTIVO']);
const ESTADOS_LIQUIDACION = new Set(['PENDIENTE', 'PAGADO']);
const TIPOS_ENTIDAD_COMISIONABLE = new Set(['HOTEL', 'AGENCIA_NACIONAL']);
const LEGACY_TIPOS_BENEFICIARIO = new Set(['HOTEL', 'AGENCIA', 'FREELANCE']);
const NOMBRES_CANALES_COMISION = Object.freeze({
  HOTEL: 'HOTEL',
  'AGENCIA NACIONAL': 'AGENCIA_NACIONAL',
  'AGENCIA INTERNACIONAL': 'AGENCIA_INTERNACIONAL',
  FREELANCE: 'FREELANCE',
});
const MAX_RESERVAS_LOTE = 1000;
const MAX_DOCUMENTOS = 5;
const PRIVATE_DOCUMENT_ROOT = path.resolve(__dirname, '../../private_uploads/comisiones');

function createServiceError(message, status = 400, errorCode = 'VALIDATION_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function normalizarFormaPago(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'BANCOLOMBIA') return 'TRANSFERENCIA_BANCOLOMBIA';
  return normalized;
}

function validarReceptor(nombre, dni, formaPago = null) {
  const receptor = String(nombre || '').trim();
  const documento = String(dni || '').trim();
  if (!formaPago && !receptor && !documento) return { Nombre_Receptor: null, DNI_Receptor: null };
  if (receptor.length < 2 || receptor.length > 255) {
    throw createServiceError('Ingresa el nombre de la persona o empresa que recibe el pago.', 400, 'INVALID_PAYMENT_RECIPIENT');
  }
  if (documento.length < 4 || documento.length > 50 || !/^[a-zA-Z0-9.\-\s]+$/.test(documento)) {
    throw createServiceError('Ingresa un DNI, NIT o documento válido para quien recibe el pago.', 400, 'INVALID_PAYMENT_RECIPIENT_ID');
  }
  return { Nombre_Receptor: receptor, DNI_Receptor: documento };
}

function enmascararDocumento(value) {
  const document = String(value || '').trim();
  return document ? `***${document.slice(-4)}` : null;
}

function detectarTipoDocumento(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

async function prepararDocumento(file) {
  const detected = detectarTipoDocumento(file?.buffer);
  if (!detected) throw createServiceError('Uno de los documentos no es una imagen JPG, PNG o PDF válido.', 400, 'INVALID_DOCUMENT_CONTENT');
  let buffer = file.buffer;
  if (detected.mime === 'image/jpeg') {
    buffer = await sharp(buffer).rotate().resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } else if (detected.mime === 'image/png') {
    buffer = await sharp(buffer).rotate().resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
  }
  return {
    buffer,
    mime: detected.mime,
    ext: detected.ext,
    originalName: path.basename(String(file.originalname || `documento${detected.ext}`)).slice(0, 255),
  };
}

function rutaPrivadaAbsoluta(relativePath) {
  const relative = String(relativePath || '').replace(/\\/g, '/');
  if (!/^beneficiario-\d+\/[a-zA-Z0-9._-]+$/.test(relative)) return null;
  const absolute = path.resolve(PRIVATE_DOCUMENT_ROOT, relative);
  return absolute.startsWith(`${PRIVATE_DOCUMENT_ROOT}${path.sep}`) ? absolute : null;
}

async function eliminarArchivosPrivados(paths) {
  for (const relative of paths || []) {
    const absolute = rutaPrivadaAbsoluta(relative);
    if (!absolute) continue;
    try { await fs.unlink(absolute); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function validarDatosPago(formaPago, numeroCuenta, opciones = {}) {
  const { permitirVacio = false, permitirCuentaVacia = false } = opciones;
  const forma = normalizarFormaPago(formaPago);
  const cuenta = String(numeroCuenta || '').trim();

  if (permitirVacio && !forma && !cuenta) {
    return { Forma_Pago: null, Numero_Cuenta: null };
  }

  if (!FORMAS_PAGO.has(forma)) {
    throw createServiceError('Selecciona Bancolombia, Nequi o efectivo.', 400, 'INVALID_PAYMENT_METHOD');
  }
  if (forma === 'TRANSFERENCIA_BANCOLOMBIA' && cuenta && !/^\d{11}$/.test(cuenta)) {
    throw createServiceError('La cuenta Bancolombia debe tener exactamente 11 dígitos.', 400, 'INVALID_ACCOUNT');
  }
  if (forma === 'NEQUI' && cuenta && !/^3\d{9}$/.test(cuenta)) {
    throw createServiceError('El número Nequi debe tener 10 dígitos e iniciar en 3.', 400, 'INVALID_ACCOUNT');
  }
  if (!permitirCuentaVacia && forma !== 'EFECTIVO' && !cuenta) {
    throw createServiceError(
      forma === 'NEQUI'
        ? 'Ingresa el número asociado a Nequi.'
        : 'Ingresa el número de cuenta Bancolombia.',
      400,
      'INVALID_ACCOUNT',
    );
  }

  return {
    Forma_Pago: forma,
    Numero_Cuenta: forma === 'EFECTIVO' || !cuenta ? null : cuenta,
  };
}

function normalizarIdsReservas(reservas) {
  if (!Array.isArray(reservas) || reservas.length === 0) {
    throw createServiceError('Selecciona al menos una reserva.', 400, 'EMPTY_SELECTION');
  }
  const ids = [...new Set(reservas.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length || ids.length > MAX_RESERVAS_LOTE) {
    throw createServiceError('La selección de reservas no es válida.', 400, 'INVALID_SELECTION');
  }
  return ids;
}

function validarFecha(value) {
  const fecha = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw createServiceError('Selecciona una fecha válida.', 400, 'INVALID_DATE');
  }
  return fecha;
}

function fechaBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function tipoEntidadCanal(nombreCanal) {
  return NOMBRES_CANALES_COMISION[String(nombreCanal || '').trim().toLocaleUpperCase('es-CO')] || null;
}

function condicionesElegibilidadComision({ r = 'R', c = 'C', e = 'E', p = 'P' } = {}) {
  return [
    `${p}.Confirmacion = 1`,
    `${p}.Comision > 0`,
    `UPPER(TRIM(COALESCE(${p}.Tipo_Pasajero, ''))) <> 'INFANTE'`,
    `${r}.Fecha_Tour <= CURDATE()`,
    `UPPER(TRIM(COALESCE(${r}.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')`,
    `COALESCE(${c}.Tiene_Comision, 0) = 1`,
    `UPPER(TRIM(COALESCE(${c}.Nombre_Canal, ''))) <> 'AGENCIA INTERNACIONAL'`,
    `(
      (UPPER(TRIM(${c}.Nombre_Canal)) = 'HOTEL' AND ${r}.Id_Entidad_Reportante IS NOT NULL
        AND ${e}.Tipo = 'HOTEL' AND ${e}.Activo = 1 AND ${e}.Estado_Validacion <> 'RECHAZADA')
      OR (UPPER(TRIM(${c}.Nombre_Canal)) = 'AGENCIA NACIONAL' AND ${r}.Id_Entidad_Reportante IS NOT NULL
        AND ${e}.Tipo = 'AGENCIA_NACIONAL' AND ${e}.Activo = 1 AND ${e}.Estado_Validacion <> 'RECHAZADA')
      OR (UPPER(TRIM(${c}.Nombre_Canal)) = 'FREELANCE' AND ${r}.Id_Entidad_Reportante IS NULL)
    )`,
  ];
}

function buildPassengerQuery(filtros = {}) {
  const { Id_Tour, Id_Reserva, Fecha, Id_Canal, Nombre_Reportante, Estado } = filtros;
  const conditions = condicionesElegibilidadComision();
  const params = [];

  if (Id_Reserva) {
    const ids = normalizarIdsReservas(Array.isArray(Id_Reserva) ? Id_Reserva : [Id_Reserva]);
    conditions.push(`R.Id_Reserva IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  if (Fecha) {
    conditions.push('R.Fecha_Tour = ?');
    params.push(validarFecha(Fecha));
  }
  if (Id_Tour) {
    const ids = (Array.isArray(Id_Tour) ? Id_Tour : [Id_Tour])
      .map(Number)
      .filter(Number.isInteger);
    if (ids.length) {
      conditions.push(`H.Id_Tour IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (Id_Canal) {
    const idCanal = Number(Id_Canal);
    if (Number.isInteger(idCanal) && idCanal > 0) {
      conditions.push('C.Id_Canal = ?');
      params.push(idCanal);
    }
  }
  if (Nombre_Reportante) {
    conditions.push("CONCAT_WS(' ', COALESCE(E.Nombre, ''), COALESCE(R.Nombre_Reportante, '')) LIKE ?");
    params.push(`%${String(Nombre_Reportante).trim()}%`);
  }
  if (Estado && ESTADOS_LIQUIDACION.has(String(Estado).toUpperCase())) {
    conditions.push("COALESCE(L.Estado, 'PENDIENTE') = ?");
    params.push(String(Estado).toUpperCase());
  }

  return {
    sql: `
      SELECT
        R.Id_Reserva,
        R.Fecha_Tour,
        R.Nombre_Reportante,
        R.Telefono_Reportante,
        R.Tipo_Reserva,
        C.Id_Canal,
        C.Nombre_Canal,
        C.Tiene_Comision,
        E.Id_Entidad_Reportante,
        E.Tipo AS Tipo_Entidad,
        E.Nombre AS Nombre_Entidad,
        E.Activo AS Entidad_Activa,
        E.Estado_Validacion AS Estado_Validacion_Entidad,
        PC.Id_Perfil_Comision,
        PC.Forma_Pago AS Forma_Pago_Perfil,
        PC.Numero_Cuenta AS Cuenta_Perfil,
        PC.Nombre_Receptor AS Nombre_Receptor_Perfil,
        PC.DNI_Receptor AS DNI_Receptor_Perfil,
        T.Id_Tour,
        T.Nombre_Tour,
        P.Id_Pasajero,
        P.Nombre_Pasajero,
        P.DNI,
        P.Tipo_Pasajero,
        P.Comision AS Comision_Pasajero,
        COALESCE(L.Estado, 'PENDIENTE') AS Estado_Liquidacion,
        L.Forma_Pago AS Forma_Pago_Liquidacion,
        L.Cuenta_Bancaria AS Cuenta_Liquidacion,
        L.Nombre_Receptor_Snap,
        L.DNI_Receptor_Snap,
        L.Fecha_Pago,
        L.Monto_Comision_Pagada
      FROM ${reservasOperativasSource('R')}
      INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
      INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
      INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
      LEFT JOIN entidades_reportantes E ON E.Id_Entidad_Reportante = R.Id_Entidad_Reportante
      LEFT JOIN perfiles_comision_entidad PC
        ON PC.Id_Entidad_Reportante = E.Id_Entidad_Reportante AND PC.Activo = 1
      INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
      LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
      WHERE ${conditions.join(' AND ')}
      ORDER BY C.Nombre_Canal, COALESCE(E.Nombre, R.Nombre_Reportante), R.Id_Reserva, P.Id_Pasajero
    `,
    params,
  };
}

function esFilaComisionable(row) {
  const tipoCanal = tipoEntidadCanal(row.Nombre_Canal);
  if (!Number(row.Tiene_Comision) || !tipoCanal || tipoCanal === 'AGENCIA_INTERNACIONAL') return false;
  if (String(row.Tipo_Pasajero || '').toUpperCase() === 'INFANTE') return false;
  if (tipoCanal === 'FREELANCE') return !row.Id_Entidad_Reportante;
  return Boolean(row.Id_Entidad_Reportante)
    && row.Tipo_Entidad === tipoCanal
    && Number(row.Entidad_Activa) === 1
    && row.Estado_Validacion_Entidad !== 'RECHAZADA';
}

function resumirReservasElegibles(rows) {
  const reservas = new Map();
  for (const row of rows) {
    if (!esFilaComisionable(row)) continue;
    if (!reservas.has(row.Id_Reserva)) {
      reservas.set(row.Id_Reserva, {
        ...row,
        Monto_Comision: 0,
        Num_Pasajeros: 0,
        Comision_Minima: null,
        Comision_Maxima: null,
        pasajeros: [],
      });
    }
    const reserva = reservas.get(row.Id_Reserva);
    const comision = Number(row.Comision_Pasajero) || 0;
    reserva.Monto_Comision += comision;
    reserva.Num_Pasajeros += 1;
    reserva.Comision_Minima = reserva.Comision_Minima === null ? comision : Math.min(reserva.Comision_Minima, comision);
    reserva.Comision_Maxima = reserva.Comision_Maxima === null ? comision : Math.max(reserva.Comision_Maxima, comision);
    reserva.pasajeros.push({
      Id_Pasajero: Number(row.Id_Pasajero),
      Nombre_Pasajero: row.Nombre_Pasajero,
      DNI: row.DNI || null,
      Tipo_Pasajero: row.Tipo_Pasajero || null,
      Comision: comision,
    });
  }
  return [...reservas.values()];
}

function agruparComisiones(rows) {
  const canales = new Map();
  for (const row of resumirReservasElegibles(rows)) {
    const tipoCanal = tipoEntidadCanal(row.Nombre_Canal);
    if (!canales.has(row.Id_Canal)) {
      canales.set(row.Id_Canal, {
        Id_Canal: Number(row.Id_Canal),
        Nombre_Canal: row.Nombre_Canal,
        reportantesMap: new Map(),
        Total_Canal: 0,
        Pendiente_Canal: 0,
        Pagado_Canal: 0,
      });
    }

    const canal = canales.get(row.Id_Canal);
    const reportanteKey = tipoCanal === 'FREELANCE'
      ? `reserva:${row.Id_Reserva}`
      : `entidad:${row.Id_Entidad_Reportante}`;
    const nombre = tipoCanal === 'FREELANCE'
      ? (row.Nombre_Reportante || '(Sin reportante)')
      : (row.Nombre_Entidad || '(Sin entidad)');

    if (!canal.reportantesMap.has(reportanteKey)) {
      canal.reportantesMap.set(reportanteKey, {
        Key_Beneficiario: reportanteKey,
        Id_Entidad_Reportante: row.Id_Entidad_Reportante ? Number(row.Id_Entidad_Reportante) : null,
        Id_Perfil_Comision: row.Id_Perfil_Comision ? Number(row.Id_Perfil_Comision) : null,
        Tipo_Entidad: row.Tipo_Entidad || null,
        Nombre_Entidad: row.Nombre_Entidad || null,
        Nombre_Beneficiario: nombre,
        Id_Canal: Number(row.Id_Canal),
        Nombre_Reportante: tipoCanal === 'FREELANCE' ? (row.Nombre_Reportante || null) : null,
        Telefono: tipoCanal === 'FREELANCE' ? (row.Telefono_Reportante || null) : null,
        Centralizado: Boolean(row.Id_Perfil_Comision),
        Forma_Pago: row.Forma_Pago_Perfil || row.Forma_Pago_Liquidacion || null,
        Cuenta_Bancaria: row.Cuenta_Perfil || row.Cuenta_Liquidacion || null,
        Nombre_Receptor: row.Nombre_Receptor_Perfil || row.Nombre_Receptor_Snap || null,
        DNI_Receptor: row.DNI_Receptor_Perfil || row.DNI_Receptor_Snap || null,
        documentos: [],
        Origen_Datos_Pago: row.Forma_Pago_Perfil ? 'CENTRALIZADO' : (row.Forma_Pago_Liquidacion ? 'HISTORICO' : 'SIN_DATOS'),
        reservasMap: new Map(),
        Total_Reportante: 0,
        Pendiente_Reportante: 0,
        Pagado_Reportante: 0,
      });
    }

    const reportante = canal.reportantesMap.get(reportanteKey);
    const reserva = {
      Id_Reserva: row.Id_Reserva,
      Fecha_Tour: row.Fecha_Tour,
      Id_Tour: Number(row.Id_Tour),
      Nombre_Tour: row.Nombre_Tour,
      Nombre_Reportante: row.Nombre_Reportante || null,
      Telefono_Reportante: row.Telefono_Reportante || null,
      Tipo_Reserva: row.Tipo_Reserva || null,
      Num_Pasajeros: row.Num_Pasajeros,
      Total_Comision: row.Monto_Comision,
      Comision_Minima: row.Comision_Minima,
      Comision_Maxima: row.Comision_Maxima,
      Estado_Liquidacion: row.Estado_Liquidacion,
      Forma_Pago: row.Forma_Pago_Liquidacion || null,
      Cuenta_Bancaria: row.Cuenta_Liquidacion || null,
      Nombre_Receptor: row.Nombre_Receptor_Snap || null,
      DNI_Receptor: row.DNI_Receptor_Snap || null,
      Fecha_Pago: row.Fecha_Pago || null,
      Monto_Comision_Pagada: row.Monto_Comision_Pagada == null ? null : Number(row.Monto_Comision_Pagada),
      pasajeros: row.pasajeros,
    };
    reportante.reservasMap.set(row.Id_Reserva, reserva);
    const pagado = reserva.Estado_Liquidacion === 'PAGADO';
    reportante.Total_Reportante += reserva.Total_Comision;
    reportante.Pendiente_Reportante += pagado ? 0 : reserva.Total_Comision;
    reportante.Pagado_Reportante += pagado
      ? (reserva.Monto_Comision_Pagada == null ? reserva.Total_Comision : reserva.Monto_Comision_Pagada)
      : 0;
  }

  const result = [];
  for (const canal of canales.values()) {
    const reportantes = [];
    for (const reportante of canal.reportantesMap.values()) {
      const reservas = Array.from(reportante.reservasMap.values());
      canal.Total_Canal += reportante.Total_Reportante;
      canal.Pendiente_Canal += reportante.Pendiente_Reportante;
      canal.Pagado_Canal += reportante.Pagado_Reportante;
      const { reservasMap, ...reportanteData } = reportante;
      reportantes.push({ ...reportanteData, reservas });
    }
    const { reportantesMap, ...canalData } = canal;
    result.push({ ...canalData, reportantes });
  }
  return result;
}

async function listarComisiones(filtros = {}) {
  if (!filtros.Fecha) return [];
  const { sql, params } = buildPassengerQuery(filtros);
  const [rows] = await db.query(sql, params);
  return agruparComisiones(rows);
}

async function bloquearReservas(conn, ids) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT R.Id_Reserva FROM reservas R
     WHERE R.Id_Reserva IN (${placeholders}) AND ${reservaNoEliminadaPredicate('R')}
     FOR UPDATE`,
    ids,
  );
  return rows;
}

async function obtenerReservasElegibles(conn, ids) {
  const { sql, params } = buildPassengerQuery({ Id_Reserva: ids });
  const [rows] = await conn.query(sql, params);
  return resumirReservasElegibles(rows);
}

function claveGrupoReserva(row) {
  const tipoCanal = tipoEntidadCanal(row.Nombre_Canal);
  if (!Number(row.Tiene_Comision) || tipoCanal === 'AGENCIA_INTERNACIONAL') {
    throw createServiceError('El canal de una o más reservas no genera comisiones.', 409, 'CHANNEL_NOT_COMMISSIONABLE');
  }
  if (tipoCanal === 'HOTEL' || tipoCanal === 'AGENCIA_NACIONAL') {
    if (!row.Id_Entidad_Reportante || row.Tipo_Entidad !== tipoCanal) {
      throw createServiceError('La reserva no tiene una entidad reportante válida para su canal.', 409, 'ENTITY_COMMISSION_MISMATCH');
    }
    return `entidad:${row.Id_Entidad_Reportante}`;
  }
  if (tipoCanal === 'FREELANCE' && !row.Id_Entidad_Reportante) return `reserva:${row.Id_Reserva}`;
  throw createServiceError('El canal de una o más reservas no está configurado para comisiones.', 409, 'CHANNEL_NOT_COMMISSIONABLE');
}

function datosPagoEfectivos(grupo, reservas, estado) {
  const tipoCanal = tipoEntidadCanal(reservas[0]?.Nombre_Canal);
  if (tipoCanal === 'FREELANCE' && reservas.length !== 1) {
    throw createServiceError('Cada reserva Freelance se debe liquidar de forma independiente.', 400, 'FREELANCE_GROUP_NOT_ALLOWED');
  }
  const claves = new Set(reservas.map(claveGrupoReserva));
  if (claves.size !== 1) {
    throw createServiceError('Cada grupo de pago debe corresponder a una entidad o a una sola reserva Freelance.', 400, 'MIXED_COMMISSION_GROUP');
  }
  const perfil = TIPOS_ENTIDAD_COMISIONABLE.has(tipoCanal) && reservas[0].Id_Perfil_Comision
    && reservas[0].Forma_Pago_Perfil
    ? reservas[0]
    : null;
  const forma = perfil?.Forma_Pago_Perfil ?? grupo.Forma_Pago;
  const cuenta = perfil?.Cuenta_Perfil ?? grupo.Cuenta_Bancaria;
  const receptorNombre = perfil?.Nombre_Receptor_Perfil ?? grupo.Nombre_Receptor;
  const receptorDni = perfil?.DNI_Receptor_Perfil ?? grupo.DNI_Receptor;
  const paymentRequired = estado === 'PAGADO';
  const pago = validarDatosPago(forma, cuenta, {
    permitirVacio: !paymentRequired,
    permitirCuentaVacia: !paymentRequired,
  });
  const receptor = validarReceptor(receptorNombre, receptorDni, estado === 'PAGADO' ? pago.Forma_Pago : null);
  return {
    ...pago,
    ...receptor,
    Nombre_Beneficiario: tipoCanal === 'FREELANCE'
      ? (receptor.Nombre_Receptor || reservas[0].Nombre_Reportante || null)
      : reservas[0].Nombre_Entidad,
  };
}

async function actualizarLiquidacionesLote(payload, userId = null) {
  const estado = String(payload?.Estado || '').trim().toUpperCase();
  if (!ESTADOS_LIQUIDACION.has(estado)) {
    throw createServiceError('El estado de liquidación no es válido.', 400, 'INVALID_STATUS');
  }
  if (!Array.isArray(payload?.pagos) || !payload.pagos.length) {
    throw createServiceError('No hay comisiones seleccionadas.', 400, 'EMPTY_SELECTION');
  }

  const grupos = payload.pagos.map((grupo) => {
    const reservas = normalizarIdsReservas(grupo.reservas);
    return { ...grupo, reservas };
  });
  const allIds = grupos.flatMap((grupo) => grupo.reservas);
  const uniqueIds = [...new Set(allIds)];
  if (uniqueIds.length !== allIds.length || uniqueIds.length > MAX_RESERVAS_LOTE) {
    throw createServiceError('Hay reservas repetidas o la selección es demasiado grande.', 400, 'INVALID_SELECTION');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const locked = await bloquearReservas(conn, uniqueIds);
    if (locked.length !== uniqueIds.length) {
      const found = new Set(locked.map((row) => String(row.Id_Reserva)));
      throw createServiceError('Algunas reservas ya no están disponibles para liquidar.', 409, 'COMMISSION_CHANGED',
        uniqueIds.filter((id) => !found.has(String(id))));
    }
    const elegibles = await obtenerReservasElegibles(conn, uniqueIds);
    if (elegibles.length !== uniqueIds.length) {
      const found = new Set(elegibles.map((row) => String(row.Id_Reserva)));
      const invalidas = uniqueIds.filter((id) => !found.has(String(id)));
      throw createServiceError(
        'Algunas reservas ya no cumplen las condiciones para generar comisión.',
        409,
        'COMMISSION_CHANGED',
        invalidas,
      );
    }

    // HOTEL y AGENCIA NACIONAL pasan al pago por grupo entidad+día.
    // El camino heredado sigue intacto para Freelance, pero no puede crear ni
    // reabrir liquidaciones individuales de entidades después de activar lotes.
    if (elegibles.some((row) => TIPOS_ENTIDAD_COMISIONABLE.has(row.Tipo_Entidad))) {
      throw createServiceError(
        'HOTEL y AGENCIA NACIONAL se liquidan desde sus grupos por entidad y día.',
        409,
        'ENTITY_GROUP_PAYMENT_REQUIRED',
      );
    }

    const byId = new Map(elegibles.map((row) => [String(row.Id_Reserva), row]));
    const montoPorReserva = Object.fromEntries(elegibles.map((row) => [String(row.Id_Reserva), Number(row.Monto_Comision || 0)]));
    const montoTotalLote = Object.values(montoPorReserva).reduce((sum, value) => sum + value, 0);
    const fechaPago = estado === 'PAGADO' ? fechaBogota() : null;
    const values = [];
    for (const grupo of grupos) {
      const groupRows = grupo.reservas.map((idReserva) => byId.get(String(idReserva)));
      const payment = datosPagoEfectivos(grupo, groupRows, estado);
      for (const idReserva of grupo.reservas) {
        const reserva = byId.get(String(idReserva));
        values.push([
          idReserva,
          payment.Nombre_Beneficiario,
          payment.Forma_Pago,
          payment.Numero_Cuenta,
          payment.Nombre_Receptor,
          payment.DNI_Receptor,
          estado,
          fechaPago,
          estado === 'PAGADO' ? Number(reserva.Monto_Comision) : null,
          userId || null,
          userId || null,
        ]);
      }
    }

    await conn.query(
      `INSERT INTO liquidaciones
       (Id_Reserva, Nombre_Beneficiario_Snap,
        Forma_Pago, Cuenta_Bancaria, Nombre_Receptor_Snap, DNI_Receptor_Snap, Estado, Fecha_Pago, Monto_Comision_Pagada,
        Creado_Por, Actualizado_Por)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         Nombre_Beneficiario_Snap = VALUES(Nombre_Beneficiario_Snap),
         Forma_Pago = VALUES(Forma_Pago),
         Cuenta_Bancaria = VALUES(Cuenta_Bancaria),
         Nombre_Receptor_Snap = VALUES(Nombre_Receptor_Snap),
         DNI_Receptor_Snap = VALUES(DNI_Receptor_Snap),
         Estado = VALUES(Estado),
         Fecha_Pago = VALUES(Fecha_Pago),
         Monto_Comision_Pagada = VALUES(Monto_Comision_Pagada),
         Actualizado_Por = VALUES(Actualizado_Por)`,
      [values],
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'liquidaciones',
      id_registro: uniqueIds.join(','),
      accion: estado === 'PAGADO' ? 'PAGAR_COMISIONES' : 'REABRIR_COMISIONES',
      id_usuario: userId,
      detalles: [
        { columna: 'Reservas', anterior: null, nuevo: uniqueIds.length },
        { columna: 'Estado', anterior: null, nuevo: estado },
        ...(estado === 'PAGADO' ? [
          { columna: 'Monto_Comision_Pagada_Total', anterior: null, nuevo: montoTotalLote },
          { columna: 'Montos_Por_Reserva', anterior: null, nuevo: JSON.stringify(montoPorReserva) },
        ] : []),
      ],
    });

    await conn.commit();
    return {
      updated: uniqueIds.length,
      ...(estado === 'PAGADO' ? { montos: montoPorReserva } : {}),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function actualizarLiquidacion(payload, userId = null) {
  return actualizarLiquidacionesLote({
    Estado: payload?.Estado,
    pagos: [{
      reservas: payload?.reservas,
      Forma_Pago: payload?.Forma_Pago,
      Cuenta_Bancaria: payload?.Cuenta_Bancaria,
      Nombre_Receptor: payload?.Nombre_Receptor,
      DNI_Receptor: payload?.DNI_Receptor,
    }],
  }, userId);
}

async function actualizarDatosPago(payload, userId = null) {
  const reservas = normalizarIdsReservas(payload?.reservas);
  const pago = validarDatosPago(payload?.Forma_Pago, payload?.Cuenta_Bancaria);
  const receptor = validarReceptor(payload?.Nombre_Receptor, payload?.DNI_Receptor, pago.Forma_Pago);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const locked = await bloquearReservas(conn, reservas);
    if (locked.length !== reservas.length) {
      throw createServiceError('La selección cambió. Actualiza la consulta e inténtalo nuevamente.', 409, 'COMMISSION_CHANGED');
    }
    const elegibles = await obtenerReservasElegibles(conn, reservas);
    if (elegibles.length !== reservas.length) {
      throw createServiceError('La selección cambió. Actualiza la consulta e inténtalo nuevamente.', 409, 'COMMISSION_CHANGED');
    }
    const groupKeys = new Set(elegibles.map(claveGrupoReserva));
    if (groupKeys.size !== 1 || (tipoEntidadCanal(elegibles[0].Nombre_Canal) === 'FREELANCE' && elegibles.length !== 1)) {
      throw createServiceError('Actualiza los datos de pago por entidad o por una sola reserva Freelance.', 400, 'MIXED_COMMISSION_GROUP');
    }
    const byId = new Map(elegibles.map((row) => [String(row.Id_Reserva), row]));
    const values = reservas.map((idReserva) => {
      const reserva = byId.get(String(idReserva));
      return [
        idReserva,
        reserva.Nombre_Entidad || receptor.Nombre_Receptor || reserva.Nombre_Reportante || null,
        'PENDIENTE',
        pago.Forma_Pago,
        pago.Numero_Cuenta,
        receptor.Nombre_Receptor,
        receptor.DNI_Receptor,
        userId || null,
        userId || null,
      ];
    });

    await conn.query(
      `INSERT INTO liquidaciones
       (Id_Reserva, Nombre_Beneficiario_Snap,
        Estado, Forma_Pago, Cuenta_Bancaria, Nombre_Receptor_Snap, DNI_Receptor_Snap,
        Creado_Por, Actualizado_Por)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         Nombre_Beneficiario_Snap = VALUES(Nombre_Beneficiario_Snap),
         Forma_Pago = VALUES(Forma_Pago),
         Cuenta_Bancaria = VALUES(Cuenta_Bancaria),
         Nombre_Receptor_Snap = VALUES(Nombre_Receptor_Snap),
         DNI_Receptor_Snap = VALUES(DNI_Receptor_Snap),
         Actualizado_Por = VALUES(Actualizado_Por)`,
      [values],
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'liquidaciones',
      id_registro: reservas.join(','),
      accion: 'ACTUALIZAR_DATOS_PAGO_COMISION',
      id_usuario: userId,
      detalles: [
        { columna: 'Forma_Pago', anterior: null, nuevo: pago.Forma_Pago },
        { columna: 'Cuenta', anterior: null, nuevo: pago.Numero_Cuenta ? `***${pago.Numero_Cuenta.slice(-4)}` : 'EFECTIVO' },
      ],
    });
    await conn.commit();
    return { updated: reservas.length };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function validarIdEntidadComision(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createServiceError('Selecciona una entidad reportante válida.', 400, 'ENTITY_INVALID');
  }
  return id;
}

function validarTipoEntidadConPerfil(entity) {
  if (!entity || !TIPOS_ENTIDAD_COMISIONABLE.has(entity.Tipo)) {
    throw createServiceError(
      'Solo HOTEL y AGENCIA NACIONAL pueden tener un perfil de comisión reutilizable.',
      400,
      'ENTITY_COMMISSION_PROFILE_FORBIDDEN',
    );
  }
}

async function obtenerPerfilComisionEntidad(idEntidad) {
  const entityId = validarIdEntidadComision(idEntidad);
  const [[entity]] = await db.query(
    'SELECT Id_Entidad_Reportante, Tipo, Nombre FROM entidades_reportantes WHERE Id_Entidad_Reportante = ? LIMIT 1',
    [entityId],
  );
  if (!entity) throw createServiceError('La entidad reportante no existe.', 404, 'ENTITY_NOT_FOUND');
  validarTipoEntidadConPerfil(entity);
  const [[profile]] = await db.query(
    `SELECT Id_Perfil_Comision, Id_Entidad_Reportante, Forma_Pago, Numero_Cuenta,
            Nombre_Receptor, DNI_Receptor, Activo, Creado_Por, Actualizado_Por,
            Fecha_Registro, Fecha_Actualizacion
       FROM perfiles_comision_entidad
      WHERE Id_Entidad_Reportante = ? LIMIT 1`,
    [entityId],
  );
  return profile ? { ...profile, Tipo_Entidad: entity.Tipo, Nombre_Entidad: entity.Nombre } : null;
}

async function guardarPerfilComisionEntidad(payload, userId = null) {
  const entityId = validarIdEntidadComision(payload?.Id_Entidad_Reportante);
  const pago = validarDatosPago(payload?.Forma_Pago, payload?.Numero_Cuenta);
  const receptor = validarReceptor(payload?.Nombre_Receptor, payload?.DNI_Receptor, pago.Forma_Pago);
  const requestedProfileId = payload?.Id_Perfil_Comision == null ? null : Number(payload.Id_Perfil_Comision);
  if (requestedProfileId !== null && (!Number.isSafeInteger(requestedProfileId) || requestedProfileId <= 0)) {
    throw createServiceError('El perfil de comisión no es válido.', 400, 'PROFILE_INVALID');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[entity]] = await conn.query(
      `SELECT Id_Entidad_Reportante, Tipo, Nombre FROM entidades_reportantes
        WHERE Id_Entidad_Reportante = ? FOR UPDATE`,
      [entityId],
    );
    if (!entity) throw createServiceError('La entidad reportante no existe.', 404, 'ENTITY_NOT_FOUND');
    validarTipoEntidadConPerfil(entity);

    const [[existing]] = await conn.query(
      `SELECT Id_Perfil_Comision, Forma_Pago, Numero_Cuenta, Nombre_Receptor, DNI_Receptor
         FROM perfiles_comision_entidad WHERE Id_Entidad_Reportante = ? LIMIT 1 FOR UPDATE`,
      [entityId],
    );
    if (requestedProfileId && existing && Number(existing.Id_Perfil_Comision) !== requestedProfileId) {
      throw createServiceError('El perfil no pertenece a la entidad indicada.', 409, 'PROFILE_ENTITY_MISMATCH');
    }

    let profileId;
    let created = false;
    if (existing) {
      profileId = Number(existing.Id_Perfil_Comision);
      await conn.query(
        `UPDATE perfiles_comision_entidad
            SET Forma_Pago = ?, Numero_Cuenta = ?, Nombre_Receptor = ?, DNI_Receptor = ?,
                Activo = 1, Actualizado_Por = ?
          WHERE Id_Perfil_Comision = ?`,
        [pago.Forma_Pago, pago.Numero_Cuenta, receptor.Nombre_Receptor, receptor.DNI_Receptor,
          userId || null, profileId],
      );
    } else {
      if (requestedProfileId) throw createServiceError('El perfil de comisión ya no existe.', 404, 'PROFILE_NOT_FOUND');
      const [result] = await conn.query(
        `INSERT INTO perfiles_comision_entidad
          (Id_Entidad_Reportante, Forma_Pago, Numero_Cuenta, Nombre_Receptor, DNI_Receptor,
           Creado_Por, Actualizado_Por)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entityId, pago.Forma_Pago, pago.Numero_Cuenta, receptor.Nombre_Receptor, receptor.DNI_Receptor,
          userId || null, userId || null],
      );
      profileId = Number(result.insertId);
      created = true;
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'perfiles_comision_entidad',
      id_registro: profileId,
      accion: created ? 'CREAR_PERFIL_COMISION_ENTIDAD' : 'ACTUALIZAR_PERFIL_COMISION_ENTIDAD',
      id_usuario: userId,
      detalles: [
        { columna: 'Id_Entidad_Reportante', anterior: null, nuevo: entityId },
        { columna: 'Forma_Pago', anterior: existing?.Forma_Pago || null, nuevo: pago.Forma_Pago },
        { columna: 'Numero_Cuenta', anterior: existing?.Numero_Cuenta ? `***${String(existing.Numero_Cuenta).slice(-4)}` : null,
          nuevo: pago.Numero_Cuenta ? `***${pago.Numero_Cuenta.slice(-4)}` : 'EFECTIVO' },
        { columna: 'Nombre_Receptor', anterior: existing?.Nombre_Receptor || null, nuevo: receptor.Nombre_Receptor },
        { columna: 'DNI_Receptor', anterior: enmascararDocumento(existing?.DNI_Receptor), nuevo: enmascararDocumento(receptor.DNI_Receptor) },
      ],
    });
    await conn.commit();
    return {
      Id_Perfil_Comision: profileId,
      Id_Entidad_Reportante: entityId,
      Tipo_Entidad: entity.Tipo,
      Nombre_Entidad: entity.Nombre,
      Forma_Pago: pago.Forma_Pago,
      Numero_Cuenta: pago.Numero_Cuenta,
      Nombre_Receptor: receptor.Nombre_Receptor,
      DNI_Receptor: receptor.DNI_Receptor,
      Activo: 1,
      created,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function guardarBeneficiarioDesdeComision(payload, userId = null, files = []) {
  const Id_Canal = Number(payload?.Id_Canal);
  const tipo = String(payload?.Tipo_Beneficiario || '').trim().toUpperCase();
  const nombre = String(payload?.Nombre || '').trim();
  const telefono = String(payload?.Telefono || '').trim() || null;
  const pago = validarDatosPago(payload?.Forma_Pago, payload?.Numero_Cuenta);
  const receptor = validarReceptor(payload?.Nombre_Receptor, payload?.DNI_Receptor, pago.Forma_Pago);
  const reservas = normalizarIdsReservas(payload?.reservas);
  const uploadedFiles = Array.isArray(files) ? files : [];
  if (uploadedFiles.length > MAX_DOCUMENTOS) {
    throw createServiceError(`Puedes adjuntar máximo ${MAX_DOCUMENTOS} documentos.`, 400, 'TOO_MANY_DOCUMENTS');
  }
  const preparedDocuments = await Promise.all(uploadedFiles.map(prepararDocumento));

  if (!Number.isInteger(Id_Canal) || Id_Canal <= 0 || !LEGACY_TIPOS_BENEFICIARIO.has(tipo) || nombre.length < 2) {
    throw createServiceError('Completa correctamente el beneficiario.', 400, 'INVALID_BENEFICIARY');
  }

  const conn = await db.getConnection();
  const writtenPaths = [];
  let committed = false;
  try {
    await conn.beginTransaction();
    let beneficiario = null;
    const requestedId = Number(payload?.Id_Beneficiario);
    if (Number.isInteger(requestedId) && requestedId > 0) {
      const [rows] = await conn.query(
        'SELECT * FROM beneficiarios_comision WHERE Id_Beneficiario = ? AND Activo = 1 FOR UPDATE',
        [requestedId],
      );
      beneficiario = rows[0] || null;
    } else {
      const [rows] = await conn.query(
        `SELECT * FROM beneficiarios_comision
         WHERE Id_Canal = ? AND Activo = 1 AND LOWER(TRIM(Nombre)) = LOWER(?)
         ORDER BY Id_Beneficiario ASC LIMIT 1 FOR UPDATE`,
        [Id_Canal, nombre],
      );
      beneficiario = rows[0] || null;
    }

    let idBeneficiario;
    let created = false;
    if (beneficiario) {
      idBeneficiario = Number(beneficiario.Id_Beneficiario);
      await conn.query(
        `UPDATE beneficiarios_comision
         SET Tipo_Beneficiario = ?, Nombre = ?, Telefono = ?, Forma_Pago = ?,
             Numero_Cuenta = ?, Nombre_Receptor = ?, DNI_Receptor = ?, Actualizado_Por = ?
         WHERE Id_Beneficiario = ?`,
        [tipo, nombre, telefono, pago.Forma_Pago, pago.Numero_Cuenta, receptor.Nombre_Receptor, receptor.DNI_Receptor, userId || null, idBeneficiario],
      );
    } else {
      const [result] = await conn.query(
        `INSERT INTO beneficiarios_comision
         (Id_Canal, Tipo_Beneficiario, Nombre, Telefono, Forma_Pago, Numero_Cuenta,
          Nombre_Receptor, DNI_Receptor, Creado_Por, Actualizado_Por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Id_Canal, tipo, nombre, telefono, pago.Forma_Pago, pago.Numero_Cuenta, receptor.Nombre_Receptor, receptor.DNI_Receptor, userId || null, userId || null],
      );
      idBeneficiario = Number(result.insertId);
      created = true;
    }

    let documents = [];
    const [existingDocuments] = await conn.query(
      `SELECT Id_Documento, Id_Beneficiario, Nombre_Original, Mime_Type, Tamano_Bytes, Fecha_Creacion
       FROM beneficiarios_comision_documentos WHERE Id_Beneficiario = ? FOR UPDATE`,
      [idBeneficiario],
    );
    if (existingDocuments.length + preparedDocuments.length > MAX_DOCUMENTOS) {
      throw createServiceError(
        `El beneficiario puede tener máximo ${MAX_DOCUMENTOS} documentos. Elimina uno antes de adjuntar más.`,
        400,
        'TOO_MANY_DOCUMENTS',
      );
    }

    if (preparedDocuments.length) {
      const relativeDir = `beneficiario-${idBeneficiario}`;
      const absoluteDir = path.resolve(PRIVATE_DOCUMENT_ROOT, relativeDir);
      await fs.mkdir(absoluteDir, { recursive: true });
      const documentValues = [];
      for (const document of preparedDocuments) {
        const storedName = `${randomUUID()}${document.ext}`;
        const relativePath = `${relativeDir}/${storedName}`;
        const absolutePath = rutaPrivadaAbsoluta(relativePath);
        if (!absolutePath) throw createServiceError('No fue posible preparar la ruta del documento.', 500, 'DOCUMENT_PATH_ERROR');
        await fs.writeFile(absolutePath, document.buffer, { flag: 'wx' });
        writtenPaths.push(relativePath);
        documentValues.push([idBeneficiario, document.originalName, storedName, relativePath, document.mime, document.buffer.length, userId || null]);
      }
      await conn.query(
        `INSERT INTO beneficiarios_comision_documentos
         (Id_Beneficiario, Nombre_Original, Nombre_Almacenado, Ruta_Privada, Mime_Type, Tamano_Bytes, Creado_Por)
         VALUES ?`,
        [documentValues],
      );
    }

    [documents] = await conn.query(
      `SELECT Id_Documento, Id_Beneficiario, Nombre_Original, Mime_Type, Tamano_Bytes, Fecha_Creacion
       FROM beneficiarios_comision_documentos WHERE Id_Beneficiario = ? ORDER BY Id_Documento DESC`,
      [idBeneficiario],
    );

    const placeholders = reservas.map(() => '?').join(',');
    const [reservasValidas] = await conn.query(
      `SELECT r.Id_Reserva FROM reservas r WHERE ${reservaNoEliminadaPredicate('r')}
        AND r.Id_Reserva IN (${placeholders}) AND r.Id_Canal = ? FOR UPDATE`,
      [...reservas, Id_Canal],
    );
    if (reservasValidas.length !== reservas.length) {
      throw createServiceError('No fue posible vincular todas las reservas al beneficiario.', 409, 'BENEFICIARY_LINK_FAILED');
    }

    await conn.query(
      `UPDATE reservas
       SET Id_Beneficiario_Comision = ?
       WHERE Id_Reserva IN (${placeholders}) AND Id_Canal = ?`,
      [idBeneficiario, ...reservas, Id_Canal],
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'beneficiarios_comision',
      id_registro: idBeneficiario,
      accion: created ? 'CREAR_BENEFICIARIO_COMISION' : 'ACTUALIZAR_BENEFICIARIO_COMISION',
      id_usuario: userId,
      detalles: [
        { columna: 'Nombre', anterior: beneficiario?.Nombre || null, nuevo: nombre },
        { columna: 'Forma_Pago', anterior: beneficiario?.Forma_Pago || null, nuevo: pago.Forma_Pago },
        { columna: 'Cuenta', anterior: beneficiario?.Numero_Cuenta ? `***${String(beneficiario.Numero_Cuenta).slice(-4)}` : null, nuevo: pago.Numero_Cuenta ? `***${pago.Numero_Cuenta.slice(-4)}` : 'EFECTIVO' },
        { columna: 'Receptor', anterior: beneficiario?.Nombre_Receptor || null, nuevo: receptor.Nombre_Receptor },
        { columna: 'Documento_Receptor', anterior: enmascararDocumento(beneficiario?.DNI_Receptor), nuevo: enmascararDocumento(receptor.DNI_Receptor) },
        { columna: 'Documentos_Adjuntos', anterior: null, nuevo: preparedDocuments.length || 'SIN_CAMBIOS' },
      ],
    });

    await conn.commit();
    committed = true;
    return {
      Id_Beneficiario: idBeneficiario,
      Id_Canal,
      Tipo_Beneficiario: tipo,
      Nombre: nombre,
      Telefono: telefono,
      Forma_Pago: pago.Forma_Pago,
      Numero_Cuenta: pago.Numero_Cuenta,
      Nombre_Receptor: receptor.Nombre_Receptor,
      DNI_Receptor: receptor.DNI_Receptor,
      documentos: documents,
      created,
    };
  } catch (error) {
    if (!committed) {
      await conn.rollback();
      await eliminarArchivosPrivados(writtenPaths);
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function obtenerDocumentoBeneficiario(idDocumento) {
  const [[document]] = await db.query(
    `SELECT Id_Documento, Id_Beneficiario, Nombre_Original, Ruta_Privada, Mime_Type, Tamano_Bytes
     FROM beneficiarios_comision_documentos WHERE Id_Documento = ? LIMIT 1`,
    [idDocumento],
  );
  if (!document) throw createServiceError('Documento no encontrado.', 404, 'DOCUMENT_NOT_FOUND');
  const absolutePath = rutaPrivadaAbsoluta(document.Ruta_Privada);
  if (!absolutePath) throw createServiceError('La ruta del documento no es válida.', 500, 'DOCUMENT_PATH_ERROR');
  try { await fs.access(absolutePath); }
  catch { throw createServiceError('El archivo del documento no está disponible.', 404, 'DOCUMENT_FILE_NOT_FOUND'); }
  return { ...document, absolutePath };
}

async function eliminarDocumentoBeneficiario(idBeneficiario, idDocumento) {
  const conn = await db.getConnection();
  let originalPath = null;
  let tombstonePath = null;
  let committed = false;
  try {
    await conn.beginTransaction();
    const [[document]] = await conn.query(
      `SELECT Ruta_Privada FROM beneficiarios_comision_documentos
       WHERE Id_Documento = ? AND Id_Beneficiario = ? LIMIT 1 FOR UPDATE`,
      [idDocumento, idBeneficiario],
    );
    if (!document) throw createServiceError('Documento no encontrado.', 404, 'DOCUMENT_NOT_FOUND');
    originalPath = rutaPrivadaAbsoluta(document.Ruta_Privada);
    if (originalPath) {
      tombstonePath = `${originalPath}.delete-${randomUUID()}`;
      try { await fs.rename(originalPath, tombstonePath); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; tombstonePath = null; }
    }
    await conn.query(
      'DELETE FROM beneficiarios_comision_documentos WHERE Id_Documento = ? AND Id_Beneficiario = ?',
      [idDocumento, idBeneficiario],
    );
    await conn.commit();
    committed = true;
    if (tombstonePath) await fs.unlink(tombstonePath);
    return { deleted: 1 };
  } catch (error) {
    if (!committed) {
      await conn.rollback();
      if (tombstonePath && originalPath) {
        try { await fs.rename(tombstonePath, originalPath); } catch { /* recuperación de mejor esfuerzo */ }
      }
    }
    throw error;
  } finally {
    conn.release();
  }
}

function paymentLabel(value) {
  if (value === 'TRANSFERENCIA_BANCOLOMBIA') return 'Bancolombia';
  if (value === 'NEQUI') return 'Nequi';
  if (value === 'EFECTIVO') return 'Efectivo';
  return 'Sin definir';
}

function sanitizeWorksheetName(value, fallback) {
  const cleaned = String(value || '').replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 22;
}

async function generarExcelComisiones(filtros, res) {
  const fecha = validarFecha(filtros?.Fecha);
  const canales = await listarComisiones({ ...filtros, Fecha: fecha });
  if (!canales.length) {
    throw createServiceError('No hay comisiones para exportar con estos filtros.', 404, 'NO_DATA');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIR - Maxitours';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [
    { header: 'CANAL', key: 'canal', width: 24 },
    { header: 'BENEFICIARIO', key: 'beneficiario', width: 34 },
    { header: 'MEDIO', key: 'medio', width: 18 },
    { header: 'NÚMERO', key: 'cuenta', width: 20 },
    { header: 'RECIBE', key: 'receptor', width: 32 },
    { header: 'DNI / NIT RECEPTOR', key: 'dniReceptor', width: 20 },
    { header: 'RESERVAS', key: 'reservas', width: 12 },
    { header: 'RESERVAS ASOCIADAS', key: 'reservasAsociadas', width: 38 },
    { header: 'PASAJEROS', key: 'pasajeros', width: 12 },
    { header: 'PENDIENTE', key: 'pendiente', width: 18 },
    { header: 'PAGADO', key: 'pagado', width: 18 },
    { header: 'TOTAL', key: 'total', width: 18 },
  ];
  styleHeader(summary.getRow(1));

  let totalGeneral = 0;
  let pendienteGeneral = 0;
  let pagadoGeneral = 0;
  const usedSheetNames = new Set(['Resumen']);

  for (const canal of canales) {
    for (const rep of canal.reportantes) {
      summary.addRow({
        canal: canal.Nombre_Canal,
        beneficiario: rep.Nombre_Beneficiario || rep.Nombre_Entidad || rep.Nombre_Reportante || '',
        medio: paymentLabel(rep.Forma_Pago),
        cuenta: rep.Cuenta_Bancaria || (rep.Forma_Pago === 'EFECTIVO' ? 'EFECTIVO' : ''),
        receptor: rep.Nombre_Receptor || '',
        dniReceptor: rep.DNI_Receptor || '',
        reservas: rep.reservas.length,
        reservasAsociadas: rep.reservas.map(reserva => reserva.Id_Reserva).join(', '),
        pasajeros: rep.reservas.reduce((sum, reserva) => sum + reserva.Num_Pasajeros, 0),
        pendiente: rep.Pendiente_Reportante,
        pagado: rep.Pagado_Reportante,
        total: rep.Total_Reportante,
      });
    }
    totalGeneral += canal.Total_Canal;
    pendienteGeneral += canal.Pendiente_Canal;
    pagadoGeneral += canal.Pagado_Canal;

    let sheetName = sanitizeWorksheetName(canal.Nombre_Canal, `Canal ${canal.Id_Canal}`);
    let suffix = 2;
    const base = sheetName.slice(0, 27);
    while (usedSheetNames.has(sheetName)) sheetName = `${base} ${suffix++}`.slice(0, 31);
    usedSheetNames.add(sheetName);

    const ws = workbook.addWorksheet(sheetName);
    ws.columns = [
      { header: 'ID RESERVA', key: 'reserva', width: 18 },
      { header: 'BENEFICIARIO', key: 'beneficiario', width: 32 },
      { header: 'PASAJERO', key: 'pasajero', width: 32 },
      { header: 'DNI / PASAPORTE', key: 'dni', width: 20 },
      { header: 'TIPO', key: 'tipo', width: 13 },
      { header: 'TOUR', key: 'tour', width: 26 },
      { header: 'COMISIÓN', key: 'comision', width: 16 },
      { header: 'ESTADO', key: 'estado', width: 14 },
      { header: 'MEDIO', key: 'medio', width: 18 },
      { header: 'NÚMERO', key: 'cuenta', width: 20 },
      { header: 'RECIBE', key: 'receptor', width: 30 },
      { header: 'DNI / NIT RECEPTOR', key: 'dniReceptor', width: 20 },
      { header: 'FECHA PAGO', key: 'fechaPago', width: 15 },
    ];
    styleHeader(ws.getRow(1));

    for (const rep of canal.reportantes) {
      for (const reserva of rep.reservas) {
        for (const pasajero of reserva.pasajeros) {
          ws.addRow({
            reserva: reserva.Id_Reserva,
            beneficiario: rep.Nombre_Beneficiario || rep.Nombre_Entidad || rep.Nombre_Reportante || '',
            pasajero: pasajero.Nombre_Pasajero,
            dni: pasajero.DNI || '',
            tipo: pasajero.Tipo_Pasajero || '',
            tour: reserva.Nombre_Tour,
            comision: pasajero.Comision,
            estado: reserva.Estado_Liquidacion,
            medio: paymentLabel(reserva.Forma_Pago || rep.Forma_Pago),
            cuenta: reserva.Cuenta_Bancaria || rep.Cuenta_Bancaria || '',
            receptor: reserva.Nombre_Receptor || rep.Nombre_Receptor || '',
            dniReceptor: reserva.DNI_Receptor || rep.DNI_Receptor || '',
            fechaPago: reserva.Fecha_Pago || '',
          });
        }
      }
    }
    ws.getColumn('comision').numFmt = '$#,##0';
    ws.autoFilter = { from: 'A1', to: 'M1' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const totalRow = summary.addRow({
    canal: 'TOTAL GENERAL',
    pendiente: pendienteGeneral,
    pagado: pagadoGeneral,
    total: totalGeneral,
  });
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
  ['pendiente', 'pagado', 'total'].forEach((key) => { summary.getColumn(key).numFmt = '$#,##0'; });
  summary.autoFilter = { from: 'A1', to: 'L1' };
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Comisiones_${fecha}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = {
  listarComisiones,
  actualizarLiquidacion,
  actualizarLiquidacionesLote,
  actualizarDatosPago,
  obtenerPerfilComisionEntidad,
  guardarPerfilComisionEntidad,
  guardarBeneficiarioDesdeComision,
  obtenerDocumentoBeneficiario,
  eliminarDocumentoBeneficiario,
  generarExcelComisiones,
  // Exportados para pruebas unitarias.
  agruparComisiones,
  buildPassengerQuery,
  condicionesElegibilidadComision,
  tipoEntidadCanal,
  claveGrupoReserva,
  datosPagoEfectivos,
  validarDatosPago,
  normalizarFormaPago,
  validarReceptor,
  detectarTipoDocumento,
};
