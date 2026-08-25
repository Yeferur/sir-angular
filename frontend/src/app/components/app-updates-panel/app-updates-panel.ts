import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

@Component({
  selector: 'app-updates-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-updates-panel.html',
  styleUrls: ['./app-updates-panel.css'],
})
export class AppUpdatesPanelComponent {
  private drawer = inject(SirDrawerService);

  readonly version = 'v1.2.0-beta';
  readonly status = 'Fase beta';
  readonly date = 'Agosto 2026';

  readonly mainNotice =
    'SIR recibió una renovación integral de su operación, diseño y seguridad. Reservas, transfers, tours, puntos, programación, control de viaje, informes, usuarios y turnos ahora trabajan bajo una experiencia más clara y consistente. La aplicación aún se encuentra en fase beta, por lo que pueden presentarse errores o inconsistencias que deben ser reportados.';

  readonly reportInstructions =
    'Si encuentras errores o inconsistencias en la app, repórtalos indicando el módulo, la acción realizada, el mensaje mostrado y, si es posible, una captura de pantalla.';

  readonly keyHighlights = [
    'Nueva experiencia de Inicio adaptada al perfil y sus permisos.',
    'Reservas, transfers, tours y puntos reorganizados en flujos más claros.',
    'Programación logística renovada con rutas, buses, privados y exportaciones.',
    'Nuevos módulos de Control de viaje, Seguros y Comisiones.',
    'Informes ejecutivos y Aforos con consulta operativa más completa.',
    'Usuarios, perfil, permisos y seguridad fortalecidos.',
    'Nueva planificación semanal de turnos, canales y vacaciones.',
  ];

  readonly sections = [
    {
      title: 'Inicio, navegación y búsqueda',
      items: [
        'El Inicio ahora se adapta al perfil, los permisos y la actividad relevante de cada usuario.',
        'Los perfiles de gestión cuentan con accesos rápidos, operación de hoy y mañana, próximos servicios, pendientes, alertas de aforo y actividad reciente.',
        'Los asesores reciben una experiencia centrada en su jornada y sus herramientas de trabajo diario.',
        'La búsqueda global fue simplificada y permite encontrar reservas, transfers, tours, puntos y otras consultas sin perder el contexto.',
        'Los accesos desde Inicio y Aforos conservan fechas, tours y filtros al abrir los listados correspondientes.',
      ],
    },
    {
      title: 'Reservas y transfers',
      items: [
        'Los procesos de creación y edición fueron reorganizados en pasos claros para datos, pasajeros, pagos y revisión final.',
        'Los resúmenes permanecen visibles durante la operación para consultar servicio, fecha, pasajeros, moneda, total y disponibilidad.',
        'Se fortalecieron las validaciones de cupos, fechas, puntos de encuentro, duplicados, precios, pagos y configuraciones faltantes.',
        'Los listados conservan filtros y paginación en la URL, mantienen los resultados durante las actualizaciones y muestran errores sin interrumpir la consulta.',
        'Reservas permite consultar grupales y privadas juntas o por separado; únicamente las privadas llevan una identificación especial.',
        'Transfers comparte el mismo lenguaje de consulta y edición, incluyendo pagos completos, abonos, pagos en punto y comprobantes.',
      ],
    },
    {
      title: 'Tours, planes, tarifas y calendario',
      items: [
        'Crear y Editar Tour ahora organizan información, planes, tarifas, calendario, configuración y revisión en un flujo guiado.',
        'Se simplificó la gestión de monedas, vigencias, temporadas, fechas especiales, comisiones y puntos asociados.',
        'El sistema orienta al paso que contiene un error y permite revisar libremente la configuración durante la edición.',
        'La eliminación protege la información histórica: un tour con dependencias se desactiva y solo se elimina definitivamente cuando es seguro.',
      ],
    },
    {
      title: 'Puntos de encuentro y rutas',
      items: [
        'Crear y Editar Punto fueron reorganizados en información, ubicación, ruta, horarios y revisión.',
        'Ahora es posible utilizar una ruta existente, crear una nueva o dejarla pendiente, además de insertar el punto en una posición concreta.',
        'Las coordenadas se validan contra la red vial para reducir ubicaciones incorrectas y problemas posteriores en Programación.',
        'El orden de los puntos puede ajustarse visualmente y queda protegido frente a cambios incompletos o dependencias históricas.',
      ],
    },
    {
      title: 'Programación logística',
      items: [
        'Programación separa claramente el dashboard de consulta y el editor operativo de cada jornada.',
        'Los listados guardados pueden consultarse antes de editar, y las reservas se asignan o trasladan entre buses con acciones explícitas.',
        'Se incorporaron deshacer, restaurar, reservas sin asignar, guías obligatorias y validaciones antes de guardar.',
        'Las rutas terminan en la primera parada operativa de cada tour y muestran tiempos transparentes: 22 km/h en ciudad y 50 km/h en carretera, sin tráfico, esperas ni abordaje.',
        'Las reservas privadas cuentan con una programación independiente de vehículos y guías.',
        'Cada bus puede exportarse individualmente y la jornada completa puede descargarse en un archivo ZIP con un Excel por vehículo.',
      ],
    },
    {
      title: 'Control de viaje',
      items: [
        'Confirmación de pasajeros evolucionó a Control de viaje, con resumen de reservas, pasajeros, viajaron y no viajaron.',
        'Se agregaron confirmación individual, acciones masivas, búsqueda y filtros de asistencia.',
        'Los cambios pueden deshacerse antes de guardar y la barra de confirmación solo aparece cuando existe información modificada.',
        'El guardado actualiza únicamente los pasajeros cambiados, conserva la trazabilidad y respeta el punto de encuentro específico de cada pasajero.',
      ],
    },
    {
      title: 'Seguros y comisiones',
      items: [
        'Seguros organiza la jornada por bus y permite revisar pasajeros, guía, vehículo e información operativa antes de exportar.',
        'Comisiones fue convertida en una bandeja administrativa compacta por canal, reportante, reserva y pasajero.',
        'Las liquidaciones consideran la comisión histórica y los pasajeros que realmente viajaron.',
        'Es posible pagar individualmente, por reportante o sobre toda la consulta, con validaciones según el medio de pago.',
        'La exportación a Excel no altera el estado de las liquidaciones.',
      ],
    },
    {
      title: 'Informes y aforos',
      items: [
        'Informes fue reconstruido como un dashboard ejecutivo con filtros por periodo, tour y tipo de reserva.',
        'Se distinguen ingresos de tours y transfers, recaudo registrado, saldo por conciliar, valores estimados y valores confirmados.',
        'Los indicadores comparan periodos equivalentes, separan monedas y utilizan la confirmación real del viaje cuando está disponible.',
        'Los gráficos, métricas y estados se actualizan en vivo sin reemplazos bruscos ni pérdida de contexto.',
        'Aforos facilita la consulta diaria de ocupación, disponibilidad y reservas privadas.',
        'Desde el detalle de privadas se puede abrir el listado conservando fecha, tour y tipo de reserva.',
      ],
    },
    {
      title: 'Usuarios, perfil y seguridad',
      items: [
        'Usuarios cuenta con consulta de cuentas activas e inactivas, estado de sesión, drawer de detalle y acciones administrativas más claras.',
        'Crear y Editar Usuario organizan identidad, rol, permisos y revisión final en un flujo guiado.',
        'Los permisos efectivos se muestran por módulo sin duplicar como excepciones los permisos heredados del rol.',
        'La política de contraseñas fue unificada y los cambios sensibles invalidan las sesiones correspondientes.',
        'Mi perfil separa foto, datos personales y seguridad, con guardados independientes y protección de cambios pendientes.',
        'El rol Cliente quedó aislado para consultar y administrar únicamente sus propias reservas, sin acceso a información interna de la empresa.',
      ],
    },
    {
      title: 'Turnos, canales y vacaciones',
      items: [
        'Se agregó la planificación semanal de jornadas concretas para cada asesor, organizada por canal de ventas.',
        'Los horarios utilizan bloques de 30 minutos, días de trabajo o descanso y cálculo del tiempo semanal programado.',
        'La semana se guarda al publicar y siempre solicita confirmación antes de quedar visible para los asesores.',
        'Las jornadas sin horario y las semanas con siete días programados se presentan como advertencias claras y revisables.',
        'Se puede copiar la semana anterior, cambiar temporalmente el canal y asignar el rol semanal de supernumerario.',
        'Las vacaciones se programan con fechas sugeridas y ajustables, excluyendo esos días de la jornada.',
        'Mi horario permite al asesor consultar su semana publicada, estado actual, días, horas, duración y vacaciones.',
        'Los asesores pueden solicitar el intercambio de una jornada puntual con un compañero de su mismo canal; el horario solo cambia cuando el compañero acepta.',
        'Las solicitudes de intercambio conservan su estado, permiten aceptar, rechazar o cancelar y dejan historial de la decisión.',
        'La ficha de Usuario muestra horario y vacaciones y permite abrir Turnos con el asesor ya seleccionado.',
      ],
    },
    {
      title: 'Diseño, rendimiento y accesibilidad',
      items: [
        'La interfaz fue unificada con superficies, controles, badges, drawers, wizards y barras de acciones consistentes.',
        'La barra superior integra navegación, búsqueda, notificaciones persistentes, actividad real de la aplicación, tema, perfil y novedades.',
        'Carga, error, vacío y reintento utilizan estados compactos; las actualizaciones conservan los datos visibles.',
        'Las solicitudes obsoletas se cancelan o descartan para evitar que información anterior reemplace una consulta nueva.',
        'Las transiciones y microinteracciones comunican cambios con movimiento sutil y respetan la preferencia de movimiento reducido.',
        'El sistema global de alertas confirma acciones sensibles y presenta errores y advertencias de forma consistente.',
        'Se corrigió la adaptación del inicio de sesión y de las principales pantallas entre tema claro y oscuro.',
      ],
    },
  ];

  close(): void {
    this.drawer.close();
  }
}
