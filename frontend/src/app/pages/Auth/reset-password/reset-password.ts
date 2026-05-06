import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/Login/login-service';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;

  if (!password || !confirmPassword) {
    return null;
  }

  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css'
})
export class ResetPasswordPageComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private navbar = inject(DynamicIslandGlobalService);
  private route = inject(ActivatedRoute);

  submitting = false;
  successMessage = '';
  error = '';
  token = '';

  form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]]
  }, { validators: passwordMatchValidator });

  ngOnInit(): void {
    this.navbar.mode.set('');
    this.token = String(this.route.snapshot.queryParamMap.get('token') || '').trim();

    if (!this.token) {
      this.error = 'El enlace de recuperación no es válido o ya expiró.';
    }
  }

  submit(): void {
    this.successMessage = '';
    this.error = '';
    this.form.markAllAsTouched();

    if (!this.token) {
      this.error = 'El enlace de recuperación no es válido o ya expiró.';
      return;
    }

    if (this.form.invalid) {
      return;
    }

    const password = String(this.form.value.password || '');
    this.submitting = true;

    this.auth.resetPassword(this.token, password).subscribe({
      next: (response) => {
        this.successMessage = response?.message || 'Contraseña actualizada correctamente.';
        this.form.disable();
        this.submitting = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'El enlace de recuperación no es válido o ya expiró.';
        this.submitting = false;
      }
    });
  }
}
