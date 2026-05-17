import { Component, OnInit, Signal, computed, signal } from '@angular/core';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import type { Usuario } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { AuthService } from '../../../services/Login/login-service';
import { PermisosService } from '../../../services/Permisos/permisos.service';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css'
})
export class Usuarios implements OnInit {
  usuarios!: Signal<Usuario[]>;
  estados!: Signal<Map<string, string>>;

  isLoading = signal<boolean>(true);
  skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

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
    private navbar: DynamicIslandGlobalService,
    private auth: AuthService,
    private permisosService: PermisosService
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

    this.navbar.showConfirm(
      'Cierre de Sesión',
      'Estás a punto de cerrar la sesión de este usuario.',
      [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Cerrar Sesión',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            this.performLogout(userId);
          }
        }
      ]
    );
  }

  private performLogout(userId: string) {
    this.usuariosService.forzarCierreSesion(userId).subscribe({
      next: () => {
        this.navbar.successToast('Sesion cerrada', 'La sesión del usuario fue cerrada exitosamente.');
      },
      error: (err) => {
        console.error('❌ Error cerrando sesión:', err);
        this.navbar.errorToast('Error', 'Ocurrió un error cerrando la sesión.');
      }
    });
  }

  cerrarMisSesiones() {
    this.navbar.showConfirm(
      'Cerrar sesión en todos mis dispositivos',
      'Esta acción cerrará tu sesión en todos los navegadores y dispositivos.',
      [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Cerrar sesiones',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            this.auth.logoutAllSessions().subscribe({
              next: () => {
                this.auth.clearLocalSession();
                this.navbar.successToast('Sesión cerrada', 'Cerraste sesión en todos tus dispositivos.');
              },
              error: (err) => {
                console.error('❌ Error cerrando sesiones en todos los dispositivos:', err);
                this.auth.clearLocalSession();
                this.navbar.warningToast('Sesión cerrada', 'No pudimos confirmar el cierre remoto, pero tu sesión local fue cerrada.');
              }
            });
          }
        }
      ]
    );
  }

  eliminarUsuario(userId: string) {
    if (!this.canDeleteUsers()) {
      return;
    }

    if (this.isCurrentUser(userId)) {
      this.navbar.warningToast('Acción no permitida', 'No puedes eliminar tu propio usuario desde tu sesión activa.');
      return;
    }

    this.navbar.showConfirm(
      '¿Eliminar Usuario?',
      'Esta acción desactivará al usuario, cerrará sus sesiones activas y lo ocultará del listado. El historial seguirá conservando la relación con su Id_Usuario.',
      [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.clearOverlay() },
        {
          text: 'Eliminar', style: 'primary', onClick: () => {
            this.navbar.clearOverlay();
            this.confirmEliminar(userId);
          }
        }
      ]
    );
  }

  private confirmEliminar(userId: string) {
    const removed = this.usuariosService.removeUsuarioFromSignal(userId);
    if (!removed.user) {
      this.navbar.warningToast('Sin cambios', 'No se encontro el usuario seleccionado.');
      return;
    }

    this.navbar.infoToast('Eliminando usuario', 'Actualizando listado...', 1800);

    this.usuariosService.eliminarUsuario(userId).subscribe({
      next: () => {
        this.navbar.successToast('Usuario desactivado', 'El usuario fue desactivado y sus sesiones quedaron cerradas.');
      },
      error: (err) => {
        this.usuariosService.restoreUsuarioInSignal(removed.user!, removed.estado, removed.index);
        const msg = err?.error?.error || 'Error al eliminar usuario.';
        this.navbar.errorToast('Error', msg);
      }
    });
  }
}
