import {
    Component,
    AfterViewInit,
    HostListener,
    ElementRef,
    OnDestroy,
    OnInit,
    inject,
    signal,
    computed,
    ChangeDetectorRef,
    ViewChild,
    effect,
} from '@angular/core';
import {
    Router,
    RouterLink,
    RouterLinkActive,
    NavigationEnd,
    ActivatedRoute,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/Login/login-service';
import { UserService } from '../services/userdata';
import { GlobalSearchService } from '../services/global-search.service';
import { SirDrawerService } from '../services/Drawer/drawer.service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { environment } from '../../environments/environment';

import { GlobalSearchComponent } from '../components/global-search/global-search';
import { TopbarTransitionService } from '../components/login/topbar-transition.service';
import { LoginContentComponent } from '../components/login/login';


/* ─── Tipos ────────────────────────────────────────────────── */

interface SidebarItem {
    key: string;
    label: string;
    icon: string;
    route?: string;
    permission?: string;
    exact?: boolean;
    children?: SidebarItem[];
}


/* ─── Componente ───────────────────────────────────────────── */

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [
        RouterLink,
        RouterLinkActive,
        FormsModule,
        GlobalSearchComponent,
        LoginContentComponent,
    ],
    templateUrl: './layout.html',
    styleUrls: ['./layout.css'],
})
export class LayoutComponent implements OnInit, OnDestroy, AfterViewInit {

    // ── Servicios ────────────────────────────────────────────────
    private authService = inject(AuthService);
    private userService = inject(UserService);
    private search = inject(GlobalSearchService);
    private drawer = inject(SirDrawerService);
    private permisosService = inject(PermisosService);
    private usuariosService = inject(UsuariosService);
    private transitionService = inject(TopbarTransitionService);
    private cdr = inject(ChangeDetectorRef);
    private router = inject(Router);
    private activatedRoute = inject(ActivatedRoute);

    readonly aiEnabled = !!environment.aiEnabled;

    // ── Señales del servicio global ──────────────────────────────
    globalSearchOpen = this.search.open;

    // ── Estado local ─────────────────────────────────────────────
    user = signal<any>(null);
    avatarUrl = signal<string | null>(null);
    isDarkMode = true;
    profileMenuOpen = signal(false);
    mobileDrawerOpen = signal(false);
    sidebarHovered = signal(false);
    pageTitle = signal<string>('');

    // Sidebar
    activeMenu = signal<string | null>(null);
    currentUrl = signal<string>(this.router.url);
    ready = signal(false);
    loadingError = signal<string | null>(null);
    systemEvent = signal<any>(null);
    topbarWidth = signal<number | null>(null);
    measuringTopbar = signal(false);
    logoutStartRect = signal<{ top: number; left: number; width: number; height: number } | null>(null);
    readonly transitionPhase = this.transitionService.phase;

    @ViewChild('topbarBar') private topbarBar?: ElementRef<HTMLElement>;

    private themeObserver?: MutationObserver;
    private routerSub?: Subscription;

    private readonly topbarStateEffect = effect(() => {
        this.topbarState();
        queueMicrotask(() => this.syncTopbarWidth());
    });

    private readonly collapseEffect = effect(() => {
        if (this.transitionService.phase() !== 'collapsing') return;
        requestAnimationFrame(() => {
            this.router.navigateByUrl('/');
            window.setTimeout(() => {
                this.logoutStartRect.set(null);
                this.transitionService.markAppReady();
            }, 360);
        });
    });


    // ── Estado computado del topbar ──────────────────────────────
    topbarState = computed(() => {
        if (this.systemEvent()) return 'sistema';
        if (this.globalSearchOpen()) return 'global-search';
        return 'idle';
    });

    // /reset-password se resuelve por su propia ruta (router-outlet en
    // app.html), no por esta isla — si estamos ahí, la isla no debe
    // mostrar su propio login por encima.
    readonly isPublicAuthRoute = computed(() =>
        this.normalizeUrl(this.currentUrl()).startsWith('/reset-password')
    );

    // La isla aloja el login cuando no estamos autenticados (fase
    // 'login'), y también durante 'expanding'/'collapsing' — así el
    // login queda dentro de la MISMA caja que se expande/colapsa, sin
    // el corte que da desmontar el layout entero y montar un login
    // aparte en otro contenedor.
    readonly showAuthSlot = computed(() => {
        if (this.isPublicAuthRoute()) return false;
        const phase = this.transitionPhase();
        return phase === 'expanding' || phase === 'login' || phase === 'collapsing';
    });

    // El contenido normal de la app (título, iconos, avatar) y el resto
    // del chrome (sidebar, drawer, pills) solo tiene sentido con sesión
    // activa y ya asentada.
    readonly showAppChrome = computed(() => this.transitionPhase() === 'app');


    // ── Lifecycle ────────────────────────────────────────────────

    async ngOnInit(): Promise<void> {
        // Tema
        const theme = document.documentElement.getAttribute('data-theme');
        this.isDarkMode = theme !== 'light';

        this.themeObserver = new MutationObserver(() => {
            this.isDarkMode =
                document.documentElement.getAttribute('data-theme') !== 'light';
            this.cdr.markForCheck();
        });
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });

        // Usuario y avatar
        this.user.set(this.authService.getUser());
        this.refreshAvatar();

        // Título de la página desde datos de ruta. También mantiene
        // currentUrl al día siempre (con o sin sesión) — showAuthSlot
        // lo necesita para saber si estamos en /reset-password.
        this.routerSub = this.router.events
            .pipe(filter(e => e instanceof NavigationEnd))
            .subscribe(event => {
                const navEnd = event as NavigationEnd;
                this.currentUrl.set(navEnd.urlAfterRedirects || navEnd.url);

                let route = this.activatedRoute;
                while (route.firstChild) route = route.firstChild;
                const title = route.snapshot.title ?? route.snapshot.data?.['title'] ?? '';
                this.pageTitle.set(this.extractTitle(title));
                // El título cambia el ancho del contenido; remedir tras el cambio.
                queueMicrotask(() => this.syncTopbarWidth());
            });

        // Título inicial (carga directa)
        const getLeafTitle = () => {
            let route = this.activatedRoute;
            while (route.firstChild) route = route.firstChild;
            return route.snapshot.title ?? route.snapshot.data?.['title'] ?? '';
        };
        this.pageTitle.set(this.extractTitle(getLeafTitle()));

        // Permisos y sidebar
        try {
            const token = this.authService.getToken?.() || null;
            if (!token) {
                this.transitionService.markLoginReady();
                this.ready.set(true);
                return;
            }

            this.transitionService.markAppReady();

            this.router.events
                .pipe(filter(e => e instanceof NavigationEnd))
                .subscribe(() => this.syncActiveSubmenu());

            await this.permisosService.loadSessionData();
            this.syncActiveSubmenu();
            this.ready.set(true);
        } catch (e: any) {
            console.error('Layout init error:', e);
            this.loadingError.set('No se pudieron cargar permisos');
            this.ready.set(true);
        }
    }

    ngAfterViewInit(): void {
        this.syncTopbarWidth();

        // Reintento tras cargar fuentes (Boxicons). La primera medición
        // de scrollWidth puede ocurrir antes de que la fuente de íconos
        // tenga su tamaño final, dejando la isla fijada más angosta de
        // lo necesario y recortando contenido con el overflow:hidden.
        if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
            (document as any).fonts.ready.then(() => this.syncTopbarWidth());
        }

    }

    ngOnDestroy(): void {
        this.themeObserver?.disconnect();
        this.routerSub?.unsubscribe();
    }

    // Sin manejo de transitionend ni timers: el título se muestra siempre,
    // solo el ancho de la isla se anima. La medición se hace con doble rAF
    // para dejar que el layout (fuentes, imágenes) se asiente antes de
    // leer scrollWidth, en vez de medir en el mismo frame del cambio.
    private syncTopbarWidth(): void {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const bar = this.topbarBar?.nativeElement;
            if (!bar) return;

            // Medir en modo natural mediante una clase CSS controlada por
            // Angular; no escribir geometrÃ­a directamente en el elemento.
            this.measuringTopbar.set(true);

            requestAnimationFrame(() => {
                const nextWidth = Math.min(
                    Math.ceil(bar.scrollWidth + 8),
                    Math.max(220, window.innerWidth - 30),
                );
                this.measuringTopbar.set(false);

                if (this.topbarWidth() !== nextWidth) {
                    this.topbarWidth.set(nextWidth);
                }

            // Rect real tras el cambio de ancho — un frame más para que el
            // navegador ya haya re-centrado la isla con el ancho nuevo
            // (el left depende del width porque está centrada por flex).
                requestAnimationFrame(() => {
                });
            });
        }));
    }


    // ── Perfil ───────────────────────────────────────────────────

    getUserInitials(): string {
        const u = this.user();
        const first = String(u?.name || '').trim();
        const last = String(u?.apellidos || '').trim();
        if (first || last) {
            return `${first.charAt(0)}${last.charAt(0)}`.trim().toUpperCase() || '?';
        }
        const email = String(u?.email || '').trim();
        return email ? email.charAt(0).toUpperCase() : '?';
    }

    toggleProfileMenu(): void {
        this.profileMenuOpen.update(v => !v);
    }

    closeProfileMenu(): void {
        this.profileMenuOpen.set(false);
    }

    // ── Mobile drawer ─────────────────────────────────────────────

    toggleMobileDrawer(): void { this.mobileDrawerOpen.update(v => !v); }
    closeMobileDrawer(): void {
        this.mobileDrawerOpen.set(false);
        this.closeAllSubmenus();
    }


    navigateToProfile(): void {
        this.closeProfileMenu();
        this.router.navigate(['/Perfil/Editar']);
    }

    toggleTheme(): void {
        this.isDarkMode = !this.isDarkMode;
        const nextTheme = this.isDarkMode ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('theme', nextTheme);
        this.cdr.markForCheck();
    }

    async handleLogout(): Promise<void> {
        this.closeProfileMenu();

        this.transitionService.requestExpandToFullscreen();

        const bar = this.topbarBar?.nativeElement;
        if (!bar) {
            this.finishLogout();
            return;
        }

        // Por si quedó algo pegado de un intento anterior (ver nota en
        // resetBarGeometryOverrides): arrancar siempre desde limpio.
        const rect = bar.getBoundingClientRect();
        this.logoutStartRect.set({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        });
        // Toda la geometría va por inline style (nunca por la hoja de
        // estilos): un inline style siempre gana sobre una regla CSS
        // externa sin !important, así que si el "to" viviera en una
        // clase, pelearía contra este mismo "from" inline y el valor
        // nunca cambiaría de verdad — y sin cambio real, transitionend
        // jamás dispara. Ver nota en layout.css.
        requestAnimationFrame(() => {
            window.setTimeout(() => this.finishLogout(), 720);
        });
    }

    /**
     * Espera transitionend de una propiedad puntual en un elemento
     * concreto. Si no dispara dentro de `timeoutMs` (reduced motion,
     * pestaña en segundo plano, o cualquier caso donde el valor no
     * cambió de verdad), fuerza igual el siguiente paso — nunca deja
     * una coreografía colgada a medias.
     */
    /** Limpia clase + inline styles de geometría dejados por la animación de logout. */
    private finishLogout(): void {
        this.logoutStartRect.set(null);
        this.userService.clearUser();
        this.authService.logout();
        this.user.set(null);
        this.avatarUrl.set(null);
        this.router.navigateByUrl('/');
        this.transitionService.markLoginReady();
    }


    // ── Búsqueda global ──
    openGlobalSearch(): void { this.search.openSearch(); }
    closeGlobalSearch(): void { this.search.closeSearch(); }
    showSystemEvent(payload: any): void { this.systemEvent.set(payload); }


    // ── Novedades ────────────────────────────────────────────────
    openAppUpdates(): void { this.drawer.openAppUpdates(); }

    // ── Overlay / alertas ────────────────────────────────────────

    // ── Atajos de teclado globales ───────────────────────────────

    @HostListener('document:keydown', ['$event'])
    handleGlobalShortcuts(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        const tagName = target?.tagName?.toLowerCase() || '';
        const editable = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.openGlobalSearch();
            return;
        }

        if (event.key === 'Escape') {
            if (this.globalSearchOpen()) {
                if (editable && !target?.closest('app-global-search')) return;
                event.preventDefault();
                this.closeGlobalSearch();
            }
            if (this.profileMenuOpen()) this.closeProfileMenu();
        }
    }

    @HostListener('document:click', ['$event'])
    handleDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (this.profileMenuOpen() && !target?.closest('.topbar-profile')) {
            this.closeProfileMenu();
        }
    }


    // ── Helpers privados ─────────────────────────────────────────

    private extractTitle(docTitle: string): string {
        // "SIR · Nueva Reserva" → "Nueva Reserva"
        const parts = docTitle.split('·');
        return parts.length > 1 ? parts[parts.length - 1].trim() : docTitle.trim();
    }

    private refreshAvatar(): void {
        this.usuariosService.getMiPerfil().subscribe({
            next: (perfil: any) => this.avatarUrl.set(perfil?.Avatar || null),
            error: () => this.avatarUrl.set(null),
        });
    }

    private syncActiveSubmenu(): void {
        for (const item of this.getVisibleMenuItems()) {
            if (this.shouldRenderAsDropdown(item) && this.isSubmenuActive(item)) {
                this.activeMenu.set(item.key);
                return;
            }
        }
    }

    private normalizeUrl(url: string): string {
        const sanitized = String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
        return sanitized || '/';
    }


    // ── Definición del menú ──────────────────────────────────────

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
            key: 'seguros',
            label: 'Seguros',
            icon: 'bx bx-shield',
            route: '/Seguros',
            permission: 'SEGUROS.LEER',
            exact: true,
        },
         {
            key: 'comisiones',
            label: 'Comisiones',
            icon: 'bx bx-dollar',
            route: '/Comisiones',
            permission: 'COMISIONES.LEER',
            exact: true,
        },
        {
            key: 'configuracion',
            label: 'Configuración',
            icon: 'bx bx-cog',
            children: [
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
            ],
        },
    ];


    // ── Menú dinámico (permisos) ─────────────────────────────────

    getVisibleMenuItems(): SidebarItem[] {
        return this.menuItems.filter(item => this.isVisibleItem(item));
    }

    getVisibleChildren(item: SidebarItem): SidebarItem[] {
        return (item.children ?? []).filter(child => this.isVisibleItem(child));
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
            return this.tienePermiso(item.permission) &&
                this.getVisibleChildren(item).length > 0;
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

    isRouteActive(route: string, exact = false): boolean {
        const current = this.normalizeUrl(this.currentUrl());
        const target = this.normalizeUrl(route);
        if (exact || target === '/') return current === target;
        return current === target || current.startsWith(`${target}/`);
    }

    isSubmenuActive(item: SidebarItem): boolean {
        const children = this.getVisibleChildren(item);
        if (!children.length) {
            return !!item.route && this.isRouteActive(item.route, item.exact ?? false);
        }
        if (children.length === 1) {
            const child = children[0];
            return !!child.route && this.isRouteActive(child.route, child.exact ?? false);
        }
        return children.some(c => !!c.route && this.isRouteActive(c.route, c.exact ?? false));
    }

    isMenuOpen(item: SidebarItem): boolean {
        return this.activeMenu() === item.key || this.isSubmenuActive(item);
    }


    // ── Acciones UI del sidebar ──────────────────────────────────

    toggleMenu(key: string, event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        this.activeMenu.update(current => current === key ? null : key);
    }

    closeAllSubmenus(): void {
        const key = this.activeMenu();
        if (!key) return;
        const item = this.menuItems.find(i => i.key === key);
        if (item && this.isSubmenuActive(item)) return;
        this.activeMenu.set(null);
    }

    clickPage(): void {
        this.closeAllSubmenus();
    }
}