const db = require('../database/db');

const capabilities = {
  initialized: false,
  database: null,
  reservasSoftDelete: false,
  reservaDeletionAudit: false,
  aforoOperation: false,
  permissionCatalogRevision: false,
  chatSchema: false,
  programacionManualSchema: false,
  passengerTypeEnye: false,
  tourPriceTypeEnye: false,
};

async function initializeSchemaCapabilities(executor = db) {
  const [[databaseRow]] = await executor.query('SELECT DATABASE() AS databaseName');
  if (!databaseRow?.databaseName) throw new Error('No se pudo identificar la base activa para detectar capacidades del esquema.');

  const [columns] = await executor.query(`
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'reservas' AND COLUMN_NAME IN ('Eliminada_En', 'Eliminada_Por', 'Motivo_Eliminacion'))
         OR (TABLE_NAME = 'aforos' AND COLUMN_NAME = 'Operacion')
         OR (TABLE_NAME = 'permisos_cache_revision' AND COLUMN_NAME = 'Tipo')
         OR (TABLE_NAME IN ('pasajeros', 'tour_precios') AND COLUMN_NAME = 'Tipo_Pasajero'))
  `);
  const [tables] = await executor.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN ('chat_conversaciones', 'chat_participantes', 'chat_mensajes',
         'programacion_importaciones', 'programacion_importacion_archivos',
         'programacion_listados_manual', 'programacion_listado_items')
  `);
  const columnTypes = new Map(columns.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, String(row.COLUMN_TYPE || '').toLowerCase()]));
  const tableNames = new Set(tables.map((row) => row.TABLE_NAME));

  Object.assign(capabilities, {
    initialized: true,
    database: databaseRow.databaseName,
    reservasSoftDelete: columnTypes.has('reservas.Eliminada_En'),
    reservaDeletionAudit: ['reservas.Eliminada_En', 'reservas.Eliminada_Por', 'reservas.Motivo_Eliminacion']
      .every((column) => columnTypes.has(column)),
    aforoOperation: columnTypes.has('aforos.Operacion'),
    permissionCatalogRevision: columnTypes.get('permisos_cache_revision.Tipo')?.includes('catalogo') || false,
    chatSchema: ['chat_conversaciones', 'chat_participantes', 'chat_mensajes'].every((table) => tableNames.has(table)),
    programacionManualSchema: ['programacion_importaciones', 'programacion_importacion_archivos',
      'programacion_listados_manual', 'programacion_listado_items'].every((table) => tableNames.has(table)),
    passengerTypeEnye: columnTypes.get('pasajeros.Tipo_Pasajero')?.includes('niño') || false,
    tourPriceTypeEnye: columnTypes.get('tour_precios.Tipo_Pasajero')?.includes('niño') || false,
  });
  return getSchemaCapabilities();
}

function getSchemaCapabilities() {
  return { ...capabilities };
}

function reservasOperativasSource(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias de reservas no válido.');
  return capabilities.reservasSoftDelete
    ? `(SELECT * FROM reservas WHERE Eliminada_En IS NULL) ${alias}`
    : `reservas ${alias}`;
}

function reservaNoEliminadaPredicate(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias de reservas no válido.');
  return capabilities.reservasSoftDelete ? `${alias}.Eliminada_En IS NULL` : '1 = 1';
}

function reservaDeletionColumn(alias) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias de reservas no válido.');
  return capabilities.reservasSoftDelete ? `${alias}.Eliminada_En` : 'NULL';
}

function requireSchemaCapability(capability, message) {
  if (!capabilities[capability]) {
    const error = new Error(message || `La capacidad de esquema ${capability} aún no está disponible.`);
    error.code = 'SCHEMA_CAPABILITY_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

function passengerTypeForDatabase(type, table = 'pasajeros') {
  const canonical = String(type || '').trim().toUpperCase() === 'NINO' ? 'NIÑO'
    : String(type || '').trim().toUpperCase();
  const supportsEnye = table === 'tour_precios' ? capabilities.tourPriceTypeEnye : capabilities.passengerTypeEnye;
  return canonical === 'NIÑO' && !supportsEnye ? 'NINO' : canonical;
}

module.exports = {
  initializeSchemaCapabilities,
  getSchemaCapabilities,
  reservasOperativasSource,
  reservaNoEliminadaPredicate,
  reservaDeletionColumn,
  requireSchemaCapability,
  passengerTypeForDatabase,
};
