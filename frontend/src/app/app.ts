import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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

  private destroy$ = new Subject<void>();
  private wsStarted = false;

  constructor(
    public navbar: DynamicIslandGlobalService,
    public auth: AuthService,
    private ws: WebSocketService,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // ✅ 0) Cargar permisos guardados
    this.permisosService.cargarPermisosDesdeLocalStorage();

    // ✅ 1) Listener global de WS (UNA sola vez)
    this.ws.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg: any) => {
        const type = (msg?.type || '').toString();

        // ✅ Acepta ambos por compatibilidad
        const isForce = type === 'forceLogout' || type === 'force-logout';
        const isLogout = type === 'logout';

        if (isForce) {
          console.warn('🚪 Sesión cerrada remotamente.');

          this.navbar.alert.set({
            type: 'warning',
            title: 'Sesión Cerrada',
            message: 'Tu sesión fue cerrada en otro lugar o por un administrador.',
          });

          // ✅ Cierre ordenado
          setTimeout(() => {
            this.navbar.alert.set(null);
            this.ws.disconnect();
            this.auth.logout();
            this.permisosService.limpiarPermisos();
            this.wsStarted = false;
          }, 1500);

          return;
        }

        if (isLogout) {
          console.log('✅ Logout recibido por WS');
          this.ws.disconnect();
          this.auth.logout();
          this.permisosService.limpiarPermisos();
          this.wsStarted = false;
          return;
        }
      });

    // ✅ 2) Estado de autenticación (evita emisiones repetidas iguales)
    this.auth.isLoggedIn()
      .pipe(
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe((logged) => {
        this.loggedIn = logged;
        this.navbar.mode.set(logged ? '' : 'login');
        this.cdr.detectChanges();

        if (logged) {
          const token = this.auth.getToken();

          // ✅ Conectar WS una sola vez por sesión
          if (token && !this.wsStarted) {
            this.ws.connect(token);
            this.wsStarted = true;
          }

          // ✅ Cargar permisos/menú
          this.permisosService.obtenerMisPermisos().subscribe({
            error: (err) => console.error('Error al cargar permisos:', err)
          });

          this.permisosService.obtenerMiMenu().subscribe({
            error: (err) => console.error('Error al cargar menú:', err)
          });

        } else {
          // ✅ Cierre limpio
          this.ws.disconnect();
          this.permisosService.limpiarPermisos();
          this.wsStarted = false;
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
