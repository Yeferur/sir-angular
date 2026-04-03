# Auditoría UX Frontend SIR

Fecha: 31 de marzo de 2026
Alcance: Frontend Angular, enfoque en experiencia de usuario, lógica de interfaz y casos de uso reales.
Módulos auditados: Reservas, Tours y Usuarios.

## Resumen Ejecutivo

El frontend tiene una base funcional sólida, pero en flujo real presenta cinco patrones de fricción transversales:

1. Fatiga de alertas: se usan demasiadas alertas bloqueantes para eventos de validación o estado que deberían ser no intrusivos.
2. Riesgo de pérdida de trabajo: no hay guardas de salida en formularios extensos (especialmente Reservas).
3. Feedback inconsistente de carga y guardado: en algunos flujos el usuario no tiene señal clara de progreso local ni prevención de doble acción.
4. Recuperación incompleta ante error: en ciertos casos el usuario queda sin ruta clara de recuperación o con navegación forzada.
5. Fricciones de confianza: validaciones y mensajes no siempre distinguen entre advertencia contextual y error crítico.

---

## Módulo: Reservas

### Fricción 1: Falsos positivos de cupos durante edición

Caso de uso exacto que lo provoca:
- Un asesor abre una reserva existente para editarla.
- Durante la hidratación inicial del formulario se ejecuta verificación de cupos y puede dispararse una alerta de "Cupos insuficientes" aunque no haya intención de aumentar pasajeros o cambiar a una fecha/tour conflictivo.
- Esto genera percepción de "error" sobre una reserva ya válida y aumenta ansiedad operativa.

Evidencia funcional observada:
- En edición se llama verificación de cupos al cargar la reserva y también en múltiples cambios de campos.
- Existe exclusión por Id_Reserva en backend/servicio, pero UX sigue mostrando advertencia bloqueante en momentos prematuros del flujo.

Solución de UX propuesta:
- Introducir semántica de validación en dos niveles:
  1. Estado informativo en tiempo real (inline, no bloqueante): mostrar "ocupación actual" y diferencia de cupos en panel lateral.
  2. Bloqueo transaccional solo al guardar: si el nuevo payload rompe cupos, ahí sí modal de decisión.
- Regla de supresión inteligente: no mostrar modal de cupos insuficientes durante carga inicial de una reserva existente.
- Si la reserva no cambió en Tour/Fecha/Cantidad con asiento, mostrar etiqueta neutral: "Sin cambios de capacidad".

---

### Fricción 2: Alert Fatigue por uso masivo de modales/alertas bloqueantes

Caso de uso exacto que lo provoca:
- Al crear o editar reserva, casi cualquier evento relevante (carga, error de consulta auxiliar, validación, confirmación, éxito) usa alertas globales con botones.
- El usuario atraviesa demasiados interrupciones para completar una sola tarea.

Impacto UX:
- Costo cognitivo alto.
- Pérdida de ritmo operativo para asesores con alto volumen de reservas.
- Riesgo de "click automático" en botones sin lectura real de mensajes.

Solución de UX propuesta:
- Definir matriz de notificación por criticidad:
  - Crítico (bloqueante): conflictos de sobrecupo al confirmar, eliminación, cambios irreversibles.
  - Importante (toast persistente): fallas recuperables de catálogo o consultas auxiliares.
  - Informativo (toast breve): éxito de guardado, recálculo completado.
- Reemplazar alertas de "estado operativo" (cargando datos, consulta secundaria exitosa/fallida) por componentes inline o toasts discretos.
- Mantener solo una confirmación antes del submit final.

---

### Fricción 3: Prevención de pérdida de datos insuficiente en formularios largos

Caso de uso exacto que lo provoca:
- Asesor llena múltiples pasajeros, pagos y observaciones.
- Cambia de ruta, cierra pestaña o regresa por navegación accidental.
- El sistema no advierte salida ni ofrece recuperación del borrador.

Impacto UX:
- Riesgo alto de pérdida de trabajo y retrabajo manual.
- Frustración especialmente en operaciones con 8-15 pasajeros.

Solución de UX propuesta:
- Implementar protección en tres capas:
  1. Guard de navegación (cuando el formulario esté dirty).
  2. Advertencia beforeunload en cierre/refresh.
  3. Autoguardado local por borrador (por reserva nueva y por reserva en edición).
- Recuperación en reingreso:
  - Banner: "Encontramos un borrador de hace X minutos. ¿Continuar o descartar?"

---

### Fricción 4: Falta de estado de guardado visible y prevención de doble envío

Caso de uso exacto que lo provoca:
- En crear/editar reserva, el botón Guardar no refleja explícitamente estado de submitting.
- Si el backend responde lento, el usuario puede reintentar por incertidumbre.

Impacto UX:
- Posible duplicidad de acciones.
- Sensación de congelamiento aunque la petición esté en curso.

Solución de UX propuesta:
- Estado de submit explícito:
  - Botón pasa a "Guardando...", deshabilitado.
  - Indicador inline fijo en resumen de reserva.
- Optimistic UX controlado:
  - Marcar temporalmente estado "Guardando cambios" en cabecera.
  - Si falla, rollback visual claro y CTA "Reintentar".

---

### Fricción 5: Manejo de errores orientado al sistema, no a la tarea

Caso de uso exacto que lo provoca:
- Errores técnicos de validación/cupos/consultas aparecen como alertas genéricas.
- Usuario no siempre recibe siguiente paso accionable dentro del mismo contexto.

Impacto UX:
- Tiempo de resolución más alto.
- Soporte operativo innecesario para casos que deberían ser auto-resolubles.

Solución de UX propuesta:
- Estructurar mensajes por formato de acción:
  - Qué pasó.
  - Cómo resolverlo ahora.
  - Qué conserva el sistema (por ejemplo: "Tus pasajeros siguen cargados").
- Preferir CTAs contextuales dentro del formulario (resaltar campo o sección) en lugar de modal global.

---

## Módulo: Tours

### Fricción 1: Carga global bloqueante para listado y operaciones simples

Caso de uso exacto que lo provoca:
- En ver tours se muestra alerta global de "Cargando tours..." en vez de skeleton o loading del propio listado.
- Al eliminar o fallar eliminación se interrumpe el flujo con alertas modales.

Impacto UX:
- Interrupción innecesaria de navegación.
- La pantalla parece más pesada de lo que realmente es.

Solución de UX propuesta:
- Sustituir alertas de carga por:
  - Skeleton de filas y badges.
  - Estado vacío con acción principal.
- Mantener confirmación solo para eliminar, pero usar toast para éxito/error no crítico.

---

### Fricción 2: Confirmaciones redundantes y navegación con timeout

Caso de uso exacto que lo provoca:
- Crear/editar tour requiere confirmación modal y luego navega con setTimeout tras éxito.
- Usuario no controla el momento exacto de salida.

Impacto UX:
- Pérdida de control percibida.
- Riesgo de no leer feedback completo.

Solución de UX propuesta:
- Reemplazar navegación temporizada por CTA explícito:
  - "Ver listado" / "Seguir editando" / "Crear otro tour".
- Si se mantiene auto-redirección, mostrar contador visible y opción cancelar redirección.

---

### Fricción 3: Estados de carga dispares entre crear y editar

Caso de uso exacto que lo provoca:
- En edición existe loadingData adicional; en creación la experiencia depende más del botón y alertas.
- La percepción de progreso no es uniforme entre flujos equivalentes.

Impacto UX:
- Inconsistencia mental: el usuario no sabe si la app está "lista" o "bloqueada" según pantalla.

Solución de UX propuesta:
- Sistema unificado de estados de carga por pantalla:
  - Initial loading
  - Saving
  - Recoverable error
- Usar el mismo patrón visual y de interacción en crear/editar tours.

---

### Fricción 4: Dead end parcial en errores de carga de edición

Caso de uso exacto que lo provoca:
- Si falla carga de tour en editar, se muestra alerta con opción volver.
- No hay opción de reintentar dentro de la misma pantalla, ni diagnóstico contextual.

Impacto UX:
- Flujo sin salida local: obliga a abandonar contexto.

Solución de UX propuesta:
- Incluir doble acción estándar en error de carga:
  - Reintentar aquí.
  - Volver al listado.
- Mantener historial mínimo de última carga fallida para no perder estado visual del formulario.

---

## Módulo: Usuarios

### Fricción 1: Dependencia de alerta global para loading inicial

Caso de uso exacto que lo provoca:
- Crear/editar usuario enciende loading global mientras carga roles/permisos.
- El formulario completo desaparece con bloqueos basados en isLoading.

Impacto UX:
- Sensación de salto brusco de interfaz.
- Menor claridad sobre qué parte está cargando exactamente.

Solución de UX propuesta:
- Carga progresiva del formulario:
  - Mostrar estructura del formulario desde el inicio.
  - Skeleton/placeholder solo en selectores dependientes (roles/permisos).
- Mantener acciones no dependientes habilitadas cuando sea seguro.

---

### Fricción 2: Alertas de confirmación y éxito para acciones de rutina

Caso de uso exacto que lo provoca:
- Crear, actualizar, forzar cierre de sesión y eliminar usuario dependen de secuencias de alertas modales.

Impacto UX:
- Interrupción repetitiva en tareas administrativas frecuentes.

Solución de UX propuesta:
- Mantener modal solo en acciones destructivas (eliminar usuario).
- Para crear/actualizar/cerrar sesión:
  - Confirmación inline o contextual liviana.
  - Toast de resultado con enlace rápido al registro afectado.

---

### Fricción 3: Navegación diferida por timeout tras éxito

Caso de uso exacto que lo provoca:
- Editar usuario usa espera temporizada antes de volver al listado.

Impacto UX:
- Bloqueo artificial de continuidad de trabajo.
- Puede percibirse como lentitud de backend aunque no lo sea.

Solución de UX propuesta:
- Sustituir timeout por decisión explícita del usuario:
  - Botones "Volver ahora" y "Seguir editando".
- Si hay redirección automática, exponer cancelación visible.

---

### Fricción 4: Posible fragilidad de estados de carga encadenados

Caso de uso exacto que lo provoca:
- En editar usuario hay cadena roles/permisos/usuario con contador pendingLoads.
- Si alguna rama falla y redirige, la experiencia puede sentirse abrupta y poco recuperable.

Impacto UX:
- Riesgo de percepción de error aleatorio.
- Flujo sin recuperación local para datos transitorios.

Solución de UX propuesta:
- Estado transaccional por etapa:
  - Cargando catálogos.
  - Cargando usuario.
  - Listo.
- Error por etapa con retry local y persistencia de lo ya cargado.

---

## Hallazgos Transversales (API Envelope y Error Recovery)

### Fricción transversal 1: Doble canal de error potencial

Caso de uso exacto que lo provoca:
- El interceptor de API Envelope muestra alertas al detectar success false y además vuelve a propagar HttpErrorResponse.
- Los componentes también manejan error y vuelven a alertar.

Impacto UX:
- Riesgo de mensajes duplicados o ruido visual.

Solución de UX propuesta:
- Política única de ownership del error:
  - Interceptor: transformar y clasificar error, sin notificar UI salvo errores globales no manejados.
  - Componente: mostrar mensaje contextual de tarea.
- Opción alternativa: interceptor notifica y componente no repite (controlado por flag de metadatos).

---

### Fricción transversal 2: Falta de patrón uniforme para dead ends

Caso de uso exacto que lo provoca:
- Algunos errores dejan CTA de cerrar, otros de volver, otros solo mensaje.
- No hay contrato UX común de recuperación.

Impacto UX:
- Comportamiento impredecible para el asesor.

Solución de UX propuesta:
- Definir estándar de error UX para toda la app:
  - Nivel 1: reintentar en contexto.
  - Nivel 2: guardar borrador y salir.
  - Nivel 3: escalar soporte con ID de trazabilidad.

---

## Priorización Recomendada (PM)

1. Alta prioridad (impacto alto, esfuerzo medio):
- Guard de salida + borrador automático en Reservas.
- Reducir modales bloqueantes en Reservas (matriz de notificaciones).
- Bloqueo de doble submit y estado visible de guardado en Reservas.

2. Media prioridad (impacto alto, esfuerzo bajo):
- Reemplazar timeouts de navegación por CTA explícito en Tours y Usuarios.
- Unificar patrón de loading por pantalla y listado.

3. Media prioridad (impacto medio, esfuerzo medio):
- Normalizar estrategia de errores entre interceptor y componentes para evitar duplicación.

---

## Criterios de Éxito UX para validar mejoras

- Reducción del número de alertas bloqueantes por tarea crítica en al menos 40%.
- Tasa de abandono de formulario de Reservas con pérdida de datos cercana a 0.
- Reducción de reintentos manuales de guardado por incertidumbre.
- Disminución de incidencias de soporte por "la app me botó" o "se perdió la reserva".
- Mayor tiempo efectivo en tarea y menor tiempo en interrupciones.

---

## Notas Finales

Este reporte se centra exclusivamente en comportamiento UX y lógica de interfaz sin cambios de código. La siguiente etapa recomendada es convertir estos hallazgos en un plan de rediseño de interacción por sprint, con hipótesis medibles y pruebas rápidas con asesores reales.
