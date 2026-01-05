const db = require('../../database/db');

async function getServiciosTransferSvc() {
  const [rows] = await db.query('SELECT Id_Servicio, Nombre_Servicio FROM servicios_transfer');
  return rows.map(r => ({ id: r.Id_Servicio, Servicio: r.Nombre_Servicio }));
}

async function crearTransferSvc(payload) {
  const sql = `INSERT INTO transfers (
    Nombre_Titular, Telefono_Titular, Id_Servicio, Punto_Salida, Punto_Destino,
    Fecha_Transfer, Hora_Recogida, Nombre_Reportante, Telefono_Reportante, Estado, Observaciones
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;

  const params = [
    payload.Titular || null,
    payload.Tel_Contacto || null,
    payload.Servicio || null,
    payload.Salida || null,
    payload.Llegada || null,
    payload.FechaTransfer || null,
    payload.HoraRecogida || null,
    payload.NombreReporta || null,
    payload.TelefonoTransfer || null,
    payload.Estado || null,
    payload.Observaciones || null
  ];

  const [result] = await db.query(sql, params);
  return { success: true, Id_Transfer: result.insertId, message: 'Transfer creado correctamente.' };
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
  if (Estado) conds.push(`tr.Estado = ${db.escape(Estado)}`);
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
      s.Nombre_Servicio AS Nombre_Servicio,
      tr.Fecha_Registro
    FROM transfers tr
    LEFT JOIN servicios_transfer s ON s.Id_Servicio = tr.Id_Servicio
    ${where}
    ORDER BY tr.Fecha_Registro DESC
  `;

  const [rows] = await db.query(sql);
  return rows;
}

module.exports = { getServiciosTransferSvc, crearTransferSvc, filtrarTransfersSvc, getRangosSvc, getPreciosPorRangoSvc };

async function getRangosSvc() {
  const [rows] = await db.query('SELECT Id_Rango, Descripcion, Minimo, Maximo FROM transfers_rangos ORDER BY Minimo');
  return rows.map(r => ({ id: r.Id_Rango, Descripcion: r.Descripcion, Minimo: r.Minimo, Maximo: r.Maximo }));
}

async function getPreciosPorRangoSvc(Id_Rango) {
  const [rows] = await db.query('SELECT tp.Id_PrecioTransfer, tp.Id_Rango, tp.Id_Moneda, m.Codigo AS MonedaCodigo, tp.Precio FROM transfers_precios tp LEFT JOIN monedas m ON tp.Id_Moneda = m.Id_Moneda WHERE tp.Id_Rango = ?', [Id_Rango]);
  return rows;
}

module.exports = { getServiciosTransferSvc, crearTransferSvc, filtrarTransfersSvc, getRangosSvc, getPreciosPorRangoSvc };
