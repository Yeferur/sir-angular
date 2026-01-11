const db = require('../../database/db');

async function recordHistorial({ conexion = null, tabla, id_registro = null, accion, id_usuario = null, detalles = [] }) {
  // If a connection is provided, use it (inside transaction), else get a new one
  const useExternalConn = !!conexion;
  const conn = conexion || await db.getConnection();

  try {
    // Normalizar usuario
    const safeUser = (id_usuario == null) ? 0 : id_usuario;

    // Resolver acción concreta si viniera como 'CREAR_O_ACTUALIZAR'
    let finalAccion = accion;
    if (accion === 'CREAR_O_ACTUALIZAR') {
      if (!id_registro || id_registro === 0) {
        finalAccion = 'CREAR';
      } else {
        try {
          // Intentar obtener la columna PRIMARY KEY de la tabla
          const [pkRows] = await conn.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI' LIMIT 1",
            [tabla]
          );

          const pkCol = pkRows && pkRows[0] && pkRows[0].COLUMN_NAME;
          if (pkCol) {
            const [exists] = await conn.query(
              `SELECT 1 FROM \`${tabla}\` WHERE \`${pkCol}\` = ? LIMIT 1`,
              [id_registro]
            );
            finalAccion = (exists && exists.length) ? 'ACTUALIZAR' : 'CREAR';
          } else {
            // Fallback: intentar con patrón Id_<singular>
            const guessed = `Id_${tabla.slice(0, -1)}`;
            try {
              const [exists2] = await conn.query(
                `SELECT 1 FROM \`${tabla}\` WHERE \`${guessed}\` = ? LIMIT 1`,
                [id_registro]
              );
              finalAccion = (exists2 && exists2.length) ? 'ACTUALIZAR' : 'CREAR';
            } catch (e) {
              finalAccion = 'CREAR_O_ACTUALIZAR';
            }
          }
        } catch (e) {
          finalAccion = 'CREAR_O_ACTUALIZAR';
        }
      }
    }

    const [res] = await conn.query(
      'INSERT INTO historial (Tabla, Id_Registro, Accion, Id_Usuario) VALUES (?, ?, ?, ?)',
      [tabla, id_registro ?? 0, finalAccion, safeUser]
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
