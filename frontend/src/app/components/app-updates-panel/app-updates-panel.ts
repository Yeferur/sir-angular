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

  readonly version = 'v1.1.0-beta';
  readonly status = 'Fase beta';
  readonly date = 'Junio 2026';

  readonly mainNotice =
    'SIR fue renovado para ofrecer una operación más clara, rápida y segura en reservas, transfers, programación y control comercial. Aun se encuentra en fase beta, por lo que pueden presentarse errores o inconsistencias que deben ser reportados.';

  readonly reportInstructions =
    'Si encuentras errores o inconsistencias en la app, repórtalos indicando el módulo, la acción realizada, el mensaje mostrado y, si es posible, una captura de pantalla.';

  readonly keyHighlights = [
    'Nuevo Inicio personalizado según el perfil y sus permisos.',
    'Flujos guiados por pasos para reservas y transfers.',
    'Nuevo resumen visible durante la operación.',
    'Programación de buses con soporte multipunto y reservas privadas.',
    'Módulos nuevos de Seguros y Comisiones.',
  ];

  readonly sections = [
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
