const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const backendRoot = path.resolve(__dirname, '..');
for (const fileName of ['.env', path.join('env', '.env')]) {
  const envPath = path.join(backendRoot, fileName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function signature(row) {
  const data = parseJson(row.Datos);
  // La firma es deliberadamente estricta: no mezcla ciclos, textos o entidades
  // diferentes aunque todos pertenezcan al módulo de Comisiones.
  return JSON.stringify([
    String(row.Id_Usuario), String(row.Tipo || ''), String(row.Entidad_Tipo || ''),
    String(row.Entidad_Id || ''), String(data.pendienteId || ''),
    String(row.Titulo || '').trim(), String(row.Mensaje || '').trim(),
  ]);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  if (apply && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Limpieza rechazada: DB_HOST=${host || '(vacío)'} no es una base local.`);
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || process.env.DB_DATABASE,
    dateStrings: true,
  });
  try {
    const [rows] = await connection.query(
      `SELECT Id_Notificacion, Id_Usuario, Tipo, Titulo, Mensaje, Entidad_Tipo,
              Entidad_Id, Datos, Clave_Deduplicacion, Leida, Fecha_Lectura, Fecha_Creacion
         FROM notificaciones
        WHERE LOWER(CONCAT_WS(' ', Tipo, Titulo, Mensaje, Entidad_Tipo, Entidad_Id, Datos)) LIKE '%comision%'
        ORDER BY Id_Usuario, Fecha_Creacion, Id_Notificacion`
    );
    const groups = new Map();
    for (const row of rows) {
      const key = signature(row);
      const values = groups.get(key) || [];
      values.push(row);
      groups.set(key, values);
    }
    const duplicates = [...groups.values()].filter(items => items.length > 1);
    const report = duplicates.map(items => ({
      usuario: String(items[0].Id_Usuario),
      titulo: items[0].Titulo,
      entidad: `${items[0].Entidad_Tipo || ''}:${items[0].Entidad_Id || ''}`,
      ids: items.map(item => String(item.Id_Notificacion)),
      estadosLectura: items.map(item => !!item.Leida),
      fechas: items.map(item => item.Fecha_Creacion),
    }));
    if (!apply || !duplicates.length) {
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: rows.length, duplicateGroups: duplicates.length, removable: duplicates.reduce((sum, items) => sum + items.length - 1, 0), groups: report }, null, 2));
      return;
    }

    await connection.beginTransaction();
    let removed = 0;
    for (const items of duplicates) {
      const survivor = items[0];
      const discarded = items.slice(1);
      const wasRead = items.some(item => Number(item.Leida) === 1);
      const readDates = items.map(item => item.Fecha_Lectura).filter(Boolean).sort();
      await connection.query(
        'UPDATE notificaciones SET Leida = ?, Fecha_Lectura = ? WHERE Id_Notificacion = ?',
        [wasRead ? 1 : 0, wasRead ? (readDates[0] || survivor.Fecha_Creacion) : null, survivor.Id_Notificacion]
      );
      await connection.query(
        `DELETE FROM notificaciones WHERE Id_Notificacion IN (${discarded.map(() => '?').join(',')})`,
        discarded.map(item => item.Id_Notificacion)
      );
      removed += discarded.length;
    }
    await connection.commit();
    console.log(JSON.stringify({ mode: 'apply', duplicateGroups: duplicates.length, removed, groups: report }, null, 2));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(`No se pudo limpiar el histórico de Comisiones: ${error.message}`);
  process.exitCode = 1;
});
