import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { SirSelectComponent } from '../../../shared/select/select';

@Component({
  selector: 'app-mercadeo-entidad-edit-panel',
  standalone: true,
  imports: [FormsModule, DrawerCloseButtonComponent, SirSelectComponent],
  templateUrl: './mercadeo-entidad-edit-panel.html',
  styleUrl: './mercadeo-entidad-create-panel.css',
})
export class MercadeoEntidadEditPanelComponent {
  @Input({ required: true }) controller!: any;
}
