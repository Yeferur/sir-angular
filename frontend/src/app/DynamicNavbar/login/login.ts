import { Component, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/Login/login-service';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { PermisosService } from '../../services/Permisos/permisos.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginContentComponent implements OnInit, OnDestroy {
  username = '';
  password = '';
  error = '';
  isLoading = false;
  showPassword = false;
  isDarkMode: boolean = true;

  private auth = inject(AuthService);
  private navbar = inject(DynamicIslandGlobalService);
  private permisosService = inject(PermisosService);
  private cdr = inject(ChangeDetectorRef);

  private observer?: MutationObserver;

  login() {
    this.error = '';

    if (!this.username || !this.password) {
      this.error = 'Por favor, complete todos los campos.';
      return;
    }

    this.isLoading = true;

    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.isLoading = false;
        this.permisosService.cargarPermisosDesdeLocalStorage();
        this.navbar.mode.set('');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.error || 'Usuario o contraseña incorrectos.';
        this.cdr.markForCheck();
      }
    });
  }

  ngOnInit(): void {
    const theme = document.documentElement.getAttribute('data-theme');
    this.isDarkMode = theme !== 'light';

    this.observer = new MutationObserver(() => {
      const updatedTheme = document.documentElement.getAttribute('data-theme');
      this.isDarkMode = updatedTheme !== 'light';
      this.cdr.markForCheck();
    });

    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
