import { Component, inject, signal, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';

import { UserService } from '../services/userdata';
import { DynamicIslandGlobalService } from '../services/DynamicNavbar/global';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';

type MenuAction = 'openAppUpdates' | 'toggleTheme';

interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  route?: string;
  permission?: string;
  action?: MenuAction;
  exact?: boolean;
  children?: SidebarItem[];
}

const APP_UPDATES_VERSION = 'v1.0.0-beta';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
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
  activeMenu = signal<string | null>(null);
  isDarkMode = false;

  // Ruta actual reactiva (para resaltar el padre del submenú activo)
  currentUrl = signal<string>(this.router.url);

  // data state
  user = signal<any>(null);
  avatarUrl = signal<string | null>(null);

  // ✅ CLAVE: no renderizar el menú hasta tener permisos cargados
  ready = signal(false);
  loadingError = signal<string | null>(null);

  private readonly menuItems: SidebarItem[] = [
    {
      key: 'inicio',
      label: 'Inicio',
      icon: 'bx bxs-dashboard',
      route: '/',
      permission: 'INICIO.LEER',
      exact: true,
    },
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: 'bx bx-line-chart',
      route: '/Dashboard',
      permission: 'INFORMES.LEER',
      exact: true,
    },
    {
      key: 'historial',
      label: 'Historial',
      icon: 'bx bx-history',
      route: '/Historial',
      permission: 'HISTORIAL.LEER',
      exact: true,
    },
    {
      key: 'reservas',
      label: 'Reservas',
      icon: 'bx bx-calendar-plus',
      children: [
        {
          key: 'reservas-nueva',
          label: 'Nueva Reserva',
          icon: 'bx bx-plus',
          route: '/Reservas/NuevaReserva',
          permission: 'RESERVAS.CREAR',
          exact: true,
        },
        {
          key: 'reservas-ver',
          label: 'Ver Reservas',
          icon: 'bx bx-list-ul',
          route: '/Reservas/VerReservas',
          permission: 'RESERVAS.LEER',
          exact: true,
        },
        {
          key: 'reservas-control',
          label: 'Control de Viaje',
          icon: 'bx bx-check-shield',
          route: '/Reservas/Confirmacion',
          permission: 'CONTROL_VIAJE.LEER',
          exact: true,
        },
      ],
    },
    {
      key: 'transfers',
      label: 'Transfer',
      icon: 'bx bx-car',
      children: [
        {
          key: 'transfers-nuevo',
          label: 'Nuevo Transfer',
          icon: 'bx bx-plus',
          route: '/Transfers/NuevoTransfer',
          permission: 'TRANSFERS.CREAR',
          exact: true,
        },
        {
          key: 'transfers-ver',
          label: 'Ver Transfer',
          icon: 'bx bx-list-ul',
          route: '/Transfers/VerTransfers',
          permission: 'TRANSFERS.LEER',
          exact: true,
        },
      ],
    },
    {
      key: 'tours',
      label: 'Tours',
      icon: 'bx bx-flag',
      children: [
        {
          key: 'tours-nuevo',
          label: 'Nuevo Tour',
          icon: 'bx bx-plus',
          route: '/Tours/NuevoTour',
          permission: 'TOURS.CREAR',
          exact: true,
        },
        {
          key: 'tours-ver',
          label: 'Ver Tours',
          icon: 'bx bx-list-ul',
          route: '/Tours/VerTours',
          permission: 'TOURS.LEER',
          exact: true,
        },
      ],
    },
    {
      key: 'puntos',
      label: 'Puntos de encuentro',
      icon: 'bx bx-map',
      children: [
        {
          key: 'puntos-nuevo',
          label: 'Nuevo Punto',
          icon: 'bx bx-plus',
          route: '/Puntos/NuevoPunto',
          permission: 'PUNTOS.CREAR',
          exact: true,
        },
        {
          key: 'puntos-ver',
          label: 'Ver Puntos',
          icon: 'bx bx-map-alt',
          route: '/Puntos/VerPuntos',
          permission: 'PUNTOS.LEER',
          exact: true,
        },
      ],
    },
    {
      key: 'programacion',
      label: 'Listados de buses',
      icon: 'bx bx-list-check',
      route: '/Programacion/Listado',
      permission: 'PROGRAMACION.LEER',
      exact: true,
    },
    {
      key: 'configuracion',
      label: 'Configuración',
      icon: 'bx bx-cog',
      children: [
        {
          key: 'perfil',
          label: 'Perfil',
          icon: 'bx bx-user-circle',
          route: '/Perfil/Editar',
          exact: true,
        },
        {
          key: 'usuarios',
          label: 'Administrar Usuarios',
          icon: 'bx bx-group',
          route: '/Usuarios',
          permission: 'USUARIOS.LEER',
          exact: true,
        },
        {
          key: 'usuarios-nuevo',
          label: 'Crear Usuarios',
          icon: 'bx bx-user-plus',
          route: '/Usuarios/NuevoUsuario',
          permission: 'USUARIOS.CREAR',
          exact: true,
        },
        {
          key: 'ayuda',
          label: 'Ayuda',
          icon: 'bx bx-help-circle',
          route: '/Ayuda',
          exact: true,
        },
        {
          key: 'novedades',
          label: 'Novedades',
          icon: 'bx bx-bell',
          action: 'openAppUpdates',
        },
        {
          key: 'tema',
          label: 'Tema',
          icon: 'bx bx-moon',
          action: 'toggleTheme',
        },
      ],
    },
  ];

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
  // Menú dinámico
  // -----------------------
  getVisibleMenuItems(): SidebarItem[] {
    return this.menuItems.filter((item) => this.isVisibleItem(item));
  }

  getVisibleChildren(item: SidebarItem): SidebarItem[] {
    return (item.children ?? []).filter((child) => this.isVisibleItem(child));
  }

  getSingleVisibleChild(item: SidebarItem): SidebarItem | null {
    const [child] = this.getVisibleChildren(item);
    return child ?? null;
  }

  tienePermiso(permission?: string): boolean {
    if (!permission) return true;
    return this.permisosService.tienePermiso(permission);
  }

  isVisibleItem(item: SidebarItem): boolean {
    if (item.children?.length) {
      const childrenVisible = this.getVisibleChildren(item).length > 0;
      return this.tienePermiso(item.permission) && childrenVisible;
    }

    return this.tienePermiso(item.permission);
  }

  shouldRenderAsDropdown(item: SidebarItem): boolean {
    return this.getVisibleChildren(item).length >= 2;
  }

  shouldRenderAsDirectLink(item: SidebarItem): boolean {
    return this.getVisibleChildren(item).length === 1;
  }

  getDirectRouteForSingleChild(item: SidebarItem): string | null {
    return this.getSingleVisibleChild(item)?.route ?? null;
  }

  getDirectActionForSingleChild(item: SidebarItem): MenuAction | null {
    return this.getSingleVisibleChild(item)?.action ?? null;
  }

  getItemLabel(item: SidebarItem): string {
    if (item.action === 'toggleTheme') {
      return `Tema: ${this.isDarkMode ? 'Oscuro' : 'Claro'}`;
    }

    return item.label;
  }

  isRouteActive(route: string, exact = false): boolean {
    const current = this.normalizeUrl(this.currentUrl());
    const target = this.normalizeUrl(route);

    if (exact || target === '/') {
      return current === target;
    }

    return current === target || current.startsWith(`${target}/`);
  }

  isSubmenuActive(item: SidebarItem): boolean {
    const visibleChildren = this.getVisibleChildren(item);
    if (visibleChildren.length === 0) {
      return !!item.route && this.isRouteActive(item.route, item.exact ?? false);
    }

    if (visibleChildren.length === 1) {
      const child = visibleChildren[0];
      return !!child.route && this.isRouteActive(child.route, child.exact ?? false);
    }

    return visibleChildren.some((child) => !!child.route && this.isRouteActive(child.route, child.exact ?? false));
  }

  isMenuOpen(item: SidebarItem): boolean {
    return this.activeMenu() === item.key || this.isSubmenuActive(item);
  }

  // -----------------------
  // UI Actions
  // -----------------------
  toggleSidebar() {
    this.isSidebarOpen.update((v) => !v);
    this.resetNavbarStates();
  }

  toggleMenu(key: string) {
    this.activeMenu.update((current) => (current === key ? null : key));
  }

  closeAllSubmenus() {
    const currentKey = this.activeMenu();
    if (!currentKey) {
      return;
    }

    const currentItem = this.menuItems.find((item) => item.key === currentKey);
    if (currentItem && this.isSubmenuActive(currentItem)) {
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
    this.isSidebarOpen.set(false);
  }

  openAppUpdates(): void {
    this.navbar.openAppUpdates();
    this.isSidebarOpen.set(false);
  }

  handleMenuAction(action: MenuAction) {
    if (action === 'openAppUpdates') {
      this.openAppUpdates();
      return;
    }

    this.toggleTheme();
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
  private syncActiveSubmenu(): void {
    for (const item of this.getVisibleMenuItems()) {
      if (this.shouldRenderAsDropdown(item) && this.isSubmenuActive(item)) {
        this.activeMenu.set(item.key);
        return;
      }
    }

    // Si la ruta actual no pertenece a ningún submenú, no abrimos nada.
    // (No cerramos manualmente — respeta la preferencia del usuario)
  }

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
    const currentOverlay = this.navbar?.overlay?.();

    if (!currentOverlay?.loading) {
      this.navbar?.clearOverlay?.();
    }

    this.navbar?.clearBaseState?.({
      cupos: true,
      reserva: true,
      transfer: true,
      puntos: true,
      panel: false,
      preview: false,
      sugerencias: false,
    });
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

  private normalizeUrl(url: string): string {
    const sanitized = String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
    return sanitized || '/';
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
