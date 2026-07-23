const db = require('../../database/db');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { recordHistorial, logSistema } = require('../Historial/logger');
const { normalizarFechaMysql } = require('../../utils/mysqlDate');

const COMPROBANTE_TRANSFER_FILE_RE = /^[a-zA-Z0-9._-]+$/;

function normalizarRutaComprobanteTransferSalida(input, idTransfer = null) {
  const value = String(input || '').trim().replace(/\\/g, '/');
  if (!value || value === 'N/A') return null;

  const relative = value.startsWith('uploads/transfers/')
    ? value.slice('uploads/'.length)
    : value;

  const expectedPrefix = idTransfer
    ? `transfers/${String(idTransfer)}/`
    : 'transfers/';

  if (!relative.startsWith(expectedPrefix)) return null;

  const fileName = path.basename(relative);
  if (!COMPROBANTE_TRANSFER_FILE_RE.test(fileName)) return null;

  return relative;
}

function rutaComprobanteTransferAbsolutaSegura(relativePath) {
  const normalized = normalizarRutaComprobanteTransferSalida(relativePath);
  if (!normalized) return null;

  const uploadsRoot = path.resolve(__dirname, '../../uploads');
  const absolutePath = path.resolve(uploadsRoot, normalized);
  if (!(absolutePath === uploadsRoot || absolutePath.startsWith(`${uploadsRoot}${path.sep}`))) {
    return null;
  }

  return absolutePath;
}

async function eliminarArchivoComprobanteTransferFisico(relativePath) {
  const absolutePath = rutaComprobanteTransferAbsolutaSegura(relativePath);
  if (!absolutePath) return false;

  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function fechaMysqlDatetimeSegura(fecha) {
  const normalizada = normalizarFechaMysql(fecha, { tipo: 'datetime' });
  if (normalizada) return normalizada;

  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

  return partes.replace('T', ' ');
}

async function guardarComprobanteTransferInicial(idTransfer, file) {
  if (!file || !file.buffer) {
    const err = new Error('El comprobante de pago es obligatorio para registrar el pago del transfer.');
    err.status = 400;
    err.errorCode = 'BAD_REQUEST';
    throw err;
  }

  const baseDir = path.join(__dirname, '../../uploads', 'transfers', String(idTransfer));
  fs.mkdirSync(baseDir, { recursive: true });

  const ext = getExtensionForMime(file);
  const fileName = `${randomUUID()}${ext}`;
  const filePath = path.join(baseDir, fileName);

  fs.writeFileSync(filePath, file.buffer);

  return `transfers/${idTransfer}/${fileName}`;
}

function obtenerArchivoPorCampo(files = [], ...fieldNames) {
  if (!Array.isArray(files)) return null;
  return files.find((file) => fieldNames.includes(file?.fieldname)) || null;
}

async function resolverComprobanteInicialTransfer({
  idTransfer,
  file,
  ruta,
  requeridoMensaje,
  archivosCreados
}) {
  if (file) {
    const guardado = await guardarComprobanteTransferInicial(idTransfer, file);
    if (Array.isArray(archivosCreados)) archivosCreados.push(guardado);
    return guardado;
  }

  const normalizada = normalizarRutaComprobanteTransferSalida(ruta, idTransfer);
  if (normalizada) return normalizada;

  const err = new Error(requeridoMensaje);
  err.status = 400;
  err.errorCode = 'BAD_REQUEST';
  throw err;
}

function normalizarFechaTransferYMD(fecha) {
  return normalizarFechaMysql(fecha, { tipo: 'date' }) || '';
}

function hoyBogotaYMD() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function fechaTransferEsPasadaBogota(fecha) {
  const ymd = normalizarFechaTransferYMD(fecha);
  return !!ymd && ymd < hoyBogotaYMD();
}

function tieneTexto(value) {
  return String(value ?? '').trim().length > 0;
}

function normalizarEstadoTransferLegacy(estado) {
  const value = String(estado || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'activo' || value === 'activa' || value === 'confirmada') return 'Confirmado';
  if (value === 'completada') return 'Completado';
  if (value === 'cancelada') return 'Cancelado';
  if (value === 'confirmado') return 'Confirmado';
  if (value === 'completado') return 'Completado';
  if (value === 'cancelado') return 'Cancelado';
  if (value === 'pendiente') return 'Pendiente';
  if (value === 'pendiente de datos') return 'Pendiente de datos';
  if (value === 'pendiente de pago') return 'Pendiente de pago';
  return String(estado || '').trim();
}

function expandirEstadoTransferFiltro(estado) {
  const normalized = normalizarEstadoTransferLegacy(estado);
  const lower = normalized.toLowerCase();
  if (lower === 'confirmado') return ['Confirmado', 'Confirmada', 'Activo', 'Activa'];
  if (lower === 'completado') return ['Completado', 'Completada'];
  if (lower === 'cancelado') return ['Cancelado', 'Cancelada'];
  return normalized ? [normalized] : [];
}

function resolverEstadoTransfer(payload = {}, estadoActual = null) {
  const estadoBase = normalizarEstadoTransferLegacy(estadoActual);

  if (estadoBase === 'Cancelado' || estadoBase === 'Completado') {
    return estadoBase;
  }

  if (payload.ModoDuplicado) {
    return 'Pendiente';
  }

  const valorServicio = Number(payload.ValorServicio || payload.Valor || 0);
  const pago = payload.Pago || {};
  const abonos = Array.isArray(pago.Abonos) ? pago.Abonos : [];
  const totalAbonado = abonos.reduce((sum, abono) => sum + Number(abono?.Monto || 0), 0);
  const tienePagoEnPunto = String(pago.Tipo || '').trim() === 'PagaEnPunto';
  const tieneAbonos = abonos.some((abono) => Number(abono?.Monto || 0) > 0);
  const pagoOk = pago.Tipo === 'Completo'
    || (valorServicio > 0 && totalAbonado >= valorServicio);
  const tieneCompromisoConfirmado = tienePagoEnPunto || pago.Tipo === 'Completo' || tieneAbonos;

  const vueloParcial = tieneTexto(payload.Vuelo) || tieneTexto(payload.TipoVuelo);
  const datosOk = [
    payload.Titular,
    payload.DNI,
    payload.Tel_Contacto,
    payload.Id_Rango || payload.Rango,
    payload.Servicio,
    payload.Salida,
    payload.Llegada,
    payload.FechaTransfer,
    payload.HoraRecogida,
    payload.NombreReporta,
    payload.TelefonoTransfer,
    payload.ValorServicio || payload.Valor,
  ].every(tieneTexto) && (!vueloParcial || (tieneTexto(payload.Vuelo) && tieneTexto(payload.TipoVuelo)));

  let estado = 'Pendiente';
  if (datosOk && (pagoOk || tieneCompromisoConfirmado)) estado = 'Confirmado';
  else if (!datosOk && (pagoOk || tieneCompromisoConfirmado)) estado = 'Pendiente de datos';
  else if (datosOk && !pagoOk) estado = 'Pendiente de pago';

  if (fechaTransferEsPasadaBogota(payload.FechaTransfer)) {
    return estado === 'Confirmado' ? 'Completado' : 'Cancelado';
  }

  return estado;
}

async function actualizarEstadosTransfersVencidos(conexion = db) {
  const useExternalConn = !!conexion && conexion !== db;
  const conn = useExternalConn ? conexion : await db.getConnection();
  const hoyBogota = hoyBogotaYMD();
  const resumen = { evaluados: 0, actualizados: 0, idsActualizados: [] };

  const resolverTransicionTransferVencido = (estadoActual, fechaTransfer) => {
    const estado = String(estadoActual || '').trim();
    const vencida = fechaTransferEsPasadaBogota(fechaTransfer);

    if ((estado === 'Activo' || estado === 'Activa' || estado === 'Confirmada') && vencida) {
      return { nuevoEstado: 'Completado', motivo: 'VENCIMIENTO_AUTOMATICO' };
    }
    if (estado === 'Activo' || estado === 'Activa' || estado === 'Confirmada') {
      return { nuevoEstado: 'Confirmado', motivo: 'NORMALIZACION_LEGACY' };
    }
    if (estado === 'Completada') {
      return { nuevoEstado: 'Completado', motivo: 'NORMALIZACION_LEGACY' };
    }
    if (estado === 'Cancelada') {
      return { nuevoEstado: 'Cancelado', motivo: 'NORMALIZACION_LEGACY' };
    }
    if (estado === 'Confirmado' && vencida) {
      return { nuevoEstado: 'Completado', motivo: 'VENCIMIENTO_AUTOMATICO' };
    }
    if (['Pendiente', 'Pendiente de datos', 'Pendiente de pago'].includes(estado) && vencida) {
      return { nuevoEstado: 'Cancelado', motivo: 'VENCIMIENTO_AUTOMATICO' };
    }
    return null;
  };

  try {
    if (!useExternalConn) await conn.beginTransaction();

    const [candidatos] = await conn.query(
      `SELECT Id_Transfer, Estado, Fecha_Transfer
         FROM transfers
        WHERE Estado IN ('Activo', 'Activa', 'Confirmada', 'Completada', 'Cancelada')
           OR (
             Fecha_Transfer < ?
             AND Estado IN ('Confirmado', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago')
           )`,
      [hoyBogota]
    );

    resumen.evaluados = Number(candidatos?.length || 0);

    for (const row of candidatos || []) {
      const transicion = resolverTransicionTransferVencido(row.Estado, row.Fecha_Transfer);
      if (!transicion || transicion.nuevoEstado === row.Estado) continue;

      const [updateResult] = await conn.query(
        `UPDATE transfers
            SET Estado = ?
          WHERE Id_Transfer = ?
            AND Estado = ?`,
        [transicion.nuevoEstado, row.Id_Transfer, row.Estado]
      );

      if (!updateResult?.affectedRows) continue;

      await recordHistorial({
        conexion: conn,
        tabla: 'transfers',
        id_registro: row.Id_Transfer,
        accion: 'ACTUALIZAR_ESTADO_AUTOMATICO',
        id_usuario: null,
        detalles: [
          { columna: 'Estado', anterior: row.Estado || null, nuevo: transicion.nuevoEstado },
          { columna: 'Motivo', anterior: null, nuevo: transicion.motivo }
        ]
      });

      resumen.actualizados += 1;
      resumen.idsActualizados.push(Number(row.Id_Transfer));
    }

    if (!useExternalConn) await conn.commit();
    return resumen;
  } catch (error) {
    if (!useExternalConn) await conn.rollback();
    throw error;
  } finally {
    if (!useExternalConn) conn.release();
  }
}

function resolverUsuarioHistorialTransfer(explicitUserId = null) {
  return explicitUserId ?? null;
}

function formatoCodigoTransfer(idTransfer) {
  const numeric = String(idTransfer || '').replace(/\D/g, '');
  return numeric ? `TRS${numeric.padStart(5, '0')}` : null;
}

function normalizarIdTransferInput(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^TRS/i, '')
    .replace(/^TRC/i, '')
    .replace(/^TR-?/i, '');
  return /^\d+$/.test(normalized) ? normalized : null;
}

async function generarIdTransferUnico(conn) {
  for (let intento = 0; intento < 10; intento += 1) {
    const idTransfer = Math.floor(10000 + Math.random() * 90000);
    const [rows] = await conn.query('SELECT 1 FROM transfers WHERE Id_Transfer = ? LIMIT 1', [idTransfer]);
    if (!rows.length) return idTransfer;
  }

  const err = new Error('No se pudo generar un código único para el transfer.');
  err.status = 500;
  throw err;
}

async function getServiciosTransferSvc() {
  const [rows] = await db.query('SELECT Id_Servicio, Nombre_Servicio FROM servicios_transfer');
  return rows.map(r => ({ id: r.Id_Servicio, Servicio: r.Nombre_Servicio }));
}

function normalizarCantidadPersonasInput(value) {
  if (value === null || value === undefined || value === '') return null;
  const cantidad = Number(value);
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    const err = new Error('Cantidad_Personas debe ser un entero mayor o igual a 1.');
    err.status = 400;
    err.errorCode = 'BAD_REQUEST';
    throw err;
  }
  return cantidad;
}

async function getRangoPorCantidadSvc(conn, cantidadPersonas) {
  const [rows] = await conn.query(
    `SELECT Id_Rango, Descripcion, Minimo, Maximo
       FROM transfers_rangos
      WHERE ? >= Minimo
        AND (Maximo IS NULL OR ? <= Maximo)
      ORDER BY Minimo ASC
      LIMIT 1`,
    [cantidadPersonas, cantidadPersonas]
  );

  return rows?.[0] || null;
}

async function getRangoPorIdSvc(conn, idRango) {
  const [rows] = await conn.query(
    `SELECT Id_Rango, Descripcion, Minimo, Maximo
       FROM transfers_rangos
      WHERE Id_Rango = ?
      LIMIT 1`,
    [idRango]
  );

  return rows?.[0] || null;
}

async function getPrecioBasePorRangoSvc(conn, idRango, idMoneda = null) {
  const params = [idRango];
  let sql = `
    SELECT tp.Id_PrecioTransfer, tp.Id_Rango, tp.Id_Moneda, m.Codigo AS MonedaCodigo, tp.Precio
      FROM transfers_precios tp
      LEFT JOIN monedas m ON tp.Id_Moneda = m.Id_Moneda
     WHERE tp.Id_Rango = ?`;

  if (idMoneda === null || idMoneda === undefined || idMoneda === '') {
    sql += ' AND tp.Id_Moneda IS NULL';
  } else {
    sql += ' AND tp.Id_Moneda = ?';
    params.push(idMoneda);
  }

  sql += ' ORDER BY tp.Id_PrecioTransfer ASC LIMIT 1';

  const [rows] = await conn.query(sql, params);
  return rows?.[0] || null;
}

async function resolverRangoYValorTransfer(conn, payload = {}, opciones = {}) {
  const cantidadIngresada = Object.prototype.hasOwnProperty.call(payload, 'Cantidad_Personas');
  const cantidadFuente = cantidadIngresada ? payload.Cantidad_Personas : opciones.cantidadActual;
  const cantidadPersonas = cantidadFuente === null || cantidadFuente === undefined || cantidadFuente === ''
    ? null
    : normalizarCantidadPersonasInput(cantidadFuente);

  if (cantidadPersonas === null) {
    const err = new Error('Cantidad_Personas es obligatoria para calcular el rango del transfer.');
    err.status = 400;
    err.errorCode = 'MISSING_PARAMS';
    throw err;
  }

  const rango = await getRangoPorCantidadSvc(conn, cantidadPersonas);
  if (!rango) {
    const err = new Error('No existe un rango configurado para la cantidad de personas indicada.');
    err.status = 400;
    err.errorCode = 'RANGE_NOT_FOUND';
    throw err;
  }

  const idRangoFinal = rango.Id_Rango;
  const precioBaseRow = await getPrecioBasePorRangoSvc(conn, idRangoFinal, opciones.idMoneda ?? null);
  const precioBase = precioBaseRow?.Precio !== undefined && precioBaseRow?.Precio !== null
    ? Number(precioBaseRow.Precio)
    : null;
  const valorIngresadoRaw = Object.prototype.hasOwnProperty.call(payload, 'ValorServicio')
    ? payload.ValorServicio
    : payload.Valor;
  const valorIngresadoTexto = String(valorIngresadoRaw ?? '').trim();
  const tieneValorIngresado = valorIngresadoTexto !== '';

  let valorFinal = null;
  if (tieneValorIngresado) {
    const valorIngresado = Number(valorIngresadoRaw);
    if (!Number.isFinite(valorIngresado) || valorIngresado < 0) {
      const err = new Error('El valor del transfer no tiene un formato numérico válido.');
      err.status = 400;
      err.errorCode = 'BAD_REQUEST';
      throw err;
    }
    valorFinal = valorIngresado;
  } else if (precioBase !== null && !Number.isNaN(precioBase)) {
    valorFinal = precioBase;
  } else {
    valorFinal = 0;
  }

  return {
    cantidadPersonas,
    idRango: idRangoFinal,
    rango,
    precioBase,
    precioBaseRow,
    valorFinal
  };
}

async function crearTransferSvc(payload, files = {}) {
  const conn = await db.getConnection();
  const rutasComprobantesCreadas = [];
  const historialUserId = resolverUsuarioHistorialTransfer(files?.userId);

  try {
    // Iniciar transacción
    await conn.beginTransaction();

    // Resolver Id_Moneda desde tabla monedas si viene Codigo
    let idMoneda = payload.Id_Moneda || null;
    if (!idMoneda && payload.Moneda) {
      const [monedas] = await conn.query(
        'SELECT Id_Moneda FROM monedas WHERE Codigo = ? LIMIT 1',
        [payload.Moneda]
      );
      idMoneda = monedas?.[0]?.Id_Moneda || null;
    }

    const pricing = await resolverRangoYValorTransfer(conn, payload, { idMoneda });
    const estadoCalculado = resolverEstadoTransfer({
      ...payload,
      Id_Moneda: idMoneda,
      Id_Rango: pricing.idRango,
      Rango: pricing.idRango,
      ValorServicio: pricing.valorFinal,
      Valor: pricing.valorFinal,
    });
    const idTransfer = await generarIdTransferUnico(conn);

    const sql = `INSERT INTO transfers (
      Id_Transfer,
      Nombre_Titular,
      DNI,
      Telefono_Titular,
      Cantidad_Personas,
      Id_Rango,
      Id_Servicio,
      Punto_Salida,
      Punto_Destino,
      Fecha_Transfer,
      Hora_Recogida,
      Nombre_Reportante,
      Telefono_Reportante,
      Valor,
      Id_Moneda,
      Vuelo,
      TipoVuelo,
      Estado,
      Observaciones
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    const params = [
      idTransfer,
      payload.Titular || null,
      payload.DNI || null,
      payload.Tel_Contacto || null,
      pricing.cantidadPersonas,
      pricing.idRango,
      payload.Servicio || null,
      payload.Salida || null,
      payload.Llegada || null,
      payload.FechaTransfer || null,
      payload.HoraRecogida || null,
      payload.NombreReporta || null,
      payload.TelefonoTransfer || null,
      pricing.valorFinal,
      idMoneda,
      payload.Vuelo || null,
      payload.TipoVuelo || null,
      estadoCalculado,
      payload.Observaciones || null
    ];

    await conn.query(sql, params);

    // Array para guardar los pagos creados (devolver Ids)
    const pagosCreados = [];

    // Insertar pagos si vienen en payload
    if (payload.Pago && payload.Pago.Tipo) {
      const valorServicio = payload.ValorServicio || payload.Valor || 0;
      const ahora = new Date();
      const fechaPagoAhora = fechaMysqlDatetimeSegura(ahora);

      if (payload.Pago.Tipo === 'Completo') {
        // Un pago completo
        const comprobanteCompleto = await resolverComprobanteInicialTransfer({
          idTransfer,
          file: files.comprobantePago || null,
          ruta: payload.Pago.Pago_Comprobante || null,
          requeridoMensaje: 'El comprobante de pago es obligatorio para registrar un pago completo del transfer.',
          archivosCreados: rutasComprobantesCreadas
        });
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            idTransfer,
            valorServicio,
            'Completo',
            fechaPagoAhora,
            'Pagado',
            payload.Pago.Observaciones || 'Pago completo registrado al crear transfer',
            comprobanteCompleto
          ]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: valorServicio,
          Metodo: 'Completo',
          Pago_Comprobante: comprobanteCompleto
        });
      } else if (payload.Pago.Tipo === 'PagaEnPunto') {
        // No se crea pago real para PagaEnPunto.
      } else if (payload.Pago.Tipo === 'Abonos' && Array.isArray(payload.Pago.Abonos)) {
        // Insertar un registro por cada abono
        for (const [index, abono] of payload.Pago.Abonos.entries()) {
          if (abono.Monto && Number(abono.Monto) > 0) {
            const fechaPagoRaw = abono.Fecha_Pago ?? abono.Fecha ?? null;
            const fechaPagoNormalizada = normalizarFechaMysql(fechaPagoRaw, { tipo: 'datetime' });
            const fechaPago = fechaPagoNormalizada ?? (fechaPagoRaw ? null : fechaPagoAhora);
            const archivoAbono = obtenerArchivoPorCampo(
              files.comprobantesAbonos || [],
              `comprobanteAbono_${index}`,
              `comprobantesAbonos_${index}`,
              `abono_${index}`
            );
            const comprobanteAbono = await resolverComprobanteInicialTransfer({
              idTransfer,
              file: archivoAbono,
              ruta: abono.Pago_Comprobante || null,
              requeridoMensaje: `El comprobante del abono ${index + 1} es obligatorio.`,
              archivosCreados: rutasComprobantesCreadas
            });
            const [pagRes] = await conn.query(
              `INSERT INTO pagos_transfers
               (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [idTransfer, Number(abono.Monto), 'Abono', fechaPago, 'Pagado', abono.Observaciones || null, comprobanteAbono]
            );
            pagosCreados.push({
              Id_Pago: pagRes.insertId,
              Monto: Number(abono.Monto),
              Metodo: 'Abono',
              Pago_Comprobante: comprobanteAbono
            });
          }
        }
      }
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'transfers',
      id_registro: idTransfer,
      accion: 'CREAR_TRANSFER',
      id_usuario: historialUserId,
      detalles: [
        { columna: 'Nombre_Titular', anterior: null, nuevo: payload.Titular || null },
        { columna: 'Fecha_Transfer', anterior: null, nuevo: payload.FechaTransfer || null },
        { columna: 'Estado', anterior: null, nuevo: estadoCalculado }
      ]
    });

    await conn.commit();

    return { success: true, Id_Transfer: idTransfer, Codigo_Transfer: formatoCodigoTransfer(idTransfer), pagos: pagosCreados, message: 'Transfer creado correctamente.' };
  } catch (error) {
    // Rollback en caso de error
    await conn.rollback();
    if (rutasComprobantesCreadas.length > 0) {
      await Promise.all(
        rutasComprobantesCreadas.map((ruta) => eliminarArchivoComprobanteTransferFisico(ruta).catch(() => false))
      );
    }
    throw error;
  } finally {
    // Liberar conexión
    conn.release();
  }
}


// exports consolidated at end of file

async function filtrarTransfersSvc(q) {
  const {
    Fecha_Transfer,
    Fecha_Registro,
    Id_Servicio,
    Id_Rango,
    Estado,
    Id_Transfer,
    Nombre_Titular,
    Telefono_Titular,
    DNI,
    Punto_Salida,
    Punto_Destino,
    q: busquedaGeneral
  } = q;

  const conds = [];
  if (Fecha_Transfer) conds.push(`tr.Fecha_Transfer = ${db.escape(Fecha_Transfer)}`);
  if (Fecha_Registro) conds.push(`DATE(tr.Fecha_Registro) = ${db.escape(Fecha_Registro)}`);
  if (Id_Servicio) {
    if (Array.isArray(Id_Servicio)) {
      const ids = Id_Servicio.map(i => db.escape(i)).join(',');
      conds.push(`tr.Id_Servicio IN (${ids})`);
    } else conds.push(`tr.Id_Servicio = ${db.escape(Id_Servicio)}`);
  }
  if (Id_Rango) conds.push(`tr.Id_Rango = ${db.escape(Id_Rango)}`);
  if (Estado) {
    if (Array.isArray(Estado)) {
      const expanded = [...new Set(Estado.flatMap((item) => expandirEstadoTransferFiltro(item)))];
      if (expanded.length) {
        const estados = expanded.map(e => db.escape(e)).join(',');
        conds.push(`tr.Estado IN (${estados})`);
      }
    } else {
      const expanded = expandirEstadoTransferFiltro(Estado);
      if (expanded.length === 1) {
        conds.push(`tr.Estado = ${db.escape(expanded[0])}`);
      } else if (expanded.length > 1) {
        const estados = expanded.map(e => db.escape(e)).join(',');
        conds.push(`tr.Estado IN (${estados})`);
      }
    }
  }
  const idTransferFiltro = normalizarIdTransferInput(Id_Transfer);
  if (idTransferFiltro) conds.push(`tr.Id_Transfer = ${db.escape(idTransferFiltro)}`);
  if (Nombre_Titular) conds.push(`tr.Nombre_Titular LIKE ${db.escape('%' + Nombre_Titular + '%')}`);
  if (Telefono_Titular) conds.push(`tr.Telefono_Titular LIKE ${db.escape('%' + Telefono_Titular + '%')}`);
  if (DNI) conds.push(`tr.DNI LIKE ${db.escape('%' + DNI + '%')}`);
  if (Punto_Salida) conds.push(`tr.Punto_Salida LIKE ${db.escape('%' + Punto_Salida + '%')}`);
  if (Punto_Destino) conds.push(`tr.Punto_Destino LIKE ${db.escape('%' + Punto_Destino + '%')}`);
  if (busquedaGeneral) {
    const term = String(busquedaGeneral).trim();
    if (term) {
      const likeTerm = db.escape(`%${term}%`);
      const idFromTerm = normalizarIdTransferInput(term);
      const generalConditions = [
        `tr.Nombre_Titular LIKE ${likeTerm}`,
        `tr.DNI LIKE ${likeTerm}`,
        `tr.Telefono_Titular LIKE ${likeTerm}`,
        `tr.Punto_Salida LIKE ${likeTerm}`,
        `tr.Punto_Destino LIKE ${likeTerm}`,
        `s.Nombre_Servicio LIKE ${likeTerm}`,
      ];
      if (idFromTerm) generalConditions.unshift(`tr.Id_Transfer = ${db.escape(idFromTerm)}`);
      conds.push(`(${generalConditions.join(' OR ')})`);
    }
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      tr.Id_Transfer,
      CONCAT('TRS', LPAD(tr.Id_Transfer, 5, '0')) AS Codigo_Transfer,
      tr.Fecha_Transfer,
      tr.Hora_Recogida,
      tr.Estado,
      tr.Punto_Salida,
      tr.Punto_Destino,
      tr.Nombre_Titular,
      tr.Telefono_Titular,
      tr.DNI,
      tr.Cantidad_Personas,
      tr.Id_Rango,
      rg.Descripcion AS RangoDescripcion,
      tr.Valor,
      tr.Id_Moneda,
      m.Codigo AS MonedaCodigo,
      tr.Vuelo,
      tr.TipoVuelo,
      s.Nombre_Servicio AS Nombre_Servicio,
      tr.Fecha_Registro
    FROM transfers tr
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
    LEFT JOIN transfers_rangos rg ON rg.Id_Rango = tr.Id_Rango
    LEFT JOIN monedas m ON m.Id_Moneda = tr.Id_Moneda
    ${where}
    ORDER BY tr.Fecha_Registro DESC
  `;

  const [rows] = await db.query(sql);
  return rows.map((row) => ({
    ...row,
    Estado: normalizarEstadoTransferLegacy(row?.Estado),
    Estado_Transfer: normalizarEstadoTransferLegacy(row?.Estado_Transfer || row?.Estado),
  }));
}

async function getRangosSvc() {
  const [rows] = await db.query(`
    SELECT Id_Rango, Descripcion, Minimo, Maximo
    FROM transfers_rangos
    ORDER BY Minimo
  `);

  return rows.map(r => ({
    id: r.Id_Rango,
    Id_Rango: r.Id_Rango,
    Descripcion: r.Descripcion,
    Minimo: r.Minimo,
    Maximo: r.Maximo
  }));
}

async function getPreciosPorRangoSvc(Id_Rango) {
  const [rows] = await db.query('SELECT tp.Id_PrecioTransfer, tp.Id_Rango, tp.Id_Moneda, m.Codigo AS MonedaCodigo, tp.Precio FROM transfers_precios tp LEFT JOIN monedas m ON tp.Id_Moneda = m.Id_Moneda WHERE tp.Id_Rango = ?', [Id_Rango]);
  return rows;
}

async function getPrecioBasePorRangoYMonedaSvc(Id_Rango, Id_Moneda) {
  if (!Id_Rango || !Id_Moneda) {
    return { found: false, precio: 0 };
  }

  const [rows] = await db.query(
    `SELECT tp.Precio
       FROM transfers_precios tp
      WHERE tp.Id_Rango = ?
        AND tp.Id_Moneda = ?
      LIMIT 1`,
    [Id_Rango, Id_Moneda]
  );

  const precio = rows?.[0]?.Precio;
  if (precio === undefined || precio === null) {
    return { found: false, precio: 0 };
  }

  return { found: true, precio: Number(precio) };
}

async function getDetalleTransferSvc(Id_Transfer) {
  // Obtener detalles completos del transfer
  const [transferData] = await db.query(`
    SELECT
      tr.*,
      CONCAT('TRS', LPAD(tr.Id_Transfer, 5, '0')) AS Codigo_Transfer,
      s.Nombre_Servicio,
      rg.Descripcion AS RangoDescripcion,
      rg.Minimo,
      rg.Maximo,
      m.Codigo AS MonedaCodigo,
      m.Nombre_Moneda
    FROM transfers tr
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
    LEFT JOIN transfers_rangos rg ON rg.Id_Rango = tr.Id_Rango
    LEFT JOIN monedas m ON m.Id_Moneda = tr.Id_Moneda
    WHERE tr.Id_Transfer = ?
  `, [Id_Transfer]);

  if (!transferData || transferData.length === 0) {
    return null;
  }

  const transfer = transferData[0];
  transfer.Estado = normalizarEstadoTransferLegacy(transfer.Estado);

  // Obtener pagos del transfer
  const [pagos] = await db.query(`
    SELECT
      Id_Pago,
      Monto,
      Metodo,
      Fecha_Pago,
      Estado,
      Observaciones,
      Pago_Comprobante
    FROM pagos_transfers
    WHERE Id_Transfer = ?
    ORDER BY Fecha_Pago ASC, Id_Pago ASC
  `, [Id_Transfer]);

  const comprobantes = (pagos || [])
    .filter(pago => pago?.Pago_Comprobante)
    .map((pago, index) => ({
      id: pago.Id_Pago ?? index + 1,
      Id_Pago: pago.Id_Pago,
      nombre: path.basename(String(pago.Pago_Comprobante || '')) || `comprobante-${index + 1}`,
      filename: path.basename(String(pago.Pago_Comprobante || '')) || `comprobante-${index + 1}`,
      url: pago.Pago_Comprobante,
      tipo: pago.Metodo || 'Comprobante',
      fecha: pago.Fecha_Pago || null
    }));

  return {
    transfer,
    pagos: pagos || [],
    comprobantes
  };
}

async function normalizarEstadosTransfersExistentes(conexion = db) {
  const [transferRows] = await conexion.query(
    `SELECT
        Id_Transfer,
        Fecha_Transfer,
        Estado,
        Nombre_Titular,
        DNI,
        Telefono_Titular,
        Cantidad_Personas,
        Id_Rango,
        Id_Servicio,
        Punto_Salida,
        Punto_Destino,
        Hora_Recogida,
        Nombre_Reportante,
        Telefono_Reportante,
        Valor,
        Vuelo,
        TipoVuelo
       FROM transfers`
  );

  if (!transferRows?.length) return { evaluados: 0, actualizados: 0 };

  const ids = transferRows.map((row) => row.Id_Transfer).filter(Boolean);
  const placeholders = ids.map(() => '?').join(',');

  const [pagosRows] = await conexion.query(
    `SELECT Id_Transfer, Monto, Metodo
       FROM pagos_transfers
      WHERE Id_Transfer IN (${placeholders})`,
    ids
  );

  const pagosMap = new Map();
  for (const pago of pagosRows || []) {
    const key = String(pago.Id_Transfer);
    if (!pagosMap.has(key)) pagosMap.set(key, []);
    pagosMap.get(key).push(pago);
  }

  let actualizados = 0;
  for (const transfer of transferRows) {
    const idTransfer = String(transfer.Id_Transfer);
    const estadoActual = normalizarEstadoTransferLegacy(transfer.Estado);
    const pagos = pagosMap.get(idTransfer) || [];

    let tipoPago = '';
    let abonos = [];
    if (pagos.some((pago) => String(pago?.Metodo || '').trim() === 'Completo')) {
      tipoPago = 'Completo';
    } else if (pagos.some((pago) => String(pago?.Metodo || '').trim() === 'Abono')) {
      tipoPago = 'Abonos';
      abonos = pagos
        .filter((pago) => String(pago?.Metodo || '').trim() === 'Abono')
        .map((pago) => ({ Monto: Number(pago?.Monto || 0) }));
    } else {
      tipoPago = 'PagaEnPunto';
    }

    let nuevoEstado = estadoActual;
    if (!['Cancelado', 'Completado'].includes(estadoActual)) {
      nuevoEstado = resolverEstadoTransfer({
        FechaTransfer: transfer.Fecha_Transfer,
        Pago: { Tipo: tipoPago, Abonos: abonos },
        Titular: transfer.Nombre_Titular,
        DNI: transfer.DNI,
        Tel_Contacto: transfer.Telefono_Titular,
        Id_Rango: transfer.Id_Rango,
        Servicio: transfer.Id_Servicio,
        Salida: transfer.Punto_Salida,
        Llegada: transfer.Punto_Destino,
        HoraRecogida: transfer.Hora_Recogida,
        NombreReporta: transfer.Nombre_Reportante,
        TelefonoTransfer: transfer.Telefono_Reportante,
        ValorServicio: transfer.Valor,
        Vuelo: transfer.Vuelo,
        TipoVuelo: transfer.TipoVuelo,
      }, estadoActual || null);
    }

    if (nuevoEstado !== transfer.Estado) {
      await conexion.query(
        `UPDATE transfers
            SET Estado = ?
          WHERE Id_Transfer = ?`,
        [nuevoEstado, idTransfer]
      );
      actualizados += 1;
    }
  }

  return { evaluados: transferRows.length, actualizados };
}

// FUNCIONES PARA COMPROBANTES TRANSFERS

async function subirComprobanteTransferSvc(Id_Transfer, Id_Pago, file, userId = null, clientIp = null) {
  let conn;
  let rutaAnterior = null;
  let rutaNueva = null;
  try {
    // Validar que el pago existe y pertenece al transfer
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [pagos] = await conn.query(
      'SELECT Id_Pago, Pago_Comprobante FROM pagos_transfers WHERE Id_Pago = ? AND Id_Transfer = ? LIMIT 1 FOR UPDATE',
      [Id_Pago, Id_Transfer]
    );

    if (pagos.length === 0) {
      const err = new Error('Pago no encontrado o no pertenece a este transfer');
      err.status = 404;
      throw err;
    }
    rutaAnterior = normalizarRutaComprobanteTransferSalida(pagos[0].Pago_Comprobante, Id_Transfer);

    // Crear carpeta de uploads si no existe
    const baseDir = path.join(__dirname, '../../uploads', 'transfers', String(Id_Transfer));
    fs.mkdirSync(baseDir, { recursive: true });

    // Generar nombre seguro para el archivo
    const ext = getExtensionForMime(file);
    const fileName = `${randomUUID()}${ext}`;
    const filePath = path.join(baseDir, fileName);

    // Guardar archivo
    fs.writeFileSync(filePath, file.buffer);

    // Generar ruta relativa segura
    const rutaComprobante = `transfers/${Id_Transfer}/${fileName}`;
    rutaNueva = rutaComprobante;

    // Actualizar la base de datos con la ruta
    await conn.query(
      'UPDATE pagos_transfers SET Pago_Comprobante = ? WHERE Id_Pago = ?',
      [rutaComprobante, Id_Pago]
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'transfers',
      id_registro: Id_Transfer,
      accion: 'AGREGAR_COMPROBANTE_TRANSFER',
      id_usuario: userId,
      detalles: [
        { columna: 'Pago_Comprobante', anterior: rutaAnterior || null, nuevo: rutaNueva || null }
      ]
    });

    await conn.commit();
    conn.release();
    conn = null;

    if (rutaAnterior && rutaAnterior !== rutaNueva) {
      await eliminarArchivoComprobanteTransferFisico(rutaAnterior).catch((error) => {
        console.warn('No se pudo eliminar el comprobante anterior del transfer:', error?.message || error);
      });
    }

    return {
      Id_Pago,
      Pago_Comprobante: rutaComprobante,
      message: 'Comprobante guardado correctamente'
    };
  } catch (error) {
    if (conn) {
      await conn.rollback();
      conn.release();
    }
    if (rutaNueva) {
      await eliminarArchivoComprobanteTransferFisico(rutaNueva).catch(() => false);
    }
    throw error;
  }
}

function getExtensionForMime(file) {
  if (file.mimetype === 'image/jpeg') return '.jpg';
  if (file.mimetype === 'image/png') return '.png';
  if (file.mimetype === 'application/pdf') return '.pdf';
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ext || '.bin';
}

async function actualizarTransferSvc(Id_Transfer, payload, userId = null) {
  const conn = await db.getConnection();
  let rutasPendientesEliminar = [];
  const historialUserId = resolverUsuarioHistorialTransfer(userId);

  try {
    // Iniciar transacción
    await conn.beginTransaction();

    const [transferActualRows] = await conn.query(
      `SELECT Estado
         FROM transfers
        WHERE Id_Transfer = ?
        LIMIT 1
        FOR UPDATE`,
      [Id_Transfer]
    );

    if (!transferActualRows?.length) {
      const err = new Error('Transfer no encontrado');
      err.status = 404;
      throw err;
    }

    // Resolver Id_Moneda desde tabla monedas si viene Codigo
    let idMoneda = payload.Id_Moneda || null;
    if (!idMoneda && payload.Moneda) {
      const [monedas] = await conn.query(
        'SELECT Id_Moneda FROM monedas WHERE Codigo = ? LIMIT 1',
        [payload.Moneda]
      );
      idMoneda = monedas?.[0]?.Id_Moneda || null;
    }

    const [transferDataActualRows] = await conn.query(
      `SELECT Id_Rango, Valor, Cantidad_Personas, Id_Moneda
         FROM transfers
        WHERE Id_Transfer = ?
        LIMIT 1
        FOR UPDATE`,
      [Id_Transfer]
    );
    const transferActual = transferDataActualRows?.[0] || {};
    if (!idMoneda) {
      idMoneda = transferActual.Id_Moneda ?? null;
    }

    const pricing = await resolverRangoYValorTransfer(conn, payload, {
      idMoneda,
      valorActual: transferActual.Valor ?? null,
      cantidadActual: transferActual.Cantidad_Personas ?? null
    });

    const estadoCalculado = resolverEstadoTransfer({
      ...payload,
      Id_Moneda: idMoneda,
      Id_Rango: pricing.idRango,
      Rango: pricing.idRango,
      ValorServicio: pricing.valorFinal,
      Valor: pricing.valorFinal,
    }, transferActualRows[0].Estado || null);

    const sql = `UPDATE transfers SET
      Nombre_Titular = ?,
      DNI = ?,
      Telefono_Titular = ?,
      Cantidad_Personas = ?,
      Id_Rango = ?,
      Id_Servicio = ?,
      Punto_Salida = ?,
      Punto_Destino = ?,
      Fecha_Transfer = ?,
      Hora_Recogida = ?,
      Nombre_Reportante = ?,
      Telefono_Reportante = ?,
      Valor = ?,
      Id_Moneda = ?,
      Vuelo = ?,
      TipoVuelo = ?,
      Estado = ?,
      Observaciones = ?
    WHERE Id_Transfer = ?`;

    const params = [
      payload.Titular || null,
      payload.DNI || null,
      payload.Tel_Contacto || null,
      pricing.cantidadPersonas !== null ? pricing.cantidadPersonas : transferActual.Cantidad_Personas ?? null,
      pricing.idRango,
      payload.Servicio || null,
      payload.Salida || null,
      payload.Llegada || null,
      payload.FechaTransfer || null,
      payload.HoraRecogida || null,
      payload.NombreReporta || null,
      payload.TelefonoTransfer || null,
      pricing.valorFinal,
      idMoneda,
      payload.Vuelo || null,
      payload.TipoVuelo || null,
      estadoCalculado,
      payload.Observaciones || null,
      Id_Transfer
    ];

    await conn.query(sql, params);

    const [pagosActualesRows] = await conn.query(
      `SELECT Pago_Comprobante
         FROM pagos_transfers
        WHERE Id_Transfer = ?
        FOR UPDATE`,
      [Id_Transfer]
    );

    const rutasActuales = new Set(
      (pagosActualesRows || [])
        .map((row) => normalizarRutaComprobanteTransferSalida(row.Pago_Comprobante, Id_Transfer))
        .filter(Boolean)
    );

    const rutasConservar = new Set();
    const rutaPagoCompleto = normalizarRutaComprobanteTransferSalida(payload?.Pago?.Pago_Comprobante, Id_Transfer);
    if (rutaPagoCompleto) rutasConservar.add(rutaPagoCompleto);
    if (Array.isArray(payload?.Pago?.Abonos)) {
      for (const abono of payload.Pago.Abonos) {
        const rutaAbono = normalizarRutaComprobanteTransferSalida(abono?.Pago_Comprobante, Id_Transfer);
        if (rutaAbono) rutasConservar.add(rutaAbono);
      }
    }

    rutasPendientesEliminar = Array.from(rutasActuales).filter((ruta) => !rutasConservar.has(ruta));

    // Eliminar pagos existentes
    await conn.query('DELETE FROM pagos_transfers WHERE Id_Transfer = ?', [Id_Transfer]);

    // Insertar nuevos pagos
    const pagosCreados = [];
    if (payload.Pago && payload.Pago.Tipo) {
      const valorServicio = payload.ValorServicio || payload.Valor || 0;
      const ahora = new Date();

      if (payload.Pago.Tipo === 'Completo') {
        const pagoComprobante = normalizarRutaComprobanteTransferSalida(payload.Pago.Pago_Comprobante, Id_Transfer);
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            Id_Transfer,
            valorServicio,
            'Completo',
            fechaMysqlDatetimeSegura(ahora),
            'Pagado',
            payload.Pago.Observaciones || 'Pago completo registrado al actualizar transfer',
            pagoComprobante
          ]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: valorServicio,
          Metodo: 'Completo',
          Pago_Comprobante: pagoComprobante
        });
      } else if (payload.Pago.Tipo === 'PagaEnPunto') {
        // No se crea registro de pago para PagaEnPunto.
      } else if (payload.Pago.Tipo === 'Abonos' && Array.isArray(payload.Pago.Abonos)) {
        for (const abono of payload.Pago.Abonos) {
          if (abono.Monto && Number(abono.Monto) > 0) {
            const fechaPagoRaw = abono.Fecha_Pago ?? abono.Fecha ?? null;
            const fechaPagoNormalizada = normalizarFechaMysql(fechaPagoRaw, { tipo: 'datetime' });
            const fechaPago = fechaPagoNormalizada ?? (fechaPagoRaw ? null : fechaMysqlDatetimeSegura(ahora));
            const pagoComprobante = normalizarRutaComprobanteTransferSalida(abono.Pago_Comprobante, Id_Transfer);
            const [pagRes] = await conn.query(
              `INSERT INTO pagos_transfers
               (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [Id_Transfer, Number(abono.Monto), 'Abono', fechaPago, 'Pagado', abono.Observaciones || null, pagoComprobante]
            );
            pagosCreados.push({
              Id_Pago: pagRes.insertId,
              Monto: Number(abono.Monto),
              Metodo: 'Abono',
              Pago_Comprobante: pagoComprobante
            });
          }
        }
      }
    }

    await recordHistorial({
      conexion: conn,
      tabla: 'transfers',
      id_registro: Id_Transfer,
      accion: 'ACTUALIZAR_TRANSFER',
      id_usuario: historialUserId,
      detalles: [
        { columna: 'Nombre_Titular', anterior: transferActualRows?.[0]?.Nombre_Titular ?? null, nuevo: payload?.Titular || null },
        { columna: 'Fecha_Transfer', anterior: transferActualRows?.[0]?.Fecha_Transfer ?? null, nuevo: payload?.FechaTransfer || null },
        { columna: 'Estado', anterior: transferActualRows?.[0]?.Estado ?? null, nuevo: estadoCalculado }
      ]
    });

    // Commit transacción
    await conn.commit();

    if (rutasPendientesEliminar.length > 0) {
      await Promise.all(
        rutasPendientesEliminar.map((ruta) =>
          eliminarArchivoComprobanteTransferFisico(ruta).catch((error) => {
            console.warn('No se pudo eliminar un comprobante anterior del transfer:', error?.message || error);
            return false;
          })
        )
      );
    }

    return { success: true, Id_Transfer, Codigo_Transfer: formatoCodigoTransfer(Id_Transfer), pagos: pagosCreados, message: 'Transfer actualizado correctamente.' };
  } catch (error) {
    // Rollback en caso de error
    await conn.rollback();
    throw error;
  } finally {
    // Liberar conexión
    conn.release();
  }
}

async function cancelarTransferSvc(Id_Transfer, userId = null) {
  const conn = await db.getConnection();
  const historialUserId = resolverUsuarioHistorialTransfer(userId);
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT Estado, Nombre_Titular, Fecha_Transfer FROM transfers WHERE Id_Transfer = ? LIMIT 1 FOR UPDATE',
      [Id_Transfer]
    );

    if (!rows.length) {
      const err = new Error('Transfer no encontrado');
      err.status = 404;
      throw err;
    }

    const estadoAnterior = rows[0].Estado || null;
    await conn.query(
      'UPDATE transfers SET Estado = ? WHERE Id_Transfer = ?',
      ['Cancelado', Id_Transfer]
    );

    await recordHistorial({
      conexion: conn,
      tabla: 'transfers',
      id_registro: Id_Transfer,
      accion: 'CANCELAR_TRANSFER',
      id_usuario: historialUserId,
      detalles: [
        { columna: 'Estado', anterior: estadoAnterior, nuevo: 'Cancelado' },
        { columna: 'Nombre_Titular', anterior: rows[0].Nombre_Titular ?? null, nuevo: rows[0].Nombre_Titular ?? null },
        { columna: 'Fecha_Transfer', anterior: rows[0].Fecha_Transfer ?? null, nuevo: rows[0].Fecha_Transfer ?? null }
      ]
    });

    await conn.commit();
    return { Id_Transfer, Codigo_Transfer: formatoCodigoTransfer(Id_Transfer), Estado: 'Cancelado' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function eliminarTransferSvc(Id_Transfer, userId = null, clientIp = null) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT
          Id_Transfer,
          Estado,
          Nombre_Titular,
          Fecha_Transfer
       FROM transfers
      WHERE Id_Transfer = ?
      LIMIT 1
      FOR UPDATE`,
      [Id_Transfer]
    );

    if (!rows.length) {
      const err = new Error('Transfer no encontrado');
      err.status = 404;
      err.errorCode = 'TRANSFER_NOT_FOUND';
      throw err;
    }

    const transfer = rows[0];
    const [pagos] = await conn.query(
      `SELECT Id_Pago, Pago_Comprobante
         FROM pagos_transfers
        WHERE Id_Transfer = ?
        FOR UPDATE`,
      [Id_Transfer]
    );

    const pagosCount = Number(pagos?.length || 0);
    const comprobantesCount = (pagos || []).filter((p) => {
      const ruta = String(p?.Pago_Comprobante || '').trim();
      return ruta && ruta !== 'N/A';
    }).length;

    await recordHistorial({
      conexion: conn,
      tabla: 'transfers',
      id_registro: Id_Transfer,
      accion: 'ELIMINAR_TRANSFER',
      id_usuario: userId,
      detalles: [
        { columna: 'Estado', anterior: transfer.Estado || null, nuevo: 'ELIMINADO' },
        { columna: 'Nombre_Titular', anterior: transfer.Nombre_Titular || null, nuevo: null },
        { columna: 'Fecha_Transfer', anterior: normalizarFechaTransferYMD(transfer.Fecha_Transfer), nuevo: null },
        { columna: 'Pagos_Eliminados', anterior: pagosCount, nuevo: 0 },
      ]
    });

    await conn.query('DELETE FROM pagos_transfers WHERE Id_Transfer = ?', [Id_Transfer]);
    await conn.query('DELETE FROM transfers WHERE Id_Transfer = ?', [Id_Transfer]);

    await conn.commit();

    return {
      Id_Transfer: Number(Id_Transfer),
      Codigo_Transfer: formatoCodigoTransfer(Id_Transfer),
      dependenciasEliminadas: {
        pagos: pagosCount,
        comprobantesReferenciados: comprobantesCount,
      },
      comprobantesFisicosEliminados: false,
    };
  } catch (error) {
    await conn.rollback();
    try { await logSistema({ mensaje: `eliminarTransfer error: ${error.message || error}`, meta: { Id_Transfer, userId, clientIp } }); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function resolverComprobanteSeguroTransferPorNombre(nombreArchivo) {
  // Validar que nombreArchivo no intente path traversal
  if (nombreArchivo.includes('..') || nombreArchivo.includes('/') || nombreArchivo.includes('\\')) {
    return null;
  }

  // Buscar el archivo en la carpeta uploads/transfers o en sus subcarpetas por transfer
  const uploadsDir = path.join(__dirname, '../../uploads', 'transfers');
  const directPath = path.resolve(uploadsDir, nombreArchivo);
  let resolvedPath = directPath;

  if (!fs.existsSync(resolvedPath)) {
    const transferDirs = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
      : [];

    const match = transferDirs
      .map(entry => path.resolve(uploadsDir, entry.name, nombreArchivo))
      .find(candidate => candidate.startsWith(uploadsDir) && fs.existsSync(candidate));

    if (match) resolvedPath = match;
  }

  // Verificar que está dentro de uploadsDir
  if (!resolvedPath.startsWith(uploadsDir)) {
    return null;
  }

  // Verificar que el archivo existe
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return {
    absolutePath: resolvedPath,
    relativePath: nombreArchivo
  };
}

module.exports = { getServiciosTransferSvc, crearTransferSvc, actualizarTransferSvc, cancelarTransferSvc, eliminarTransferSvc, filtrarTransfersSvc, getRangosSvc, getPreciosPorRangoSvc, getPrecioBasePorRangoYMonedaSvc, getDetalleTransferSvc, subirComprobanteTransferSvc, resolverComprobanteSeguroTransferPorNombre, actualizarEstadosTransfersVencidos, normalizarEstadosTransfersExistentes };
