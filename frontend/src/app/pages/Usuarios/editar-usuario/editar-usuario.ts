import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { PermisosService, Rol } from '../../../services/Permisos/permisos.service';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import {
    evaluateUserPassword,
    isUserPasswordStrong,
    normalizeUserName,
    USER_PHONE_REGEX,
} from '../usuario-form.utils';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
    const pass = group.get('Contrasena')?.value;
    const confirm = group.get('Confirmar')?.value;
    if (!pass && !confirm) return null; // Both empty is fine (no change)
    if (pass && !confirm) return { passwordMismatch: true };
    if (!pass && confirm) return { passwordMismatch: true };
    return pass === confirm ? null : { passwordMismatch: true };
}

@Component({
    selector: 'app-editar-usuario',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, UppercaseInputDirective, LoadingStateComponent],
    templateUrl: './editar-usuario.html',
    styleUrls: ['../usuario-shared.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditarUsuarioComponent implements OnInit, OnDestroy {
    form: FormGroup;
    userId: string | null = null;

    roles: Rol[] = [];
    permisos: any[] = [];
    selectedPermisos: number[] = [];

    isLoading = signal(false);
    catalogLoading = signal(false);
    isSubmitting = signal(false);
    private pendingLoads = 0;
    errorMsg = '';

    showPassword = false;
    showConfirm = false;
    passwordStrengthOpen = false;

    passwordStrength = {
        score: 0,
        label: 'Débil',
        checks: {
            length8: false,
            lower: false,
            upper: false,
            digit: false,
            symbol: false,
            length12: false
        }
    };

    private destroy$ = new Subject<void>();

    constructor(
        private fb: FormBuilder,
        private permisosService: PermisosService,
        private usuariosService: UsuariosService,
        private router: Router,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef,
        private alerts: SirAlertService
    ) {
        this.form = this.fb.group({
            Id_Usuario: [{ value: '', disabled: true }, [Validators.required]],
            Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
            Telefono_Usuario: ['', [Validators.required, Validators.pattern(USER_PHONE_REGEX)]],
            Usuario: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
            Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
            Contrasena: [''], // Optional
            Confirmar: [''], // Optional
            Id_Rol: ['', [Validators.required]],
            Activo: [1]
        }, { validators: passwordMatchValidator });
    }

    ngOnInit(): void {
        this.userId = this.route.snapshot.paramMap.get('id');
        if (!this.userId) {
            this.router.navigate(['/Usuarios']);
            return;
        }

        this.isLoading.set(true);
        this.catalogLoading.set(true);
        this.pendingLoads = 0;

        // Load dependencies and then user
        this.loadRoles();
        this.loadPermisos();

        // Setup password listener
        this.setupPasswordStrength();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    c(name: string): AbstractControl {
        return this.form.get(name)!;
    }

    msg(name: string): string {
        const ctrl = this.c(name);
        if (!ctrl.errors) return '';

        if (ctrl.errors['required']) return 'Este campo es obligatorio.';
        if (ctrl.errors['email']) return 'Correo inválido.';
        if (ctrl.errors['minlength']) return `Mínimo ${ctrl.errors['minlength'].requiredLength} caracteres.`;
        if (ctrl.errors['maxlength']) return `Máximo ${ctrl.errors['maxlength'].requiredLength} caracteres.`;
        if (ctrl.errors['pattern']) {
            if (name === 'Telefono_Usuario') return 'Teléfono inválido (solo números, 7 a 15 dígitos).';
            return 'Formato inválido.';
        }
        return 'Valor inválido.';
    }

    private navbar(type: 'error' | 'success' | 'info' | 'warning', title: string, message: string, loading = false, autoClose = true) {
        if (loading) {
            this.alerts.showLoading(title, message, { type, autoClose });
            return;
        }
        const toastByType = {
            error: () => this.alerts.errorToast(title, message),
            success: () => this.alerts.successToast(title, message),
            info: () => this.alerts.infoToast(title, message),
            warning: () => this.alerts.warningToast(title, message),
        } as const;

        toastByType[type]();
    }

    private loadRoles() {
        this.pendingLoads++;
        this.permisosService.obtenerRoles().subscribe({
            next: (r) => {
                this.roles = r.roles || [];
                this.checkLoadingFinish();
            },
            error: () => {
                this.roles = [];
                this.checkLoadingFinish();
            }
        });
    }

    private loadPermisos() {
        this.pendingLoads++;
        this.permisosService.obtenerPermisos().subscribe({
            next: (res) => {
                this.permisos = res.permisos || [];
                this.checkLoadingFinish();
            },
            error: () => {
                this.permisos = [];
                this.checkLoadingFinish();
            }
        });
    }

    private loadUsuario() {
        if (!this.userId) return;
        this.pendingLoads++;
        this.usuariosService.obtenerUsuario(this.userId).subscribe({
            next: (u) => {
                this.form.patchValue({
                    Id_Usuario: u.Id_Usuario,
                    Nombres_Apellidos: u.Nombres_Apellidos,
                    Telefono_Usuario: u.Telefono_Usuario,
                    Usuario: u.Usuario,
                    Correo: u.Correo,
                    Id_Rol: u.Id_Rol,
                    Activo: u.Activo
                });

                // Cargar permisos individuales
                this.selectedPermisos = (u.permisos || []).map((p: any) => Number(p?.Id_Permiso ?? p));
                this.checkLoadingFinish();
            },
            error: (err) => {
                this.navbar('error', 'Error', 'No se pudo cargar el usuario.', false);
                this.pendingLoads--; // to avoid stuck
                this.router.navigate(['/Usuarios']);
            }
        });
    }

    private checkLoadingFinish() {
        this.pendingLoads--;
        // If roles and permissions are loaded, we can fetch the user to map data correctly
        // But we need to make sure we don't call loadUsuario multiple times or before dependencies

        // Strategy: wait until roles & perms are done (pendingLoads = 0 from initial calls)
        // Then call loadUsuario
        // Note: use getRawValue() because Id_Usuario control is disabled
        if (this.pendingLoads === 0 && !this.form.getRawValue().Id_Usuario) {
            // Initial load of deps done, now load user
            this.loadUsuario();
        } else if (this.pendingLoads <= 0) {
            // All done
            this.isLoading.set(false);
            this.catalogLoading.set(false);
            this.cdr.markForCheck();
        }
    }

    // Handle manual permission toggle (if not using role defaults or if editing specific perms)
    // Logic from crear-usuario: changing role resets perms. Here we might want to keep existing ones?
    // User requirements said "same logic", so changing role -> load role perms.
    onRolChange() {
        const idRol = Number(this.form.value.Id_Rol || 0);
        if (!idRol || !this.form.get('Id_Rol')?.dirty) return;

        // Al cambiar de rol se limpian únicamente las excepciones individuales.
        // Los permisos propios del rol no se duplican en usuario_permisos.
        this.selectedPermisos = [];
        this.cdr.markForCheck();
    }

    togglePermiso(idPermiso: number) {
        const id = Number(idPermiso);
        if (this.selectedPermisos.includes(id)) {
            this.selectedPermisos = this.selectedPermisos.filter((permisoId) => permisoId !== id);
        } else {
            this.selectedPermisos = [...this.selectedPermisos, id];
        }
        this.cdr.markForCheck();
    }

    openPasswordStrength() {
        this.passwordStrengthOpen = true;
        this.cdr.markForCheck();
    }

    closePasswordStrengthIfOutside(event: FocusEvent, wrap: HTMLElement) {
        const next = event.relatedTarget as HTMLElement | null;
        if (next && wrap.contains(next)) return;
        this.passwordStrengthOpen = false;
        this.cdr.markForCheck();
    }

    private setupPasswordStrength() {
        const ctrl = this.form.get('Contrasena');
        if (!ctrl) return;

        ctrl.valueChanges
            .pipe(startWith(ctrl.value || ''), takeUntil(this.destroy$))
            .subscribe((v) => {
                if (!v) {
                    this.passwordStrength = evaluateUserPassword('', true);
                } else {
                    this.passwordStrength = evaluateUserPassword(v);
                }
                this.cdr.markForCheck();
            });
    }

    canUpdateUsers(): boolean {
        return this.permisosService.tienePermiso('USUARIOS.ACTUALIZAR');
    }

    private isPasswordStrongEnough(): boolean {
        const pass = String(this.form.value.Contrasena || '');
        return !pass || isUserPasswordStrong(pass);
    }

    submit() {
        this.errorMsg = '';
        this.form.updateValueAndValidity({ emitEvent: false });
        this.form.markAllAsTouched();

        if (this.form.invalid) {
            const invalid = Object.keys(this.form.controls).filter((k) => this.form.get(k)?.invalid);
            if (this.form.errors?.['passwordMismatch'] && !invalid.includes('Confirmar')) {
                invalid.push('Confirmar');
            }
            const friendly: Record<string, string> = {
                Id_Usuario: 'Cédula',
                Nombres_Apellidos: 'Nombre completo',
                Telefono_Usuario: 'Teléfono',
                Usuario: 'Usuario',
                Correo: 'Correo',
                Contrasena: 'Contraseña',
                Confirmar: 'Confirmar contraseña',
                Id_Rol: 'Rol',
                Activo: 'Estado'
            };

            const fields = invalid.map((f) => friendly[f] || f);
            const msg = fields.length
                ? `Revisa los siguientes campos: ${fields.join(', ')}`
                : 'Hay campos inválidos en el formulario.';

            this.alerts.showAlert({
                type: 'error',
                title: 'Campos requeridos incompletos',
                message: msg,
                autoClose: true,
                buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alerts.closeModal() }]
            });
            return;
        }

        if (!this.isPasswordStrongEnough()) {
            this.errorMsg = 'Nueva contraseña débil. Si no deseas cambiarla, déjala en blanco.';
            this.navbar('warning', 'Contraseña débil', this.errorMsg, false);
            return;
        }

        const payload = {
            Nombres_Apellidos: normalizeUserName(this.form.value.Nombres_Apellidos),
            Telefono_Usuario: this.form.value.Telefono_Usuario ? String(this.form.value.Telefono_Usuario) : null,
            Usuario: String(this.form.value.Usuario),
            Correo: String(this.form.value.Correo),
            Contrasena: this.form.value.Contrasena || '', // Send empty if no change
            Id_Rol: Number(this.form.value.Id_Rol),
            Activo: Number(this.form.value.Activo ?? 1),
            permisos: this.selectedPermisos
        };

        this.alerts.showConfirm(
            '¿Guardar cambios?',
            'Se actualizará la información del usuario.',
            [
                { text: 'Cancelar', style: 'secondary', onClick: () => this.alerts.closeModal() },
                { text: 'Guardar', style: 'primary', onClick: () => { this.alerts.closeModal(); this.confirmUpdate(payload); } }
            ]
        );
    }

    private confirmUpdate(payload: any) {
        if (this.isSubmitting() || !this.userId) return;
        this.isSubmitting.set(true);
        this.cdr.markForCheck();

        this.usuariosService.actualizarUsuario(this.userId, payload).subscribe({
            next: () => {
                this.form.markAsPristine();
                this.isSubmitting.set(false);
                this.alerts.successToast('Actualizado', 'Usuario actualizado correctamente');
                this.cdr.markForCheck();
                this.router.navigate(['/Usuarios']);
            },
            error: (err: any) => {
                this.isSubmitting.set(false);
                this.errorMsg = err?.error?.message || 'No se pudo actualizar el usuario.';
                this.alerts.errorToast('Error', this.errorMsg);
                this.cdr.markForCheck();
            }
        });
    }

    hasUnsavedChanges(): boolean {
        return this.form?.dirty && !this.isSubmitting();
    }
}
