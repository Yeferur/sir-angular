const db = require('../../database/db');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

async function getServiciosTransferSvc() {
  const [rows] = await db.query('SELECT Id_Servicio, Nombre_Servicio FROM servicios_transfer');
  return rows.map(r => ({ id: r.Id_Servicio, Servicio: r.Nombre_Servicio }));
}

async function crearTransferSvc(payload) {
  const conn = await db.getConnection();

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

    const sql = `INSERT INTO transfers (
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
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

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
      payload.Estado || null,
      payload.Observaciones || null
    ];

    const [result] = await conn.query(sql, params);
    const idTransfer = result.insertId;

    // Array para guardar los pagos creados (devolver Ids)
    const pagosCreados = [];

    // Insertar pagos si vienen en payload
    if (payload.Pago && payload.Pago.Tipo) {
      const valorServicio = payload.ValorServicio || payload.Valor || 0;
      const ahora = new Date();

      if (payload.Pago.Tipo === 'Completo') {
        // Un pago completo
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [idTransfer, valorServicio, 'Completo', ahora, 'Pagado', 'Pago completo registrado al crear transfer', null]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: valorServicio,
          Metodo: 'Completo'
        });
      } else if (payload.Pago.Tipo === 'PagaEnPunto') {
        // Un pago pendiente en punto
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [idTransfer, 0, 'Paga en punto', ahora, 'Pendiente', 'Pago pendiente en punto', null]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: 0,
          Metodo: 'Paga en punto'
        });
      } else if (payload.Pago.Tipo === 'Abonos' && Array.isArray(payload.Pago.Abonos)) {
        // Insertar un registro por cada abono
        for (const abono of payload.Pago.Abonos) {
          if (abono.Monto && Number(abono.Monto) > 0) {
            const fechaPago = abono.Fecha_Pago ? new Date(abono.Fecha_Pago) : ahora;
            const [pagRes] = await conn.query(
              `INSERT INTO pagos_transfers
               (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [idTransfer, Number(abono.Monto), 'Abono', fechaPago, 'Pagado', abono.Observaciones || null, null]
            );
            pagosCreados.push({
              Id_Pago: pagRes.insertId,
              Monto: Number(abono.Monto),
              Metodo: 'Abono'
            });
          }
        }
      }
    }

    // Commit transacción
    await conn.commit();

    return { success: true, Id_Transfer: idTransfer, pagos: pagosCreados, message: 'Transfer creado correctamente.' };
  } catch (error) {
    // Rollback en caso de error
    await conn.rollback();
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
  if (Id_Transfer) conds.push(`tr.Id_Transfer = ${db.escape(Id_Transfer)}`);
  if (Nombre_Titular) conds.push(`tr.Nombre_Titular LIKE ${db.escape('%' + Nombre_Titular + '%')}`);
  if (Telefono_Titular) conds.push(`tr.Telefono_Titular LIKE ${db.escape('%' + Telefono_Titular + '%')}`);
  if (DNI) conds.push(`tr.DNI LIKE ${db.escape('%' + DNI + '%')}`);
  if (Punto_Salida) conds.push(`tr.Punto_Salida LIKE ${db.escape('%' + Punto_Salida + '%')}`);
  if (Punto_Destino) conds.push(`tr.Punto_Destino LIKE ${db.escape('%' + Punto_Destino + '%')}`);

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      tr.Id_Transfer,
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
  // Obtener detalles completos del transfer
  const [transferData] = await db.query(`
    SELECT
      tr.*,
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

  return {
    transfer,
    pagos: pagos || []
  };
}

// FUNCIONES PARA COMPROBANTES TRANSFERS

async function subirComprobanteTransferSvc(Id_Transfer, Id_Pago, file, userId = null, clientIp = null) {
  let conn;
  try {
    // Validar que el pago existe y pertenece al transfer
    conn = await db.getConnection();
    const [pagos] = await conn.query(
      'SELECT Id_Pago FROM pagos_transfers WHERE Id_Pago = ? AND Id_Transfer = ? LIMIT 1',
      [Id_Pago, Id_Transfer]
    );

    if (pagos.length === 0) {
      const err = new Error('Pago no encontrado o no pertenece a este transfer');
      err.status = 404;
      throw err;
    }

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

    // Actualizar la base de datos con la ruta
    await conn.query(
      'UPDATE pagos_transfers SET Pago_Comprobante = ? WHERE Id_Pago = ?',
      [rutaComprobante, Id_Pago]
    );

    conn.release();

    return {
      Id_Pago,
      Pago_Comprobante: rutaComprobante,
      message: 'Comprobante guardado correctamente'
    };
  } catch (error) {
    if (conn) conn.release();
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
      payload.Observaciones || null,
      Id_Transfer
    ];

    await conn.query(sql, params);

    // Eliminar pagos existentes
    await conn.query('DELETE FROM pagos_transfers WHERE Id_Transfer = ?', [Id_Transfer]);

    // Insertar nuevos pagos
    const pagosCreados = [];
    if (payload.Pago && payload.Pago.Tipo) {
      const valorServicio = payload.ValorServicio || payload.Valor || 0;
      const ahora = new Date();

      if (payload.Pago.Tipo === 'Completo') {
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [Id_Transfer, valorServicio, 'Completo', ahora, 'Pagado', 'Pago completo registrado al actualizar transfer', null]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: valorServicio,
          Metodo: 'Completo'
        });
      } else if (payload.Pago.Tipo === 'PagaEnPunto') {
        const [pagRes] = await conn.query(
          `INSERT INTO pagos_transfers
           (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [Id_Transfer, 0, 'Paga en punto', ahora, 'Pendiente', 'Pago pendiente en punto', null]
        );
        pagosCreados.push({
          Id_Pago: pagRes.insertId,
          Monto: 0,
          Metodo: 'Paga en punto'
        });
      } else if (payload.Pago.Tipo === 'Abonos' && Array.isArray(payload.Pago.Abonos)) {
        for (const abono of payload.Pago.Abonos) {
          if (abono.Monto && Number(abono.Monto) > 0) {
            const fechaPago = abono.Fecha_Pago ? new Date(abono.Fecha_Pago) : ahora;
            const [pagRes] = await conn.query(
              `INSERT INTO pagos_transfers
               (Id_Transfer, Monto, Metodo, Fecha_Pago, Estado, Observaciones, Pago_Comprobante)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [Id_Transfer, Number(abono.Monto), 'Abono', fechaPago, 'Pagado', abono.Observaciones || null, null]
            );
            pagosCreados.push({
              Id_Pago: pagRes.insertId,
              Monto: Number(abono.Monto),
              Metodo: 'Abono'
            });
          }
        }
      }
    }

    // Commit transacción
    await conn.commit();

    return { success: true, Id_Transfer, pagos: pagosCreados, message: 'Transfer actualizado correctamente.' };
  } catch (error) {
    // Rollback en caso de error
    await conn.rollback();
    throw error;
  } finally {
    // Liberar conexión
    conn.release();
  }
}

async function resolverComprobanteSeguroTransferPorNombre(nombreArchivo) {
  // Validar que nombreArchivo no intente path traversal
  if (nombreArchivo.includes('..') || nombreArchivo.includes('/') || nombreArchivo.includes('\\')) {
    return null;
  }

  // Buscar el archivo en la carpeta uploads/transfers
  const uploadsDir = path.join(__dirname, '../../uploads', 'transfers');
  const resolvedPath = path.resolve(uploadsDir, nombreArchivo);

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

module.exports = { getServiciosTransferSvc, crearTransferSvc, actualizarTransferSvc, filtrarTransfersSvc, getRangosSvc, getPreciosPorRangoSvc, getDetalleTransferSvc, subirComprobanteTransferSvc, resolverComprobanteSeguroTransferPorNombre };
