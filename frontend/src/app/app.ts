import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { layout } from './layout/layout';
import { DynamicNavbarComponent } from './DynamicNavbar/global/global';
import { DynamicIslandGlobalService } from './services/DynamicNavbar/global';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/Login/login-service';
import { WebSocketService } from './services/WebSocket/web-socket';
import { PermisosService } from './services/Permisos/permisos.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, layout, DynamicNavbarComponent, CommonModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App implements OnInit {
  loggedIn = false;

  constructor(
    public navbar: DynamicIslandGlobalService,
    public auth: AuthService,
    private ws: WebSocketService,
    private permisosService: PermisosService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    // 🚀 1️⃣ Suscripción que dura todo el ciclo de vida
    this.ws.messages$.subscribe((msg) => {
      // Logout forzado: un administrador cerró tu sesión
      if (msg.type === 'force-logout') {
        console.warn('🚪 Sesión cerrada remotamente por administrador.');

        this.navbar.alert.set({
          type: 'warning',
          title: 'Sesión Cerrada',
          message: 'Tu sesión fue cerrada por un administrador.',
        });

        setTimeout(() => {
          this.navbar.alert.set(null);
          this.auth.logout();
          this.permisosService.limpiarPermisos();
        }, 3000);
      }
      
      // Logout normal: el usuario cerró su propia sesión
      if (msg.type === 'logout') {
        console.log('✅ Sesión cerrada correctamente.');
        this.auth.logout();
        this.permisosService.limpiarPermisos();
      }
    });


    // 🚀 2️⃣ Suscripción al estado de autenticación
    this.auth.isLoggedIn().subscribe((logged) => {
      this.loggedIn = logged;
      this.navbar.mode.set(logged ? '' : 'login');
      this.cdr.detectChanges();

      // Si está logueado, conectar WebSocket y cargar permisos
      if (logged) {
        const token = this.auth.getToken();
        if (token) {
          this.ws.connect(token);
        }

        // Cargar permisos y menú del usuario
        this.permisosService.obtenerMisPermisos().subscribe({
          error: (err) => console.error('Error al cargar permisos:', err)
        });

        this.permisosService.obtenerMiMenu().subscribe({
          error: (err) => console.error('Error al cargar menú:', err)
        });
      } else {
        this.ws.disconnect();
        this.permisosService.limpiarPermisos();
      }
    });

    // Cargar permisos desde localStorage al iniciar (si existen)
    this.permisosService.cargarPermisosDesdeLocalStorage();
  }

  get mode() {
    return this.navbar.mode();
  }
}
