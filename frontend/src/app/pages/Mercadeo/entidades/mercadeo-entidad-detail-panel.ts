import { CommonModule, DatePipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSearchInputComponent } from '../../../shared/search-input/search-input';

@Component({
  selector: 'app-mercadeo-entidad-detail-panel',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, DrawerCloseButtonComponent, LoadingStateComponent,
    SirSearchInputComponent],
  templateUrl: './mercadeo-entidad-detail-panel.html',
  styleUrl: './mercadeo-entidad-detail-panel.css',
})
export class MercadeoEntidadDetailPanelComponent {
  @Input({ required: true }) controller!: any;

  get selectedActivity(): any {
    return this.controller?.selectedActivity?.() ?? null;
  }
}
