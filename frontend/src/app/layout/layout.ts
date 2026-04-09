import { Component, inject, signal, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';

import { UserService } from '../services/userdata';
import { DynamicIslandGlobalService } from '../services/DynamicNavbar/global';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { PermisoDirective } from '../shared/directives/permiso.directive';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, PermisoDirective, CommonModule],
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
      // 1) usuario desde sesión (localStorage o donde lo guardes)
      this.user.set(this.authService.getUser());

      // 2) tema guardado
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        this.isDarkMode = savedTheme === 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
      }

      // 3) ✅ cargar permisos antes de mostrar el menú
      //    (si no hay token/usuario, no intentes cargar)
      const token = this.authService.getToken?.() || null;
      if (!token) {
        this.ready.set(true); // deja renderizar layout (mostrar login o lo que aplique)
        return;
      }

      // 3.1) Cargar avatar real del perfil (persistido en DB)
      this.refreshAvatar();

      // 3.2) Mantener avatar sincronizado al navegar entre rutas
      this.router.events
        .pipe(filter((event) => event instanceof NavigationEnd))
        .subscribe(() => this.refreshAvatar());

      await this.permisosService.loadSessionData();

      // 4) listo para renderizar el sidebar
      this.ready.set(true);
    } catch (e: any) {
      console.error('Layout init error:', e);
      this.loadingError.set('No se pudieron cargar permisos');
      // para que no se quede negro, renderiza igual
      this.ready.set(true);
    }
  }

  // -----------------------
  // UI Actions
  // -----------------------
  toggleSidebar() {
    this.isSidebarOpen.update(v => !v);
    this.resetNavbarStates();
  }

  toggleMenu(index: number) {
    this.activeMenu.update(current => (current === index ? null : index));
  }

  closeAllSubmenus() {
    this.activeMenu.set(null);
  }

  clickPage() {
    this.resetNavbarStates();
    this.isSidebarOpen.set(false);
    this.activeMenu.set(null);
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  async handleLogout() {
    try {
      this.userService.clearUser();
      this.authService.logout(); // asumo que te redirige o limpia token
    } finally {
      // por si acaso
      this.ready.set(false);
      this.user.set(null);
      this.activeMenu.set(null);
      this.isSidebarOpen.set(false);
      await this.router.navigateByUrl('/login');
    }
  }

  // -----------------------
  // Helpers
  // -----------------------
  private resetNavbarStates() {
    this.navbar?.alert?.set(null);
    this.navbar?.cuposInfo?.set(null);
    this.navbar?.Id_Reserva?.set(null);
  }

  private refreshAvatar(): void {
    this.usuariosService.getMiPerfil().subscribe({
      next: (perfil: any) => {
        this.avatarUrl.set(perfil?.Avatar || null);
      },
      error: () => {
        this.avatarUrl.set(null);
      }
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
