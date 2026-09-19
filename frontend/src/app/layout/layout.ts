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
    untracked,
    afterNextRender,
    Injector,
} from '@angular/core';
import {
    Router,
    RouterLink,
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
import { PendientesService } from '../services/Pendientes/pendientes.service';
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
    children?: SidebarItem[];
}


/* ─── Componente ───────────────────────────────────────────── */

@Component({
    selector: 'app-layout',
    standalone: true,
    imports: [
        RouterLink,
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
    readonly pendingCenter = inject(PendientesService);
    private webSocket = inject(WebSocketService);
    private injector = inject(Injector);

    // ── Señales del servicio global ──────────────────────────────
    globalSearchOpen = this.search.open;
    searchQuery = this.search.query;
    searchLoading = this.search.loading;
    searchClosing = signal(false);
    searchControlsRestoring = signal(false);
    readonly searchModeActive = computed(() =>
        this.globalSearchOpen() || (this.searchClosing() && !this.searchControlsRestoring())
    );
    readonly searchRestoreActive = computed(() => this.searchClosing() && this.searchControlsRestoring());

    // ── Estado local ─────────────────────────────────────────────
    user = signal<any>(null);
    avatarUrl = signal<string | null>(null);
    isDarkMode = true;
    profileMenuOpen = signal(false);
    navigationLauncherOpen = signal(false);
    createMenuOpen = signal(false);
    createMenuPosition = signal({ left: 10, top: 76 });
    profileMenuPosition = signal({ left: 10, top: 76 });
    pageTitle = signal<string>('');
    titleLeaving = signal(false);
    titleEntering = signal(false);
    readonly navigationActive = this.activity.visible;

    currentUrl = signal<string>(this.router.url);
    ready = signal(false);
    loadingError = signal<string | null>(null);
    systemEvent = signal<any>(null);
    topbarWidth = signal<number | null>(null);
    logoutStartRect = signal<{ top: number; left: number; width: number; height: number } | null>(null);
    transitionStage = signal<'island' | 'wide' | 'fullscreen'>('fullscreen');
    sessionCopyVisible = signal(false);
    sessionDetailsVisible = signal(false);
    chromeHandoffVisible = signal(false);
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
                subtitle: 'Tu sesión está lista.',
                microcopy: 'Preparando tu espacio de trabajo',
            };
        }

        return {
            kind: 'farewell' as const,
            title: firstName ? `Hasta pronto, ${firstName}` : 'Hasta pronto',
            subtitle: 'Cerrando tu sesión…',
            microcopy: 'Nos vemos pronto en Maxitours',
        };
    });
    readonly topbarFeedbackType = computed(() => {
        const toasts = this.alerts.toasts();
        return toasts.length ? toasts[toasts.length - 1].type : null;
    });

    @ViewChild('topbarBar') private topbarBar?: ElementRef<HTMLElement>;
    @ViewChild('topbarContent') private topbarContent?: ElementRef<HTMLElement>;
    @ViewChild('topbarSearchInput') private topbarSearchInput?: ElementRef<HTMLInputElement>;
    @ViewChild('navigationTrigger') private navigationTrigger?: ElementRef<HTMLButtonElement>;
    @ViewChild('createTrigger') private createTrigger?: ElementRef<HTMLButtonElement>;
    @ViewChild('profileTrigger') private profileTrigger?: ElementRef<HTMLButtonElement>;
    @ViewChild('navigationLauncher') private navigationLauncher?: ElementRef<HTMLElement>;
    @ViewChild('createMenu') private createMenu?: ElementRef<HTMLElement>;
    @ViewChild('profileMenu') private profileMenu?: ElementRef<HTMLElement>;

    private topbarResizeObserver?: ResizeObserver;

    private themeObserver?: MutationObserver;
    private routerSub?: Subscription;
    private sessionBeatTimer?: number;
    private transitionRun = 0;
    private idleTopbarWidth: number | null = null;
    private searchWasOpen = false;
    private searchRestoreTimer?: number;
    private searchTransitionCleanup?: () => void;
    private searchTransitionRun = 0;
    private finishRouteActivity?: () => void;
    private titleMotionTimer?: number;
    private notificationEventSub?: Subscription;
    private authNotificationSub?: Subscription;

    private readonly topbarStateEffect = effect(() => {
        this.topbarState();
        queueMicrotask(() => this.syncTopbarWidth());
    });

    private readonly searchFocusEffect = effect((onCleanup) => {
        if (!this.globalSearchOpen()) return;
        const timer = window.setTimeout(() => this.topbarSearchInput?.nativeElement.focus(), 180);
        onCleanup(() => window.clearTimeout(timer));
    });

    private readonly loginTargetEffect = effect(() => {
        if (this.transitionService.phase() === 'login') {
            this.transitionStage.set('fullscreen');
        }
    });

    private readonly collapseEffect = effect(() => {
        // IMPORTANTE: este effect debe depender únicamente de la fase.
        // Las señales que mutamos durante la coreografía (logoutStartRect,
        // topbarWidth, etc.) se leen/escriben fuera del tracking para evitar
        // reiniciar la transición mientras sigue en `collapsing`.
        if (this.transitionService.phase() !== 'collapsing') return;
        untracked(() => this.beginLoginCollapse());
    });

    private beginLoginCollapse(): void {
        const run = ++this.transitionRun;

        this.user.set(this.authService.getUser());
        this.refreshAvatar();

        if (!this.logoutStartRect()) {
            this.logoutStartRect.set(this.getFallbackIslandRect());
        }

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!this.isTransitionRunActive(run, 'collapsing')) return;

            const content = this.topbarContent?.nativeElement;
            if (content) {
                const target = this.getFallbackIslandRect();
                if (window.innerWidth > 766) {
                    target.width = Math.min(content.scrollWidth + 30, window.innerWidth - 30);
                    target.left = (window.innerWidth - target.width) / 2;
                }
                this.logoutStartRect.set(target);
                this.topbarWidth.set(target.width);
            }

            void this.runLoginTransition(run);
        }));
    }

    private async runLoginTransition(run: number): Promise<void> {
        try {
            this.chromeHandoffVisible.set(false);
            this.sessionCopyVisible.set(true);
            this.sessionDetailsVisible.set(true);

            await this.waitForBeat(620, run);
            if (!this.isTransitionRunActive(run, 'collapsing')) return;

            // El mensaje pertenece al estado fullscreen. Al empezar a volver
            // a una barra de 56px se desvanece inmediatamente, en paralelo a
            // fullscreen → wide. Así nunca queda texto grande recortado dentro
            // de la barra compacta.
            this.sessionDetailsVisible.set(false);
            this.sessionCopyVisible.set(false);
            this.transitionStage.set('wide');

            await this.waitForTopbarTransition(['height', 'top'], 520, run);
            if (!this.isTransitionRunActive(run, 'collapsing')) return;

            // Sin pausa entre etapas. El chrome real empieza el handoff antes
            // de que termine wide → island para que la barra nunca quede vacía.
            this.transitionStage.set('island');
            window.setTimeout(() => {
                if (this.isTransitionRunActive(run, 'collapsing')) {
                    this.chromeHandoffVisible.set(true);
                }
            }, this.prefersReducedMotion() ? 0 : 230);

            await this.waitForTopbarTransition(['width', 'left'], 430, run);
            if (!this.isTransitionRunActive(run, 'collapsing')) return;

            this.completeLoginTransition(run);
        } catch (error) {
            console.error('Topbar login transition failed:', error);
            // Si la ejecución sigue siendo la vigente, cerramos la coreografía
            // de forma segura en vez de dejar la app atrapada en `collapsing`.
            this.completeLoginTransition(run);
        }
    }

    private completeLoginTransition(run: number): void {
        if (!this.isTransitionRunActive(run, 'collapsing')) return;

        this.transitionStage.set('island');
        this.chromeHandoffVisible.set(true);
        this.sessionDetailsVisible.set(false);
        this.sessionCopyVisible.set(false);
        this.logoutStartRect.set(null);

        // phase='app' es la única señal que debe montar el shell privado.
        this.transitionService.markAppReady();
        void this.router.navigateByUrl('/');
        queueMicrotask(() => this.syncTopbarWidth());
    }


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
            this.permisosService.permisos$,
        ]).pipe(
            distinctUntilChanged(([prevLogged, prevPermissions], [nextLogged, nextPermissions]) => (
                prevLogged === nextLogged && prevPermissions.join('|') === nextPermissions.join('|')
            )),
        ).subscribe(([loggedIn]) => this.syncNotificationSession(loggedIn));

        // Título de la página desde datos de ruta. También mantiene
        // currentUrl al día siempre (con o sin sesión) — showAuthSlot
        // lo necesita para saber si estamos en /reset-password.
        this.routerSub = this.router.events.subscribe(event => {
            if (event instanceof NavigationStart) {
                this.closeTopbarMenus();
                this.closeProfileMenu();
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

            await this.permisosService.loadSessionData({ forceBackend: true });
            this.ready.set(true);
        } catch (e: any) {
            console.error('Layout init error:', e);
            this.loadingError.set('No se pudieron cargar permisos');
            this.ready.set(true);
        }
    }

    ngAfterViewInit(): void {
        this.syncTopbarWidth();
        this.topbarResizeObserver = new ResizeObserver(() => this.positionSmallMenu());
        if (this.topbarBar) this.topbarResizeObserver.observe(this.topbarBar.nativeElement);

        // Reintento tras cargar fuentes (Boxicons). La primera medición
        // de scrollWidth puede ocurrir antes de que la fuente de íconos
        // tenga su tamaño final, dejando la isla fijada más angosta de
        // lo necesario y recortando contenido con el overflow:hidden.
        if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
            (document as any).fonts.ready.then(() => this.syncTopbarWidth());
        }

    }

    ngOnDestroy(): void {
        this.topbarResizeObserver?.disconnect();
        this.themeObserver?.disconnect();
        this.routerSub?.unsubscribe();
        this.authNotificationSub?.unsubscribe();
        this.notificationEventSub?.unsubscribe();
        if (this.sessionBeatTimer) window.clearTimeout(this.sessionBeatTimer);
        if (this.searchRestoreTimer) window.clearTimeout(this.searchRestoreTimer);
        this.searchTransitionCleanup?.();
        this.transitionRun++;
        this.finishRouteActivity?.();
        if (this.titleMotionTimer) window.clearTimeout(this.titleMotionTimer);
    }

    private syncNotificationSession(loggedIn: boolean): void {
        this.notificationEventSub?.unsubscribe();
        this.notificationEventSub = undefined;

        if (!loggedIn) {
            this.notifications.clear();
            this.pendingCenter.clear();
            return;
        }

        if (this.permisosService.tienePermiso('PENDIENTES.LEER')) {
            this.pendingCenter.loadCount();
        } else {
            this.pendingCenter.clear();
        }

        if (!this.permisosService.tienePermiso('NOTIFICACIONES.LEER')) {
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
            if (!bar || !content || !this.showAppChrome()) return;
            if (this.globalSearchOpen()) {
                if (!this.searchWasOpen) {
                    this.idleTopbarWidth = this.topbarWidth() || Math.ceil(bar.getBoundingClientRect().width);
                    this.searchWasOpen = true;
                }
                const available = Math.max(220, window.innerWidth - 30);
                const compact = window.innerWidth <= 766
                    ? available
                    : Math.min(available, Math.max(560, Math.min(680, this.idleTopbarWidth * .76)));
                this.topbarWidth.set(compact);
                return;
            }

            if (this.searchWasOpen) {
                // Durante el cierre explícito, closeGlobalSearch() es dueño de
                // la geometría hasta que termine la transición de width.
                if (this.searchClosing()) return;

                this.searchWasOpen = false;
                if (this.idleTopbarWidth != null) {
                    this.topbarWidth.set(Math.min(this.idleTopbarWidth, window.innerWidth - 30));
                }
                this.idleTopbarWidth = null;
                if (this.searchRestoreTimer) window.clearTimeout(this.searchRestoreTimer);
                this.searchRestoreTimer = window.setTimeout(() => this.syncTopbarWidth(), 400);
                return;
            }

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
        const shouldOpen = !this.profileMenuOpen();
        this.closeNavigationLauncher();
        this.closeCreateMenu();
        this.closeGlobalSearch();
        this.profileMenuOpen.set(shouldOpen);
        if (shouldOpen) this.focusFirstInteractive('profile');
    }

    closeProfileMenu(restoreFocus = false): void {
        if (!this.profileMenuOpen()) return;
        this.profileMenuOpen.set(false);
        if (restoreFocus) this.profileTrigger?.nativeElement.focus();
    }

    onBrandClick(): void {
        this.closeProfileMenu();
        this.closeTopbarMenus();
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
        if (!this.showAppChrome()) return;
        this.closeProfileMenu();
        this.closeTopbarMenus();
        this.closeGlobalSearch();

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

        this.sessionCopyVisible.set(false);
        this.sessionDetailsVisible.set(false);
        this.chromeHandoffVisible.set(true);
        const run = ++this.transitionRun;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            void this.runLogoutTransition(run);
        }));
    }

    private async runLogoutTransition(run: number): Promise<void> {
        // Crossfade corto: marca real → marca centrada de transición.
        await this.waitForBeat(150, run);
        if (!this.isTransitionRunActive(run, 'expanding')) return;
        this.chromeHandoffVisible.set(false);
        this.transitionStage.set('wide');
        await this.waitForTopbarTransition(['width', 'left'], 430, run);
        if (!this.isTransitionRunActive(run, 'expanding')) return;

        this.transitionStage.set('fullscreen');
        await this.waitForTopbarTransition(['height', 'top'], 520, run);
        if (!this.isTransitionRunActive(run, 'expanding')) return;

        this.sessionCopyVisible.set(true);
        this.sessionDetailsVisible.set(true);
        await this.waitForBeat(900, run);
        if (!this.isTransitionRunActive(run, 'expanding')) return;
        this.sessionCopyVisible.set(false);
        this.sessionDetailsVisible.set(false);
        await this.waitForBeat(180, run);
        if (this.isTransitionRunActive(run, 'expanding')) this.finishLogout();
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

    private prefersReducedMotion(): boolean {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    private isTransitionRunActive(run: number, phase: 'collapsing' | 'expanding'): boolean {
        return run === this.transitionRun && this.transitionPhase() === phase;
    }

    private waitForBeat(duration: number, run: number): Promise<void> {
        return new Promise(resolve => {
            const timer = window.setTimeout(resolve, this.prefersReducedMotion() ? 0 : duration);
            if (run !== this.transitionRun) {
                window.clearTimeout(timer);
                resolve();
            }
        });
    }

    private waitForTopbarTransition(properties: string[], timeoutMs: number, run: number): Promise<void> {
        const bar = this.topbarBar?.nativeElement;
        if (!bar || this.prefersReducedMotion()) return Promise.resolve();

        return new Promise(resolve => {
            let completed = false;
            const finish = () => {
                if (completed) return;
                completed = true;
                bar.removeEventListener('transitionend', onTransitionEnd);
                window.clearTimeout(timer);
                resolve();
            };
            const onTransitionEnd = (event: TransitionEvent) => {
                if (run === this.transitionRun && event.target === bar && properties.includes(event.propertyName)) finish();
            };
            const timer = window.setTimeout(finish, timeoutMs);
            bar.addEventListener('transitionend', onTransitionEnd);
        });
    }


    // ── Búsqueda global ──
    openGlobalSearch(): void {
        this.searchTransitionRun++;
        this.searchTransitionCleanup?.();
        this.searchTransitionCleanup = undefined;
        this.closeProfileMenu();
        this.closeTopbarMenus();
        this.searchClosing.set(false);
        this.searchControlsRestoring.set(false);

        if (!this.globalSearchOpen()) {
            const bar = this.topbarBar?.nativeElement;
            this.idleTopbarWidth = this.topbarWidth()
                || (bar ? Math.ceil(bar.getBoundingClientRect().width) : null);
            this.searchWasOpen = true;
        }

        this.search.openSearch();
        queueMicrotask(() => this.syncTopbarWidth());
    }

    closeGlobalSearch(): void {
        if (!this.globalSearchOpen() || this.searchClosing()) return;

        const transitionRun = ++this.searchTransitionRun;
        this.searchTransitionCleanup?.();
        this.searchTransitionCleanup = undefined;

        const bar = this.topbarBar?.nativeElement;
        const fromWidth = bar?.getBoundingClientRect().width ?? this.topbarWidth() ?? 0;
        const targetWidth = this.idleTopbarWidth != null
            ? Math.min(this.idleTopbarWidth, window.innerWidth - 30)
            : fromWidth;

        // El panel de resultados se desmonta ya, pero mantenemos visualmente
        // el modo de búsqueda mientras la isla recupera su ancho. Así los
        // iconos normales nunca aparecen fuera de una barra todavía compacta.
        this.searchClosing.set(true);
        this.searchControlsRestoring.set(false);
        if (targetWidth > 0) this.topbarWidth.set(targetWidth);
        this.search.closeSearch();

        // Montar el chrome normal en el siguiente frame permite que la isla
        // empiece a recuperar su ancho con ambos estados presentes. La clase
        // de restauración mantiene el contenido estable mientras entra.
        requestAnimationFrame(() => {
            if (transitionRun === this.searchTransitionRun && this.searchClosing()) {
                this.searchControlsRestoring.set(true);
            }
        });

        const finish = () => {
            if (transitionRun !== this.searchTransitionRun) return;
            this.searchClosing.set(false);
            this.searchControlsRestoring.set(false);
            this.searchWasOpen = false;
            this.idleTopbarWidth = null;
            this.searchTransitionCleanup = undefined;
            queueMicrotask(() => this.syncTopbarWidth());
        };

        if (!bar || this.prefersReducedMotion() || Math.abs(fromWidth - targetWidth) < 1) {
            finish();
            return;
        }

        let completed = false;
        const done = () => {
            if (completed) return;
            completed = true;
            bar.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallback);
            finish();
        };
        const onEnd = (event: TransitionEvent) => {
            if (event.target === bar && event.propertyName === 'width') done();
        };
        const fallback = window.setTimeout(done, 430);
        bar.addEventListener('transitionend', onEnd);
        this.searchTransitionCleanup = () => {
            bar.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallback);
            completed = true;
            this.searchTransitionCleanup = undefined;
        };
    }
    onTopbarSearchInput(event: Event): void {
        this.search.updateQuery((event.target as HTMLInputElement).value);
    }
    submitTopbarSearch(): void {
        const query = this.searchQuery().trim();
        if (query) this.search.searchGlobal(query);
    }
    showSystemEvent(payload: any): void { this.systemEvent.set(payload); }


    // ── Novedades ────────────────────────────────────────────────
    openAppUpdates(): void {
        this.closeTopbarMenus();
        this.closeProfileMenu();
        this.drawer.openAppUpdates();
    }
    openNotifications(): void {
        this.closeTopbarMenus();
        this.closeProfileMenu();
        this.drawer.openNotifications();
    }

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
            if (this.navigationLauncherOpen()) {
                event.preventDefault();
                this.closeNavigationLauncher(true);
                return;
            }
            if (this.createMenuOpen()) {
                event.preventDefault();
                this.closeCreateMenu(true);
                return;
            }
            if (this.globalSearchOpen()) {
                if (editable && !target?.closest('app-global-search')) return;
                event.preventDefault();
                this.closeGlobalSearch();
            }
            if (this.profileMenuOpen()) {
                event.preventDefault();
                this.closeProfileMenu(true);
            }
        }
    }

    @HostListener('document:click', ['$event'])
    handleDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (this.profileMenuOpen() && !target?.closest('.profile-dropdown, [data-profile-trigger]')) {
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
        if (
            this.navigationLauncherOpen()
            && !target?.closest('.navigation-launcher')
            && !target?.closest('[data-navigation-trigger]')
        ) {
            this.closeNavigationLauncher();
        }
        if (
            this.createMenuOpen()
            && !target?.closest('.topbar-create-menu')
            && !target?.closest('[data-create-trigger]')
        ) {
            this.closeCreateMenu();
        }
    }

    @HostListener('window:resize')
    handleWindowResize(): void {
        this.syncTopbarWidth();
        this.positionSmallMenu();
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
            key: 'pendientes',
            label: 'Pendientes',
            icon: 'bx bx-list-check',
            group: 'principal',
            route: '/Pendientes',
            permission: ['PENDIENTES.LEER', 'RECORDATORIOS.LEER'],
            exact: true,
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
            key: 'control-viaje',
            label: 'Control de Viaje',
            icon: 'bx bx-check-shield',
            group: 'gestion',
            route: '/Reservas/Confirmacion',
            permission: 'CONTROL_VIAJE.LEER',
            exact: true,
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
                },
            ],
        },
    ];


    // ── Menú dinámico (permisos) ─────────────────────────────────

    getVisibleMenuItems(): SidebarItem[] {
        return this.menuItems.filter(item => this.isVisibleItem(item));
    }

    /** Pausas de lectura, nunca esperas de red ni bloqueos del hilo de UI. */
    private sessionBeat(duration: number, callback: () => void): void {
        if (this.sessionBeatTimer) window.clearTimeout(this.sessionBeatTimer);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.sessionBeatTimer = window.setTimeout(() => {
            this.sessionBeatTimer = undefined;
            if (this.transitionPhase() === 'collapsing' || this.transitionPhase() === 'expanding') callback();
        }, reduced ? 0 : duration);
    }

    getVisibleMenuItemsByGroup(group: NonNullable<SidebarItem['group']>): SidebarItem[] {
        return this.getVisibleMenuItems().filter(item => item.group === group);
    }

    getNavigationPanelWidth(): number {
        const items = this.getVisibleMenuItems();
        const groups = new Set(items.map(item => item.group)).size;
        const operationColumns = items.filter(item => item.group === 'operacion').length > 1 ? 2 : 1;
        // Las categorías ocultas por permisos no reservan ancho en el panel.
        return Math.min(1140, groups * 220 + (operationColumns - 1) * 220 + Math.max(0, groups - 1) * 16 + 32);
    }

    getCreateActions(): SidebarItem[] {
        return this.getVisibleMenuItems().flatMap(item =>
            this.getVisibleChildren(item).filter(child => child.kind === 'action' && !!child.route)
        );
    }

    getMenuDescription(item: SidebarItem): string {
        const descriptions: Record<string, string> = {
            inicio: 'Resumen general',
            'mi-horario': 'Turnos y jornada',
            pendientes: 'Recordatorios y tareas',
            aforos: 'Disponibilidad y cupos',
            informes: 'Análisis y reportes',
            historial: 'Actividad del sistema',
            programacion: 'Programación operativa',
            seguros: 'Vehículos, guías y conductores',
            comisiones: 'Pendientes por liquidar',
        };
        return descriptions[item.key] || '';
    }

    getVisibleChildren(item: SidebarItem): SidebarItem[] {
        return (item.children ?? []).filter(child => this.isVisibleItem(child));
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
        if (item.children?.length) {
            return this.tienePermiso(item.permission) &&
                this.getVisibleChildren(item).length > 0;
        }
        return this.tienePermiso(item.permission);
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

    // ── Navegación compacta del topbar ───────────────────────────

    toggleNavigationLauncher(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        const shouldOpen = !this.navigationLauncherOpen();
        this.closeCreateMenu();
        this.closeProfileMenu();
        this.closeGlobalSearch();
        this.navigationLauncherOpen.set(shouldOpen);
        if (shouldOpen) this.focusFirstInteractive('navigation');
    }

    closeNavigationLauncher(restoreFocus = false): void {
        if (!this.navigationLauncherOpen()) return;
        this.navigationLauncherOpen.set(false);
        if (restoreFocus) queueMicrotask(() => this.navigationTrigger?.nativeElement.focus());
    }

    toggleCreateMenu(event?: Event): void {
        event?.preventDefault();
        event?.stopPropagation();
        const shouldOpen = !this.createMenuOpen();
        this.closeNavigationLauncher();
        this.closeProfileMenu();
        this.closeGlobalSearch();
        this.createMenuOpen.set(shouldOpen);
        if (shouldOpen) this.focusFirstInteractive('create');
    }

    closeCreateMenu(restoreFocus = false): void {
        if (!this.createMenuOpen()) return;
        this.createMenuOpen.set(false);
        if (restoreFocus) this.createTrigger?.nativeElement.focus();
    }

    closeTopbarMenus(): void {
        this.closeNavigationLauncher();
        this.closeCreateMenu();
    }

    navigateFromTopbar(): void {
        this.closeTopbarMenus();
        this.closeProfileMenu();
    }

    trapPanelFocus(event: KeyboardEvent, container: HTMLElement): void {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(container.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(element => element.offsetParent !== null);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    handleSmallMenuKeydown(event: KeyboardEvent, container: HTMLElement, menu: 'create' | 'profile'): void {
        if (event.key === 'Tab' || event.key === 'Escape') {
            if (menu === 'create') this.closeCreateMenu(true);
            else this.closeProfileMenu(true);
            if (event.key === 'Escape') event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = this.getMenuItems(container);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0
            : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
    }

    private getMenuItems(container: HTMLElement): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
            .filter(element => element.offsetParent !== null);
    }

    private positionSmallMenu(): void {
        const trigger = this.createMenuOpen() ? this.createTrigger : this.profileMenuOpen() ? this.profileTrigger : null;
        const menu = this.createMenuOpen() ? this.createMenu : this.profileMenu;
        if (!trigger || !menu) return;
        const rect = trigger.nativeElement.getBoundingClientRect();
        const bar = this.topbarBar?.nativeElement.getBoundingClientRect();
        // offsetWidth no incluye el scale de la animación de apertura/cierre.
        const width = menu.nativeElement.offsetWidth;
        const position = this.createMenuOpen() ? this.createMenuPosition : this.profileMenuPosition;
        position.set({
            left: Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10)),
            top: (bar?.bottom ?? rect.bottom) + 10,
        });
    }

    private focusFirstInteractive(menu: 'navigation' | 'create' | 'profile'): void {
        afterNextRender(() => {
            const open = menu === 'navigation' ? this.navigationLauncherOpen()
                : menu === 'create' ? this.createMenuOpen() : this.profileMenuOpen();
            if (!open) return;
            this.positionSmallMenu();
            const container = menu === 'navigation' ? this.navigationLauncher
                : menu === 'create' ? this.createMenu : this.profileMenu;
            if (container) this.getMenuItems(container.nativeElement)[0]?.focus();
        }, { injector: this.injector });
    }

}
