// Esta fase se valida exclusivamente sobre MySQL local de pruebas.
function assertLocalTestDatabase(env, database) {
  if (env.SIR_PREPROD_VALIDATION === '1') {
    const { assertValidationDatabaseName } = require('./validation-database-guard');
    assertValidationDatabaseName(database);
  }
  const host = String(env.DB_HOST || '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)
    || String(env.NODE_ENV || '').toLowerCase() === 'production'
    || (env.SIR_PREPROD_VALIDATION !== '1'
      && !/(?:^|_)test(?:_|$)/i.test(String(database || ''))
      && !/^sir2_permissions_cache_validation_[a-f0-9]{20}$/i.test(String(database || '')))
    || /(?:^|_)(?:prod|production|operativa)(?:_|$)/i.test(database)) {
    throw new Error('La validación de caché requiere una base local identificada como test, fuera de producción.');
  }
}

async function assertRevisionSchema(connection, { requireCatalog = false } = {}) {
  const [tables] = await connection.query(`SELECT ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permisos_cache_revision'`);
  if (!tables.length) return; // CREATE TABLE IF NOT EXISTS la creará.
  const [columns] = await connection.query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permisos_cache_revision'`);
  const [indexes] = await connection.query(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permisos_cache_revision'
    ORDER BY INDEX_NAME, SEQ_IN_INDEX`);
  const byName = new Map(columns.map((c) => [c.COLUMN_NAME, c]));
  const tipo = byName.get('Tipo');
  const id = byName.get('Id_Entidad');
  const revision = byName.get('Revision');
  const primary = indexes.filter((i) => i.INDEX_NAME === 'PRIMARY').map((i) => i.COLUMN_NAME);
  const catalogType = "enum('ROL','USUARIO','CATALOGO')";
  const legacyType = "enum('ROL','USUARIO')";
  const validType = requireCatalog ? tipo?.COLUMN_TYPE === catalogType
    : [legacyType, catalogType].includes(tipo?.COLUMN_TYPE);
  if (tables[0].ENGINE !== 'InnoDB' || columns.length !== 3
    || !validType
    || id?.COLUMN_TYPE !== 'bigint unsigned' || revision?.COLUMN_TYPE !== 'bigint unsigned'
    || [tipo, id, revision].some((c) => c?.IS_NULLABLE !== 'NO')
    || String(revision?.COLUMN_DEFAULT) !== '1'
    || primary.join(',') !== 'Tipo,Id_Entidad'
    || indexes.some((i) => i.INDEX_NAME !== 'PRIMARY' && Number(i.NON_UNIQUE) === 0)) {
    throw new Error('permisos_cache_revision ya existe con esquema incompatible/parcial. No se alteraron sus datos.');
  }
}

module.exports = { assertLocalTestDatabase, assertRevisionSchema };
