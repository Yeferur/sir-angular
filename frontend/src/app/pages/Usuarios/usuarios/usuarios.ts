import { Component, OnInit, Signal, computed, signal } from '@angular/core';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import type { Usuario } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { AuthService } from '../../../services/Login/login-service';

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
    private auth: AuthService
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

  forzarCierreSesion(userId: string) {
    if (this.isCurrentUser(userId)) {
      this.cerrarMisSesiones();
      return;
    }

    this.navbar.alert.set({
      type: 'warning',
      title: 'Cierre de Sesión',
      message: 'Estás a punto de cerrar la sesión de este usuario.',
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        },
        {
          text: 'Cerrar Sesión',
          style: 'primary',
          onClick: () => {
            this.navbar.alert.set(null); // Close confirm
            this.performLogout(userId);
          }
        }
      ]
    });
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
    this.navbar.alert.set({
      type: 'info',
      title: 'Cerrar sesión en todos mis dispositivos',
      message: 'Esta acción cerrará tu sesión en todos los navegadores y dispositivos.',
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        },
        {
          text: 'Cerrar sesiones',
          style: 'primary',
          onClick: () => {
            this.navbar.alert.set(null);
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
    });
  }

  eliminarUsuario(userId: string) {
    this.navbar.alert.set({
      type: 'error', // Red alert for danger
      title: '¿Eliminar Usuario?',
      message: 'Esta acción eliminará al usuario y sus permisos. Si tiene datos asociados (historial, reservas) podría fallar.',
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
        {
          text: 'Eliminar', style: 'primary', onClick: () => {
            this.navbar.alert.set(null);
            this.confirmEliminar(userId);
          }
        }
      ]
    });
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
        this.navbar.successToast('Eliminado', 'Usuario eliminado correctamente.');
      },
      error: (err) => {
        this.usuariosService.restoreUsuarioInSignal(removed.user!, removed.estado, removed.index);
        const msg = err?.error?.error || 'Error al eliminar usuario.';
        this.navbar.errorToast('Error', msg);
      }
    });
  }
}
