# Diagnóstico de compilación y Karma — 2026-10-12

## Entorno

- Windows 11 Pro 10.0.26300; Node v22.15.1 x64; npm 10.9.2.
- 16 procesadores lógicos; 15.607 GiB de RAM, con 2.5–2.9 GiB libres durante las mediciones.
- Angular CLI 21.2.21, Angular Core 21.2.20, `@angular/build` 21.2.21, TypeScript 5.9.3.
- esbuild 0.28.1; Sass 1.97.3; Vite 7.3.6; Rollup 4.62.4; Chrome 154.0.8037.99.
- Node v22.15.1 cumple el rango oficial de Angular 21: `^20.19.0 || ^22.12.0 || ^24.0.0`.

## Reproducción y fase

| Caso | Entorno | Resultado | Evidencia |
| --- | --- | --- | --- |
| Build desarrollo actual | Sandbox | 0, empaquetado completo | `dev-current.stdout.log`, `dev-current.stderr.log`, `dev-current.processes.log` |
| `npx ng build` desarrollo actual | Sandbox | 0, empaquetado completo | `npx-dev-combined.log` |
| Build desarrollo actual sin caché Angular | Sandbox | 0, empaquetado completo | observado con `ng cache disable`, luego se reactivó la caché |
| Build producción actual | Sandbox | 1, fase CSS de optimización de fuentes; DNS `ENOTFOUND fonts.googleapis.com` | `prod-sandbox.stdout.log`, `prod-sandbox.stderr.log`, `prod-sandbox.processes.log` |
| Build producción actual | Fuera del sandbox | 0, empaquetado y optimización completos | `prod-elevated.stdout.log`, `prod-elevated.stderr.log` |
| Karma actual | Sandbox | 1; genera bundles e inicia servidor, ChromeHeadless no arranca | `karma-sandbox.stdout.log`, `karma-sandbox.stderr.log`, `karma-sandbox.processes.log` |
| Karma actual | Fuera del sandbox | 0; 187/187 tras corregir dos pruebas | `karma-final.stdout.log`, `karma-final.stderr.log` |
| `ng serve` actual | Fuera del sandbox | servidor activo y HTTP 200 | `serve.stdout.log`, `serve.stderr.log` |
| Chrome headless `about:blank` | Sandbox | `0x80000003`, sin salida | `chrome-direct.stdout.log`, `chrome-direct.stderr.log` |
| Edge headless `about:blank` | Sandbox | `0xC0000005` en `msedge.exe` (PID 13992) | `edge-direct.stdout.log`, `edge-direct.stderr.log` |
| Chrome headless `about:blank` | Fuera del sandbox | 0 | `chrome-direct-elevated.stdout.log`, `chrome-direct-elevated.stderr.log` |
| esbuild nativo y API Node | Sandbox | 0 ambos | ejecución directa de versión y transformación mínima |

La ejecución anterior de Angular CLI que devolvió `0xC0000005` no volvió a reproducirse. No hay evento WER ni registro del proceso hijo de aquella ejecución. Por ello no se puede atribuir con certeza aquel código a `node.exe`, `esbuild.exe` u otro proceso. El proceso que sí produjo de nuevo ese código fue `msedge.exe` en la prueba headless aislada, ajena al build Angular.

## Comparación con HEAD previo

Se extrajo `HEAD` (`5c24654e83fa6851d287e8fcb5f85c6ffb973c20`) en una copia aislada. Solo se ajustaron rutas relativas de `node_modules` y `release-metadata.json` para la nueva ubicación; se compartieron las dependencias instaladas y no se cambió código de aplicación.
Se conservó el ZIP de la extracción; se eliminó la copia temporal expandida después de las pruebas.

| Caso base | Sandbox | Fuera del sandbox |
| --- | --- | --- |
| Build desarrollo | 0 | No repetido |
| Build producción | 1, mismo `ENOTFOUND fonts.googleapis.com` | 0 |
| Karma | No repetido | 0, 173/173 |

La base y el árbol actual compilan y ejecutan Karma fuera del sandbox. El bloqueo DNS de producción aparece también en la base dentro del sandbox. No se justifica reinstalar dependencias ni cambiar versiones.

## Pruebas y correcciones

- Karma encontró inicialmente 185 éxitos y 2 fallos del nuevo `PermissionPickerComponent`. Se corrigió la simulación de entrada de búsqueda y la lectura de dependencias de Angular 21 en `permission-picker.spec.ts`; después pasó 187/187.
- La integración MySQL de Mercadeo pasó sobre `sir2_programacion_alertas_test_20260921`, pero el proceso quedaba abierto por el pool. Se añadió el cierre del pool en el teardown; después pasó y terminó con código 0.
- Pruebas backend relacionadas: 9/9 unitarias; 1/1 integración MySQL local.
- No se actualizaron Node, Angular ni dependencias; no hubo cambios permanentes de seguridad o WebSocket.

## Limitaciones

- La causa exacta del `0xC0000005` anterior de `ng build` sigue sin evidencia de proceso. En las reproducciones actuales el compilador Angular, esbuild, bundling, optimización y assets terminan correctamente fuera del sandbox.
- La validación visual de Mercadeo mostró escritorio, tamaño intermedio y móvil, temas claro y oscuro, estado inicial, resultados, filtros combinados, estado vacío, cambio de página y contadores. En móvil, la tabla usa desplazamiento horizontal y los contadores se apilan; la topbar no se trunca. No se observaron errores o warnings de consola en esa sesión.
- El selector compartido de permisos se inspeccionó en Editar Usuario en escritorio y móvil: grupos, búsqueda por Mercadeo, nombre completo, 19 permisos seleccionados y selección reversible en borrador. No se guardó ningún cambio de permiso de usuario real.
- La comprobación visual de Crear Usuario y la prueba de cambio de permiso con dos cuentas siguen pendientes de una segunda cuenta de prueba en un perfil independiente.
