import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { PermisosService, MenuItem } from '../../../services/Permisos/permisos.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-dynamic-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
      <div class="container-fluid">
        <a class="navbar-brand" href="/">Sir Angular</a>
        
        <button class="navbar-toggler" type="button" (click)="toggleMenu()">
          <span class="navbar-toggler-icon"></span>
        </button>

        <div class="collapse navbar-collapse" [class.show]="menuOpen">
          <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
            <!-- Items del menú dinámico -->
            <li class="nav-item" *ngFor="let item of menuItems">
              <a class="nav-link" [routerLink]="[item.ruta]" (click)="menuOpen = false">
                <i [class]="'bi bi-' + item.icono"></i>
                {{ item.nombre }}
              </a>
            </li>

            <!-- Separador -->
            <li class="nav-item" *ngIf="menuItems.length > 0">
              <hr class="dropdown-divider">
            </li>

            <!-- Opciones de usuario -->
            <li class="nav-item dropdown">
              <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" (click)="$event.preventDefault()">
                <i class="bi bi-person-circle"></i>
                Usuario
              </a>
              <ul class="dropdown-menu dropdown-menu-end" [class.show]="userDropdownOpen">
                <li><a class="dropdown-item" href="#" (click)="irAPerfil($event)">Mi Perfil</a></li>
                <li><a class="dropdown-item" href="#" (click)="irAPermisos($event)">Mis Permisos</a></li>
                <li *ngIf="esAdmin"><hr class="dropdown-divider"></li>
                <li *ngIf="esAdmin"><a class="dropdown-item" href="#" (click)="irAAdministracion($event)">Administración</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" (click)="cerrarSesion($event)">Cerrar Sesión</a></li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  `,
  styles: [`
    .navbar {
      box-shadow: 0 2px 4px rgba(0,0,0,.1);
    }

    .navbar-brand {
      font-weight: bold;
      font-size: 1.3rem;
    }

    .nav-link {
      transition: color 0.3s ease;
      margin-right: 0.5rem;
    }

    .nav-link:hover {
      color: #0d6efd !important;
    }

    .nav-link i {
      margin-right: 0.5rem;
    }

    .dropdown-menu {
      border: 1px solid #dee2e6;
    }

    .dropdown-item {
      padding: 0.5rem 1rem;
    }

    .dropdown-item:hover {
      background-color: #f8f9fa;
      color: #0d6efd;
    }
  `]
})
export class DynamicNavbarComponent implements OnInit, OnDestroy {
  menuItems: MenuItem[] = [];
  esAdmin = false;
  menuOpen = false;
  userDropdownOpen = false;
  private destroy$ = new Subject<void>();

  constructor(
    private permisosService: PermisosService,
    private router: Router
  ) {}

  ngOnInit() {
    // Cargar menú
    this.permisosService.menu$
      .pipe(takeUntil(this.destroy$))
      .subscribe(menu => {
        this.menuItems = menu;
      });

    // Cargar permisos para detectar si es admin
    this.permisosService.permisos$
      .pipe(takeUntil(this.destroy$))
      .subscribe(permisos => {
        this.esAdmin = permisos.includes('USUARIOS.GESTIONAR_ROLES');
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
  }

  irAPerfil(event: Event) {
    event.preventDefault();
    this.menuOpen = false;
    this.router.navigate(['/perfil']);
  }

  irAPermisos(event: Event) {
    event.preventDefault();
    this.menuOpen = false;
    this.router.navigate(['/mis-permisos']);
  }

  irAAdministracion(event: Event) {
    event.preventDefault();
    this.menuOpen = false;
    this.router.navigate(['/administracion/permisos']);
  }

  cerrarSesion(event: Event) {
    event.preventDefault();
    localStorage.removeItem('auth_token');
    this.permisosService.limpiarPermisos();
    this.router.navigate(['/login']);
  }
}
