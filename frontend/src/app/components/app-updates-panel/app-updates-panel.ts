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

  readonly version = 'v1.0.1-beta';
  readonly status = 'Validación activa';
  readonly date = 'Mayo 2026';

  readonly mainNotice =
    'SIR Angular continúa en fase de validación en producción. En esta versión se han corregido flujos importantes de tours, reservas, transfers, permisos, usuarios, confirmaciones y seguridad.';

  readonly reportInstructions =
    'Si encuentras un error, repórtalo indicando el módulo, la acción que estabas realizando, el mensaje mostrado y, si es posible, una captura de pantalla.';

  readonly recentChanges = [
    'Correcciones en disponibilidad de tours por días, temporadas y fechas especiales.',
    'Mejoras en Crear y Editar Tour, incluyendo selección automática de días por temporada.',
    'Transfers ahora detecta el rango por cantidad de personas y mantiene el valor editable.',
    'Reservas y Transfers manejan mejor precios por moneda y alertas cuando falta configuración.',
    'Paneles de Ver Reserva y Ver Transfer rediseñados para ser más claros y compactos.',
    'PDF de Reserva y Transfer ajustados con información más limpia para el usuario.',
    'Acciones críticas ahora usan confirmaciones seguras desde Dynamic Navbar.',
    'Eliminar ahora está protegido por permisos en Reservas, Transfers, Tours, Puntos y Usuarios.',
    'Los botones de eliminación solo aparecen si el usuario tiene permiso.',
    'Usuarios se desactivan de forma segura sin romper historial y cerrando sus sesiones activas.',
    'Se reforzó el bloqueo de sesiones para usuarios inactivos.',
  ];

  close(): void {
    this.drawer.close();
  }
}
