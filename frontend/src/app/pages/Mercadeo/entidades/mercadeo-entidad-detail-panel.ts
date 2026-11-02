import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

@Component({
  selector: 'app-mercadeo-entidad-detail-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, DrawerCloseButtonComponent, LoadingStateComponent],
  templateUrl: './mercadeo-entidad-detail-panel.html',
  styleUrl: '../../../components/reserva/reserva.css',
})
export class MercadeoEntidadDetailPanelComponent {
  @Input({ required: true }) controller!: any;

  get selectedActivity(): any {
    return this.controller?.selectedActivity?.() ?? null;
  }

  get entity(): any {
    return this.controller?.selected?.()?.entity ?? this.selectedActivity;
  }
}
