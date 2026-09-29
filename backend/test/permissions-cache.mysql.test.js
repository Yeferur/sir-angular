const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { assertLocalTestDatabase, assertRevisionSchema } = require('../scripts/permissions-cache-safety');

function startBackend(env) {
  const child = fork(path.join(__dirname, '..', 'scripts', 'testing', 'permissions-backend-process.cjs'), [], {
    env, silent: true, windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  let sequence = 0;
  return {
    child,
    ready: new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Backend no arrancó: ${output}`)), 15000);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Backend terminó (${code}): ${output}`)); });
      child.on('message', (message) => {
        if (message.ready) { clearTimeout(timer); resolve(message); }
      });
    }),
    stats() {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { child.off('message', receive); reject(new Error('Sin estadísticas')); }, 5000);
        function receive(message) {
          if (message.id === id) { clearTimeout(timer); child.off('message', receive); resolve(message.counters); }
        }
        child.on('message', receive);
        child.send({ id, command: 'stats' });
      });
    },
  };
}

test('MySQL real: dos server.js propagan revocación/concesión, overrides y rollback', {
  skip: process.env.PERMISSIONS_CACHE_MYSQL_TEST !== '1', timeout: 90000,
}, async (t) => {
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  dotenv.config({ path: path.join(__dirname, '..', 'env', '.env'), quiet: true });
  const source = process.env.DB_NAME || process.env.DB_DATABASE;
  assertLocalTestDatabase(process.env, source);
  assert.match(source, /^[a-z0-9_]+$/i);
  const database = `sir_permissions_cache_test_${randomUUID().replaceAll('-', '')}`;
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: source,
  });
  const workers = [];
  let created = false;
  t.after(async () => {
    await Promise.all(workers.map(async ({ child }) => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }));
    try {
      // Únicamente la base efímera creada por ESTA ejecución, nunca la fuente.
      assert.match(database, /^sir_permissions_cache_test_[a-f0-9]{32}$/);
      assert.notEqual(database, source);
      if (created) await connection.query(`DROP DATABASE \`${database}\``);
    } finally { await connection.end(); }
  });

  const [[destination]] = await connection.query('SELECT DATABASE() AS db, @@hostname AS server');
  assert.equal(destination.db, source);
  await assertRevisionSchema(connection);
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  await connection.query(`USE \`${database}\``);
  assertLocalTestDatabase(process.env, database);
  // Copiar únicamente estructura actual, incluyendo índices, FK e InnoDB.
  const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'permisos_cache_revision'`, [source]);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { TABLE_NAME: table } of tables) {
    assert.match(table, /^[a-z0-9_]+$/i);
    const [[schema]] = await connection.query(`SHOW CREATE TABLE \`${source}\`.\`${table}\``);
    await connection.query(schema['Create Table']);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  const migration = await fs.readFile(path.join(__dirname, '..', 'database', 'migrations', '20260920_revision_cache_permisos.sql'), 'utf8');
  await connection.query(migration);
  await connection.query(migration); // idempotencia real.
  await assertRevisionSchema(connection);
  await connection.query(`INSERT INTO permisos SELECT * FROM \`${source}\`.permisos`);
  const [permissions] = await connection.query("SELECT Id_Permiso, Codigo_Permiso FROM permisos WHERE Codigo_Permiso LIKE 'USUARIOS.%'");
  const ids = new Map(permissions.map((p) => [p.Codigo_Permiso, p.Id_Permiso]));
  const readId = ids.get('USUARIOS.LEER');
  for (const code of ['USUARIOS.LEER', 'USUARIOS.CREAR', 'USUARIOS.ACTUALIZAR', 'USUARIOS.ELIMINAR']) assert.ok(ids.has(code), code);
  await connection.query("INSERT INTO roles (Id_Rol, Nombre_Rol, Activo) VALUES (1,'Administrador',1),(2,'Asesor',1),(3,'Cliente',1),(4,'Otro',1)");
  await connection.query('INSERT INTO rol_permisos (Id_Rol, Id_Permiso) VALUES ?', [
    [...ids.values()].map((id) => [1, id]).concat([[2, readId]]),
  ]);
  await connection.query(`INSERT INTO usuarios
    (Id_Usuario,Nombres_Apellidos,Usuario,Correo,Contrasena,Id_Rol,Activo)
    VALUES (700100,'Admin prueba','admin_prueba','admin@example.invalid','sin_login',1,1)`);
  const secret = randomUUID();
  const tokenFor = (id) => jwt.sign({ id }, secret, { expiresIn: '10m' });
  const adminToken = tokenFor(700100);
  async function saveSession(id, token) {
    await connection.query('INSERT INTO sesiones (Id_Usuario, Token, Fecha_Inicio, Fecha_Expira) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [id, token]);
  }
  await saveSession(700100, adminToken);
  const env = { ...process.env, DB_NAME: database, DB_DATABASE: database, NODE_ENV: 'test',
    PORT: '0', JWT_SECRET: secret, IA_ENABLED: 'false', AI_ENABLED: 'false', EMAIL_OUTBOX_ENABLED: 'false' };
  const a = startBackend(env); workers.push(a);
  const b = startBackend(env); workers.push(b);
  const [readyA, readyB] = await Promise.all([a.ready, b.ready]);
  assert.notEqual(readyA.pid, readyB.pid);
  assert.notEqual(readyA.port, readyB.port);
  async function request(port, method, route, token = adminToken, body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function expectStatus(port, method, route, status, token, body) {
    const result = await request(port, method, route, token, body);
    assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.body)}`);
    return result;
  }
  const userBody = (id, roleId, effective) => ({ Id_Usuario: id, Nombres_Apellidos: `Usuario ${id}`,
    Usuario: `usuario_${id}`, Correo: `${id}@example.invalid`, Contrasena: 'Prueba_Segura9!',
    Id_Rol: roleId, Activo: 1, ...(effective === undefined ? {} : { permisosEfectivos: effective }) });
  const tokens = new Map();
  for (const [id, role, effective] of [[700101, 2], [700102, 2, []], [700103, 4, [readId]], [700104, 3, [readId]]]) {
    await expectStatus(readyA.port, 'POST', '/usuarios', 201, adminToken, userBody(id, role, effective));
    const token = tokenFor(id); tokens.set(id, token); await saveSession(id, token);
  }
  const userToken = tokens.get(700101);
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  const warm = await b.stats();
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  const hit = await b.stats();
  assert.equal(hit.permissions - warm.permissions, 0);
  assert.equal(hit.revisions - warm.revisions, 1);
  await expectStatus(readyB.port, 'GET', '/roles', 403, tokens.get(700102)); // DENY
  await expectStatus(readyB.port, 'GET', '/roles', 200, tokens.get(700103)); // ALLOW
  await expectStatus(readyB.port, 'GET', '/roles', 403, tokens.get(700104)); // Cliente
  const roleChange = { idRol: 2, idPermiso: readId };
  const revBefore = Date.now();
  await expectStatus(readyA.port, 'DELETE', '/rol-permisos', 200, adminToken, roleChange);
  await expectStatus(readyB.port, 'GET', '/roles', 403, userToken);
  const propagationMs = Date.now() - revBefore;
  assert.ok(propagationMs < 300000);
  await expectStatus(readyB.port, 'GET', '/roles', 200, tokens.get(700103)); // ALLOW sigue vigente
  await expectStatus(readyA.port, 'POST', '/rol-permisos', 200, adminToken, roleChange);
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  await expectStatus(readyB.port, 'GET', '/roles', 403, tokens.get(700102)); // DENY sigue vigente

  async function editUser(id, role, effective, status = 200) {
    const body = userBody(id, role, effective); delete body.Contrasena;
    return expectStatus(readyA.port, 'PUT', `/usuarios/${id}`, status, adminToken, body);
  }
  await editUser(700101, 2, []);
  await expectStatus(readyB.port, 'GET', '/roles', 403, userToken);
  await editUser(700101, 2, [readId]);
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  await editUser(700103, 4, []); // revocar ALLOW individual
  await expectStatus(readyB.port, 'GET', '/roles', 403, tokens.get(700103));
  await editUser(700103, 4, [readId]); // conceder ALLOW individual
  await expectStatus(readyB.port, 'GET', '/roles', 200, tokens.get(700103));

  async function revision(tipo, id) {
    const [[row]] = await connection.query('SELECT CAST(Revision AS CHAR) AS revision FROM permisos_cache_revision WHERE Tipo=? AND Id_Entidad=?', [tipo, id]);
    return row?.revision ?? '0';
  }
  // Error real en MySQL al escribir revisión: la mutación previa debe revertirse.
  const beforeRole = await revision('ROL', 2);
  const beforeUser = await revision('USUARIO', 700101);
  for (const event of ['INSERT', 'UPDATE']) {
    await connection.query(`CREATE TRIGGER fail_revision_${event.toLowerCase()} BEFORE ${event}
      ON permisos_cache_revision FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fallo de revision de prueba'`);
  }
  await expectStatus(readyA.port, 'DELETE', '/rol-permisos', 500, adminToken, roleChange);
  assert.equal(await revision('ROL', 2), beforeRole);
  const [[retained]] = await connection.query('SELECT COUNT(*) AS n FROM rol_permisos WHERE Id_Rol=2 AND Id_Permiso=?', [readId]);
  assert.equal(retained.n, 1);
  await expectStatus(readyA.port, 'POST', '/rol-permisos', 500, adminToken, { idRol: 2, idPermiso: ids.get('USUARIOS.CREAR') });
  const [[notGranted]] = await connection.query('SELECT COUNT(*) AS n FROM rol_permisos WHERE Id_Rol=2 AND Id_Permiso=?', [ids.get('USUARIOS.CREAR')]);
  assert.equal(notGranted.n, 0);
  assert.equal(await revision('ROL', 2), beforeRole);
  await expectStatus(readyA.port, 'PUT', '/roles/2', 500, adminToken, { nombreRol: 'Asesor', descripcion: 'prueba', activo: 0 });
  const [[roleRetained]] = await connection.query('SELECT Activo FROM roles WHERE Id_Rol=2');
  assert.equal(roleRetained.Activo, 1);
  await editUser(700101, 2, [], 500);
  assert.equal(await revision('USUARIO', 700101), beforeUser);
  const [[overrides]] = await connection.query('SELECT COUNT(*) AS n FROM usuario_permisos WHERE Id_Usuario=700101');
  assert.equal(overrides.n, 0);
  await expectStatus(readyA.port, 'POST', '/usuarios', 500, adminToken, userBody(700105, 4, [readId]));
  const [[notCreated]] = await connection.query('SELECT COUNT(*) AS n FROM usuarios WHERE Id_Usuario=700105');
  assert.equal(notCreated.n, 0);
  assert.equal(await revision('USUARIO', 700105), '0');
  await expectStatus(readyA.port, 'DELETE', '/usuarios/700101', 500, adminToken);
  const [[userRetained]] = await connection.query('SELECT Activo FROM usuarios WHERE Id_Usuario=700101');
  assert.equal(userRetained.Activo, 1);
  assert.equal(await revision('USUARIO', 700101), beforeUser);
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  for (const event of ['insert', 'update']) await connection.query(`DROP TRIGGER fail_revision_${event}`);
  await expectStatus(readyA.port, 'POST', '/cache/invalidar', 200, adminToken, { userId: 700101 });
  assert.equal(BigInt(await revision('USUARIO', 700101)), BigInt(beforeUser) + 1n);
  const beforeInvalidation = await b.stats();
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  assert.ok((await b.stats()).permissions > beforeInvalidation.permissions);

  // Una caché ALLOW caliente no puede ocultar un error de revisión real.
  await connection.query('RENAME TABLE permisos_cache_revision TO revision_temporalmente_no_disponible');
  try { await expectStatus(readyB.port, 'GET', '/roles', 500, userToken); }
  finally { await connection.query('RENAME TABLE revision_temporalmente_no_disponible TO permisos_cache_revision'); }
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);

  await expectStatus(readyA.port, 'PUT', '/roles/2', 200, adminToken, { nombreRol: 'Asesor', descripcion: 'prueba', activo: 0 });
  await expectStatus(readyB.port, 'GET', '/roles', 403, userToken);
  await expectStatus(readyA.port, 'PUT', '/roles/2', 200, adminToken, { nombreRol: 'Asesor', descripcion: 'prueba', activo: 1 });
  await expectStatus(readyB.port, 'GET', '/roles', 200, userToken);
  await editUser(700101, 4, []); // conserva invalidación de sesión por cambio de rol.
  await expectStatus(readyB.port, 'GET', '/roles', 401, userToken);
  const newToken = jwt.sign({ id: 700101, nonce: randomUUID() }, secret, { expiresIn: '10m' });
  await saveSession(700101, newToken);
  await expectStatus(readyB.port, 'GET', '/roles', 403, newToken);

  // Revisiones adyacentes por encima del límite entero de Number son distintas.
  await connection.query("UPDATE permisos_cache_revision SET Revision=9007199254740992 WHERE Tipo='USUARIO' AND Id_Entidad=700103");
  await expectStatus(readyB.port, 'GET', '/roles', 200, tokens.get(700103));
  await editUser(700103, 4, []);
  assert.equal(await revision('USUARIO', 700103), '9007199254740993');
  await expectStatus(readyB.port, 'GET', '/roles', 403, tokens.get(700103));
  await editUser(700103, 4, [readId]);

  // Concurrencia de escritores reales: sin incrementos perdidos.
  const revConcurrent = BigInt(await revision('USUARIO', 700103));
  await Promise.all(Array.from({ length: 8 }, (_, i) => expectStatus(i % 2 ? readyA.port : readyB.port,
    'POST', '/cache/invalidar', 200, adminToken, { userId: 700103 })));
  assert.equal(BigInt(await revision('USUARIO', 700103)), revConcurrent + 8n);

  // Capturar la consulta REAL de producción para EXPLAIN, sin duplicarla.
  const pool = require('../database/db');
  let revisionSql;
  const originalQuery = pool.query;
  pool.query = async (sql) => { revisionSql = sql; return [[{ Id_Rol: '2', Revision_Usuario: '0', Revision_Rol: '0' }]]; };
  try { await require('../services/Permisos/permisos.service').obtenerRevisionPermisosUsuario(700101); }
  finally { pool.query = originalQuery; await pool.end(); }
  const [plan] = await connection.query(`EXPLAIN ${revisionSql}`, [700101]);
  assert.equal(plan.length, 3);
  plan.forEach((row) => { assert.equal(row.key, 'PRIMARY'); assert.ok(['const', 'eq_ref'].includes(row.type)); });
  t.diagnostic(JSON.stringify({ source, database, server: destination.server,
    processes: [readyA, readyB], propagationMs, cacheHit: { revisionQueries: 1, effectivePermissionReads: 0 },
    explain: plan.map(({ table, type, key, rows }) => ({ table, type, key, rows })),
    websocketClients: 0, rollback: 'rol y usuario verificados en MySQL', cleanup: 'base efímera eliminada al finalizar' }));
});
