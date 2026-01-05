const db = require('../../database/db');

async function recordHistorial({ conexion = null, tabla, id_registro = null, accion, id_usuario = null, detalles = [] }) {
  // If a connection is provided, use it (inside transaction), else get a new one
  const useExternalConn = !!conexion;
  const conn = conexion || await db.getConnection();

  try {
    const safeUser = (id_usuario == null) ? 0 : id_usuario;
    const [res] = await conn.query(
      'INSERT INTO historial (Tabla, Id_Registro, Accion, Id_Usuario) VALUES (?, ?, ?, ?)',
      [tabla, id_registro ?? 0, accion, safeUser]
    );

    const Id_Historial = res.insertId;

    if (Array.isArray(detalles) && detalles.length) {
      const placeholders = detalles.map(() => '(?, ?, ?, ?)').join(',');
      const params = [];
      for (const d of detalles) {
        params.push(Id_Historial, d.columna || '', (d.anterior == null) ? '' : String(d.anterior), (d.nuevo == null) ? '' : String(d.nuevo));
      }
      await conn.query(
        `INSERT INTO detalle_historial (Id_Historial, Columna, Valor_Anterior, Valor_Nuevo) VALUES ${placeholders}`,
        params
      );
    }

    return Id_Historial;
  } finally {
    if (!useExternalConn && conn) conn.release();
  }
}

async function logSistema({ mensaje, nivel = 'error', id_usuario = null, meta = null }) {
  const now = new Date();
  const msg = typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje);
  try {
    const safeUser = (id_usuario == null) ? 0 : id_usuario;
    await db.query(
      'INSERT INTO logs_sistema (Nivel, Mensaje, Meta, Id_Usuario, Fecha_Registro) VALUES (?, ?, ?, ?, ?)',
      [nivel, msg, meta ? JSON.stringify(meta) : '', safeUser, now]
    );
  } catch (e) {
    console.error('Failed to write to logs_sistema:', e);
  }
}

module.exports = { recordHistorial, logSistema };
