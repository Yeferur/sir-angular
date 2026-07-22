import { Component, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/Login/login-service';
import { TopbarTransitionService } from './topbar-transition.service';

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
  recoveryOpen = false;
  recoveryEmail = '';
  recoveryMessage = '';
  recoveryResetUrl = '';
  recoveryError = '';
  recoverySubmitting = false;
  resetMode = false;
  resetToken = '';
  resetPassword = '';
  resetPasswordConfirmation = '';
  resetError = '';
  resetSuccess = '';
  resetSubmitting = false;
  resetPasswordStrength = this.evaluatePassword('');
  passwordStrengthOpen = false;
  private auth = inject(AuthService);
  private transition = inject(TopbarTransitionService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
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
        this.cdr.markForCheck();
        // La transición la controla el topbar real de LayoutComponent.
        this.transition.requestCollapseToApp();
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || err?.message || err?.error?.error || 'Usuario o contraseña incorrectos.';
        this.cdr.markForCheck();
      }
    });
  }

  toggleRecovery(): void { this.recoveryOpen = !this.recoveryOpen; }

  submitRecovery(): void {
    const email = this.recoveryEmail.trim();
    this.recoveryMessage = '';
    this.recoveryError = '';
    this.recoveryResetUrl = '';

    if (!email) {
      this.recoveryError = 'Ingresa un correo electrónico.';
      return;
    }

    this.recoverySubmitting = true;
    this.auth.forgotPassword(email).subscribe({
      next: (response) => {
        this.recoveryMessage = response?.message || 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
        this.recoveryResetUrl = response?.resetUrl || '';
        this.recoverySubmitting = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.recoveryError = 'No pudimos completar la solicitud en este momento.';
        this.recoverySubmitting = false;
        this.cdr.markForCheck();
      }
    });
  }

  submitReset(): void {
    this.resetError = '';
    this.resetSuccess = '';

    if (!this.resetToken) {
      this.resetError = 'El enlace de recuperación no es válido o ya expiró.';
      return;
    }

    if (this.resetPassword.length < 8) {
      this.resetError = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    if (!this.isResetPasswordStrongEnough()) {
      this.resetError = 'La contraseña debe incluir minúscula, mayúscula, número y símbolo.';
      return;
    }

    if (this.resetPassword !== this.resetPasswordConfirmation) {
      this.resetError = 'Las contraseñas no coinciden.';
      return;
    }

    this.resetSubmitting = true;
    this.auth.resetPassword(this.resetToken, this.resetPassword).subscribe({
      next: (response) => {
        this.resetSuccess = response?.message || 'Contraseña actualizada correctamente.';
        this.resetSubmitting = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.resetError = err?.error?.message || 'El enlace de recuperación no es válido o ya expiró.';
        this.resetSubmitting = false;
        this.cdr.markForCheck();
      }
    });
  }

  returnToLogin(): void {
    this.router.navigateByUrl('/');
  }

  updateResetPasswordStrength(value: string): void {
    this.resetPasswordStrength = this.evaluatePassword(String(value || ''));
  }

  openPasswordStrength(): void {
    this.passwordStrengthOpen = true;
    this.cdr.markForCheck();
  }

  closePasswordStrengthIfOutside(event: FocusEvent, wrap: HTMLElement): void {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && wrap.contains(next)) return;
    this.passwordStrengthOpen = false;
    this.cdr.markForCheck();
  }

  private evaluatePassword(pass: string) {
    const length8 = pass.length >= 8;
    const lower = /[a-z]/.test(pass);
    const upper = /[A-Z]/.test(pass);
    const digit = /\d/.test(pass);
    const symbol = /[^A-Za-z0-9]/.test(pass);
    const length12 = pass.length >= 12;
    const score = [length8, lower, upper, digit, symbol, length12].filter(Boolean).length;
    const label = score >= 5 ? 'Fuerte' : score >= 3 ? 'Media' : 'Débil';
    return { score, label, checks: { length8, lower, upper, digit, symbol, length12 } };
  }

  private isResetPasswordStrongEnough(): boolean {
    const checks = this.resetPasswordStrength.checks;
    return checks.length8 && checks.lower && checks.upper && checks.digit && checks.symbol;
  }

  ngOnInit(): void {
    this.resetMode = this.route.snapshot.routeConfig?.path === 'reset-password';
    this.resetToken = String(this.route.snapshot.queryParamMap.get('token') || '').trim();
    if (this.resetMode && !this.resetToken) {
      this.resetError = 'El enlace de recuperación no es válido o ya expiró.';
    }

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
