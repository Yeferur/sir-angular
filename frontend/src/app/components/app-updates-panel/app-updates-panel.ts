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
    'SIR incorpora una nueva planificación semanal de turnos y vacaciones, mejoras en la consulta de reservas y una experiencia más consistente para asesores y perfiles de gestión. Aún se encuentra en fase beta, por lo que pueden presentarse errores o inconsistencias que deben ser reportados.';

  readonly reportInstructions =
    'Si encuentras errores o inconsistencias en la app, repórtalos indicando el módulo, la acción realizada, el mensaje mostrado y, si es posible, una captura de pantalla.';

  readonly keyHighlights = [
    'Nueva planificación semanal de turnos por asesor y canal.',
    'Programación de vacaciones integrada con los horarios.',
    'Nueva vista personal “Mi horario” para asesores.',
    'Horarios y vacaciones visibles desde la gestión de usuarios.',
    'Consulta diferenciada de reservas privadas y grupales.',
  ];

  readonly sections = [
    {
      title: 'Turnos y vacaciones',
      items: [
        'Se agregó la planificación semanal de turnos con jornadas concretas para cada asesor, organizadas por canal de ventas.',
        'Los horarios se configuran en bloques de 30 minutos, permiten definir días de trabajo o descanso y muestran el total semanal programado.',
        'La publicación se realiza para toda la semana e incluye una confirmación previa antes de hacer visibles los cambios.',
        'Las jornadas sin horario y las semanas con siete días programados se identifican claramente antes de publicar.',
        'Se puede copiar la semana anterior, cambiar temporalmente el canal del asesor y asignar el rol semanal de supernumerario.',
        'Las vacaciones pueden programarse con fechas sugeridas, ajustarse manualmente y excluir automáticamente esos días de la jornada.',
      ],
    },
    {
      title: 'Experiencia del asesor',
      items: [
        'Se agregó “Mi horario” para consultar la semana publicada, los días de trabajo y descanso, las horas de entrada y salida y el tiempo total programado.',
        'El día actual y el estado dentro o fuera del horario se muestran de forma destacada para facilitar la consulta diaria.',
        'Las vacaciones programadas y la fecha de regreso aparecen dentro de la misma vista semanal.',
        'El Inicio del asesor ahora presenta su información laboral de forma separada de las herramientas de gestión.',
      ],
    },
    {
      title: 'Usuarios, canales y permisos',
      items: [
        'La ficha de cada asesor ahora muestra su horario vigente y sus vacaciones después de la información de contacto.',
        'Desde el usuario se puede abrir directamente la planificación de Turnos con el asesor ya seleccionado.',
        'La administración de turnos quedó integrada en Usuarios sin mezclarla con la creación de cuentas ni con la configuración de permisos.',
        'Se conciliaron los usuarios vigentes y los roles de asesor para trabajar con la estructura actual de permisos.',
      ],
    },
    {
      title: 'Inicio personalizado',
      items: [
        'El acceso principal ahora muestra una jornada personal para asesores y un centro operativo para los perfiles de gestión.',
        'El nuevo Inicio reúne accesos rápidos, reservas y transfers de hoy y mañana, próximos servicios, pendientes, alertas de aforo y actividad reciente según los permisos de cada usuario.',
        'Aforos conserva su propia sección y los indicadores de empresa continúan en Informes, evitando mezclar trabajo diario con análisis gerencial.',
      ],
    },
    {
      title: 'Operación de reservas y transfers',
      items: [
        'Se rediseñaron los flujos de creación y edición con un proceso guiado por pasos para organizar mejor datos, pasajeros, pagos y la revisión final.',
        'Se agregó un resumen visible durante el proceso para consultar servicio, fecha, pasajeros, moneda, valor total y disponibilidad sin perder el contexto.',
        'Se mejoraron las validaciones de cupos, fechas, puntos de encuentro, datos duplicados, precios y configuraciones faltantes.',
        'Los documentos PDF de reservas y transfers fueron actualizados con una presentación más limpia, ordenada y consistente.',
        'El listado de reservas ahora permite consultar grupales y privadas juntas o filtrar únicamente uno de los dos tipos.',
        'Solo las reservas privadas llevan una identificación especial, reduciendo elementos repetidos en las reservas grupales.',
      ],
    },
    {
      title: 'Programación de buses',
      items: [
        'Se fortaleció la programación con una mejor organización de rutas, reservas y puntos de encuentro.',
        'Ahora se pueden gestionar reservas privadas de forma independiente dentro de la programación.',
        'Se agregó soporte para reservas con varios puntos de encuentro, visualización de pasajeros por punto, identificación de reservas multipunto y consulta de destinos relacionados en el mapa.',
        'Se mejoró la lógica de asignación y visualización de buses para optimizar las rutas según el tour.',
      ],
    },
    {
      title: 'Tours, planes y comisiones',
      items: [
        'Se mejoró la configuración de tours, temporadas, fechas especiales y planes para responder correctamente según cada fecha.',
        'Las comisiones ahora se pueden configurar directamente desde cada tour y por canal de venta, facilitando su seguimiento posterior.',
      ],
    },
    {
      title: 'Nuevos módulos de Seguros y Comisiones',
      items: [
        'Se agregó el módulo de Seguros para consultar la operación por fecha y tour, revisar buses, pasajeros y personal relacionado, actualizar información operativa y exportar reportes.',
        'Se agregó el módulo de Comisiones para consultar, organizar y liquidar comisiones por fecha, tour, canal y reportante, además del seguimiento de pagos y exportación a Excel.',
      ],
    },
    {
      title: 'Informes, aforos y consulta de información',
      items: [
        'Se ampliaron los Informes con nuevos indicadores, gráficos y resúmenes para consultar ingresos, pasajeros y comportamiento operativo por periodo y tour.',
        'La vista de Aforos fue renovada para facilitar el monitoreo diario de disponibilidad y ocupación.',
        'Desde el detalle de privadas en Aforos ahora se puede abrir el listado de reservas conservando la fecha, el tour y el tipo de consulta.',
        'Se mejoró la búsqueda global para encontrar reservas, transfers, tours y puntos de forma más rápida.',
      ],
    },
    {
      title: 'Diseño, navegación y alertas',
      items: [
        'Se renovó la interfaz general con una experiencia más moderna, consistente y organizada entre módulos.',
        'Se incorporó una nueva barra superior con accesos rápidos, información dinámica, control de tema, perfil de usuario y acceso a las novedades.',
        'La navegación lateral ahora muestra las opciones disponibles según los permisos asignados a cada usuario.',
        'Se agregaron paneles laterales para consultar información y realizar acciones rápidas sin salir del flujo principal.',
        'El sistema de alertas fue unificado con mensajes más claros para confirmaciones, errores, advertencias, validaciones y acciones sensibles.',
        'Se alinearon formularios, selectores de fecha y hora, controles, colores y estados con los componentes globales de la aplicación.',
        'Se corrigió la adaptación visual del inicio de sesión entre tema claro y oscuro.',
      ],
    },
    {
      title: 'Seguridad y control de usuarios',
      items: [
        'Se reforzó el control de permisos en acciones importantes como eliminar, editar y gestionar información operativa.',
        'Las opciones sensibles solo se muestran cuando el usuario cuenta con autorización.',
        'Se mejoró la desactivación de usuarios para conservar el historial de operación y bloquear correctamente las sesiones activas de cuentas inactivas.',
      ],
    },
    {
      title: 'Mejoras generales',
      items: [
        'Se corrigieron inconsistencias visuales entre pantallas, se mejoró la carga de información y se optimizó la navegación en módulos clave.',
        'Esta actualización busca que SIR sea una herramienta más estable, clara y eficiente para la operación diaria.',
      ],
    },
  ];

  close(): void {
    this.drawer.close();
  }
}
