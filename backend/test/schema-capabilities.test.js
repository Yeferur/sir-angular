const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../services/schema-capabilities');

function makeExecutor(columns = [], tables = []) {
  return {
    async query(sql) {
      if (sql.includes('SELECT DATABASE()')) return [[{ databaseName: 'sir2_schema_fixture' }], []];
      if (sql.includes('information_schema.COLUMNS')) return [columns, []];
      if (sql.includes('information_schema.TABLES')) return [tables.map((TABLE_NAME) => ({ TABLE_NAME })), []];
      throw new Error(`Consulta inesperada del detector de esquema: ${sql}`);
    },
  };
}

test('el esquema legacy conserva SQL anterior y no menciona columnas aún inexistentes', async () => {
  const capabilities = await schema.initializeSchemaCapabilities(makeExecutor());
  assert.equal(capabilities.initialized, true);
  assert.equal(capabilities.reservasSoftDelete, false);
  assert.equal(capabilities.aforoOperation, false);
  assert.equal(capabilities.permissionCatalogRevision, false);
  assert.equal(schema.reservasOperativasSource('r'), 'reservas r');
  assert.equal(schema.reservaNoEliminadaPredicate('r'), '1 = 1');
  assert.equal(schema.reservaDeletionColumn('r'), 'NULL');
});

test('el esquema migrado activa los filtros de soft-delete y capacidades nuevas', async () => {
  const columns = [
    { TABLE_NAME: 'reservas', COLUMN_NAME: 'Eliminada_En', COLUMN_TYPE: 'datetime(3)' },
    { TABLE_NAME: 'reservas', COLUMN_NAME: 'Eliminada_Por', COLUMN_TYPE: 'bigint unsigned' },
    { TABLE_NAME: 'reservas', COLUMN_NAME: 'Motivo_Eliminacion', COLUMN_TYPE: 'varchar(500)' },
    { TABLE_NAME: 'aforos', COLUMN_NAME: 'Operacion', COLUMN_TYPE: "enum('FIJAR','USAR_BASE')" },
    { TABLE_NAME: 'permisos_cache_revision', COLUMN_NAME: 'Tipo', COLUMN_TYPE: "enum('ROL','USUARIO','CATALOGO')" },
  ];
  const tables = ['chat_conversaciones', 'chat_participantes', 'chat_mensajes',
    'programacion_importaciones', 'programacion_importacion_archivos',
    'programacion_listados_manual', 'programacion_listado_items'];
  const capabilities = await schema.initializeSchemaCapabilities(makeExecutor(columns, tables));
  assert.equal(capabilities.reservasSoftDelete, true);
  assert.equal(capabilities.reservaDeletionAudit, true);
  assert.equal(capabilities.aforoOperation, true);
  assert.equal(capabilities.permissionCatalogRevision, true);
  assert.equal(capabilities.chatSchema, true);
  assert.equal(capabilities.programacionManualSchema, true);
  assert.match(schema.reservasOperativasSource('r'), /Eliminada_En IS NULL/);
  assert.equal(schema.reservaNoEliminadaPredicate('r'), 'r.Eliminada_En IS NULL');
  assert.equal(schema.reservaDeletionColumn('r'), 'r.Eliminada_En');
});
