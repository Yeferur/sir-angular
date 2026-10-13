import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermisoCompleto } from '../../../services/Permisos/permisos.service';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';

export interface PermissionGroup {
  key: string;
  label: string;
  permisos: PermisoCompleto[];
}

@Component({
  selector: 'app-permission-picker',
  standalone: true,
  imports: [FormsModule, SirSelectComponent],
  templateUrl: './permission-picker.html',
  styleUrl: './permission-picker.css',
})
export class PermissionPickerComponent {
  @Input() groups: PermissionGroup[] = [];
  @Input() clientPermissions: PermisoCompleto[] = [];
  @Input() selectedIds: number[] = [];
  @Input() hasRole = false;
  @Input() isClientRole = false;
  @Input() loading = false;
  @Output() permissionToggle = new EventEmitter<number>();
  query = '';
  activeModuleKey = '';

  get activeGroup(): PermissionGroup | undefined {
    return this.groups.find(group => group.key === this.activeModuleKey) || this.groups[0];
  }

  get moduleOptions(): SirSelectOption<string>[] {
    return this.groups.map(group => ({
      value: group.key,
      label: `${group.label} (${this.selectedCount(group)}/${group.permisos.length})`,
    }));
  }

  get searching(): boolean {
    return !!this.query.trim();
  }

  get displayedGroups(): PermissionGroup[] {
    return this.searching ? this.visibleGroups : (this.activeGroup ? [this.activeGroup] : []);
  }

  selectModule(key: string): void {
    if (this.groups.some(group => group.key === key)) this.activeModuleKey = key;
  }

  selectedCount(group: PermissionGroup): number {
    return group.permisos.filter(permission => this.selected(permission.Id_Permiso)).length;
  }

  get visibleGroups(): PermissionGroup[] {
    const query = this.query.trim().toLocaleLowerCase('es-CO');
    if (!query) return this.groups;
    return this.groups
      .map(group => ({
        ...group,
        permisos: group.permisos.filter(permission =>
          [permission.Descripcion, permission.Accion, permission.Codigo_Permiso, group.label]
            .some(value => String(value || '').toLocaleLowerCase('es-CO').includes(query))
        ),
      }))
      .filter(group => group.permisos.length > 0);
  }

  selected(id: number): boolean {
    return this.selectedIds.includes(id);
  }

  label(permission: PermisoCompleto): string {
    return permission.Descripcion || permission.Accion || permission.Codigo_Permiso;
  }
}
