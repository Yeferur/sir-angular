const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MIGRATIONS } = require('../scripts/release-migrate-sir2');
const { reservaOcupaCupos } = require('../services/Reservas/reservas.service');

test('soft-delete libera ocupación sin convertir la reserva en cancelada', () => {
  const base = { tipoReserva: 'Grupal', estado: 'Confirmada', idTour: 5, fechaTour: '2026-10-15', cantidad: 3 };
  assert.equal(reservaOcupaCupos(base), true);
  assert.equal(reservaOcupaCupos({ ...base, estado: 'Cancelada' }), false);
  assert.equal(reservaOcupaCupos({ ...base, eliminadaEn: '2026-10-12 10:00:00' }), false);
});

test('el esquema preparado mantiene pareja directa única y elementos de listado neutrales', async () => {
  const root = path.join(__dirname, '..', 'database', 'migrations');
  const chat = await fs.readFile(path.join(root, '20261013_0004_chat_schema_mysql.sql'), 'utf8');
  const manual = await fs.readFile(path.join(root, '20261012_0005_programacion_manual.sql'), 'utf8');
  assert.match(chat, /UNIQUE KEY uq_chat_directa_par \(Tipo, Directa_Usuario_Menor, Directa_Usuario_Mayor\)/);
  assert.match(chat, /Tipo = 'GRUPAL'.*Directa_Usuario_Menor IS NULL/s);
  assert.match(chat, /fk_chat_part_ultimo_mensaje/);
  assert.match(manual, /CREATE TABLE IF NOT EXISTS programacion_listado_items/);
  assert.doesNotMatch(manual, /CREATE TABLE IF NOT EXISTS programacion_listado_reservas/);
  assert.match(manual, /Id_Reserva VARCHAR\(20\) NULL/);
  assert.match(manual, /MATCH_AMBIGUO/);
});

test('el ledger y las migraciones de motor se preparan por separado', () => {
  assert.ok(MIGRATIONS.indexOf('20261012_0001_schema_migrations.sql') < MIGRATIONS.indexOf('20261012_0002_permission_catalog_revision.sql'));
  assert.ok(MIGRATIONS.indexOf('20261012_0006_tour_comisiones_innodb.sql') < MIGRATIONS.indexOf('20261012_0007_ia_tables_innodb.sql'));
});

test('baseline dinámico de Administrador preserva overrides individuales DENY', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'services', 'Permisos', 'permisos.service.js'), 'utf8');
  const cache = await fs.readFile(path.join(__dirname, '..', 'middlewares', 'permissionsMiddleware.js'), 'utf8');
  assert.match(source, /LOWER\(TRIM\(r\.Nombre_Rol\)\) = 'administrador'/);
  assert.match(source, /COALESCE\(permiso_individual\.Tipo, ''\) <> 'DENY'/);
  assert.match(source, /WHEN MAX\(up\.Tipo = 'DENY'\) = 1 THEN 0/);
  assert.match(source, /ADMIN_ROLE_BASELINE_DYNAMIC/);
  assert.match(source, /Revision_Catalogo/);
  assert.match(cache, /a\?\.catalogo === b\?\.catalogo/);
});

test('ningún writer ni migration del runtime depende de historial_cambios', async () => {
  const logger = await fs.readFile(path.join(__dirname, '..', 'services', 'Historial', 'logger.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', '20260930_runtime_schema.sql'), 'utf8');
  assert.doesNotMatch(logger, /INSERT INTO historial_cambios/);
  assert.doesNotMatch(runtime, /CREATE TABLE IF NOT EXISTS historial_cambios/);
});
