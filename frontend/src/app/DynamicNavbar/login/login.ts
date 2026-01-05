import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/Login/login-service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginContentComponent {
  // --- Propiedades del Componente ---
  username = '';
  password = '';
  error = '';
  isLoading = false;
  showPassword = false;

  // --- Inyección de Servicios ---
  private auth = inject(AuthService);
  private navbar = inject(DynamicIslandGlobalService);
  isDarkMode: boolean;

  /**
   * Maneja el envío del formulario de login.
   */
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
        // Al iniciar sesión correctamente, esperamos un momento para mostrar
        // una posible animación de éxito y luego cerramos la vista de login.
        setTimeout(() => {
          this.navbar.mode.set(''); // Vuelve al estado compacto de la navbar
        }, 1500);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err.error?.error || 'Usuario o contraseña incorrectos.';
      }
    });
  }

  ngOnInit(): void {
    // Lógica para detectar el tema (sin cambios)
    const theme = document.documentElement.getAttribute('data-theme');
    this.isDarkMode = theme !== 'light';
    const observer = new MutationObserver(() => {
      const updatedTheme = document.documentElement.getAttribute('data-theme');
      this.isDarkMode = updatedTheme !== 'light';
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
}

