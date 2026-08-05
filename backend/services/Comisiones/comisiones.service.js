const db = require('../../database/db');
const ExcelJS = require('exceljs');
const { recordHistorial } = require('../Historial/logger');

const FORMAS_PAGO = new Set(['TRANSFERENCIA_BANCOLOMBIA', 'NEQUI', 'EFECTIVO']);
const ESTADOS_LIQUIDACION = new Set(['PENDIENTE', 'PAGADO']);
const TIPOS_BENEFICIARIO = new Set(['HOTEL', 'AGENCIA', 'FREELANCE']);
const MAX_RESERVAS_LOTE = 1000;

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

function validarDatosPago(formaPago, numeroCuenta) {
  const forma = normalizarFormaPago(formaPago);
  const cuenta = String(numeroCuenta || '').trim();

  if (!FORMAS_PAGO.has(forma)) {
    throw createServiceError('Selecciona Bancolombia, Nequi o efectivo.', 400, 'INVALID_PAYMENT_METHOD');
  }
  if (forma === 'TRANSFERENCIA_BANCOLOMBIA' && !/^\d{11}$/.test(cuenta)) {
    throw createServiceError('La cuenta Bancolombia debe tener exactamente 11 dígitos.', 400, 'INVALID_ACCOUNT');
  }
  if (forma === 'NEQUI' && !/^3\d{9}$/.test(cuenta)) {
    throw createServiceError('El número Nequi debe tener 10 dígitos e iniciar en 3.', 400, 'INVALID_ACCOUNT');
  }

  return {
    Forma_Pago: forma,
    Numero_Cuenta: forma === 'EFECTIVO' ? null : cuenta,
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

function buildPassengerQuery(filtros = {}) {
  const { Id_Tour, Fecha, Id_Canal, Nombre_Reportante, Estado } = filtros;
  const conditions = [
    'P.Confirmacion = 1',
    'P.Comision > 0',
    'R.Fecha_Tour <= CURDATE()',
    "UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')",
  ];
  const params = [];

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
    conditions.push("COALESCE(B.Nombre, R.Nombre_Reportante, '') LIKE ?");
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
        C.Id_Canal,
        C.Nombre_Canal,
        T.Id_Tour,
        T.Nombre_Tour,
        P.Id_Pasajero,
        P.Nombre_Pasajero,
        P.DNI,
        P.Tipo_Pasajero,
        P.Comision AS Comision_Pasajero,
        B.Id_Beneficiario,
        B.Tipo_Beneficiario,
        B.Nombre AS Nombre_Beneficiario,
        B.Telefono AS Telefono_Beneficiario,
        B.Forma_Pago AS Forma_Pago_Beneficiario,
        B.Numero_Cuenta AS Cuenta_Beneficiario,
        COALESCE(L.Estado, 'PENDIENTE') AS Estado_Liquidacion,
        L.Forma_Pago AS Forma_Pago_Liquidacion,
        L.Cuenta_Bancaria AS Cuenta_Liquidacion,
        L.Fecha_Pago
      FROM reservas R
      INNER JOIN horarios H ON H.Id_Horario = R.Id_Horario
      INNER JOIN tours T ON T.Id_Tour = H.Id_Tour
      INNER JOIN canales_reservas C ON C.Id_Canal = R.Id_Canal
      INNER JOIN pasajeros P ON P.Id_Reserva = R.Id_Reserva
      LEFT JOIN beneficiarios_comision B
        ON B.Id_Beneficiario = R.Id_Beneficiario_Comision
       AND B.Activo = 1
      LEFT JOIN liquidaciones L ON L.Id_Reserva = R.Id_Reserva
      WHERE ${conditions.join(' AND ')}
      ORDER BY C.Nombre_Canal, COALESCE(B.Nombre, R.Nombre_Reportante), R.Id_Reserva, P.Id_Pasajero
    `,
    params,
  };
}

function legacyBeneficiaryKey(row) {
  return `${row.Id_Canal}:${String(row.Nombre_Reportante || '(Sin beneficiario)').trim().toLocaleUpperCase('es-CO')}`;
}

function agruparComisiones(rows) {
  const canales = new Map();

  for (const row of rows) {
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
    const reportanteKey = row.Id_Beneficiario
      ? `beneficiario:${row.Id_Beneficiario}`
      : `legacy:${legacyBeneficiaryKey(row)}`;
    const nombre = row.Nombre_Beneficiario || row.Nombre_Reportante || '(Sin beneficiario)';

    if (!canal.reportantesMap.has(reportanteKey)) {
      const forma = row.Forma_Pago_Beneficiario || row.Forma_Pago_Liquidacion || null;
      const cuenta = row.Cuenta_Beneficiario || row.Cuenta_Liquidacion || null;
      canal.reportantesMap.set(reportanteKey, {
        Key_Beneficiario: reportanteKey,
        Id_Beneficiario: row.Id_Beneficiario ? Number(row.Id_Beneficiario) : null,
        Id_Canal: Number(row.Id_Canal),
        Tipo_Beneficiario: row.Tipo_Beneficiario || null,
        Nombre_Reportante: nombre,
        Telefono: row.Telefono_Beneficiario || row.Telefono_Reportante || null,
        Centralizado: Boolean(row.Id_Beneficiario),
        Forma_Pago: forma,
        Cuenta_Bancaria: cuenta,
        Origen_Datos_Pago: row.Forma_Pago_Beneficiario ? 'CENTRALIZADO' : (row.Forma_Pago_Liquidacion ? 'HISTORICO' : 'SIN_DATOS'),
        reservasMap: new Map(),
        Total_Reportante: 0,
        Pendiente_Reportante: 0,
        Pagado_Reportante: 0,
      });
    }

    const reportante = canal.reportantesMap.get(reportanteKey);
    if (!reportante.reservasMap.has(row.Id_Reserva)) {
      reportante.reservasMap.set(row.Id_Reserva, {
        Id_Reserva: row.Id_Reserva,
        Fecha_Tour: row.Fecha_Tour,
        Id_Tour: Number(row.Id_Tour),
        Nombre_Tour: row.Nombre_Tour,
        Num_Pasajeros: 0,
        Total_Comision: 0,
        Comision_Minima: null,
        Comision_Maxima: null,
        Estado_Liquidacion: row.Estado_Liquidacion,
        Forma_Pago: row.Forma_Pago_Liquidacion || null,
        Cuenta_Bancaria: row.Cuenta_Liquidacion || null,
        Fecha_Pago: row.Fecha_Pago || null,
        pasajeros: [],
      });
    }

    const reserva = reportante.reservasMap.get(row.Id_Reserva);
    const comision = Number(row.Comision_Pasajero) || 0;
    reserva.Num_Pasajeros += 1;
    reserva.Total_Comision += comision;
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

  const result = [];
  for (const canal of canales.values()) {
    const reportantes = [];
    for (const reportante of canal.reportantesMap.values()) {
      const reservas = Array.from(reportante.reservasMap.values());
      for (const reserva of reservas) {
        const pagado = reserva.Estado_Liquidacion === 'PAGADO';
        reportante.Total_Reportante += reserva.Total_Comision;
        reportante.Pendiente_Reportante += pagado ? 0 : reserva.Total_Comision;
        reportante.Pagado_Reportante += pagado ? reserva.Total_Comision : 0;
      }
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

async function obtenerReservasElegibles(conn, ids, lock = false) {
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT
       R.Id_Reserva,
       R.Id_Canal,
       R.Id_Beneficiario_Comision,
       COALESCE(B.Nombre, R.Nombre_Reportante, '(Sin beneficiario)') AS Nombre_Beneficiario
     FROM reservas R
     LEFT JOIN beneficiarios_comision B ON B.Id_Beneficiario = R.Id_Beneficiario_Comision
     WHERE R.Id_Reserva IN (${placeholders})
       AND R.Fecha_Tour <= CURDATE()
       AND UPPER(TRIM(COALESCE(R.Estado, ''))) NOT IN ('CANCELADA', 'CANCELADO', 'ELIMINADA', 'ELIMINADO')
       AND EXISTS (
         SELECT 1
         FROM pasajeros P
         WHERE P.Id_Reserva = R.Id_Reserva
           AND P.Confirmacion = 1
           AND P.Comision > 0
       )
     ${lock ? 'FOR UPDATE' : ''}`,
    ids,
  );
  return rows;
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
    const pago = validarDatosPago(grupo.Forma_Pago, grupo.Cuenta_Bancaria);
    return { ...pago, reservas };
  });
  const allIds = grupos.flatMap((grupo) => grupo.reservas);
  const uniqueIds = [...new Set(allIds)];
  if (uniqueIds.length !== allIds.length || uniqueIds.length > MAX_RESERVAS_LOTE) {
    throw createServiceError('Hay reservas repetidas o la selección es demasiado grande.', 400, 'INVALID_SELECTION');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const elegibles = await obtenerReservasElegibles(conn, uniqueIds, true);
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

    const byId = new Map(elegibles.map((row) => [String(row.Id_Reserva), row]));
    const fechaPago = estado === 'PAGADO' ? fechaBogota() : null;
    const values = [];
    for (const grupo of grupos) {
      for (const idReserva of grupo.reservas) {
        const reserva = byId.get(String(idReserva));
        values.push([
          idReserva,
          reserva.Id_Beneficiario_Comision || null,
          reserva.Nombre_Beneficiario || null,
          grupo.Forma_Pago,
          grupo.Numero_Cuenta,
          estado,
          fechaPago,
        ]);
      }
    }

    await conn.query(
      `INSERT INTO liquidaciones
       (Id_Reserva, Id_Beneficiario_Comision, Nombre_Beneficiario_Snap,
        Forma_Pago, Cuenta_Bancaria, Estado, Fecha_Pago)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         Id_Beneficiario_Comision = VALUES(Id_Beneficiario_Comision),
         Nombre_Beneficiario_Snap = VALUES(Nombre_Beneficiario_Snap),
         Forma_Pago = VALUES(Forma_Pago),
         Cuenta_Bancaria = VALUES(Cuenta_Bancaria),
         Estado = VALUES(Estado),
         Fecha_Pago = VALUES(Fecha_Pago)`,
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
      ],
    });

    await conn.commit();
    return { updated: uniqueIds.length };
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
    }],
  }, userId);
}

async function actualizarDatosPago(payload, userId = null) {
  const reservas = normalizarIdsReservas(payload?.reservas);
  const pago = validarDatosPago(payload?.Forma_Pago, payload?.Cuenta_Bancaria);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const elegibles = await obtenerReservasElegibles(conn, reservas, true);
    if (elegibles.length !== reservas.length) {
      throw createServiceError('La selección cambió. Actualiza la consulta e inténtalo nuevamente.', 409, 'COMMISSION_CHANGED');
    }
    const byId = new Map(elegibles.map((row) => [String(row.Id_Reserva), row]));
    const values = reservas.map((idReserva) => {
      const reserva = byId.get(String(idReserva));
      return [
        idReserva,
        reserva.Id_Beneficiario_Comision || null,
        reserva.Nombre_Beneficiario || null,
        'PENDIENTE',
        pago.Forma_Pago,
        pago.Numero_Cuenta,
      ];
    });

    await conn.query(
      `INSERT INTO liquidaciones
       (Id_Reserva, Id_Beneficiario_Comision, Nombre_Beneficiario_Snap,
        Estado, Forma_Pago, Cuenta_Bancaria)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         Id_Beneficiario_Comision = VALUES(Id_Beneficiario_Comision),
         Nombre_Beneficiario_Snap = VALUES(Nombre_Beneficiario_Snap),
         Forma_Pago = VALUES(Forma_Pago),
         Cuenta_Bancaria = VALUES(Cuenta_Bancaria)`,
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

async function guardarBeneficiarioDesdeComision(payload, userId = null) {
  const Id_Canal = Number(payload?.Id_Canal);
  const tipo = String(payload?.Tipo_Beneficiario || '').trim().toUpperCase();
  const nombre = String(payload?.Nombre || '').trim();
  const telefono = String(payload?.Telefono || '').trim() || null;
  const pago = validarDatosPago(payload?.Forma_Pago, payload?.Numero_Cuenta);
  const reservas = normalizarIdsReservas(payload?.reservas);

  if (!Number.isInteger(Id_Canal) || Id_Canal <= 0 || !TIPOS_BENEFICIARIO.has(tipo) || nombre.length < 2) {
    throw createServiceError('Completa correctamente el beneficiario.', 400, 'INVALID_BENEFICIARY');
  }

  const conn = await db.getConnection();
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
             Numero_Cuenta = ?, Actualizado_Por = ?
         WHERE Id_Beneficiario = ?`,
        [tipo, nombre, telefono, pago.Forma_Pago, pago.Numero_Cuenta, userId || null, idBeneficiario],
      );
    } else {
      const [result] = await conn.query(
        `INSERT INTO beneficiarios_comision
         (Id_Canal, Tipo_Beneficiario, Nombre, Telefono, Forma_Pago, Numero_Cuenta, Creado_Por, Actualizado_Por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [Id_Canal, tipo, nombre, telefono, pago.Forma_Pago, pago.Numero_Cuenta, userId || null, userId || null],
      );
      idBeneficiario = Number(result.insertId);
      created = true;
    }

    const placeholders = reservas.map(() => '?').join(',');
    const [reservasValidas] = await conn.query(
      `SELECT Id_Reserva FROM reservas
       WHERE Id_Reserva IN (${placeholders}) AND Id_Canal = ? FOR UPDATE`,
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
      ],
    });

    await conn.commit();
    return {
      Id_Beneficiario: idBeneficiario,
      Id_Canal,
      Tipo_Beneficiario: tipo,
      Nombre: nombre,
      Telefono: telefono,
      Forma_Pago: pago.Forma_Pago,
      Numero_Cuenta: pago.Numero_Cuenta,
      created,
    };
  } catch (error) {
    await conn.rollback();
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
    { header: 'RESERVAS', key: 'reservas', width: 12 },
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
        beneficiario: rep.Nombre_Reportante,
        medio: paymentLabel(rep.Forma_Pago),
        cuenta: rep.Cuenta_Bancaria || (rep.Forma_Pago === 'EFECTIVO' ? 'EFECTIVO' : ''),
        reservas: rep.reservas.length,
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
      { header: 'FECHA PAGO', key: 'fechaPago', width: 15 },
    ];
    styleHeader(ws.getRow(1));

    for (const rep of canal.reportantes) {
      for (const reserva of rep.reservas) {
        for (const pasajero of reserva.pasajeros) {
          ws.addRow({
            reserva: reserva.Id_Reserva,
            beneficiario: rep.Nombre_Reportante,
            pasajero: pasajero.Nombre_Pasajero,
            dni: pasajero.DNI || '',
            tipo: pasajero.Tipo_Pasajero || '',
            tour: reserva.Nombre_Tour,
            comision: pasajero.Comision,
            estado: reserva.Estado_Liquidacion,
            medio: paymentLabel(reserva.Forma_Pago || rep.Forma_Pago),
            cuenta: reserva.Cuenta_Bancaria || rep.Cuenta_Bancaria || '',
            fechaPago: reserva.Fecha_Pago || '',
          });
        }
      }
    }
    ws.getColumn('comision').numFmt = '$#,##0';
    ws.autoFilter = { from: 'A1', to: 'K1' };
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
  summary.autoFilter = { from: 'A1', to: 'I1' };
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
  guardarBeneficiarioDesdeComision,
  generarExcelComisiones,
  // Exportados para pruebas unitarias.
  agruparComisiones,
  buildPassengerQuery,
  validarDatosPago,
  normalizarFormaPago,
};
