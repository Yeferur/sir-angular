# Pendientes y Recordatorios — contrato del MVP

## Principios del dominio

- Un **pendiente automático** es una proyección de una condición que ya decidió el dominio de SIR. No es un ticket y no se asigna ni reasigna.
- Un **recordatorio manual** pertenece exclusivamente al usuario que lo creó. No se comparte.
- Una **notificación** comunica un acontecimiento; no reemplaza el pendiente ni el recordatorio que la originó.
- **Entrega de turno** es un concepto operativo distinto. Queda explícitamente fuera del MVP y se conserva para la siguiente fase.
- Posponer y descartar son operaciones distintas. Posponer mantiene el pendiente en `ACTIVO` y establece `Suprimido_Hasta`; descartar cambia a `DESCARTADO` y registra auditoría.
- Prioridad, recurrencia, ventanas de urgencia, límite de posposición, posibilidad de descarte, justificación y canales se configuran en `reglas_pendientes`.

## Matriz de permisos del MVP

| Capacidad | Administrador | Asesor | Cliente |
|---|---:|---:|---:|
| Consultar pendientes visibles | `PENDIENTES.LEER` | `PENDIENTES.LEER` | No |
| Posponer / descartar según regla | `PENDIENTES.GESTIONAR` | `PENDIENTES.GESTIONAR` | No |
| Auditar todos los pendientes | `PENDIENTES.AUDITAR` | No por defecto | No |
| Consultar recordatorios propios | `RECORDATORIOS.LEER` | `RECORDATORIOS.LEER` | No |
| Crear recordatorios propios | `RECORDATORIOS.CREAR` | `RECORDATORIOS.CREAR` | No |
| Actualizar/completar propios | `RECORDATORIOS.ACTUALIZAR` | `RECORDATORIOS.ACTUALIZAR` | No |
| Eliminar propios | `RECORDATORIOS.ELIMINAR` | `RECORDATORIOS.ELIMINAR` | No |
| Centro de notificaciones interno | `NOTIFICACIONES.LEER` | `NOTIFICACIONES.LEER` | No |

Los permisos efectivos, incluidas excepciones `ALLOW`/`DENY`, prevalecen sobre el nombre del rol.

## Backlog de las dos semanas

| Orden | Entrega | Impacto | Riesgo | Esfuerzo | Estado |
|---:|---|---|---|---|---|
| P0.1 | Respaldo verificable antes de migraciones | Crítico | Bajo | Bajo | Hecho |
| P0.2 | Corregir `Notificaciones.Entidad_Id` a textual | Crítico | Alto | Bajo | Hecho |
| P0.3 | Sanear permisos de cancelar, notificaciones, rutas y visibilidad | Alto | Alto | Medio | Hecho |
| P0.4 | Eliminar error de navegación `NG0100` y denegaciones silenciosas | Alto | Medio | Bajo | Hecho |
| P0.5 | Corregir y validar restauración limpia del snapshot SQL (`turnos_dias` en InnoDB) | Crítico | Alto | Bajo | Hecho |
| P1.1 | Esquema auditable y reglas centralmente configurables | Crítico | Alto | Medio | Hecho |
| P1.2 | API privada de recordatorios y disparo de notificación | Alto | Medio | Medio | Hecho |
| P1.3 | API de pendientes con resolución automática, posponer y descartar | Crítico | Alto | Alto | Hecho |
| P1.4 | Centro responsive de Pendientes/Recordatorios | Alto | Medio | Alto | Hecho |
| P1.5 | Proyectar las cuatro detecciones actuales de Inicio | Alto | Medio | Medio | Hecho |
| P1.6 | Proyectar estados existentes de Reservas y Transfers | Crítico | Alto | Medio | Hecho |
| P1.7 | Indicador global y QA con sesión real de Asesor | Alto | Medio | Medio | Hecho |
| P1.8 | QA multirrol/móvil con casos operativos reales de la próxima jornada | Alto | Medio | Medio | Siguiente |
| P2.1 | Afinar ventanas y recurrencias con responsables de operación | Alto | Medio | Bajo | Siguiente |
| P2.2 | Pruebas de concurrencia e índices con volumen representativo | Medio | Medio | Medio | Siguiente |

## Siguiente fase, fuera del MVP

1. Entrega de turno / handoff operativo con nota para quien continúa la operación.
2. Escalamiento contextual más prominente para situaciones críticas.
3. Nuevas reglas por seguros, comisiones, pasajeros y controles, siempre reutilizando el dominio existente.
4. Asistencia predictiva e IA sobre la trazabilidad, sin convertir el módulo en un gestor de tickets.
