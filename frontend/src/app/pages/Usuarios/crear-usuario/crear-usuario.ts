import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Subject, Subscription } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { PermisoCompleto, PermisosService, Rol } from '../../../services/Permisos/permisos.service';
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
  if (!pass || !confirm) return null;
  return pass === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-crear-usuario',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, UppercaseInputDirective, LoadingStateComponent],
  templateUrl: './crear-usuario.html',
  styleUrls: ['../usuario-shared.css', './crear-usuario.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CrearUsuarioComponent implements OnInit, OnDestroy {
  form: FormGroup;

  readonly wizardSteps = [
    { id: 'identity', label: 'Identidad' },
    { id: 'access', label: 'Acceso' },
    { id: 'permissions', label: 'Permisos' },
    { id: 'review', label: 'Revisar' }
  ];
  currentStep = 0;
  maxReachedStep = 0;
  goingBack = false;
  panelAnimating = false;

  roles: Rol[] = [];
  permisos: PermisoCompleto[] = [];
  selectedPermisos: number[] = [];
  roleDefaultPermisos: number[] = [];

  isLoading = signal(true);
  loadError = signal('');
  rolePermissionsLoading = signal(false);
  isSubmitting = signal(false);
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
  private rolePermissionsRequest?: Subscription;
  private panelAnimationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private fb: FormBuilder,
    private permisosService: PermisosService,
    private usuariosService: UsuariosService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private alerts: SirAlertService
  ) {
    this.form = this.fb.group({
      Id_Usuario: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(30)]],
      Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
      Telefono_Usuario: ['', [Validators.required, Validators.pattern(USER_PHONE_REGEX)]],
      Usuario: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      Contrasena: ['', [Validators.required]],
      Confirmar: ['', [Validators.required]],
      Id_Rol: ['', [Validators.required]]
    }, { validators: passwordMatchValidator });
  }

  ngOnInit(): void {
    this.loadInitialData();
    this.setupPasswordStrength();
  }

  ngOnDestroy(): void {
    this.rolePermissionsRequest?.unsubscribe();
    if (this.panelAnimationTimer) clearTimeout(this.panelAnimationTimer);
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

  private navbar(title: string, message: string, loading = false, autoClose = true) {
    if (loading) {
      this.alerts.showLoading(title, message, { autoClose });
      return;
    }
    this.alerts.warningToast(title, message);
  }

  loadInitialData(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    forkJoin({
      roles: this.permisosService.obtenerRoles(),
      permisos: this.permisosService.obtenerPermisos()
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ roles, permisos }) => {
          this.roles = roles.roles || [];
          this.permisos = permisos.permisos || [];
          this.isLoading.set(false);
          this.cdr.markForCheck();
        },
        error: () => {
          this.roles = [];
          this.permisos = [];
          this.isLoading.set(false);
          this.loadError.set('No fue posible cargar los roles y permisos. Revisa tu conexión e inténtalo de nuevo.');
          this.cdr.markForCheck();
        }
      });
  }

  onRolChange(): void {
    const idRol = Number(this.form.value.Id_Rol || 0);
    this.rolePermissionsRequest?.unsubscribe();
    this.roleDefaultPermisos = [];
    this.selectedPermisos = [];

    if (!idRol) {
      this.rolePermissionsLoading.set(false);
      this.cdr.markForCheck();
      return;
    }

    this.rolePermissionsLoading.set(true);
    this.cdr.markForCheck();

    this.rolePermissionsRequest = this.permisosService.obtenerPermisosPorRol(idRol).subscribe({
      next: (response) => {
        const defaults = (response.permisos || [])
          .map((permiso) => Number(permiso.Id_Permiso))
          .filter((id) => Number.isFinite(id));

        this.roleDefaultPermisos = [...new Set(defaults)];
        this.selectedPermisos = [...this.roleDefaultPermisos];
        this.rolePermissionsLoading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.roleDefaultPermisos = [];
        this.selectedPermisos = [];
        this.rolePermissionsLoading.set(false);
        this.alerts.errorToast(
          'No pudimos cargar el rol',
          'Intenta seleccionar el rol nuevamente para recuperar sus permisos por defecto.'
        );
        this.cdr.markForCheck();
      }
    });
  }

  togglePermiso(idPermiso: number) {
    if (this.rolePermissionsLoading()) return;

    const id = Number(idPermiso);

    if (this.selectedPermisos.includes(id)) {
      this.selectedPermisos = this.selectedPermisos.filter((permisoId) => permisoId !== id);
    } else {
      this.selectedPermisos = [...this.selectedPermisos, id];
    }

    this.cdr.markForCheck();
  }

  isRoleDefault(idPermiso: number): boolean {
    return this.roleDefaultPermisos.includes(Number(idPermiso));
  }

  isSelected(idPermiso: number): boolean {
    return this.selectedPermisos.includes(Number(idPermiso));
  }

  get selectedRole(): Rol | undefined {
    const idRol = Number(this.form.value.Id_Rol || 0);
    return this.roles.find((rol) => Number(rol.Id_Rol) === idRol);
  }

  get permissionsByModule(): Array<{ key: string; label: string; permisos: PermisoCompleto[] }> {
    return this.buildPermissionModules(this.permisos);
  }

  get selectedPermissionModules(): Array<{ key: string; label: string; permisos: PermisoCompleto[] }> {
    return this.buildPermissionModules(
      this.permisos.filter((permiso) => this.isSelected(permiso.Id_Permiso))
    );
  }

  get selectedAdditionalPermissions(): PermisoCompleto[] {
    return this.permisos.filter((permiso) =>
      !this.isRoleDefault(permiso.Id_Permiso) && this.isSelected(permiso.Id_Permiso)
    );
  }

  get removedRoleDefaultPermissions(): PermisoCompleto[] {
    return this.permisos.filter((permiso) =>
      this.isRoleDefault(permiso.Id_Permiso) && !this.isSelected(permiso.Id_Permiso)
    );
  }

  permissionAction(permiso: PermisoCompleto): string {
    const codeAction = String(permiso.Codigo_Permiso || '').split('.').pop();
    return this.formatModuleName(permiso.Accion || codeAction || 'Permiso');
  }

  goToStep(step: number): void {
    if (step < 0 || step >= this.wizardSteps.length || step > this.maxReachedStep) return;
    if (step === this.currentStep) return;
    this.goingBack = step < this.currentStep;
    this.currentStep = step;
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  nextStep(): void {
    if (!this.validateStep(this.currentStep)) return;
    if (this.currentStep >= this.wizardSteps.length - 1) return;
    this.goingBack = false;
    this.currentStep += 1;
    this.maxReachedStep = Math.max(this.maxReachedStep, this.currentStep);
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  prevStep(): void {
    if (this.currentStep === 0) return;
    this.goingBack = true;
    this.currentStep -= 1;
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  canAdvanceFromStep(step: number): boolean {
    if (step === 0) {
      return ['Id_Usuario', 'Nombres_Apellidos', 'Telefono_Usuario', 'Correo']
        .every((name) => this.c(name).valid);
    }
    if (step === 1) {
      return ['Usuario', 'Contrasena', 'Confirmar']
        .every((name) => this.c(name).valid)
        && !this.form.errors?.['passwordMismatch']
        && this.isPasswordStrongEnough();
    }
    if (step === 2) {
      return Boolean(this.c('Id_Rol').valid && this.c('Id_Rol').value && !this.rolePermissionsLoading());
    }
    return true;
  }

  stepHasError(step: number): boolean {
    if (step === 0) {
      return ['Id_Usuario', 'Nombres_Apellidos', 'Telefono_Usuario', 'Correo']
        .some((name) => Boolean(this.c(name).touched && this.c(name).invalid));
    }
    if (step === 1) {
      return ['Usuario', 'Contrasena', 'Confirmar']
        .some((name) => Boolean(this.c(name).touched && this.c(name).invalid))
        || Boolean(this.c('Confirmar').touched && this.form.errors?.['passwordMismatch'])
        || Boolean(this.c('Contrasena').touched && !this.isPasswordStrongEnough());
    }
    if (step === 2) {
      return Boolean(this.c('Id_Rol').touched && this.c('Id_Rol').invalid);
    }
    return false;
  }

  formatModuleName(value: string): string {
    return String(value || 'General')
      .replace(/[_-]+/g, ' ')
      .toLocaleLowerCase('es-CO')
      .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('es-CO'));
  }

  private buildPermissionModules(
    permissions: PermisoCompleto[]
  ): Array<{ key: string; label: string; permisos: PermisoCompleto[] }> {
    const groups = new Map<string, PermisoCompleto[]>();

    for (const permiso of permissions) {
      const key = permiso.Codigo_Modulo
        || String(permiso.Codigo_Permiso || '').split('.')[0]
        || 'GENERAL';
      groups.set(key, [...(groups.get(key) || []), permiso]);
    }

    return [...groups.entries()].map(([key, permisos]) => ({
      key,
      label: this.formatModuleName(key),
      permisos
    }));
  }

  canCreateUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.CREAR');
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
        this.passwordStrength = evaluateUserPassword(v);
        this.cdr.markForCheck();
      });
  }

  isPasswordStrongEnough(): boolean {
    return isUserPasswordStrong(this.form.value.Contrasena);
  }

  submit() {
    this.errorMsg = '';
    this.form.updateValueAndValidity({ emitEvent: false });
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const targetStep = this.firstInvalidStep();
      this.goingBack = targetStep < this.currentStep;
      this.currentStep = targetStep;
      this.maxReachedStep = Math.max(this.maxReachedStep, targetStep);
      this.animatePanel();

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
        Id_Rol: 'Rol'
      };

      const fields = invalid.map((f) => friendly[f] || f);
      const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

      this.alerts.showAlert({
        type: 'error',
        title: 'Campos requeridos incompletos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alerts.closeModal() }]
      });

      this.cdr.markForCheck();
      return;
    }

    if (this.rolePermissionsLoading()) {
      this.alerts.warningToast('Permisos en proceso', 'Espera a que terminemos de cargar los permisos del rol.');
      return;
    }

    if (!this.isPasswordStrongEnough()) {
      this.errorMsg = 'Contraseña débil. Debe incluir mayúscula, minúscula, número, símbolo y mínimo 8 caracteres.';
      this.navbar('Contraseña débil', this.errorMsg, false);
      this.cdr.markForCheck();
      return;
    }

    const payload = {
      Id_Usuario: String(this.form.value.Id_Usuario),
      Nombres_Apellidos: normalizeUserName(this.form.value.Nombres_Apellidos),
      Telefono_Usuario: this.form.value.Telefono_Usuario ? String(this.form.value.Telefono_Usuario) : null,
      Usuario: String(this.form.value.Usuario),
      Correo: String(this.form.value.Correo),
      Contrasena: String(this.form.value.Contrasena),
      Id_Rol: Number(this.form.value.Id_Rol),
      Activo: 1,
      // El backend calcula ALLOW y DENY comparando esta selección completa
      // con la plantilla del rol. `permisos` mantiene compatibilidad con
      // versiones anteriores que solo aceptaban accesos adicionales.
      permisosEfectivos: [...this.selectedPermisos],
      permisos: this.selectedPermisos.filter((id) => !this.roleDefaultPermisos.includes(id))
    };

    // Show confirmation using global navbar alert with action buttons
    this.alerts.showConfirm(
      '¿Crear usuario?',
      'Se creará el usuario con los datos ingresados. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.alerts.closeModal() },
        { text: 'Crear', style: 'primary', onClick: () => { this.alerts.closeModal(); this.confirmCreateUser(payload); } }
      ]
    );
  }

  private confirmCreateUser(payload: any) {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.cdr.markForCheck();

    this.usuariosService.crearUsuario(payload).subscribe({
      next: () => {
        this.form.markAsPristine();
        this.isSubmitting.set(false);
        this.alerts.successToast('Usuario creado', 'El usuario se creó correctamente.');
        this.cdr.markForCheck();
        this.router.navigate(['/Usuarios']);
      },
      error: (err: any) => {
        this.isSubmitting.set(false);
        this.errorMsg = err?.error?.message || 'No se pudo crear el usuario.';
        this.alerts.errorToast('Error', this.errorMsg);
        this.cdr.markForCheck();
      }
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  private validateStep(step: number): boolean {
    const controlsByStep: Record<number, string[]> = {
      0: ['Id_Usuario', 'Nombres_Apellidos', 'Telefono_Usuario', 'Correo'],
      1: ['Usuario', 'Contrasena', 'Confirmar'],
      2: ['Id_Rol']
    };

    (controlsByStep[step] || []).forEach((name) => {
      this.c(name).markAsTouched();
      this.c(name).updateValueAndValidity({ emitEvent: false });
    });
    this.form.updateValueAndValidity({ emitEvent: false });

    if (this.canAdvanceFromStep(step)) return true;

    const messages: Record<number, string> = {
      0: 'Revisa los datos personales y de contacto señalados.',
      1: 'Completa las credenciales y confirma que las contraseñas coincidan.',
      2: 'Selecciona el rol que tendrá esta persona.'
    };
    this.alerts.warningToast('Falta información', messages[step] || 'Revisa los campos señalados.');
    this.cdr.markForCheck();
    return false;
  }

  private firstInvalidStep(): number {
    if (!this.canAdvanceFromStep(0)) return 0;
    if (!this.canAdvanceFromStep(1)) return 1;
    return 2;
  }

  private animatePanel(): void {
    this.panelAnimating = false;
    if (this.panelAnimationTimer) clearTimeout(this.panelAnimationTimer);
    requestAnimationFrame(() => {
      this.panelAnimating = true;
      this.cdr.markForCheck();
      this.panelAnimationTimer = setTimeout(() => {
        this.panelAnimating = false;
        this.cdr.markForCheck();
      }, 340);
    });
  }
}
