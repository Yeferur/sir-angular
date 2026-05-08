import { Component, inject } from '@angular/core';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

@Component({
  selector: 'app-updates-panel',
  standalone: true,
  templateUrl: './app-updates-panel.html',
  styleUrls: ['./app-updates-panel.css'],
})
export class AppUpdatesPanelComponent {
  private global = inject(DynamicIslandGlobalService);

  readonly version = 'v1.0.0-beta';
  readonly status = 'En pruebas';
  readonly date = 'Mayo 2026';

  readonly mainNotice =
    'SIR Angular está en fase de pruebas. Esta versión ya está funcionando en producción, pero todavía se encuentra en proceso de validación. Es posible que algunas funciones fallen, se cierren o presenten comportamientos inesperados.';

  readonly reportInstructions =
    'Si notas algún error, repórtalo indicando qué estabas intentando hacer, en qué módulo ocurrió, qué mensaje apareció y, si es posible, adjunta una captura de pantalla.';

  close(): void {
    this.global.closePanel();
  }
}
