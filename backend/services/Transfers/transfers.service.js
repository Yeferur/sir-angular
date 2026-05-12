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

function resolverEstadoTransfer(payload = {}, estadoActual = null) {
  if (estadoActual === 'Cancelado' || estadoActual === 'Completado') {
    return estadoActual;
  }

  if (payload.ModoDuplicado) {
    return 'Pendiente';
  }

  const valorServicio = Number(payload.ValorServicio || payload.Valor || 0);
  const pago = payload.Pago || {};
  const abonos = Array.isArray(pago.Abonos) ? pago.Abonos : [];
  const totalAbonado = abonos.reduce((sum, abono) => sum + Number(abono?.Monto || 0), 0);
  const pagoOk = pago.Tipo === 'Completo'
    || (valorServicio > 0 && totalAbonado >= valorServicio);

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
  if (datosOk && pagoOk) estado = 'Confirmado';
  else if (!datosOk && pagoOk) estado = 'Pendiente de datos';
  else if (datosOk && !pagoOk) estado = 'Pendiente de pago';

  if (fechaTransferEsPasadaBogota(payload.FechaTransfer)) {
    return estado === 'Confirmado' ? 'Completado' : 'Cancelado';
  }

  return estado;
}

async function actualizarEstadosTransfersVencidos(conexion = db) {
  await conexion.query(`
    UPDATE transfers
       SET Estado = CASE
         WHEN Estado IN ('Activo', 'Confirmada') AND Fecha_Transfer < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00')) THEN 'Completado'
         WHEN Estado IN ('Activo', 'Confirmada') THEN 'Confirmado'
         WHEN Estado = 'Completada' THEN 'Completado'
         WHEN Estado = 'Cancelada' THEN 'Cancelado'
         WHEN Estado = 'Confirmado' THEN 'Completado'
         WHEN Estado IN ('Pendiente', 'Pendiente de datos', 'Pendiente de pago') THEN 'Cancelado'
         ELSE Estado
       END
     WHERE Estado IN ('Activo', 'Confirmada', 'Completada', 'Cancelada')
        OR (
          Fecha_Transfer < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
          AND Estado IN ('Confirmado', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago')
        )
  `);
}

function formatoCodigoTransfer(idTransfer) {
  const numeric = String(idTransfer || '').replace(/\D/g, '');
  return numeric ? `TRS${numeric.padStart(5, '0')}` : null;
}

function normalizarIdTransferInput(value) {
  return String(value || '')
    .trim()
    .replace(/^TRS/i, '')
    .replace(/^TRC/i, '')
    .replace(/^TR-?/i, '');
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

async function crearTransferSvc(payload, files = {}) {
  const conn = await db.getConnection();
  const rutasComprobantesCreadas = [];

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

    const estadoCalculado = resolverEstadoTransfer({
      ...payload,
      Id_Moneda: idMoneda,
    });
    const idTransfer = await generarIdTransferUnico(conn);

    const sql = `INSERT INTO transfers (
      Id_Transfer,
      Nombre_Titular,
      DNI,
      Telefono_Titular,
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
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    const params = [
      idTransfer,
      payload.Titular || null,
      payload.DNI || null,
      payload.Tel_Contacto || null,
      payload.Id_Rango || payload.Rango || null,
      payload.Servicio || null,
      payload.Salida || null,
      payload.Llegada || null,
      payload.FechaTransfer || null,
      payload.HoraRecogida || null,
      payload.NombreReporta || null,
      payload.TelefonoTransfer || null,
      payload.ValorServicio || payload.Valor || null,
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
      id_usuario: payload?.Id_Usuario || payload?.userId || null,
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
  await actualizarEstadosTransfersVencidos();

  const {
    Fecha_Transfer,
    Id_Servicio,
    Id_Rango,
    Estado,
    Id_Transfer,
    Nombre_Titular,
    Telefono_Titular,
    DNI,
    Punto_Salida,
    Punto_Destino
  } = q;

  const conds = [];
  if (Fecha_Transfer) conds.push(`tr.Fecha_Transfer = ${db.escape(Fecha_Transfer)}`);
  if (Id_Servicio) {
    if (Array.isArray(Id_Servicio)) {
      const ids = Id_Servicio.map(i => db.escape(i)).join(',');
      conds.push(`tr.Id_Servicio IN (${ids})`);
    } else conds.push(`tr.Id_Servicio = ${db.escape(Id_Servicio)}`);
  }
  if (Id_Rango) conds.push(`tr.Id_Rango = ${db.escape(Id_Rango)}`);
  if (Estado) {
    if (Array.isArray(Estado)) {
      const estados = Estado.map(e => db.escape(e)).join(',');
      conds.push(`tr.Estado IN (${estados})`);
    } else {
      conds.push(`tr.Estado = ${db.escape(Estado)}`);
    }
  }
  const idTransferFiltro = normalizarIdTransferInput(Id_Transfer);
  if (idTransferFiltro) conds.push(`tr.Id_Transfer = ${db.escape(idTransferFiltro)}`);
  if (Nombre_Titular) conds.push(`tr.Nombre_Titular LIKE ${db.escape('%' + Nombre_Titular + '%')}`);
  if (Telefono_Titular) conds.push(`tr.Telefono_Titular LIKE ${db.escape('%' + Telefono_Titular + '%')}`);
  if (DNI) conds.push(`tr.DNI LIKE ${db.escape('%' + DNI + '%')}`);
  if (Punto_Salida) conds.push(`tr.Punto_Salida LIKE ${db.escape('%' + Punto_Salida + '%')}`);
  if (Punto_Destino) conds.push(`tr.Punto_Destino LIKE ${db.escape('%' + Punto_Destino + '%')}`);

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
      tr.Id_Rango,
      tr.Valor,
      tr.Id_Moneda,
      m.Codigo AS MonedaCodigo,
      tr.Vuelo,
      tr.TipoVuelo,
      s.Nombre_Servicio AS Nombre_Servicio,
      tr.Fecha_Registro
    FROM transfers tr
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
    LEFT JOIN monedas m ON m.Id_Moneda = tr.Id_Moneda
    ${where}
    ORDER BY tr.Fecha_Registro DESC
  `;

  const [rows] = await db.query(sql);
  return rows;
}

async function getRangosSvc() {
  const [rows] = await db.query('SELECT Id_Rango, Descripcion, Minimo, Maximo FROM transfers_rangos ORDER BY Minimo');
  return rows.map(r => ({ id: r.Id_Rango, Descripcion: r.Descripcion, Minimo: r.Minimo, Maximo: r.Maximo }));
}

async function getPreciosPorRangoSvc(Id_Rango) {
  const [rows] = await db.query('SELECT tp.Id_PrecioTransfer, tp.Id_Rango, tp.Id_Moneda, m.Codigo AS MonedaCodigo, tp.Precio FROM transfers_precios tp LEFT JOIN monedas m ON tp.Id_Moneda = m.Id_Moneda WHERE tp.Id_Rango = ?', [Id_Rango]);
  return rows;
}

async function getDetalleTransferSvc(Id_Transfer) {
  await actualizarEstadosTransfersVencidos();

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

async function actualizarTransferSvc(Id_Transfer, payload) {
  const conn = await db.getConnection();
  let rutasPendientesEliminar = [];

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

    const estadoCalculado = resolverEstadoTransfer({
      ...payload,
      Id_Moneda: idMoneda,
    }, transferActualRows[0].Estado || null);

    const sql = `UPDATE transfers SET
      Nombre_Titular = ?,
      DNI = ?,
      Telefono_Titular = ?,
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
      payload.Id_Rango || payload.Rango || null,
      payload.Servicio || null,
      payload.Salida || null,
      payload.Llegada || null,
      payload.FechaTransfer || null,
      payload.HoraRecogida || null,
      payload.NombreReporta || null,
      payload.TelefonoTransfer || null,
      payload.ValorServicio || payload.Valor || null,
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
      id_usuario: payload?.Id_Usuario || payload?.userId || null,
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

async function cancelarTransferSvc(Id_Transfer) {
  const conn = await db.getConnection();
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

module.exports = { getServiciosTransferSvc, crearTransferSvc, actualizarTransferSvc, cancelarTransferSvc, filtrarTransfersSvc, getRangosSvc, getPreciosPorRangoSvc, getDetalleTransferSvc, subirComprobanteTransferSvc, resolverComprobanteSeguroTransferPorNombre };
