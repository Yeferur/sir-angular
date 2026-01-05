import { Component, inject, Signal, signal, computed, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UserService } from '../services/userdata'; // Simulación del contexto
import { DynamicIslandGlobalService } from '../services/DynamicNavbar/global';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../services/Login/login-service';
import { PermisosService } from '../services/Permisos/permisos.service';
import { PermisoDirective } from '../shared/directives/permiso.directive';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, PermisoDirective, CommonModule],
  styleUrl: './layout.css',
  templateUrl: './layout.html',
})
export class layout {

  userService = inject(UserService);
  navbar: DynamicIslandGlobalService = inject(DynamicIslandGlobalService);
  permisosService = inject(PermisosService);
  
  constructor(private authService: AuthService, private http: HttpClient, router: Router) { }
  isSidebarOpen = signal(false);
  activeMenu = signal<number | null>(null);

  user = signal<any>(null);

  toggleSidebar() {
    this.isSidebarOpen.update(v => !v);
    // Limpiar estados del navbar al abrir/cerrar sidebar
    this.navbar?.alert?.set(null);
    this.navbar?.cuposInfo?.set(null);
    this.navbar?.Id_Reserva?.set(null);
  }

  toggleMenu(index: number) {
    this.activeMenu.update(current => current === index ? null : index);
  }

  closeAllSubmenus() {
    this.activeMenu.set(null);
  }

  handleLogout() {
    this.userService.clearUser();
    this.authService.logout();
  }

  isDarkMode = false;

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    const theme = this.isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    // Puedes guardar la preferencia si quieres:
    localStorage.setItem('theme', theme);
  }

  clickPage() {
    // Limpiar estados del navbar al cambiar de menú
    this.navbar?.alert?.set(null);
    this.navbar?.cuposInfo?.set(null);
    this.navbar?.Id_Reserva?.set(null);
  }

  ngOnInit() {
    this.user.set(this.authService.getUser());
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      this.isDarkMode = savedTheme === 'dark';
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }
}


