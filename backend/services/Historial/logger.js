const db = require('../../database/db');

let historialIdRegistroSchemaPromise = null;

function normalizeOptionalUserId(idUsuario) {
  if (idUsuario === null || idUsuario === undefined) return null;

  if (typeof idUsuario === 'number') {
    return Number.isInteger(idUsuario) && idUsuario > 0 ? idUsuario : null;
  }

  if (typeof idUsuario === 'bigint') {
    return idUsuario > 0n ? idUsuario.toString() : null;
  }

  if (typeof idUsuario === 'string') {
    const trimmed = idUsuario.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return trimmed === '0' ? null : trimmed;
  }

  return null;
}

async function ensureHistorialCambiosTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS historial_cambios (
      Id_Cambio BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      Tabla VARCHAR(100) NOT NULL,
      Id_Registro VARCHAR(50) DEFAULT NULL,
      Id_Usuario BIGINT UNSIGNED DEFAULT NULL,
      Cambio_JSON JSON NOT NULL,
      IP_Cliente VARCHAR(64) DEFAULT NULL,
      Fecha_Registro DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (Id_Cambio),
      KEY idx_historial_cambios_tabla (Tabla),
      KEY idx_historial_cambios_registro (Id_Registro),
      KEY idx_historial_cambios_usuario (Id_Usuario)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function ensureHistorialIdRegistroTextColumn() {
  if (!historialIdRegistroSchemaPromise) {
    historialIdRegistroSchemaPromise = (async () => {
      const [rows] = await db.query(
        `SELECT DATA_TYPE
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'historial'
            AND COLUMN_NAME = 'Id_Registro'
          LIMIT 1`
      );

      const dataType = String(rows?.[0]?.DATA_TYPE || '').toLowerCase();
      if (dataType !== 'varchar' && dataType !== 'text' && dataType !== 'mediumtext' && dataType !== 'longtext') {
        await db.query('ALTER TABLE historial MODIFY COLUMN Id_Registro VARCHAR(50) NULL');
      }
    })().catch((error) => {
      historialIdRegistroSchemaPromise = null;
      throw error;
    });
  }

  return historialIdRegistroSchemaPromise;
}

function normalizeHistorialInput(input, maybeData = {}) {
  if (input && typeof input === 'object' && !Array.isArray(input) && (
    Object.prototype.hasOwnProperty.call(input, 'tabla') ||
    Object.prototype.hasOwnProperty.call(input, 'conexion') ||
    Object.prototype.hasOwnProperty.call(input, 'accion')
  )) {
    return input;
  }

  if (input && typeof input.query === 'function') {
    return { conexion: input, ...(maybeData || {}) };
  }

  return { ...(maybeData || {}) };
}

async function registrarHistorial(input, maybeData = {}) {
  const data = normalizeHistorialInput(input, maybeData);
  const useExternalConn = !!data.conexion;
  const conn = data.conexion || await db.getConnection();

  try {
    await ensureHistorialIdRegistroTextColumn();

    // En tablas con FK a usuarios, usar NULL cuando no exista usuario válido
    const safeUser = normalizeOptionalUserId(data.id_usuario);
    const safeRegistro = (data.id_registro == null || data.id_registro === '') ? null : String(data.id_registro);

    // Resolver acción concreta si viniera como 'CREAR_O_ACTUALIZAR'
    let finalAccion = data.accion;
    if (data.accion === 'CREAR_O_ACTUALIZAR') {
      if (!data.id_registro || data.id_registro === 0) {
        finalAccion = 'CREAR';
      } else {
        try {
          // Intentar obtener la columna PRIMARY KEY de la tabla
          const [pkRows] = await conn.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI' LIMIT 1",
            [data.tabla]
          );

          const pkCol = pkRows && pkRows[0] && pkRows[0].COLUMN_NAME;
          if (pkCol) {
            const [exists] = await conn.query(
              `SELECT 1 FROM \`${data.tabla}\` WHERE \`${pkCol}\` = ? LIMIT 1`,
              [data.id_registro]
            );
            finalAccion = (exists && exists.length) ? 'ACTUALIZAR' : 'CREAR';
          } else {
            // Fallback: intentar con patrón Id_<singular>
            const guessed = `Id_${String(data.tabla || '').slice(0, -1)}`;
            try {
              const [exists2] = await conn.query(
                `SELECT 1 FROM \`${data.tabla}\` WHERE \`${guessed}\` = ? LIMIT 1`,
                [data.id_registro]
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
      [data.tabla, safeRegistro, finalAccion, safeUser]
    );

    const Id_Historial = res.insertId;

    if (Array.isArray(data.detalles) && data.detalles.length) {
      const placeholders = data.detalles.map(() => '(?, ?, ?, ?)').join(',');
      const params = [];
      for (const d of data.detalles) {
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

const recordHistorial = registrarHistorial;

async function logSistema({ mensaje, nivel = 'error', id_usuario = null, meta = null }) {
  const now = new Date();
  const msg = typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje);
  try {
    const safeUser = normalizeOptionalUserId(id_usuario);
    const modulo = meta ? JSON.stringify(meta).slice(0, 100) : null;
    await db.query(
      'INSERT INTO logs_sistema (Nivel, Descripcion, Modulo, Id_Usuario, Fecha_Registro) VALUES (?, ?, ?, ?, ?)',
      [String(nivel || 'INFO').toUpperCase(), msg, modulo, safeUser, now]
    );
  } catch (e) {
    console.error('Failed to write to logs_sistema:', e);
  }
}

async function recordHistorialCambioReserva({
  conexion = null,
  id_reserva,
  id_usuario = null,
  estado_anterior = null,
  estado_nuevo = null,
  ip_cliente = null,
  metadata = {}
}) {
  const useExternalConn = !!conexion;
  const conn = conexion || await db.getConnection();
  try {
    await ensureHistorialCambiosTable(conn);

    const payload = {
      estadoAnterior: estado_anterior,
      estadoNuevo: estado_nuevo,
      metadata: metadata || {}
    };

    const [result] = await conn.query(
      `INSERT INTO historial_cambios
      (Tabla, Id_Registro, Id_Usuario, Cambio_JSON, IP_Cliente, Fecha_Registro)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        'reservas',
        id_reserva ? String(id_reserva) : null,
        normalizeOptionalUserId(id_usuario),
        JSON.stringify(payload),
        ip_cliente || null,
      ]
    );

    return result.insertId;
  } finally {
    if (!useExternalConn && conn) conn.release();
  }
}

module.exports = { registrarHistorial, recordHistorial, logSistema, recordHistorialCambioReserva, ensureHistorialCambiosTable };
