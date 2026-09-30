# Release de la nueva SIR: esquema de `sir2`

**CRITICAL: Database `sir` and PM2 process `app` belong to the current production system and must never be modified by this release.**

Destino exclusivo: base `sir2`, proceso PM2 `sir-api`. El MySQL es compartido y el usuario actual puede escribir en ambas bases; por eso se exige la comprobación estricta del destino antes de cualquier DDL. Este documento no autoriza el despliegue ni sustituye el respaldo y el preflight del VPS.

## Migraciones en orden de dependencia

1. `20260911_p0_permissions_notifications.sql`: amplía `notificaciones.Entidad_Id` y agrega permisos históricos de cancelación y avisos.
2. `20260911_pendientes_recordatorios_mvp.sql`: crea la base de Pendientes, amplía Recordatorios y agrega permisos y reglas. Incluye un procedimiento SQL histórico.
3. `20260813_email_outbox.sql`: crea o completa las tres tablas de outbox, sus índices y FK; conserva tablas y filas existentes.
4. `20260920_revision_cache_permisos.sql`: crea las revisiones requeridas por el backend de permisos Fase 2D.3.
5. `20260921_programacion_cambios_pendientes.sql`: agrega la regla de cambios de Programación; depende de Pendientes.
6. `20260922_app_updates_notifications.sql`: añade la deduplicación de Avisos; depende de la base histórica de notificaciones.
7. `20260922_reminder_email.sql`: integra Recordatorios con outbox y amplía el enum de correo con `reminder`.
8. `20260929_programacion_transfers_snapshot.sql`: crea el esquema de referencia de Transfers.
9. `20260930_runtime_schema.sql`: formaliza historial, confirmación de jornada y `disponibilidad` en minúscula.

Aplicar las nueve y verificar su resultado **antes** de iniciar cualquier instancia del backend nuevo. La tabla `permisos_cache_revision` debe existir antes de iniciar Fase 2D.3. No generar snapshots históricos de Transfers: solo una exportación exitosa posterior al despliegue crea la primera referencia.

## Ejecución protegida

El ejecutor operativo es `backend/scripts/release-migrate-sir2.js` (`npm run db:release:sir2 -- --confirm-sir2` desde `backend`). Lee la configuración de la nueva SIR, exige que `DB_NAME`/`DB_DATABASE` indiquen exactamente `sir2`, se conecta indicando explícitamente `database: 'sir2'`, ejecuta `SELECT DATABASE()`, exige ese mismo resultado e imprime `TARGET DATABASE: sir2` antes de validar `--confirm-sir2`. Sin confirmación, no ejecuta DDL. No admite un nombre de base arbitrario. Nunca imprimir credenciales ni una cadena de conexión.

Si se usa el cliente MySQL para inspección, seleccionar explícitamente `sir2`, por ejemplo `mysql --defaults-extra-file=/ruta/credenciales --database=sir2 -e 'SELECT DATABASE();'`. El procedimiento de release usa el ejecutor protegido para aplicar las nueve migraciones; no apuntar comandos manuales a `sir`.

Los scripts de migración individual (`scripts/run-migration.js` y `scripts/migrate-programacion-transfers.js`) quedan limitados a bases locales de prueba. No retirar esas protecciones. Los comandos PM2 del futuro despliegue deben dirigirse explícitamente a `sir-api`; están prohibidos `pm2 restart all`, `pm2 reload all` y `pm2 delete all`. Nunca modificar `app`.

## DDL retirado del runtime

`Historial/logger.js`, `Confirmacion/confirmacion.service.js` y `Reservas/reservas.service.js` ya no crean ni alteran tablas al atender solicitudes. `20260930_runtime_schema.sql` contiene esos cambios: `historial.Id_Registro` textual cuando haga falta, `historial_cambios`, `confirmaciones_jornada` y `disponibilidad` en minúscula. `Reservas/reservas.service.js` usa también `disponibilidad` en minúscula. La migración comprueba existencia para conservar la tabla y sus datos.

## Validación local

`node scripts/verify-release-migrations.js` solo acepta una base MySQL local identificada como `test`. Clona esa base a una temporal, simula el estado observado de `sir2` (outbox y `disponibilidad` con filas, confirmaciones e historial existentes, bases históricas y revisiones ausentes), aplica las nueve migraciones dos veces y comprueba tablas, columnas, índices, FK, permisos, semillas y conservación de filas. Arranca el backend contra la copia y solicita Pendientes, Avisos y Recordatorios con una sesión temporal. Elimina la base temporal al terminar. En el MySQL local de Windows `lower_case_table_names=1`; la comprobación de nombres SQL en minúscula complementa esta prueba, pero la distinción física de mayúsculas/minúsculas del VPS (`lower_case_table_names=0`) se confirma allí solo en preflight de lectura.
