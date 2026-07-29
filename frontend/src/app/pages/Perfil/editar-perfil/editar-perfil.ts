import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import {
  evaluateUserPassword,
  isUserPasswordStrong,
  normalizeUserName,
  USER_PHONE_REGEX,
} from '../../Usuarios/usuario-form.utils';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('NuevaContrasena')?.value;
  const confirmation = group.get('ConfirmarContrasena')?.value;
  if (!password && !confirmation) return null;
  return password === confirmation ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-editar-perfil',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingStateComponent],
  templateUrl: './editar-perfil.html',
  styleUrls: ['./editar-perfil.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditarPerfilComponent implements OnInit, OnDestroy {
  @ViewChild('avatarInput') avatarInput?: ElementRef<HTMLInputElement>;

  profileForm: FormGroup;
  passwordForm: FormGroup;

  isLoading = signal(true);
  loadError = signal('');
  isProfileSubmitting = signal(false);
  isPasswordSubmitting = signal(false);
  isUploadingAvatar = signal(false);
  isDeletingAvatar = signal(false);

  perfilActual = signal<any | null>(null);
  avatarActual = signal<string | null>(null);
  avatarPreview = signal<string | null>(null);
  avatarFileName = signal('');

  passwordChangeOpen = signal(false);
  passwordStrengthOpen = signal(false);
  showNewPassword = signal(false);
  showPasswordConfirmation = signal(false);
  passwordStrength = evaluateUserPassword('', true);

  private selectedAvatarFile: File | null = null;
  private avatarPreviewObjectUrl: string | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private usuariosService: UsuariosService,
    private alerts: SirAlertService,
    private cdr: ChangeDetectorRef,
  ) {
    this.profileForm = this.fb.group({
      Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
      Telefono_Usuario: ['', [Validators.required, Validators.pattern(USER_PHONE_REGEX)]],
      Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    });

    this.passwordForm = this.fb.group({
      ContrasenaActual: ['', [Validators.required]],
      NuevaContrasena: ['', [Validators.required]],
      ConfirmarContrasena: ['', [Validators.required]],
    }, { validators: passwordMatchValidator });
  }

  ngOnInit(): void {
    this.setupPasswordStrength();
    this.cargarPerfil();
  }

  ngOnDestroy(): void {
    this.revokeAvatarPreview();
    this.destroy$.next();
    this.destroy$.complete();
  }

  hasUnsavedChanges(): boolean {
    const requestInProgress =
      this.isProfileSubmitting()
      || this.isPasswordSubmitting()
      || this.isUploadingAvatar()
      || this.isDeletingAvatar();

    if (requestInProgress) return false;

    return this.profileForm.dirty
      || Boolean(this.selectedAvatarFile)
      || (this.passwordChangeOpen() && this.passwordForm.dirty);
  }

  profileControl(name: string): AbstractControl {
    return this.profileForm.get(name)!;
  }

  passwordControl(name: string): AbstractControl {
    return this.passwordForm.get(name)!;
  }

  profileMessage(name: string): string {
    const control = this.profileControl(name);
    if (!control.errors) return '';
    if (control.errors['required']) return 'Este campo es obligatorio.';
    if (control.errors['email']) return 'Ingresa un correo válido.';
    if (control.errors['minlength']) return `Mínimo ${control.errors['minlength'].requiredLength} caracteres.`;
    if (control.errors['maxlength']) return `Máximo ${control.errors['maxlength'].requiredLength} caracteres.`;
    if (control.errors['pattern'] && name === 'Telefono_Usuario') {
      return 'Ingresa entre 7 y 15 números.';
    }
    return 'Revisa este valor.';
  }

  cargarPerfil(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    this.usuariosService.getMiPerfil().subscribe({
      next: (perfil: any) => {
        this.perfilActual.set(perfil || null);
        this.avatarActual.set(perfil?.Avatar || null);
        this.clearAvatarSelection();
        this.cancelPasswordChange();

        this.profileForm.reset({
          Nombres_Apellidos: perfil?.Nombres_Apellidos || '',
          Telefono_Usuario: perfil?.Telefono_Usuario || '',
          Correo: perfil?.Correo || '',
        });
        this.profileForm.markAsPristine();
        this.isLoading.set(false);
        this.cdr.markForCheck();
      },
      error: (error: any) => {
        this.isLoading.set(false);
        this.loadError.set(error?.error?.message || 'No fue posible cargar tu perfil. Revisa tu conexión e inténtalo de nuevo.');
        this.cdr.markForCheck();
      },
    });
  }

  guardarDatosPersonales(): void {
    if (this.isProfileSubmitting()) return;

    this.profileForm.updateValueAndValidity({ emitEvent: false });
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.alerts.warningToast('Revisa tus datos', 'Corrige los campos marcados antes de guardar.');
      return;
    }

    if (!this.profileForm.dirty) {
      this.alerts.infoToast('Sin cambios', 'Tu información personal ya está actualizada.');
      return;
    }

    const values = this.profileForm.getRawValue();
    const payload = {
      Nombres_Apellidos: normalizeUserName(values.Nombres_Apellidos),
      Telefono_Usuario: values.Telefono_Usuario ? String(values.Telefono_Usuario).trim() : null,
      Correo: String(values.Correo || '').trim(),
    };

    this.alerts.confirm(
      'Guardar información personal',
      `Se actualizarán tu nombre y tus datos de contacto.\nCorreo: ${payload.Correo}`,
      () => this.ejecutarGuardadoDatos(payload),
      undefined,
      { type: 'info', confirmText: 'Guardar cambios' }
    );
  }

  private ejecutarGuardadoDatos(payload: {
    Nombres_Apellidos: string;
    Telefono_Usuario: string | null;
    Correo: string;
  }): void {
    this.isProfileSubmitting.set(true);
    this.cdr.markForCheck();

    this.usuariosService.actualizarMiPerfil(payload).subscribe({
      next: (perfilActualizado: any) => {
        const nextProfile = perfilActualizado || { ...this.perfilActual(), ...payload };
        this.perfilActual.set(nextProfile);
        this.profileForm.reset({
          Nombres_Apellidos: nextProfile.Nombres_Apellidos ?? payload.Nombres_Apellidos,
          Telefono_Usuario: nextProfile.Telefono_Usuario ?? payload.Telefono_Usuario,
          Correo: nextProfile.Correo ?? payload.Correo,
        });
        this.profileForm.markAsPristine();
        this.isProfileSubmitting.set(false);
        this.alerts.successToast('Perfil actualizado', 'Tu información personal se guardó correctamente.');
        this.cdr.markForCheck();
      },
      error: (error: any) => {
        this.isProfileSubmitting.set(false);
        this.alerts.errorToast('No pudimos guardar', error?.error?.message || 'No fue posible actualizar tu información.');
        this.cdr.markForCheck();
      },
    });
  }

  openPasswordChange(): void {
    this.passwordChangeOpen.set(true);
    this.passwordForm.reset();
    this.showNewPassword.set(false);
    this.showPasswordConfirmation.set(false);
    this.cdr.markForCheck();
  }

  cancelPasswordChange(): void {
    this.passwordChangeOpen.set(false);
    this.passwordStrengthOpen.set(false);
    this.showNewPassword.set(false);
    this.showPasswordConfirmation.set(false);
    this.passwordForm.reset();
    this.cdr.markForCheck();
  }

  guardarContrasena(): void {
    if (this.isPasswordSubmitting()) return;

    this.passwordForm.updateValueAndValidity({ emitEvent: false });
    this.passwordForm.markAllAsTouched();

    const values = this.passwordForm.getRawValue();
    if (this.passwordForm.invalid) {
      this.alerts.warningToast('Revisa la contraseña', 'Completa los campos y confirma que ambas contraseñas coincidan.');
      return;
    }

    if (!isUserPasswordStrong(values.NuevaContrasena)) {
      this.alerts.warningToast(
        'Contraseña todavía débil',
        'Incluye mayúscula, minúscula, número, símbolo y mínimo 8 caracteres.'
      );
      return;
    }

    this.alerts.confirm(
      'Actualizar contraseña',
      'Tu contraseña será reemplazada y las demás sesiones abiertas se cerrarán por seguridad.',
      () => this.ejecutarCambioContrasena(values),
      undefined,
      { type: 'warning', confirmText: 'Cambiar contraseña' }
    );
  }

  private ejecutarCambioContrasena(values: any): void {
    const savedProfile = this.perfilActual();
    if (!savedProfile) return;

    this.isPasswordSubmitting.set(true);
    this.cdr.markForCheck();

    this.usuariosService.actualizarMiPerfil({
      Nombres_Apellidos: String(savedProfile.Nombres_Apellidos || '').trim(),
      Telefono_Usuario: savedProfile.Telefono_Usuario ? String(savedProfile.Telefono_Usuario).trim() : null,
      Correo: String(savedProfile.Correo || '').trim(),
      Contrasena: String(values.NuevaContrasena),
      Contrasena_Actual: String(values.ContrasenaActual),
    }).subscribe({
      next: (perfilActualizado: any) => {
        if (perfilActualizado) this.perfilActual.set(perfilActualizado);
        this.isPasswordSubmitting.set(false);
        this.cancelPasswordChange();
        this.alerts.successToast('Contraseña actualizada', 'Tu nueva contraseña ya está activa.');
        this.cdr.markForCheck();
      },
      error: (error: any) => {
        this.isPasswordSubmitting.set(false);
        this.alerts.errorToast('No pudimos cambiarla', error?.error?.message || 'No fue posible actualizar la contraseña.');
        this.cdr.markForCheck();
      },
    });
  }

  openPasswordStrength(): void {
    this.passwordStrengthOpen.set(true);
  }

  closePasswordStrengthIfOutside(event: FocusEvent, wrapper: HTMLElement): void {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && wrapper.contains(next)) return;
    this.passwordStrengthOpen.set(false);
  }

  private setupPasswordStrength(): void {
    this.passwordControl('NuevaContrasena').valueChanges
      .pipe(startWith(''), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.passwordStrength = evaluateUserPassword(value || '', true);
        this.cdr.markForCheck();
      });
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      this.alerts.errorToast('Formato no compatible', 'Usa una imagen JPEG, PNG, WEBP o GIF.');
      input.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.alerts.errorToast('Imagen demasiado grande', 'La foto debe pesar máximo 5 MB.');
      input.value = '';
      return;
    }

    this.revokeAvatarPreview();
    this.selectedAvatarFile = file;
    this.avatarFileName.set(file.name);
    this.avatarPreviewObjectUrl = URL.createObjectURL(file);
    this.avatarPreview.set(this.avatarPreviewObjectUrl);
    input.value = '';
    this.cdr.markForCheck();
  }

  guardarAvatar(): void {
    if (!this.selectedAvatarFile || this.isUploadingAvatar()) return;

    this.isUploadingAvatar.set(true);
    const formData = new FormData();
    formData.append('avatar', this.selectedAvatarFile);

    this.usuariosService.uploadAvatar(formData).subscribe({
      next: (response: any) => {
        const newAvatarUrl = response?.Avatar || response?.data?.Avatar;
        this.avatarActual.set(newAvatarUrl || null);
        this.perfilActual.update((profile) => profile ? { ...profile, Avatar: newAvatarUrl || null } : profile);
        this.clearAvatarSelection();
        this.isUploadingAvatar.set(false);
        this.alerts.successToast('Foto actualizada', 'Tu nueva foto de perfil ya está visible.');
        this.cdr.markForCheck();
      },
      error: (error: any) => {
        this.isUploadingAvatar.set(false);
        this.alerts.errorToast('No pudimos subirla', error?.error?.message || 'No fue posible actualizar tu foto.');
        this.cdr.markForCheck();
      },
    });
  }

  discardAvatarSelection(): void {
    this.clearAvatarSelection();
    this.cdr.markForCheck();
  }

  eliminarAvatar(): void {
    if (this.isDeletingAvatar() || !this.avatarActual()) return;
    this.alerts.confirm(
      'Eliminar foto de perfil',
      'Se eliminará tu foto actual y volverán a mostrarse tus iniciales.',
      () => this.ejecutarEliminacionAvatar(),
      undefined,
      { type: 'warning', confirmText: 'Eliminar foto' }
    );
  }

  private ejecutarEliminacionAvatar(): void {
    this.isDeletingAvatar.set(true);
    this.usuariosService.deleteAvatar().subscribe({
      next: () => {
        this.avatarActual.set(null);
        this.perfilActual.update((profile) => profile ? { ...profile, Avatar: null } : profile);
        this.clearAvatarSelection();
        this.isDeletingAvatar.set(false);
        this.alerts.successToast('Foto eliminada', 'Ahora mostraremos tus iniciales.');
        this.cdr.markForCheck();
      },
      error: (error: any) => {
        this.isDeletingAvatar.set(false);
        this.alerts.errorToast('No pudimos eliminarla', error?.error?.message || 'No fue posible eliminar tu foto.');
        this.cdr.markForCheck();
      },
    });
  }

  getInitials(): string {
    const name = String(
      this.profileForm?.value?.Nombres_Apellidos
      || this.perfilActual()?.Nombres_Apellidos
      || ''
    ).trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return `${parts[0][0] || ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`
      .toLocaleUpperCase('es-CO');
  }

  private clearAvatarSelection(): void {
    this.revokeAvatarPreview();
    this.selectedAvatarFile = null;
    this.avatarPreview.set(null);
    this.avatarFileName.set('');
    if (this.avatarInput?.nativeElement) this.avatarInput.nativeElement.value = '';
  }

  private revokeAvatarPreview(): void {
    if (!this.avatarPreviewObjectUrl) return;
    URL.revokeObjectURL(this.avatarPreviewObjectUrl);
    this.avatarPreviewObjectUrl = null;
  }
}
