# Fase 2D.3: coherencia de permisos entre procesos

Integración sobre el estado actual, usando `git show --stat f4b13f2`, el diff
completo y la comparación de sus archivos con HEAD. No se cambiaron ramas ni
se restauraron archivos completos. Se conservaron los cambios previos del frontend.

## Referencia histórica y adaptación

El commit histórico modifica middleware, servicio, controladores de Permisos y
Usuarios, package.json y tests de caché, mutaciones, Cliente, dashboard y exportación.
Introduce únicamente `permisos_cache_revision`: `Tipo ENUM('ROL','USUARIO')`,
`Id_Entidad BIGINT UNSIGNED`, `Revision BIGINT UNSIGNED DEFAULT 1`, PK compuesta
`(Tipo, Id_Entidad)`, InnoDB. No añade columnas a tablas existentes ni FK.

Se mantiene su diseño: revisión independiente del usuario y rol, incrementos
transaccionales, validación antes de reutilizar caché y hasta tres reintentos
si una revisión cambia durante el recálculo. Las mutaciones actuales de usuarios
siguen en sus transacciones originales; los cambios de permisos y estado del rol
ahora se confirman junto a su revisión. La invalidación explícita publica una
revisión de usuario para todos los procesos.

Diferencias respecto al commit: CAST de revisiones e ID de rol a CHAR para
comparaciones exactas de BIGINT; claves locales normalizadas como cadenas;
limpieza al alcanzar exactamente cinco minutos; runner protegido para MySQL local
de pruebas, con rechazo de esquema parcial/incompatible; tests adicionales del
backend actual, TTL, concurrencia y dos procesos reales contra MySQL.

Las reglas existentes permanecen: DENY prevalece, ALLOW individual puede mantener
el permiso al revocarse el rol, Cliente conserva su plantilla fija autenticada y
Administrador sigue dependiendo de USUARIOS.LEER. El cambio de rol conserva la
invalidación de sesiones. No se modificaron rutas, nombres de permisos ni WebSocket.

## Consultas y seguridad

Cada cache-hit normal añade **una SELECT** que busca el usuario por PK y las dos
revisiones por PK compuesta. No carga la matriz de permisos. El TTL es de cinco
minutos desde el último recálculo. Cada comprobación protegida valida revisiones,
incluso si ya se hizo otra comprobación en esa petición. Se mantiene el refresco
forzado previo a un 403 que ya existía.

Al cargar o invalidar se leen revisiones antes y después de los permisos efectivos.
Un cambio concurrente obliga a recalcular; cambios repetidos devuelven 503. Un
error de MySQL devuelve error y no reutiliza ALLOW obsoleto. Cliente sigue usando
la plantilla de authMiddleware, que valida sesión/usuario en MySQL en cada petición.
Las revisiones se escriben mediante UPSERT atómico en la conexión de la mutación.

EXPLAIN real: `u`, `usuario_revision` y `rol_revision` usan `PRIMARY`, acceso
`const`, estimación de cero o una fila. Los CAST se aplican al resultado, no a las
columnas usadas para joins o filtros.

## Validación local del 29 de septiembre de 2026

- Migración aplicada mediante `npm run db:migrate:permissions-cache` en
  **sir2_programacion_alertas_test_20260921**, MySQL **9.1.0**, **127.0.0.1:3306**,
  servidor **DESKTOP-8N8D4KU**, configuración development. Se verificaron nombres,
  tipos, PK, defaults e InnoDB antes de aplicarla. No se tocó una base operativa.
- Prueba HTTP en una base efímera con estructura actual y catálogo de permisos:
  `sir_permissions_cache_test_9e4bdfd95f3f45dd8a91ab7dc7cb454e`.
  Dos procesos de **server.js**, PID 9096/30520, puertos **52864/52863**.
  Se desactivaron únicamente jobs ajenos a permisos mediante el fixture; no se
  simularon autenticación, rutas, caché, servicios ni transacciones.
- B autorizó y calentó su caché; A revocó el permiso heredado por HTTP; B respondió
  **403** en la siguiente petición. Revocación más comprobación: **15 ms**.
  La concesión inversa devolvió **200** sin reiniciar B ni esperar TTL.
  No se conectó ningún cliente WebSocket ni se borró manualmente la caché de B.
- Cache-hit medido: una lectura de revisión y cero lecturas de permisos efectivos.
  Se comprobaron ALLOW/DENY individuales, Asesor, Cliente, cambios de rol,
  desactivación/reactivación de rol e invalidación explícita compartida.
- Triggers de error en la base efímera verificaron rollback real al revocar o
  conceder permisos de rol, editar rol, editar permisos individuales, crear y
  desactivar usuarios: permiso/usuario y revisión conservaron el estado previo.
- Con caché ALLOW caliente, una tabla de revisiones temporalmente inaccesible
  produjo **500**, sin autorización. Ocho invalidaciones concurrentes desde ambos
  procesos incrementaron la revisión exactamente ocho veces. Dos revisiones
  adyacentes superiores a 2^53 se distinguieron correctamente.
- Suite completa: `PERMISSIONS_CACHE_MYSQL_TEST=1 npm test`, **265 pruebas**,
  **264 correctas**, **0 fallos**, **1 omitida** (integración preexistente de reservas).
  Incluye dashboard, rutas protegidas y las pruebas históricas adaptadas.
  Los dos procesos se cerraron y la base efímera se eliminó al finalizar.

## Archivos de esta fase

- `backend/middlewares/permissionsMiddleware.js`
- `backend/services/Permisos/permisos.service.js`
- `backend/controllers/Permisos/permisos.controller.js`
- `backend/controllers/Usuarios/usuarios.controller.js`
- `backend/database/migrations/20260920_revision_cache_permisos.sql`
- `backend/package.json`
- `backend/scripts/run-migration.js`
- `backend/scripts/permissions-cache-safety.js`
- `backend/scripts/testing/permissions-backend-process.cjs`
- `backend/test/permissions-cache.test.js`
- `backend/test/permissions-cache-mutations.test.js`
- `backend/test/permissions-cache-extra.test.js`
- `backend/test/permissions-cache.mysql.test.js`
- `backend/test/client-access.test.js`
- `backend/test/ia-programacion-permissions.test.js`
- `backend/test/programacion-dashboard.test.js`
- `backend/test/programacion-export-permissions.test.js`
- `backend/test/programacion-novedades.test.js`
- `docs/fase-2d3-cache-permisos.md`

## Repetir la validación

Desde backend, con una configuración MySQL local cuya base esté identificada como
test (el runner rechaza producción y hosts remotos):

```powershell
npm run db:migrate:permissions-cache
$env:PERMISSIONS_CACHE_MYSQL_TEST = '1'
npm run test:permissions-cache:mysql
npm test
```

La integración requiere permisos para crear/eliminar su propia base efímera y
crear triggers en ella. Sin el flag explícito, la suite omite esta prueba MySQL.

Pendiente para una futura puesta en operación: aplicar la migración antes de
activar este código y actualizar todos los procesos. Los cambios manuales por SQL
deben incrementar la revisión correspondiente dentro de su misma transacción.
No hubo commit, push, deploy ni cambio de rama.
