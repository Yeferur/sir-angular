import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { SirSelectComponent } from '../../../shared/select/select';

@Component({
  selector: 'app-mercadeo-entidad-create-panel',
  standalone: true,
  imports: [FormsModule, DrawerCloseButtonComponent, SirSelectComponent],
  templateUrl: './mercadeo-entidad-create-panel.html',
  styleUrl: './mercadeo-entidad-create-panel.css',
})
export class MercadeoEntidadCreatePanelComponent {
  @Input({ required: true }) controller!: any;
  @Input() mode: 'create' | 'edit' = 'create';

  onNameChange(value: string): void {
    if (this.mode === 'create') this.controller.onCreateNameChange(value);
    else {
      this.controller.name = value;
      this.controller.detailError.set('');
    }
  }

  onTypeChange(value: any): void {
    if (this.mode === 'create') this.controller.onCreateTypeChange(value);
    else {
      this.controller.type = value;
      this.controller.detailError.set('');
    }
  }

  cancel(): void {
    if (this.mode === 'edit') this.controller.cancelEdit();
    else this.controller.close();
  }
}
