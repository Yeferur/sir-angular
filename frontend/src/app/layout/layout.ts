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
    NavigationStart,
    NavigationEnd,
    NavigationCancel,
    NavigationError,
    ActivatedRoute,
} from '@angular/router';
import { distinctUntilChanged } from 'rxjs/operators';
import { combineLatest, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/Login/login-service';
import { UserService } from '../services/userdata';
import { GlobalSearchService } from '../services/global-search.service';
import { SirDrawerService } from '../services/Drawer/drawer.service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { UsuariosService } from '../services/Usuarios/usuarios';
import { SirAlertService } from '../services/Alertas/alert.service';

import { GlobalSearchComponent } from '../components/global-search/global-search';
import { TopbarTransitionService } from '../components/login/topbar-transition.service';
import { LoginContentComponent } from '../components/login/login';
import { AppActivityService } from '../services/app-activity.service';
import { NotificacionesService } from '../services/Notificaciones/notificaciones.service';
import { WebSocketService } from '../services/WebSocket/web-socket';


/* ─── Tipos ────────────────────────────────────────────────── */

interface SidebarItem {
    key: string;
    label: string;
    icon: string;
    group?: 'principal' | 'operacion' | 'gestion' | 'sistema';
    kind?: 'action' | 'destination';
    route?: string;
    permission?: string | string[];
    exact?: boolean;
    clientVisible?: boolean;
    advisorVisible?: boolean;
    adminVisible?: boolean;
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
    private alerts = inject(SirAlertService);
    private transitionService = inject(TopbarTransitionService);
    private cdr = inject(ChangeDetectorRef);
    private router = inject(Router);
    private activatedRoute = inject(ActivatedRoute);
    private activity = inject(AppActivityService);
    readonly notifications = inject(NotificacionesService);
    private webSocket = inject(WebSocketService);

    // ── Señales del servicio global ──────────────────────────────
    globalSearchOpen = this.search.open;
    searchQuery = this.search.query;
    searchLoading = this.search.loading;

    // ── Estado local ─────────────────────────────────────────────
    user = signal<any>(null);
    avatarUrl = signal<string | null>(null);
    isDarkMode = true;
    profileMenuOpen = signal(false);
    mobileDrawerOpen = signal(false);
    hoveredMenuItem = signal<SidebarItem | null>(null);
    railTooltipTop = signal(0);
    pageTitle = signal<string>('');
    titleLeaving = signal(false);
    titleEntering = signal(false);
    readonly navigationActive = this.activity.visible;

    // Sidebar
    activeMenu = signal<string | null>(null);
    currentUrl = signal<string>(this.router.url);
    ready = signal(false);
    loadingError = signal<string | null>(null);
    systemEvent = signal<any>(null);
    topbarWidth = signal<number | null>(null);
    logoutStartRect = signal<{ top: number; left: number; width: number; height: number } | null>(null);
    transitionStage = signal<'island' | 'wide' | 'fullscreen'>('fullscreen');
    readonly transitionPhase = this.transitionService.phase;
    readonly sessionTransitionMessage = computed(() => {
        const phase = this.transitionPhase();
        if (phase !== 'collapsing' && phase !== 'expanding') return null;

        const sessionUser = this.user() || this.authService.getUser();
        const firstName = String(sessionUser?.name || '').trim().split(/\s+/)[0];

        if (phase === 'collapsing') {
            return {
                kind: 'welcome' as const,
                title: firstName ? `Qué bueno verte, ${firstName}` : 'Qué bueno verte',
            };
        }

        return {
            kind: 'farewell' as const,
            title: firstName ? `Hasta pronto, ${firstName}` : 'Hasta pronto',
        };
    });
    readonly topbarFeedbackType = computed(() => {
        const toasts = this.alerts.toasts();
        return toasts.length ? toasts[toasts.length - 1].type : null;
    });

    @ViewChild('topbarBar') private topbarBar?: ElementRef<HTMLElement>;
    @ViewChild('topbarContent') private topbarContent?: ElementRef<HTMLElement>;
    @ViewChild('topbarSearchInput') private topbarSearchInput?: ElementRef<HTMLInputElement>;

    private themeObserver?: MutationObserver;
    private routerSub?: Subscription;
    private transitionFallbackTimer?: number;
    private finishRouteActivity?: () => void;
    private titleMotionTimer?: number;
    private notificationEventSub?: Subscription;
    private authNotificationSub?: Subscription;

    private readonly topbarStateEffect = effect(() => {
        this.topbarState();
        queueMicrotask(() => this.syncTopbarWidth());
    });

    private readonly searchFocusEffect = effect(() => {
        if (!this.globalSearchOpen()) return;
        window.setTimeout(() => this.topbarSearchInput?.nativeElement.focus(), 80);
    });

    private readonly loginTargetEffect = effect(() => {
        if (this.transitionService.phase() === 'login') {
            this.transitionStage.set('fullscreen');
        }
    });

    private readonly collapseEffect = effect(() => {
        if (this.transitionService.phase() !== 'collapsing') return;

        this.user.set(this.authService.getUser());
        this.refreshAvatar();

        if (!this.logoutStartRect()) {
            this.logoutStartRect.set(this.getFallbackIslandRect());
        }

        requestAnimationFrame(() => requestAnimationFrame(() => {
            // Regreso inverso: primero recupera la altura de la isla y
            // después reduce el ancho hacia el centro superior.
            this.transitionStage.set('wide');
            this.afterTopbarTransition(['height', 'top'], () => {
                this.transitionStage.set('island');
                this.afterTopbarTransition(['width', 'left'], () => {
                    this.router.navigateByUrl('/');
                    this.logoutStartRect.set(null);
                    this.transitionService.markAppReady();
                    queueMicrotask(() => this.syncTopbarWidth());
                });
            });
        }));
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
        if (this.authService.getToken?.()) this.refreshAvatar();
        this.authNotificationSub = combineLatest([
            this.authService.isLoggedIn(),
            this.permisosService.role$,
        ]).pipe(
            distinctUntilChanged(([prevLogged, prevRole], [nextLogged, nextRole]) => (
                prevLogged === nextLogged && prevRole === nextRole
            )),
        ).subscribe(([loggedIn, role]) => this.syncNotificationSession(loggedIn, role));

        // Título de la página desde datos de ruta. También mantiene
        // currentUrl al día siempre (con o sin sesión) — showAuthSlot
        // lo necesita para saber si estamos en /reset-password.
        this.routerSub = this.router.events.subscribe(event => {
            if (event instanceof NavigationStart) {
                // Navegaciones que solo actualizan query params (ej. el filtro
                // de fecha en Aforos) mantienen la misma ruta y el mismo
                // título — no deben disparar la animación de salida del
                // título del topbar, solo las que cambian de página sí.
                const targetPath = event.url.split('?')[0];
                const currentPath = (this.currentUrl() || '').split('?')[0];
                this.startNavigationMotion(targetPath !== currentPath);
                return;
            }

            if (event instanceof NavigationEnd) {
                const navEnd = event;
                this.currentUrl.set(navEnd.urlAfterRedirects || navEnd.url);

                let route = this.activatedRoute;
                while (route.firstChild) route = route.firstChild;
                const title = route.snapshot.title ?? route.snapshot.data?.['title'] ?? '';
                const nextTitle = this.extractTitle(title);
                const titleChanged = nextTitle !== this.pageTitle();
                this.pageTitle.set(nextTitle);
                this.finishNavigationMotion(titleChanged);
                return;
            }

            if (event instanceof NavigationCancel || event instanceof NavigationError) {
                this.finishNavigationMotion(false);
            }
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
                this.transitionStage.set('fullscreen');
                this.transitionService.markLoginReady();
                this.ready.set(true);
                return;
            }

            this.transitionStage.set('island');
            this.transitionService.markAppReady();

            await this.permisosService.loadSessionData();
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
        this.authNotificationSub?.unsubscribe();
        this.notificationEventSub?.unsubscribe();
        if (this.transitionFallbackTimer) window.clearTimeout(this.transitionFallbackTimer);
        this.finishRouteActivity?.();
        if (this.titleMotionTimer) window.clearTimeout(this.titleMotionTimer);
    }

    private syncNotificationSession(loggedIn: boolean, role: string | null): void {
        this.notificationEventSub?.unsubscribe();
        this.notificationEventSub = undefined;

        if (!loggedIn) {
            this.notifications.clear();
            return;
        }

        const normalizedRole = String(role || '').trim().toLocaleLowerCase('es-CO');
        // En restauración, espera a que el rol esté hidratado antes de consultar.
        if (!normalizedRole || normalizedRole === 'cliente') {
            this.notifications.clear();
            return;
        }

        this.notifications.load();
        this.notificationEventSub = this.webSocket.events$.subscribe(event => {
            if (event.type === 'notificacionNueva' || event.type === 'turnoIntercambioActualizado') {
                this.notifications.load();
            }
        });
    }

    // El ancho se obtiene del contenido interno, que conserva su medida
    // natural sin cambiar la geometría visible de la isla. Así la barra no
    // salta a max-content durante la carga o al asentarse las fuentes.
    private syncTopbarWidth(): void {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const bar = this.topbarBar?.nativeElement;
            const content = this.topbarContent?.nativeElement;
            if (!bar || !content) return;

            const styles = getComputedStyle(bar);
            const horizontalChrome =
                (Number.parseFloat(styles.paddingLeft) || 0) +
                (Number.parseFloat(styles.paddingRight) || 0) +
                (Number.parseFloat(styles.borderLeftWidth) || 0) +
                (Number.parseFloat(styles.borderRightWidth) || 0);
            const nextWidth = Math.min(
                Math.ceil(content.scrollWidth + horizontalChrome),
                Math.max(220, window.innerWidth - 30),
            );

            if (this.topbarWidth() !== nextWidth) {
                this.topbarWidth.set(nextWidth);
            }
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

    onBrandClick(): void {
        this.closeProfileMenu();
        this.closeMobileDrawer();
        this.closeGlobalSearch();
    }


    navigateToProfile(): void {
        this.closeProfileMenu();
        this.router.navigate(['/Perfil/Editar']);
    }

    navigateToHelp(): void {
        this.closeProfileMenu();
        this.router.navigate(['/Ayuda']);
    }

    toggleTheme(event?: MouseEvent): void {
        if (document.documentElement.classList.contains('sir-theme-switching')) return;

        const nextDarkMode = !this.isDarkMode;
        const nextTheme = nextDarkMode ? 'dark' : 'light';
        const root = document.documentElement;
        const applyTheme = () => {
            this.isDarkMode = nextDarkMode;
            root.setAttribute('data-theme', nextTheme);
            localStorage.setItem('theme', nextTheme);
            this.cdr.markForCheck();
        };

        const startViewTransition = (
            document as Document & {
                startViewTransition?: (
                    update: () => void | Promise<void>
                ) => { ready: Promise<void>; finished: Promise<void> };
            }
        ).startViewTransition;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            applyTheme();
            return;
        }

        const x = event?.clientX ?? window.innerWidth / 2;
        const y = event?.clientY ?? 38;
        const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

        if (!startViewTransition) {
            root.classList.add('sir-theme-switching');

            const orb = document.createElement('span');
            orb.className = 'sir-theme-transition-orb';
            orb.style.setProperty('--theme-x', `${x}px`);
            orb.style.setProperty('--theme-y', `${y}px`);
            orb.style.setProperty('--theme-scale', String(Math.max(1, radius / 10)));
            // Coincide con --body-color del tema de destino. Así la cubierta y
            // el fondo revelado no producen dos tonalidades consecutivas.
            orb.style.background = nextDarkMode ? '#121212' : '#ffffff';
            document.body.appendChild(orb);

            let applied = false;
            const revealFinalTheme = () => {
                if (applied) return;
                applied = true;
                applyTheme();

                // Espera a que Angular y el navegador hayan pintado el tema
                // final antes de retirar la cubierta circular.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    orb.classList.add('is-fading');
                    window.setTimeout(() => {
                        orb.remove();
                        root.classList.remove('sir-theme-switching');
                    }, 160);
                }));
            };

            orb.addEventListener('transitionend', (transitionEvent) => {
                if (transitionEvent.propertyName === 'transform') revealFinalTheme();
            });
            requestAnimationFrame(() => requestAnimationFrame(() => orb.classList.add('is-active')));
            window.setTimeout(revealFinalTheme, 650);
            return;
        }

        root.classList.add('sir-theme-switching');

        // El callback debe terminar de inmediato: mientras está pendiente, la
        // View Transition mantiene congelada la captura anterior y el navegador
        // puede impedir que requestAnimationFrame llegue a ejecutarse.
        const transition = startViewTransition.call(document, applyTheme);

        const finishThemeSwitch = () => root.classList.remove('sir-theme-switching');

        transition.ready.then(() => {
            try {
                root.animate(
                    {
                        clipPath: [
                            `circle(0px at ${x}px ${y}px)`,
                            `circle(${radius}px at ${x}px ${y}px)`,
                        ],
                    },
                    {
                        duration: 560,
                        easing: 'cubic-bezier(.22,.75,.2,1)',
                        fill: 'both',
                        pseudoElement: '::view-transition-new(root)',
                    }
                );
            } catch {
                // El tema ya quedó aplicado; solo evitamos dejar bloqueado el
                // control si el navegador no admite animar el pseudo-elemento.
                finishThemeSwitch();
            }
        }, finishThemeSwitch);

        transition.finished.then(finishThemeSwitch, finishThemeSwitch);
    }

    async handleLogout(): Promise<void> {
        this.closeProfileMenu();

        const bar = this.topbarBar?.nativeElement;
        if (!bar) {
            this.finishLogout();
            return;
        }

        // Captura el rectángulo real antes de sacar la isla del flujo.
        const rect = bar.getBoundingClientRect();
        this.logoutStartRect.set({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        });
        this.transitionStage.set('island');
        this.transitionService.requestExpandToFullscreen();

        // Secuencia explícita: isla centrada → 100% del ancho → 100% de
        // la altura. Cada etapa espera su propia propiedad CSS.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.transitionStage.set('wide');
            this.afterTopbarTransition(['width', 'left'], () => {
                this.transitionStage.set('fullscreen');
                this.afterTopbarTransition(['height', 'top'], () => this.finishLogout());
            });
        }));
    }

    /** Finaliza el logout cuando la isla ya cubre el viewport. */
    private finishLogout(): void {
        this.userService.clearUser();
        this.notifications.clear();
        this.authService.logout();
        this.user.set(null);
        this.avatarUrl.set(null);
        this.router.navigateByUrl('/');
        this.transitionStage.set('fullscreen');
        this.transitionService.markLoginReady();
    }

    private getFallbackIslandRect(): { top: number; left: number; width: number; height: number } {
        const viewportWidth = window.innerWidth;
        const mobile = viewportWidth <= 766;
        const width = mobile
            ? Math.max(220, viewportWidth - 20)
            : Math.min(620, Math.max(320, viewportWidth - 30));
        const height = mobile ? 52 : 56;

        return {
            top: 10,
            left: Math.max(0, (viewportWidth - width) / 2),
            width,
            height,
        };
    }

    private afterTopbarTransition(properties: string[], callback: () => void): void {
        const bar = this.topbarBar?.nativeElement;
        if (!bar || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            callback();
            return;
        }

        let completed = false;
        const finish = () => {
            if (completed) return;
            completed = true;
            bar.removeEventListener('transitionend', onTransitionEnd);
            if (this.transitionFallbackTimer) window.clearTimeout(this.transitionFallbackTimer);
            this.transitionFallbackTimer = undefined;
            callback();
        };
        const onTransitionEnd = (event: TransitionEvent) => {
            if (event.target === bar && properties.includes(event.propertyName)) {
                finish();
            }
        };

        bar.addEventListener('transitionend', onTransitionEnd);
        this.transitionFallbackTimer = window.setTimeout(finish, 650);
    }


    // ── Búsqueda global ──
    openGlobalSearch(): void {
        this.closeProfileMenu();
        this.search.openSearch();
    }
    closeGlobalSearch(): void { this.search.closeSearch(); }
    onTopbarSearchInput(event: Event): void {
        this.search.updateQuery((event.target as HTMLInputElement).value);
    }
    submitTopbarSearch(): void {
        const query = this.searchQuery().trim();
        if (query) this.search.searchGlobal(query);
    }
    showSystemEvent(payload: any): void { this.systemEvent.set(payload); }


    // ── Novedades ────────────────────────────────────────────────
    openAppUpdates(): void { this.drawer.openAppUpdates(); }
    openNotifications(): void { this.drawer.openNotifications(); }

    isClientUser(): boolean {
        return this.permisosService.esCliente();
    }

    isAdvisorUser(): boolean {
        return String(this.permisosService.getRoleSnapshot() || '').trim().toLocaleLowerCase('es-CO') === 'asesor';
    }

    isAdministratorUser(): boolean {
        return String(this.permisosService.getRoleSnapshot() || '').trim().toLocaleLowerCase('es-CO') === 'administrador';
    }

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
            if (this.activeMenu()) this.closeAllSubmenus();
        }
    }

    @HostListener('document:click', ['$event'])
    handleDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (this.profileMenuOpen() && !target?.closest('.topbar-profile')) {
            this.closeProfileMenu();
        }
        if (
            this.globalSearchOpen()
            && !target?.closest('.topbar-search-mode')
            && !target?.closest('.topbar-expanded--search')
            && !target?.closest('[data-global-search-trigger]')
        ) {
            this.closeGlobalSearch();
        }
        if (this.activeMenu() && !target?.closest('.sidebar-navigation')) {
            this.closeAllSubmenus();
        }
    }

    @HostListener('window:resize')
    handleWindowResize(): void {
        this.syncTopbarWidth();
    }


    // ── Helpers privados ─────────────────────────────────────────

    private extractTitle(docTitle: string): string {
        // "SIR · Nueva Reserva" → "Nueva Reserva"
        const parts = docTitle.split('·');
        return parts.length > 1 ? parts[parts.length - 1].trim() : docTitle.trim();
    }

    private startNavigationMotion(pathChanged: boolean): void {
        if (!this.showAppChrome()) return;
        if (this.titleMotionTimer) window.clearTimeout(this.titleMotionTimer);

        this.finishRouteActivity?.();
        this.finishRouteActivity = this.activity.begin();

        if (pathChanged) {
            this.titleEntering.set(false);
            this.titleLeaving.set(true);
        }
    }

    private finishNavigationMotion(titleChanged: boolean): void {
        this.finishRouteActivity?.();
        this.finishRouteActivity = undefined;
        this.titleLeaving.set(false);

        if (titleChanged) {
            this.titleEntering.set(false);
            requestAnimationFrame(() => {
                this.titleEntering.set(true);
                this.titleMotionTimer = window.setTimeout(() => this.titleEntering.set(false), 320);
            });
            queueMicrotask(() => this.syncTopbarWidth());
        }

    }

    private refreshAvatar(): void {
        this.usuariosService.getMiPerfil().subscribe({
            next: (perfil: any) => this.avatarUrl.set(perfil?.Avatar || null),
            error: () => this.avatarUrl.set(null),
        });
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
            icon: 'bx bxs-home',
            group: 'principal',
            route: '/',
            exact: true,
            clientVisible: true,
        },
        {
            key: 'mi-horario',
            label: 'Mi horario',
            icon: 'bx bx-time-five',
            group: 'principal',
            route: '/MiHorario',
            exact: true,
            advisorVisible: true,
        },
        {
            key: 'aforos',
            label: 'Aforos',
            icon: 'bx bxs-dashboard',
            group: 'principal',
            route: '/Aforos',
            permission: ['AFOROS.LEER', 'INICIO.LEER'],
            exact: true,
        },
        {
            key: 'informes',
            label: 'Informes',
            icon: 'bx bx-line-chart',
            group: 'principal',
            route: '/Informes',
            permission: 'INFORMES.LEER',
            exact: true,
        },
        {
            key: 'historial',
            label: 'Historial',
            icon: 'bx bx-history',
            group: 'principal',
            route: '/Historial',
            permission: 'HISTORIAL.LEER',
            exact: true,
        },
        {
            key: 'reservas',
            label: 'Reservas',
            icon: 'bx bx-calendar',
            group: 'operacion',
            clientVisible: true,
            children: [
                {
                    key: 'reservas-nueva',
                    label: 'Nueva Reserva',
                    icon: 'bx bx-calendar-event',
                    kind: 'action',
                    route: '/Reservas/NuevaReserva',
                    permission: 'RESERVAS.CREAR',
                    exact: true,
                    clientVisible: true,
                },
                {
                    key: 'reservas-ver',
                    label: 'Ver Reservas',
                    icon: 'bx bx-list-ul',
                    route: '/Reservas/VerReservas',
                    permission: 'RESERVAS.LEER',
                    exact: true,
                    clientVisible: true,
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
            group: 'operacion',
            children: [
                {
                    key: 'transfers-nuevo',
                    label: 'Nuevo Transfer',
                    icon: 'bx bx-car',
                    kind: 'action',
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
            group: 'operacion',
            children: [
                {
                    key: 'tours-nuevo',
                    label: 'Nuevo Tour',
                    icon: 'bx bx-flag',
                    kind: 'action',
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
            group: 'operacion',
            children: [
                {
                    key: 'puntos-nuevo',
                    label: 'Nuevo Punto',
                    icon: 'bx bx-map-pin',
                    kind: 'action',
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
            group: 'gestion',
            route: '/Programacion',
            permission: 'PROGRAMACION.LEER',
            exact: false,
        },
        {
            key: 'seguros',
            label: 'Seguros',
            icon: 'bx bx-shield',
            group: 'gestion',
            route: '/Seguros',
            permission: 'SEGUROS.LEER',
            exact: true,
        },
         {
            key: 'comisiones',
            label: 'Comisiones',
            icon: 'bx bx-dollar',
            group: 'gestion',
            route: '/Comisiones',
            permission: 'COMISIONES.LEER',
            exact: true,
        },
        {
            key: 'configuracion',
            label: 'Configuración',
            icon: 'bx bx-cog',
            group: 'sistema',
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
                    icon: 'bx bx-user',
                    kind: 'action',
                    route: '/Usuarios/NuevoUsuario',
                    permission: 'USUARIOS.CREAR',
                    exact: true,
                },
                {
                    key: 'turnos-asesores',
                    label: 'Turnos de asesores',
                    icon: 'bx bx-time-five',
                    route: '/Turnos',
                    permission: 'TURNOS.LEER',
                    exact: true,
                    adminVisible: true,
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

    getActionChildren(item: SidebarItem): SidebarItem[] {
        return this.getVisibleChildren(item).filter(child => child.kind === 'action');
    }

    getNavigationChildren(item: SidebarItem): SidebarItem[] {
        return this.getVisibleChildren(item).filter(child => child.kind !== 'action');
    }

    getContextMenuItem(): SidebarItem | null {
        const key = this.activeMenu();
        if (!key) return null;
        return this.getVisibleMenuItems().find(item => item.key === key && this.shouldRenderAsDropdown(item)) ?? null;
    }

    startsMenuGroup(item: SidebarItem): boolean {
        const items = this.getVisibleMenuItems();
        const index = items.findIndex(candidate => candidate.key === item.key);
        return index > 0 && items[index - 1].group !== item.group;
    }

    getSingleVisibleChild(item: SidebarItem): SidebarItem | null {
        const [child] = this.getVisibleChildren(item);
        return child ?? null;
    }

    tienePermiso(permission?: string | string[]): boolean {
        if (!permission) return true;
        return Array.isArray(permission)
            ? this.permisosService.tieneAlgunPermiso(permission)
            : this.permisosService.tienePermiso(permission);
    }

    isVisibleItem(item: SidebarItem): boolean {
        if (this.isClientUser() && !item.clientVisible) return false;
        if (item.advisorVisible && !this.isAdvisorUser()) return false;
        if (item.adminVisible && !this.isAdministratorUser()) return false;
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
        this.hideRailTooltip();
        this.activeMenu.update(current => current === key ? null : key);
    }

    showRailTooltip(item: SidebarItem, event: Event): void {
        const target = event.currentTarget as HTMLElement | null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        this.railTooltipTop.set(rect.top + rect.height / 2);
        this.hoveredMenuItem.set(item);
    }

    hideRailTooltip(): void {
        this.hoveredMenuItem.set(null);
    }

    closeAllSubmenus(): void {
        this.activeMenu.set(null);
    }

    clickPage(): void {
        this.hideRailTooltip();
        this.closeAllSubmenus();
    }
}
