import {
  Component, inject, HostListener, ChangeDetectionStrategy
} from '@angular/core';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { ReservasDynamicComponent } from '../reserva/reserva';
import { TransferDynamicComponent } from '../transfer/transfer';
import { Mapa } from '../mapa/mapa';
import { DuplicarPanelComponent } from '../duplicar-panel/duplicar-panel';
import { AppUpdatesPanelComponent } from '../app-updates-panel/app-updates-panel';

@Component({
  selector: 'app-sir-drawer',
  standalone: true,
  imports: [ReservasDynamicComponent, TransferDynamicComponent, Mapa, DuplicarPanelComponent, AppUpdatesPanelComponent],
  templateUrl: './drawer-host.html',
  styleUrls: ['./drawer-host.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirDrawerHostComponent {
  readonly drawerSvc = inject(SirDrawerService);
  readonly drawer    = this.drawerSvc.drawer;

  close(): void {
    this.drawerSvc.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.drawer()) this.drawerSvc.close();
  }
}
