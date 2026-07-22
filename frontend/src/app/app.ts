import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject, signal, effect } from '@angular/core';
import { RouterOutlet, Router, Event as RouterEvent, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { SirAlertsHostComponent } from './components/alerts/alerts-host';
import {SirDrawerHostComponent} from "./components/drawer/drawer-host";
import { CommonModule } from '@angular/common';
import { AuthService } from './services/Login/login-service';
import { WebSocketService } from './services/WebSocket/web-socket';
import { PermisosService } from './services/Permisos/permisos.service';
import { Subject, takeUntil, distinctUntilChanged } from 'rxjs';
import { LayoutComponent } from './layout/layout';
import { SirAlertService } from './services/Alertas/alert.service';
import { TopbarTransitionService } from './components/login/topbar-transition.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LayoutComponent, SirAlertsHostComponent, SirDrawerHostComponent, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit, OnDestroy {
  loggedIn = false;
  publicAuthRoute = false;
  routeTransitioning = false;

  /**
   * Controla qué rama del template se muestra. Deliberadamente
   * separado de `loggedIn`: la coreografía isla↔login (ver
   * TopbarTransitionService) necesita que la animación de expansión
   * o colapso termine ANTES de que Angular desmonte/monte
   * Layout/Login, así que este signal solo cambia cuando la
   * transición avisa que terminó (o, en el arranque en frío / 
   * sin animación posible, por un fallback de sincronización).
   */
  viewLoggedIn = signal(false);

  private transition = inject(TopbarTransitionService);
  private viewGateBooted = false;
  private pendingViewSyncTimer: any;

  private readonly shellPhaseEffect = effect(() => {
    const phase = this.transition.phase();
    if (phase === 'app') this.viewLoggedIn.set(true);
    if (phase === 'login') this.viewLoggedIn.set(false);
    this.cdr.markForCheck();
  });

  private destroy$ = new Subject<void>();
  private wsStarted = false;

  private isAdminForceLogoutEvent(msg: any): boolean {
    const type = String(msg?.type || '');
    const reason = String(msg?.reason || '');
    return type === 'forceLogout' || type === 'force-logout' || type === 'adminForceLogout' || reason === 'admin_force_logout';
  }

  private isSelfLogoutAllSessionsEvent(msg: any): boolean {
    const type = String(msg?.type || '');
    const reason = String(msg?.reason || '');
    return type === 'selfLogoutAllSessions' || reason === 'self_logout_all_sessions';
  }

  private isCurrentSessionLogoutEvent(msg: any): boolean {
    const type = String(msg?.type || '');
    const reason = String(msg?.reason || '');
    return type === 'logout' || type === 'selfLogoutCurrentSession' || reason === 'self_logout_current_session';
  }

  constructor(
    public auth: AuthService,
    private ws: WebSocketService,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private alerts: SirAlertService
  ) {}

  private isPublicAuthRoute(url: string): boolean {
    const normalizedUrl = url || '';
    return normalizedUrl.startsWith('/reset-password');
  }

  private scheduleViewSync(target: boolean, graceMs: number): void {
    this.viewGateBooted = true;
    clearTimeout(this.pendingViewSyncTimer);

    if (!target) {
      this.viewLoggedIn.set(false);
      this.cdr.markForCheck();
      return;
    }

    if (!target) return;

    this.pendingViewSyncTimer = setTimeout(() => {
      this.viewLoggedIn.set(target);
      this.cdr.markForCheck();
    }, graceMs);
  }

  private syncShellForUrl(url: string) {
    this.publicAuthRoute = this.isPublicAuthRoute(url);

    if (!this.loggedIn && this.publicAuthRoute) {
      this.alerts.closeModal();
    }

    this.cdr.markForCheck();
  }

  ngOnInit() {
    this.syncShellForUrl(this.router.url);

    // Arranque en frío (carga directa / refresh): nadie va a llamar
    // completeLoginView/completeLogoutView porque no hubo un logout/login
    // interactivo que animar. A los 60ms, si el gate sigue sin "armar",
    // sincroniza viewLoggedIn directo con el loggedIn real y lo marca
    // como arrancado — de ahí en más todo cambio de loggedIn pasa por
    // la transición (ver scheduleViewSync).
    setTimeout(() => {
      if (this.viewGateBooted) return;
      this.viewGateBooted = true;
      this.viewLoggedIn.set(this.loggedIn);
      this.cdr.markForCheck();
    }, 60);

    this.router.events
      .pipe(takeUntil(this.destroy$))
      .subscribe((event: RouterEvent) => {
        if (event instanceof NavigationStart) {
          this.routeTransitioning = true;
          this.syncShellForUrl(event.url);
          if (this.loggedIn && !this.publicAuthRoute) {
            this.alerts.showLoading('Cargando datos...');
            this.cdr.markForCheck();
          }
        } else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          const url = event instanceof NavigationEnd ? event.urlAfterRedirects : this.router.url;
          this.routeTransitioning = false;
          this.syncShellForUrl(url);

          this.alerts.closeModal();
          this.cdr.markForCheck();
        }
      });

    this.permisosService.cargarPermisosDesdeLocalStorage();

    this.ws.systemEvents$
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg: any) => {
        if (this.isAdminForceLogoutEvent(msg)) {
          clearTimeout(this.pendingViewSyncTimer);
          this.viewLoggedIn.set(false);
          this.cdr.markForCheck();
          this.alerts.showAlert({
            type: 'warning',
            title: 'Sesión Cerrada',
            message: 'Tu sesión fue cerrada por un administrador.',
          });

          setTimeout(() => {
            this.alerts.closeModal();
            this.ws.disconnect();
            this.auth.clearLocalSession();
            this.permisosService.limpiarPermisos();
            this.wsStarted = false;
            this.cdr.markForCheck();
          }, 1500);

          return;
        }

        if (this.isSelfLogoutAllSessionsEvent(msg)) {
          clearTimeout(this.pendingViewSyncTimer);
          this.viewLoggedIn.set(false);
          this.cdr.markForCheck();
          this.alerts.showAlert({
            type: 'info',
            title: 'Sesión cerrada',
            message: 'Tu sesión fue cerrada en todos tus dispositivos.',
          });

          setTimeout(() => {
            this.alerts.closeModal();
            this.ws.disconnect();
            this.auth.clearLocalSession();
            this.permisosService.limpiarPermisos();
            this.wsStarted = false;
            this.cdr.markForCheck();
          }, 900);

          return;
        }

        if (this.isCurrentSessionLogoutEvent(msg)) {
          clearTimeout(this.pendingViewSyncTimer);
          this.viewLoggedIn.set(false);
          this.cdr.markForCheck();
          this.ws.disconnect();
          this.auth.clearLocalSession();
          this.permisosService.limpiarPermisos();
          this.wsStarted = false;
          this.cdr.markForCheck();
          return;
        }
      });

    this.auth.isLoggedIn()
      .pipe(distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((logged) => {
        this.loggedIn = logged;
        this.cdr.markForCheck();
        this.scheduleViewSync(logged, this.viewGateBooted ? 900 : 60);

        if (logged) {
          const token = this.auth.getToken();
          if (token && !this.wsStarted) {
            this.ws.connect(token);
            this.wsStarted = true;
          }
          this.permisosService.cargarPermisosDesdeLocalStorage();
        } else {
          this.ws.disconnect();
          this.permisosService.limpiarPermisos();
          this.wsStarted = false;
          this.cdr.markForCheck();
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.ws.disconnect();
  }
}