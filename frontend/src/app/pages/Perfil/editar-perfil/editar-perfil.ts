import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, NgZone, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const pass = group.get('Contrasena')?.value;
  const confirm = group.get('ConfirmarContrasena')?.value;

  if (!pass && !confirm) return null;
  return pass === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-editar-perfil',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './editar-perfil.html',
  styleUrls: ['./editar-perfil.css'],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class EditarPerfilComponent implements OnInit {
  form: FormGroup;

  isLoading = signal(false);
  isSubmitting = signal(false);
  perfilActual = signal<any | null>(null);
  showPassword = signal(false);
  showConfirm = signal(false);

  // 🎥 Avatar signals
  avatarActual = signal<string | null>(null);
  avatarPreview = signal<string | null>(null);
  selectedAvatarFile: File | null = null;
  isUploadingAvatar = signal(false);
  isDeletingAvatar = signal(false);

  private readonly PHONE_REGEX = /^[0-9]{7,15}$/;

  constructor(
    private fb: FormBuilder,
    private usuariosService: UsuariosService,
    private navbar: DynamicIslandGlobalService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
  ) {
    this.form = this.fb.group(
      {
        Id_Usuario: [{ value: '', disabled: true }],
        Usuario: [{ value: '', disabled: true }],
        Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
        Telefono_Usuario: ['', [Validators.required, Validators.pattern(this.PHONE_REGEX)]],
        Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
        Contrasena: ['', [Validators.minLength(8)]],
        ConfirmarContrasena: [''],
      },
      { validators: passwordMatchValidator }
    );
  }

  ngOnInit(): void {
    this.cargarPerfil();
  }

  c(name: string): AbstractControl {
    return this.form.get(name)!;
  }

  msg(name: string): string {
    const ctrl = this.c(name);
    if (!ctrl.errors) return '';

    if (ctrl.errors['required']) return 'Este campo es obligatorio.';
    if (ctrl.errors['email']) return 'Correo invalido.';
    if (ctrl.errors['minlength']) return `Minimo ${ctrl.errors['minlength'].requiredLength} caracteres.`;
    if (ctrl.errors['maxlength']) return `Maximo ${ctrl.errors['maxlength'].requiredLength} caracteres.`;
    if (ctrl.errors['pattern'] && name === 'Telefono_Usuario') return 'Telefono invalido (7 a 15 digitos).';
    return 'Valor invalido.';
  }

  cargarPerfil(): void {
    this.isLoading.set(true);

    this.usuariosService.getMiPerfil().subscribe({
      next: (perfil: any) => {
        this.perfilActual.set(perfil || null);
        this.avatarActual.set(perfil?.Avatar || null);
        this.form.patchValue({
          Id_Usuario: perfil?.Id_Usuario || '',
          Usuario: perfil?.Usuario || '',
          Nombres_Apellidos: perfil?.Nombres_Apellidos || '',
          Telefono_Usuario: perfil?.Telefono_Usuario || '',
          Correo: perfil?.Correo || '',
          Contrasena: '',
          ConfirmarContrasena: '',
        });
        this.form.markAsPristine();
        this.isLoading.set(false);
      },
      error: (err: any) => {
        this.isLoading.set(false);
        this.navbar.errorToast('Error', err?.error?.message || 'No se pudo cargar tu perfil.');
      },
    });
  }

  guardar(): void {
    if (this.isSubmitting()) {
      return;
    }

    // ===== Validación del formulario ANTES de confirmar =====
    this.form.updateValueAndValidity({ emitEvent: false });
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
      const friendly: Record<string, string> = {
        Nombres_Apellidos: 'Nombre completo',
        Telefono_Usuario: 'Telefono',
        Correo: 'Correo',
        Contrasena: 'Contrasena',
        ConfirmarContrasena: 'Confirmar contrasena'
      };

      const fields = invalid.map(f => friendly[f] || f);
      const msg = fields.length
        ? `Revisa los siguientes campos: ${fields.join(', ')}`
        : 'Hay campos invalidos en el formulario.';

      this.navbar.alert.set({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
      });
      return;
    }

    const values = this.form.getRawValue();
    const payload: any = {
      Nombres_Apellidos: String(values.Nombres_Apellidos || '').trim(),
      Telefono_Usuario: values.Telefono_Usuario ? String(values.Telefono_Usuario).trim() : null,
      Correo: String(values.Correo || '').trim(),
    };

    if (values.Contrasena) {
      payload.Contrasena = String(values.Contrasena);
    }

    this.isSubmitting.set(true);

    this.usuariosService.actualizarMiPerfil(payload).subscribe({
      next: (perfilActualizado: any) => {
        this.perfilActual.set(perfilActualizado || { ...this.perfilActual(), ...payload });

        this.form.patchValue({
          Nombres_Apellidos: perfilActualizado?.Nombres_Apellidos ?? payload.Nombres_Apellidos,
          Telefono_Usuario: perfilActualizado?.Telefono_Usuario ?? payload.Telefono_Usuario,
          Correo: perfilActualizado?.Correo ?? payload.Correo,
          Contrasena: '',
          ConfirmarContrasena: '',
        });
        this.form.markAsPristine();

        if (this.selectedAvatarFile) {
          this.subirAvatar(this.selectedAvatarFile, () => {
            this.isSubmitting.set(false);
            this.navbar.successToast('Perfil actualizado', 'Tus datos y tu foto se guardaron correctamente.');
          }, () => {
            this.isSubmitting.set(false);
          });
          return;
        }

        this.isSubmitting.set(false);
        this.navbar.successToast('Perfil actualizado', 'Tus datos se guardaron correctamente.');
      },
      error: (err: any) => {
        this.isSubmitting.set(false);
        this.navbar.errorToast('Error', err?.error?.message || 'No se pudo actualizar tu perfil.');
      },
    });
  }

  // 🎥 AVATAR METHODS

  /**
   * Handle file selection and preview
  * - Lee archivo en base64 para preview local
  * - Guarda el archivo para subirlo al presionar "Guardar cambios"
   */
  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Validar tipo de archivo
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      this.navbar.errorToast('Tipo invalido', 'Solo se aceptan imágenes JPEG, PNG, WEBP o GIF');
      input.value = '';
      return;
    }

    // Validar tamaño (máximo 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      this.navbar.errorToast('Archivo muy grande', 'El archivo no puede ser mayor a 5MB');
      input.value = '';
      return;
    }

    // Guardar archivo para upload posterior al guardar perfil
    this.selectedAvatarFile = file;

    const reader = new FileReader();

    reader.onload = (loadEvent) => {
      this.ngZone.run(() => {
        const previewBase64 = loadEvent.target?.result as string;
        this.avatarPreview.set(previewBase64);
        this.cdr.detectChanges();
      });
    };

    reader.readAsDataURL(file);
  }

  /**
   * Upload avatar to server
   * - FormData con archivo
   * - Mantiene preview mientras se sube
   * - Actualiza avatarActual cuando llega respuesta
   */
  subirAvatar(file: File, onSuccess?: () => void, onError?: () => void): void {
    if (this.isUploadingAvatar()) {
      return;
    }

    this.isUploadingAvatar.set(true);

    const formData = new FormData();
    formData.append('avatar', file);

    this.usuariosService.uploadAvatar(formData).subscribe({
      next: (response: any) => {
        const newAvatarUrl = response?.Avatar || response?.data?.Avatar;

        this.avatarActual.set(newAvatarUrl);
        if (this.perfilActual()) {
          this.perfilActual.set({
            ...this.perfilActual(),
            Avatar: newAvatarUrl,
          });
        }

        this.avatarPreview.set(null);
        this.selectedAvatarFile = null;

        this.isUploadingAvatar.set(false);
        this.cdr.detectChanges();

        if (!onSuccess) {
          this.navbar.successToast('Foto subida', 'Tu avatar se actualizó correctamente.');
        }
        onSuccess?.();

        const input = document.querySelector('input[type="file"][name="avatarInput"]') as HTMLInputElement;
        if (input) input.value = '';
      },
      error: (err: any) => {
        this.isUploadingAvatar.set(false);
        this.navbar.errorToast('Error en carga', err?.error?.message || 'No se pudo subir la foto');
        onError?.();

        // Reset input file
        const input = document.querySelector('input[type="file"][name="avatarInput"]') as HTMLInputElement;
        if (input) {
          input.value = '';
        }
      },
    });
  }

  /**
   * Delete avatar from server
   * Muestra alerta de confirmación personalizada antes de eliminar
   */
  eliminarAvatar(): void {
    if (this.isDeletingAvatar() || !this.avatarActual()) {
      return;
    }

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar foto de perfil',
      message: '¿Estás seguro de que deseas eliminar tu foto de perfil? Esta acción no se puede deshacer.',
      autoClose: false,
      buttons: [
        {
          text: 'Eliminar',
          style: 'primary',
          onClick: () => {
            // Cerrar alerta y ejecutar eliminación
            this.navbar.alert.set(null);
            this.ejecutarEliminacionAvatar();
          }
        },
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => {
            this.navbar.alert.set(null);
          }
        }
      ]
    });
  }

  private ejecutarEliminacionAvatar(): void {
    this.isDeletingAvatar.set(true);

    this.usuariosService.deleteAvatar().subscribe({
      next: () => {
        this.isDeletingAvatar.set(false);
        this.avatarActual.set(null);
        this.avatarPreview.set(null);
        this.selectedAvatarFile = null;
        this.navbar.successToast('Foto eliminada', 'Tu foto de perfil fue eliminada.');
      },
      error: (err: any) => {
        this.isDeletingAvatar.set(false);
        this.navbar.errorToast('Error', err?.error?.message || 'No se pudo eliminar la foto');
      },
    });
  }

  /**
   * Get initials from full name
   */
  getInitials(): string {
    const perfil = this.perfilActual();
    if (!perfil?.Nombres_Apellidos) {
      return '?';
    }
    const parts = String(perfil.Nombres_Apellidos).trim().split(' ');
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }
}