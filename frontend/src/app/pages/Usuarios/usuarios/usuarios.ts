import { Component, Signal, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UsuariosService, type Usuario } from '../../../services/Usuarios/usuarios';
import { AuthService } from '../../../services/Login/login-service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

type AccountFilter = 'todos' | 'activos' | 'inactivos';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, RouterModule, LoadingStateComponent],
  templateUrl: './usuarios.html',
  styleUrls: ['../../listado-reservas-transfers.css', './usuarios.css'],
})
export class Usuarios {
  readonly usuarios: Signal<Usuario[]>;
  readonly estados: Signal<Map<string, string>>;
  readonly isLoading: Signal<boolean>;
  readonly errorCarga: Signal<string | null>;

  readonly searchQuery = signal('');
  readonly accountFilter = signal<AccountFilter>('activos');
  readonly currentUserId = signal('');

  readonly filteredUsuarios = computed(() => {
    const query = this.searchQuery().toLocaleLowerCase('es-CO').trim();
    const filter = this.accountFilter();

    return this.usuarios().filter((user) => {
      if (filter === 'activos' && !user.activo) return false;
      if (filter === 'inactivos' && user.activo) return false;
      if (!query) return true;

      return user.name.toLocaleLowerCase('es-CO').includes(query)
        || user.email.toLocaleLowerCase('es-CO').includes(query)
        || user.username.toLocaleLowerCase('es-CO').includes(query)
        || user.rol.toLocaleLowerCase('es-CO').includes(query)
        || String(user.id_user).includes(query);
    });
  });

  readonly totalUsers = computed(() => this.usuarios().length);
  readonly enabledUsers = computed(() => this.usuarios().filter((user) => user.activo).length);
  readonly inactiveUsers = computed(() => this.usuarios().filter((user) => !user.activo).length);
  readonly openSessions = computed(() => {
    let count = 0;
    for (const state of this.estados().values()) {
      if (state === 'activa' || state === 'inactiva') count++;
    }
    return count;
  });
  readonly isInitialLoading = computed(() => this.isLoading() && this.usuarios().length === 0);

  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly auth: AuthService,
    private readonly permisosService: PermisosService,
    private readonly drawerService: SirDrawerService,
  ) {
    this.usuarios = this.usuariosService.getUsuariosSignal();
    this.estados = this.usuariosService.getEstadosSignal();
    this.isLoading = this.usuariosService.getCargandoSignal();
    this.errorCarga = this.usuariosService.getErrorCargaSignal();
    this.currentUserId.set(String(this.auth.getUser()?.id || ''));
  }

  canCreateUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.CREAR');
  }

  isCurrentUser(userId: string): boolean {
    return String(this.currentUserId()) === String(userId);
  }

  recargar(): void {
    this.usuariosService.recargar();
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  setFilter(filter: AccountFilter): void {
    this.accountFilter.set(filter);
  }

  abrirUsuario(user: Usuario): void {
    this.drawerService.openUsuario(String(user.id_user));
  }

  onCardKeydown(event: KeyboardEvent, user: Usuario): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.abrirUsuario(user);
  }

  initials(user: Usuario): string {
    const parts = String(user.name || '').trim().split(/\s+/).filter(Boolean);
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() || '?';
  }

  sessionLabel(userId: string): string {
    const state = this.estados().get(String(userId));
    if (state === 'activa') return 'En línea';
    if (state === 'inactiva') return 'Sesión abierta';
    return 'Sin sesión';
  }
}
