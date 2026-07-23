import { Component, OnInit, Signal, computed, signal } from '@angular/core';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import type { Usuario } from '../../../services/Usuarios/usuarios';
import { AuthService } from '../../../services/Login/login-service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, RouterModule, LoadingStateComponent],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css'
})
export class Usuarios implements OnInit {
  usuarios!: Signal<Usuario[]>;
  estados!: Signal<Map<string, string>>;

  isLoading = signal<boolean>(true);
  // Search signal
  searchQuery = signal('');
  currentUserId = signal('');

  // Computed filtered list
  filteredUsuarios = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const all = this.usuarios();

    if (!query) return all;

    return all.filter(u =>
      u.name.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      u.username.toLowerCase().includes(query)
    );
  });



  // KPIs
  totalUsers = computed(() => this.usuarios().length);
  activeSessions = computed(() => {
    const states = this.estados();
    let count = 0;
    for (const s of states.values()) {
      if (s === 'activa') count++;
    }
    return count;
  });

  constructor(
    private usuariosService: UsuariosService,
    private auth: AuthService,
    private permisosService: PermisosService,
    private alerts: SirAlertService
  ) {
    this.usuarios = this.usuariosService.getUsuariosSignal();
    this.estados = this.usuariosService.getEstadosSignal();
    this.currentUserId.set(String(this.auth.getUser()?.id || ''));
  }

  ngOnInit(): void {
    queueMicrotask(() => {
      this.isLoading.set(false);
    });
  }

  onSearchInput(val: string) {
    this.searchQuery.set(val);
  }

  isCurrentUser(userId: string): boolean {
    return String(this.currentUserId()) === String(userId);
  }

  canDeleteUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.ELIMINAR');
  }

  canCreateUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.CREAR');
  }

  canUpdateUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.ACTUALIZAR');
  }

  forzarCierreSesion(userId: string) {
    if (this.isCurrentUser(userId)) {
      this.cerrarMisSesiones();
      return;
    }

    this.alerts.confirm(
      'Cierre de Sesión',
      'Estás a punto de cerrar la sesión de este usuario.',
      () => this.performLogout(userId),
      undefined,
      { confirmText: 'Cerrar sesión', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  private performLogout(userId: string) {
    this.usuariosService.forzarCierreSesion(userId).subscribe({
      next: () => {
        this.alerts.successToast('Sesion cerrada', 'La sesión del usuario fue cerrada exitosamente.');
      },
      error: (err) => {
        console.error('❌ Error cerrando sesión:', err);
        this.alerts.errorToast('Error', 'Ocurrió un error cerrando la sesión.');
      }
    });
  }

  cerrarMisSesiones() {
    this.alerts.confirm(
      'Cerrar sesión en todos mis dispositivos',
      'Esta acción cerrará tu sesión en todos los navegadores y dispositivos.',
      () => {
        this.auth.logoutAllSessions().subscribe({
          next: () => {
            this.auth.clearLocalSession();
            this.alerts.successToast('Sesión cerrada', 'Cerraste sesión en todos tus dispositivos.');
          },
          error: (err) => {
            console.error('❌ Error cerrando sesiones en todos los dispositivos:', err);
            this.auth.clearLocalSession();
            this.alerts.warningToast('Sesión cerrada', 'No pudimos confirmar el cierre remoto, pero tu sesión local fue cerrada.');
          }
        });
      },
      undefined,
      { confirmText: 'Cerrar sesiones', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  eliminarUsuario(userId: string) {
    if (!this.canDeleteUsers()) {
      return;
    }

    if (this.isCurrentUser(userId)) {
      this.alerts.warningToast('Acción no permitida', 'No puedes eliminar tu propio usuario desde tu sesión activa.');
      return;
    }

    this.alerts.confirm(
      '¿Eliminar Usuario?',
      'Esta acción desactivará al usuario, cerrará sus sesiones activas y lo ocultará del listado. El historial seguirá conservando la relación con su Id_Usuario.',
      () => this.confirmEliminar(userId),
      undefined,
      { confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  private confirmEliminar(userId: string) {
    const removed = this.usuariosService.removeUsuarioFromSignal(userId);
    if (!removed.user) {
      this.alerts.warningToast('Sin cambios', 'No se encontro el usuario seleccionado.');
      return;
    }

    this.alerts.infoToast('Eliminando usuario', 'Actualizando listado...', 1800);

    this.usuariosService.eliminarUsuario(userId).subscribe({
      next: () => {
        this.alerts.successToast('Usuario desactivado', 'El usuario fue desactivado y sus sesiones quedaron cerradas.');
      },
      error: (err) => {
        this.usuariosService.restoreUsuarioInSignal(removed.user!, removed.estado, removed.index);
        const msg = err?.error?.error || 'Error al eliminar usuario.';
        this.alerts.errorToast('Error', msg);
      }
    });
  }
}
