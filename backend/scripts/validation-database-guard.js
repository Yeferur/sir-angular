// Every SQL write performed by preproduction validation must pass this guard.
// A confirmation flag never grants access to the canonical or development DB.
const FORBIDDEN_DATABASES = new Set([
  'sir',
  'sir2',
]);

function assertValidationDatabaseName(database) {
  if (typeof database !== 'string' || FORBIDDEN_DATABASES.has(database.toLowerCase())
    || !/^sir2_[a-z0-9_]*validation_[a-z0-9_]+$/i.test(database)) {
    throw new Error(`Destino de escritura rechazado: ${String(database)}. Se requiere una base sir2_*validation_* desechable.`);
  }
  return database;
}

async function assertValidationConnection(connection, expectedDatabase) {
  assertValidationDatabaseName(expectedDatabase);
  const [[row]] = await connection.query('SELECT DATABASE() AS selected_database');
  if (row?.selected_database !== expectedDatabase) {
    throw new Error(`Destino de escritura rechazado: conexión seleccionó ${row?.selected_database || '(ninguna)'}.`);
  }
}

module.exports = { assertValidationDatabaseName, assertValidationConnection };
