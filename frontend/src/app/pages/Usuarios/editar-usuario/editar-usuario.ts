import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { PermisosService, Rol } from '../../../services/Permisos/permisos.service';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

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
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './editar-usuario.html',
    styleUrls: ['./editar-usuario.css'],
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
    private readonly PHONE_REGEX = /^[0-9]{7,15}$/;

    constructor(
        private fb: FormBuilder,
        private permisosService: PermisosService,
        private usuariosService: UsuariosService,
        private router: Router,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef,
        private global: DynamicIslandGlobalService
    ) {
        this.form = this.fb.group({
            Id_Usuario: [{ value: '', disabled: true }, [Validators.required]],
            Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
            Telefono_Usuario: ['', [Validators.required, Validators.pattern(this.PHONE_REGEX)]],
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
        this.global.alert.set({ type, title, message, loading, autoClose });
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
                this.selectedPermisos = GoogleDeepmindCopy(u.permisos || []);
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
        if (!idRol) {
            if (this.form.get('Id_Rol')?.dirty) { // Only clear if user changed it manually
                this.selectedPermisos = [];
            }
            this.cdr.markForCheck();
            return;
        }

        // Only load defaults if user interaction (dirty)
        if (this.form.get('Id_Rol')?.dirty) {
            this.permisosService.obtenerPermisosPorRol(idRol).subscribe({
                next: (res) => {
                    const rolePerms: number[] = (res.permisos || []).map((p: any) => Number(p.Id_Permiso));
                    this.selectedPermisos = Array.from(new Set(rolePerms));
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.selectedPermisos = [];
                    this.cdr.markForCheck();
                }
            });
        }
    }

    togglePermiso(idPermiso: number) {
        const idx = this.selectedPermisos.indexOf(idPermiso);
        if (idx >= 0) this.selectedPermisos.splice(idx, 1);
        else this.selectedPermisos.push(idPermiso);
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
                    this.passwordStrength = { score: 0, label: 'Sin cambio', checks: { length8: false, lower: false, upper: false, digit: false, symbol: false, length12: false } };
                } else {
                    this.passwordStrength = this.evaluatePassword(String(v || ''));
                }
                this.cdr.markForCheck();
            });
    }

    private evaluatePassword(pass: string) {
        const length8 = pass.length >= 8;
        const lower = /[a-z]/.test(pass);
        const upper = /[A-Z]/.test(pass);
        const digit = /\d/.test(pass);
        const symbol = /[^A-Za-z0-9]/.test(pass);
        const length12 = pass.length >= 12;

        const score =
            (length8 ? 1 : 0) +
            (lower ? 1 : 0) +
            (upper ? 1 : 0) +
            (digit ? 1 : 0) +
            (symbol ? 1 : 0) +
            (length12 ? 1 : 0);

        let label = 'Débil';
        if (score >= 5) label = 'Fuerte';
        else if (score >= 3) label = 'Media';

        return {
            score,
            label,
            checks: { length8, lower, upper, digit, symbol, length12 }
        };
    }

    private isPasswordStrongEnough(): boolean {
        const pass = String(this.form.value.Contrasena || '');
        if (!pass) return true; // Empty means no change, so it's valid for edit mode

        const length8 = pass.length >= 8;
        const lower = /[a-z]/.test(pass);
        const upper = /[A-Z]/.test(pass);
        const digit = /\d/.test(pass);
        const symbol = /[^A-Za-z0-9]/.test(pass);
        return length8 && lower && upper && digit && symbol;
    }

    submit() {
        this.errorMsg = '';
        this.form.markAllAsTouched();

        if (this.form.invalid) {
            this.global.alert?.set?.({
                type: 'error',
                title: 'Campos inválidos',
                message: 'Por favor revisa los campos marcados en rojo.',
                autoClose: true
            });
            return;
        }

        if (!this.isPasswordStrongEnough()) {
            this.errorMsg = 'Nueva contraseña débil. Si no deseas cambiarla, déjala en blanco.';
            this.navbar('warning', 'Contraseña débil', this.errorMsg, false);
            return;
        }

        const payload = {
            Nombres_Apellidos: String(this.form.value.Nombres_Apellidos),
            Telefono_Usuario: this.form.value.Telefono_Usuario ? String(this.form.value.Telefono_Usuario) : null,
            Usuario: String(this.form.value.Usuario),
            Correo: String(this.form.value.Correo),
            Contrasena: this.form.value.Contrasena || '', // Send empty if no change
            Id_Rol: Number(this.form.value.Id_Rol),
            Activo: Number(this.form.value.Activo ?? 1),
            permisos: this.selectedPermisos
        };

        this.global.alert?.set?.({
            type: 'info',
            title: '¿Guardar cambios?',
            message: 'Se actualizará la información del usuario.',
            autoClose: false,
            buttons: [
                { text: 'Cancelar', style: 'secondary', onClick: () => this.global.alert?.set?.(null) },
                { text: 'Guardar', style: 'primary', onClick: () => { this.global.alert?.set?.(null); this.confirmUpdate(payload); } }
            ]
        });
    }

    private confirmUpdate(payload: any) {
        if (this.isSubmitting() || !this.userId) return;
        this.isSubmitting.set(true);
        this.isLoading.set(true);

        this.usuariosService.actualizarUsuario(this.userId, payload).subscribe({
            next: () => {
                this.form.markAsPristine();
                this.isSubmitting.set(false);
                this.isLoading.set(false);
                this.global.successToast('Actualizado', 'Usuario actualizado correctamente');
                this.router.navigate(['/Usuarios']);
            },
            error: (err: any) => {
                this.isSubmitting.set(false);
                this.isLoading.set(false);
                this.errorMsg = err?.error?.error || 'Error actualizando usuario';
                this.global.errorToast('Error', this.errorMsg);
            }
        });
    }

    hasUnsavedChanges(): boolean {
        return this.form?.dirty && !this.isSubmitting();
    }
}

function GoogleDeepmindCopy<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
}
