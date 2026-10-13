# Auditoría del sistema visual de consultas de SIR

Fecha: 12 de octubre de 2026. Alcance: nueva SIR Angular. Esta primera etapa no cambia reglas de negocio ni migra páginas en bloque.

## Inventario

| Pantalla | Controles compartidos actuales | Controles y patrón locales | Destino propuesto |
| --- | --- | --- | --- |
| Ver Reservas | `app-datepicker`, `app-select`, `app-loading-state`, CSS compartido con Transfers | Buscador con autocompletado de puntos, filtros expandibles, tres multiselect locales, chips, botón Buscar; estado inicial local | Familia A: conservar autocompletado y filtros propios; extraer SearchInput, MultiSelect, FilterBar/Panel y EmptyState |
| Ver Transfers | `app-datepicker`, `app-loading-state`, CSS compartido con Reservas | Buscador, dos multiselect locales, filtros expandibles, chips y estado inicial casi iguales a Reservas | Familia A: mismo armazón visual, sin unificar lógica de búsqueda |
| Mercadeo | `app-datepicker` ×3, `app-select`, `app-loading-state` | Siete filtros siempre visibles, dos fechas de registro independientes, acciones y estados vacíos propios; H1 repite la topbar | Familia C: DateRangePicker para registro; categoría y rango primarios, otros filtros en panel; quitar H1 repetido |
| Historial | `app-select` ×2, `app-datepicker` ×2, `app-loading-state` | Buscador, panel avanzado, chips; Buscar/Filtros/Exportar/Limpiar en una fila con iconos Boxicons diferentes; CSS de buscador y filtros repetido | Familia C: DateRangePicker para fecha de acción; FilterBar/Panel, SearchInput y EmptyState; jerarquía de acciones común |
| Informes (`Dashboard`) | `app-select` ×2, `app-datepicker` ×2, `app-loading-state` | Rango en dos campos, periodos rápidos, exportar/imprimir; consulta reactiva, sin botón Buscar | Familia C: DateRangePicker conservando actualización automática y periodos rápidos; no imponer Buscar |
| Comisiones | `app-datepicker`, `app-select` ×3, `app-loading-state` | Fecha/tour primarios, canal/estado secundarios; botón y panel de filtros propios, dos estados vacíos locales | Familia B: FilterBar/Panel y EmptyState; fecha sigue siendo un solo día |
| Control de Viaje | `app-datepicker`, `app-select`, `app-loading-state` | Fecha/tour y Buscar; filtros de asistencia sobre resultados; `search-state` local | Familia B: EmptyState y controles base; mantener día único y filtros de asistencia contextuales |
| Seguros | `app-datepicker`, `app-select`, `app-loading-state` | Fecha/tour y Buscar; estados vacíos y botones locales casi iguales a Comisiones | Familia B: mismos componentes base; mantener día único |
| Puntos de Encuentro | `app-select`, CSS de listado compartido | Buscador, ruta, Buscar, Exportar y estado vacío; autocompletado/acciones propios | Familia D: SearchInput/FilterBar y EmptyState; no alterar manejo de rutas |
| Usuarios | `app-select` en Crear/Editar; CSS de listado compartido | Buscador, botones segmentados de estado, Crear; selector de módulos de permisos usa un `<select>` nativo en móvil | Familia D: SearchInput; sustituir selector móvil por `app-select` con la misma navegación; mantener estados y reglas del rol |
| Aforos | `app-datepicker`, `app-loading-state` | Navegación por día anterior/siguiente y Hoy/Mañana | Revisar tamaño, foco e iconos; no aplicar barra de filtros ni rango |
| Avisos/Pendientes | `app-select` y `app-datepicker` para prioridad/posposición; `app-timepicker` | Filtros por tipo/estado, estados vacíos locales | Revisar primitivas y estados; no forzar patrón de consulta |
| Tours/Programación y formularios | `app-select`, `app-datepicker`, `app-timepicker` en varios formularios | Fechas de vigencia de Tours y rangos operativos de Programación tienen semántica propia | Revisar después de las cuatro familias; no migrar fechas sin estudiar validaciones de cada formulario |

No se encontraron `<select>` nativos en las pantallas de consulta enumeradas. Al iniciar la auditoría, el único `<select>` nativo en plantillas Angular era el selector móvil del `PermissionPickerComponent` (`pages/Usuarios/permission-picker`); se sustituyó por `app-select` en esta primera etapa. Los multiselect de Ver Reservas y Ver Transfers son implementaciones locales, no un componente compartido. El resto de selects simples usa `app-select`.

## Duplicación y diferencias verificadas

- `pages/listado-reservas-transfers.css` ya centraliza buscador, botón Filtros, chips, panel avanzado y estado inicial de Reservas/Transfers; también lo importan Puntos y Usuarios. `pages/Historial/ver-historial.css` repite `.search-row`, `.search-input`, `.btn-filter`, `.active-filters`, `.filter-token` y `.empty-state` con medidas propias.
- `pages/Comisiones/comisiones.css` y `pages/Seguros/seguros.css` repiten prácticamente los mismos `.button`, `.button--primary`, `.search-card`, `.search-primary`, `.field-group`, `.empty-state` y `.empty-icon`. `pages/Confirmacion/confirmacion.css` tiene equivalentes bajo `.action-button`, `.filters-card` y `.search-state`.
- `pages/Mercadeo/reservas/mercadeo-reservas.css` vuelve a definir `.form-group`, `.form-label`, `.form-input` y `.filter-grid` ya presentes en `styles.css` o en páginas. Su borde usa `--border-color` heredado mientras componentes recientes usan `--separator-color`.
- `styles.css` mantiene `.form-select`, `.form-input`, `.form-label`, `.empty-state`, botones y reglas antiguas `.filterButton`/`.dropdownOption`. Estas últimas requieren búsqueda de consumidores antes de borrarse. Las definiciones de `--ease-panel` y `--ease-soft` están repetidas en `:root`.
- Los estados iniciales ocupan desde una tarjeta compacta de Mercadeo hasta paneles de ~242–245 px en Control de Viaje, Comisiones y Seguros. La apariencia y el tamaño varían aunque comunican el mismo estado.
- Acciones equivalentes usan `.btn-primary`, `.button--primary`, `.action-button--primary` y `.sir-action--primary`. Exportar está junto a filtros en Historial, en metadatos del informe en Informes y en barras de resultados de otras pantallas. Debe normalizarse la jerarquía visual, manteniendo la ubicación contextual cuando exportar depende de resultados.
- Los iconos mezclan Boxicons (`bx`, cargado en `index.html`) con SVG de trazo local. Ambos existen en SIR; para controles nuevos se debe preferir un único juego de iconos por componente, manteniendo SVG cuando la forma exacta ya es parte del control compartido. Historial usa Boxicons para Filtros/Exportar/Limpiar donde otras consultas usan SVG de trazo.
- Al iniciar la auditoría, Mercadeo repetía literalmente `Mercadeo` en la topbar y en un H1 inmediato; ese H1 se retiró en esta etapa, conservando la descripción comercial. El H1 de Informes está dentro de un encabezado solo de impresión (`aria-hidden`); el contenido normal no duplica la topbar.

## API de primitivas propuesta

### Select simple

Mantener `app-select` como estándar: `options: SirSelectOption<T>[]`, `value`/`valueChange`, `ControlValueAccessor`, `placeholder`, `inputId`, `disabled`, `invalid`, `required`, `compareWith` y etiquetas ARIA. Conservar CDK Overlay, navegación con teclado, posiciones alternativas y ancho adaptativo. Añadir solo transición de apertura/cierre (~160–200 ms) y reducción de movimiento, sin cambiar valores emitidos ni `compareWith`.

### DateRangePicker

`<app-date-range-picker>` con valor `{ start: string | null; end: string | null }` en formato local `YYYY-MM-DD`, `ControlValueAccessor`, `rangeChange`, `minDate`, `maxDate`, `dateFilter`, `disabled`, `invalid`, `placeholder`, `inputId` y etiquetas ARIA. Selección: primer clic fija inicio; segundo fija fin; el mismo día es válido; un clic anterior al inicio reinicia inicio. Un rango incompleto se muestra explícitamente y no se emite como rango completo. Calendario con días de inicio/fin/intermedios, meses adyacentes en escritorio y uno en móvil, CDK Overlay y navegación de meses. No interpretar fechas como UTC.

### FilterBar y FilterPanel

`<app-filter-bar>` de proyección: ranuras `[sirPrimaryFilters]` y `[sirFilterActions]`, acción Buscar/Aplicar, Filtros (contador y `aria-expanded`), Limpiar y acciones auxiliares. `<app-filter-panel>` expandible con `panelId`, `open`, etiqueta accesible y grilla responsive; la página conserva el estado, validación, búsqueda y parámetros HTTP. `showSearch=false` permite pantallas reactivas como Informes.

### SearchInput y EmptyState

`<app-search-input>` con `value`/`valueChange`, `placeholder`, eventos `clear` y `search`, `disabled` y etiqueta ARIA; la página puede asociarle su autocompletado y decide si la búsqueda es remota o local. `<app-query-empty-state>` con `icon` de Boxicons, `title`, `description` y variante compacta. Mantener `app-loading-state` para carga y error, sin duplicar esas responsabilidades.

## Orden de migración y límites

1. Componentes base con pruebas de CVA, teclado, overlay, claro/oscuro, responsive y movimiento reducido. Ninguna pantalla cambia lógica en este paso.
2. Familia A: reemplazar buscador/multiselect/FilterBar y EmptyState, respetando filtros y autocompletado existentes.
3. Familia B: compartir barra y estado, mantener fecha única y filtros de estado sobre resultados.
4. Familia C: migrar rango de Mercadeo/Historial/Informes, cada uno conservando su disparador de consulta. El H1 duplicado de Mercadeo ya se retiró.
5. Familia D: buscador; mantener segmentación de Usuarios y búsqueda de ruta de Puntos. El selector móvil de permisos ya usa `app-select`.
6. Aforos/Avisos: solo revisar primitivas, foco y tokens. Después se puede evaluar Tours/Programación por separado.

No borrar aún CSS global de `.form-select`, `.empty-state`, `.filterButton` ni aliases de color: hay consumidores fuera de estas familias. Tras cada migración, buscar referencias, eliminar solo selectores sin consumidores y validar light/dark y tamaños 360, 768 y escritorio. Riesgos principales: diferencias entre `ngModel` y formularios reactivos, `null` frente a `''`, fechas parciales/zonas horarias, dropdowns sobre drawers, conteos de filtros, autocompletado y desplazamiento detrás de barras fijas.

## Estado de la primera etapa

Se añadieron las primitivas `app-date-range-picker`, `app-search-input`, `app-filter-bar`, `app-filter-panel` y `app-query-empty-state`, cada una con estilos propios. `app-select` conserva su API y ahora anima apertura y cierre, con `prefers-reduced-motion`. El rango usa el calendario local, `ControlValueAccessor` y un overlay sobre modales/drawers. La barra proyecta campos y acciones para no imponer criterios de búsqueda a las páginas.

Las pantallas de consulta siguen usando sus controles actuales hasta su migración por familias; por tanto, la existencia de las primitivas no implica que los rangos ni las barras locales se hayan sustituido ya. La excepción puntual es el selector móvil de módulos de permisos y el título redundante de Mercadeo. La siguiente etapa debe comprobar en cada familia la semántica de búsqueda, la validación y el responsive antes de retirar CSS local.
