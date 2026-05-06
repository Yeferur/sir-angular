import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../services/Login/login-service';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css'
})
export class ForgotPasswordPageComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private navbar = inject(DynamicIslandGlobalService);

  submitting = false;
  message = '';
  error = '';

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  ngOnInit(): void {
    this.navbar.mode.set('');
  }

  submit(): void {
    this.message = '';
    this.error = '';
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    const email = String(this.form.value.email || '').trim();
    this.submitting = true;

    this.auth.forgotPassword(email).subscribe({
      next: (response) => {
        this.message = response?.message || 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
        this.submitting = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'No pudimos completar la solicitud en este momento.';
        this.submitting = false;
      }
    });
  }
}
