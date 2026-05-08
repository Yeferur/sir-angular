import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';

import { UserService } from '../services/userdata';
import { DynamicIslandGlobalService } from '../services/DynamicNavbar/global';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { PermisoDirective } from '../shared/directives/permiso.directive';

/**
 * Mapa que asocia cada índice de submenú con el prefijo de ruta padre.
 * Se usa para:
 *   1) Marcar el padre como "has-active-child" cuando una ruta hija está activa.
 *   2) Abrir automáticamente el submenú correspondiente al navegar a una ruta hija.
 */
const SUBMENU_ROUTES: Record<number, string> = {
  1: '/Reservas',
  2: '/Transfers',
  3: '/Tours',
  4: '/Puntos',
  6: '/Configuracion', // Configuración no tiene un prefijo único, ver isSubmenuActive
};

const APP_UPDATES_VERSION = 'v1.0.0-beta';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, PermisoDirective, CommonModule],
  styleUrl: './layout.css',
  templateUrl: './layout.html',
})
export class layout implements OnInit {
  // services
  private userService = inject(UserService);
  private navbar = inject(DynamicIslandGlobalService);
  private permisosService = inject(PermisosService);
  private usuariosService = inject(UsuariosService);
  private authService = inject(AuthService);
  private router = inject(Router);

  // UI state
  isSidebarOpen = signal(false);
  activeMenu = signal<number | null>(null);
  isDarkMode = false;

  // Ruta actual reactiva (para resaltar el padre del submenú activo)
  currentUrl = signal<string>(this.router.url);

  // data state
  user = signal<any>(null);
  avatarUrl = signal<string | null>(null);

  // ✅ CLAVE: no renderizar el menú hasta tener permisos cargados
  ready = signal(false);
  loadingError = signal<string | null>(null);

  // -----------------------
  // Lifecycle
  // -----------------------
  async ngOnInit() {
    try {
      // 1) usuario desde sesión
      this.user.set(this.authService.getUser());

      // 2) tema guardado
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        this.isDarkMode = savedTheme === 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
      }

      // 3) cargar permisos antes de mostrar el menú
      const token = this.authService.getToken?.() || null;
      if (!token) {
        this.ready.set(true);
        return;
      }

      // 3.1) Cargar avatar real del perfil
      this.refreshAvatar();

      // 3.2) Suscripción a NavigationEnd
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe((event) => {
          const navEnd = event as NavigationEnd;
          this.currentUrl.set(navEnd.urlAfterRedirects || navEnd.url);

          this.refreshAvatar();
          this.resetNavbarStates();

          // ✅ Auto-abrir submenú según la ruta actual
          this.syncActiveSubmenu();
        });

      await this.permisosService.loadSessionData();

      // 3.3) Sincronizar al cargar (por si la app entró directo a una ruta hija)
      this.syncActiveSubmenu();

      // 4) listo
      this.ready.set(true);
      this.openAppUpdatesOnceForUser();
    } catch (e: any) {
      console.error('Layout init error:', e);
      this.loadingError.set('No se pudieron cargar permisos');
      this.ready.set(true);
    }
  }

  // -----------------------
  // Submenu logic
  // -----------------------

  /**
   * Devuelve true si el submenú con índice dado contiene la ruta activa.
   * Se usa desde la plantilla para aplicar la clase `has-active-child` al padre.
   */
  isSubmenuActive(index: number): boolean {
    const url = this.currentUrl();
    const prefix = SUBMENU_ROUTES[index];
    if (!prefix) return false;

    // Caso especial: el menú "Configuración" agrupa rutas dispersas
    if (index === 6) {
      return (
        url.startsWith('/Perfil') ||
        url.startsWith('/Usuarios') ||
        url.startsWith('/Ayuda')
      );
    }

    return url.startsWith(prefix);
  }

  /**
   * Abre automáticamente el submenú cuyo padre coincide con la ruta actual.
   * En desktop colapsado el CSS lo mantiene cerrado visualmente, pero el
   * estado lógico queda correcto para cuando el usuario haga hover.
   */
  private syncActiveSubmenu(): void {
    for (const idxStr of Object.keys(SUBMENU_ROUTES)) {
      const idx = Number(idxStr);
      if (this.isSubmenuActive(idx)) {
        this.activeMenu.set(idx);
        return;
      }
    }
    // Si la ruta actual no pertenece a ningún submenú, no abrimos nada.
    // (No cerramos manualmente — respeta la preferencia del usuario)
  }

  // -----------------------
  // UI Actions
  // -----------------------
  toggleSidebar() {
    this.isSidebarOpen.update((v) => !v);
    this.resetNavbarStates();
  }

  toggleMenu(index: number) {
    this.activeMenu.update((current) => (current === index ? null : index));
  }

  closeAllSubmenus() {
    // Solo cierra si la ruta actual NO pertenece a un submenú abierto.
    // Así, si el usuario está dentro de "Reservas/...", el submenú se mantiene
    // abierto al sacar el mouse (mejor UX).
    const current = this.activeMenu();
    if (current !== null && this.isSubmenuActive(current)) {
      return;
    }
    this.activeMenu.set(null);
  }

  clickPage() {
    this.resetNavbarStates();
    this.isSidebarOpen.set(false);
    // No cerramos activeMenu aquí — la sincronización por NavigationEnd
    // se encargará de dejar abierto el submenú correcto.
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  openAppUpdates(): void {
    this.navbar.openAppUpdates();
    this.isSidebarOpen.set(false);
  }

  async handleLogout() {
    this.userService.clearUser();
    this.authService.logout();
    this.ready.set(false);
    this.user.set(null);
    this.activeMenu.set(null);
    this.isSidebarOpen.set(false);
  }

  // -----------------------
  // Helpers
  // -----------------------
  private openAppUpdatesOnceForUser(): void {
    const user = this.user();
    const userKey = String(user?.id || user?.username || user?.email || '').trim();
    if (!userKey) return;

    const storageKey = `sir:app-updates:${APP_UPDATES_VERSION}:seen:${userKey}`;
    if (localStorage.getItem(storageKey) === 'true') return;

    localStorage.setItem(storageKey, 'true');
    setTimeout(() => {
      if (!this.navbar.panel()) {
        this.navbar.openAppUpdates();
      }
    }, 250);
  }

  private resetNavbarStates() {
    const currentAlert = this.navbar?.alert?.();

    if (!currentAlert?.loading) {
      this.navbar?.alert?.set(null);
    }

    this.navbar?.cuposInfo?.set(null);
    this.navbar?.Id_Reserva?.set(null);

    if (this.navbar?.Id_Transfer) this.navbar.Id_Transfer.set(null);
    if (this.navbar?.puntos) this.navbar.puntos.set(null);
  }

  private refreshAvatar(): void {
    this.usuariosService.getMiPerfil().subscribe({
      next: (perfil: any) => {
        this.avatarUrl.set(perfil?.Avatar || null);
      },
      error: () => {
        this.avatarUrl.set(null);
      },
    });
  }

  getUserInitials(): string {
    const u = this.user();
    const first = String(u?.name || '').trim();
    const last = String(u?.apellidos || '').trim();

    if (first || last) {
      return `${first.charAt(0)}${last.charAt(0)}`.trim().toUpperCase() || '?';
    }

    const email = String(u?.email || '').trim();
    if (email) return email.charAt(0).toUpperCase();

    return '?';
  }
}
