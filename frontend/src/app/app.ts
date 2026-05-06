import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet, Router, Event as RouterEvent, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { layout } from './layout/layout';
import { DynamicNavbarComponent } from './DynamicNavbar/global/global';
import { DynamicIslandGlobalService } from './services/DynamicNavbar/global';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/Login/login-service';
import { WebSocketService } from './services/WebSocket/web-socket';
import { PermisosService } from './services/Permisos/permisos.service';
import { Subject, takeUntil, distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, layout, DynamicNavbarComponent, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit, OnDestroy {
  loggedIn = false;
  publicAuthRoute = false;

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
    public navbar: DynamicIslandGlobalService,
    public auth: AuthService,
    private ws: WebSocketService,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  private isPublicAuthRoute(url: string): boolean {
    const normalizedUrl = url || '';
    return normalizedUrl.startsWith('/forgot-password') || normalizedUrl.startsWith('/reset-password');
  }

  private syncShellForUrl(url: string) {
    this.publicAuthRoute = this.isPublicAuthRoute(url);

    if (!this.loggedIn) {
      this.navbar.mode.set(this.publicAuthRoute ? '' : 'login');
      if (this.publicAuthRoute) {
        const currentAlert = this.navbar.alert();
        if (currentAlert) {
          this.navbar.alert.set(null);
        }
      }
    }

    this.cdr.markForCheck();
  }

  ngOnInit() {
    this.syncShellForUrl(this.router.url);

    this.router.events
      .pipe(takeUntil(this.destroy$))
      .subscribe((event: RouterEvent) => {
        if (event instanceof NavigationStart) {
          this.syncShellForUrl(event.url);
          if (!this.publicAuthRoute) {
            this.navbar.alert.set({
              type: 'info',
              loading: true,
              title: 'Cargando datos...'
            });
            this.cdr.markForCheck();
          }
        } else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          const url = event instanceof NavigationEnd ? event.urlAfterRedirects : this.router.url;
          this.syncShellForUrl(url);

          const currentAlert = this.navbar.alert();
          if (currentAlert?.loading) {
            this.navbar.alert.set(null);
            this.cdr.markForCheck();
          }
        }
      });

    this.permisosService.cargarPermisosDesdeLocalStorage();

    this.ws.systemEvents$
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg: any) => {
        if (this.isAdminForceLogoutEvent(msg)) {
          this.navbar.alert.set({
            type: 'warning',
            title: 'Sesión Cerrada',
            message: 'Tu sesión fue cerrada por un administrador.',
          });

          setTimeout(() => {
            this.navbar.alert.set(null);
            this.ws.disconnect();
            this.auth.clearLocalSession();
            this.permisosService.limpiarPermisos();
            this.wsStarted = false;
            this.cdr.markForCheck();
          }, 1500);

          return;
        }

        if (this.isSelfLogoutAllSessionsEvent(msg)) {
          this.navbar.alert.set({
            type: 'info',
            title: 'Sesión cerrada',
            message: 'Tu sesión fue cerrada en todos tus dispositivos.',
          });

          setTimeout(() => {
            this.navbar.alert.set(null);
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
        this.navbar.mode.set(logged ? '' : (this.publicAuthRoute ? '' : 'login'));
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

  get mode() {
    return this.navbar.mode();
  }
}
