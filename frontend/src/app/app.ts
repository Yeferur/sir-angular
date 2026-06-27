import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet, Router, Event as RouterEvent, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { LoginContentComponent } from './components/login/login';
import { SirAlertsHostComponent } from './components/alerts/alerts-host';
import {SirDrawerHostComponent} from "./components/drawer/drawer-host";
import { CommonModule } from '@angular/common';
import { AuthService } from './services/Login/login-service';
import { WebSocketService } from './services/WebSocket/web-socket';
import { PermisosService } from './services/Permisos/permisos.service';
import { Subject, takeUntil, distinctUntilChanged } from 'rxjs';
import { LayoutComponent } from './layout/layout';
import { SirAlertService } from './services/Alertas/alert.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LayoutComponent, LoginContentComponent, SirAlertsHostComponent, SirDrawerHostComponent, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit, OnDestroy {
  loggedIn = false;
  publicAuthRoute = false;
  routeTransitioning = false;

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
    return normalizedUrl.startsWith('/forgot-password') || normalizedUrl.startsWith('/reset-password');
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
