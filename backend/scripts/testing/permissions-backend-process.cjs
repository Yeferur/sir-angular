// Fixture: arranca server.js completo en un proceso independiente. Solo se desactivan
// jobs ajenos a permisos para que la prueba no envíe correos ni recordatorios.
// Autenticación, rutas, servicios, transacciones, MySQL y caché son los reales.
const { assertLocalTestDatabase } = require('../../scripts/permissions-cache-safety');
assertLocalTestDatabase(process.env, process.env.DB_NAME);
for (const [file, names] of [
  ['vencimientos.job', ['iniciarVencimientosJob', 'detenerVencimientosJob']],
  ['email-outbox.job', ['iniciarEmailOutboxJob', 'detenerEmailOutboxJob']],
  ['pendientes.job', ['iniciarPendientesJob', 'detenerPendientesJob']],
  ['app-updates.job', ['publishAppUpdateOnStartup']],
]) {
  const resolved = require.resolve(`../../jobs/${file}`);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true,
    exports: Object.fromEntries(names.map((name) => [name, async () => {}])) };
}
const counters = { revisions: 0, permissions: 0 };
const service = require('../../services/Permisos/permisos.service');
for (const [name, counter] of [
  ['obtenerRevisionPermisosUsuario', 'revisions'], ['obtenerPermisosPorUsuario', 'permissions'],
]) {
  const original = service[name];
  service[name] = async (...args) => { counters[counter]++; return original(...args); };
}
process.on('message', ({ id, command }) => {
  if (command === 'stats') process.send({ id, counters: { ...counters } });
});
const http = require('node:http');
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send({ ready: true, pid: process.pid, port: this.address().port }));
  return listen.apply(this, args);
};
require('../../server');
