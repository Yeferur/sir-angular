# Pendientes de producto

Ideas registradas para evaluar más adelante. No implican trabajo de implementación hasta que se prioricen.

## Fases y trabajo pendiente consolidado

Revisado el 27 de octubre de 2026. Las fases de Entidades/Mercadeo y las de normalización de controles son líneas de trabajo distintas, aunque ambas hayan usado numeración parecida.

### Entidades reportantes y Mercadeo

- **Fase 1 — modelo e integración: cerrada según la documentación local.** El catálogo, sus tipos y la integración con reservas están descritos en `docs/entidades-reportantes-local-20261013.md`.
- **Fase 2 — administración y experiencia de Mercadeo: parcialmente cerrada.** Las pantallas y la gestión existen, y se han hecho ajustes incrementales en tabla, filtros y drawer. La auditoría anterior no encontró una definición formal única de esta fase; falta confirmar su cierre frente al trabajo visual pendiente.
- **Fase 3 — rechazo y operaciones afectadas: reportada como implementada, pero requiere verificación antes de darla por cerrada.** El cierre de otro chat reportó motivo de rechazo, avisos agregados y pendientes por evento. Sin embargo, el código actual de `backend/services/EntidadesReportantes/entidades-reportantes.service.js` asigna `Pendiente_Por_Entidad_En=NULL` al rechazar y procesa todas las operaciones vinculadas, sin el filtro de estados abiertos/no eliminados descrito en el plan aprobado. Conciliar el código con el comportamiento aprobado antes de iniciar la Fase 4.
- **Fase 3b — pendientes por rechazo agrupados por evento: estado por confirmar.** Una auditoría anterior la marcó pendiente; un cierre posterior reportó la creación de pendientes y avisos por evento, con resumen por creador y validadores. Verificar esa implementación junto con el cierre de la Fase 3 para resolver la discrepancia histórica.
- **Fase 3c — reasignación por entidad duplicada: pendiente y posterior a 3b.** Definir reglas, compatibilidad de tipo, historial y tratamiento de operaciones pendientes antes de implementarla.
- **Fase 4 — aviso a validadores por fecha de servicio: pendiente.** Avisar a quienes tienen `ENTIDADES_REPORTANTES.VALIDAR` cuando una operación marcada por rechazo llegue a `Fecha_Tour` o `Fecha_Transfer`. Reutilizar `Pendiente_Por_Entidad_En`, sin nueva columna ni cambios al vencimiento automático. Depende de conciliar primero el cierre de Fase 3.
- **Permisos y release:** está en el repositorio la migración `20261024_0019_mercadeo_lectura.sql`, que otorga `RESERVAS.LEER` y `TRANSFERS.LEER`; las rutas de Mercadeo todavía exigen `MERCADEO.RESERVAS.LEER`. Alinear la autorización antes de dar por cerrado el acceso. La migración `20261021_0018_entidades_reportantes_validacion.sql` fue reportada como no aplicada; verificar el estado de release antes de desplegar. La migración de esquema de transfers `20261019_0001_transfers_entidad_schema_guard.sql` ya está en el repo y en el runner; su aplicación no se ha confirmado aquí.

### Normalización de controles compartidos

- **Fase 2B — multiselects: cerrada** según el cierre de la auditoría de controles. Migración de Historial a `SirMultiSelect` y alineación visual de los filtros existentes.
- **Fase 3 — autocompletes: cerrada** según el cierre de otro chat; se conservaron fuentes y comportamientos propios y se normalizó su presentación/posicionamiento. El cierre reportó 62/62 pruebas para Reservas, Transfers, Mercadeo y autocomplete compartido.
- Las tres correcciones posteriores de campos de bus, tipografía de Timepicker y override de Comisiones quedaron implementadas; el build pasó. La verificación visual/test de Chrome quedó limitada por el arranque de ChromeHeadless.
- **Pendientes menores de la auditoría:** diferencia de 42 px en la búsqueda de grupos de Comisiones; diferencias de opacidad/cursor entre controles disabled y readonly; y revisar CSS legacy solo después de confirmar que no lo usan rutas activas. No se consideran bloqueantes.

### Trabajo visual sin número de fase asignado

- **Scroll de wizards:** pendiente recorrer los wizards y mantener visible la card y sus pasos; el scroll debe quedar dentro del contenido de la card. Hacerlo por partes y reutilizar patrones existentes.
- **Consistencia de botones:** pendiente la revisión transversal de estados, animaciones e iconos; evaluar reducir iconos donde color y texto basten.

### Siguiente etapa fuera del MVP

El documento `docs/pendientes-recordatorios-mvp.md` conserva más ideas de fase posterior: entrega de turno con nota, escalamiento contextual, nuevas reglas para seguros/comisiones/pasajeros/controles y asistencia predictiva con IA. Mantenerlas fuera del alcance inmediato hasta priorización.

## Contacto del reportante en reservas y transfers

- Permitir elegir el medio de contacto: teléfono o usuario de una red social.
- Solicitar y validar un teléfono solo cuando se elija teléfono. Si se elige usuario social, aceptar y conservar el identificador tal como lo escribe el asesor, incluidos `@` y emojis.
- Evitar bloquear al asesor cuando el único dato disponible para localizar la conversación con el pasajero sea su usuario social.
- Al retomar esta idea, revisar los formularios de reserva y transfer, validaciones y persistencia, y cómo se usa el dato para encontrar el chat. Definir si la opción se llamará “Usuario de red social” y si se necesita seleccionar la plataforma.
- Registrado el 27 de octubre de 2026; aplazado, sin implementación solicitada.
