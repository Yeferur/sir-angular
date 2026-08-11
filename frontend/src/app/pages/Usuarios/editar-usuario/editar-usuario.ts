import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Subject, Subscription } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { PermisoCompleto, PermisosService, Rol } from '../../../services/Permisos/permisos.service';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { CanalTurno, TurnosService } from '../../../services/Turnos/turnos.service';
import { UppercaseInputDirective } from '../../../shared/directives/uppercase-input.directive';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import {
  evaluateUserPassword,
  isUserPasswordStrong,
  normalizeUserName,
  USER_PHONE_REGEX,
} from '../usuario-form.utils';

const PERMISSION_MODULE_ORDER = [
  'INICIO',
  'RESERVAS',
  'TRANSFERS',
  'TOURS',
  'PUNTOS DE ENCUENTRO',
  'PROGRAMACION',
  'CONTROL DE VIAJE',
  'PAGOS',
  'COMISIONES',
  'HISTORIAL',
  'INFORMES',
  'MENSAJERIA',
  'SEGUROS',
  'USUARIOS',
  'ROLES Y PERMISOS',
  'CONFIGURACION',
  'GENERAL'
];

const PERMISSION_ACTION_ORDER: Record<string, number> = {
  LEER: 10,
  CREAR: 20,
  ACTUALIZAR: 30,
  ACTUALIZAR_AFORO: 35,
  ACTUALIZAR_ASISTENCIA: 36,
  ENVIAR: 40,
  CONFIGURAR: 45,
  EXPORTAR: 50,
  ORDENAR: 55,
  ELIMINAR: 90
};

function permissionOrderToken(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toUpperCase();
}

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const pass = group.get('Contrasena')?.value;
  const confirm = group.get('Confirmar')?.value;
  if (!pass && !confirm) return null;
  return pass === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-editar-usuario',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, UppercaseInputDirective, LoadingStateComponent],
  templateUrl: './editar-usuario.html',
  styleUrls: ['../usuario-shared.css', '../usuario-wizard.css', './editar-usuario.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditarUsuarioComponent implements OnInit, OnDestroy {
  form: FormGroup;
  userId: string | null = null;

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
  canales: CanalTurno[] = [];
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
  passwordStrength = evaluateUserPassword('', true);

  private destroy$ = new Subject<void>();
  private rolePermissionsRequest?: Subscription;
  private panelAnimationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private fb: FormBuilder,
    private permisosService: PermisosService,
    private usuariosService: UsuariosService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private alerts: SirAlertService,
    private turnosService: TurnosService
  ) {
    this.form = this.fb.group({
      Id_Usuario: [{ value: '', disabled: true }, [Validators.required]],
      Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
      Telefono_Usuario: ['', [Validators.required, Validators.pattern(USER_PHONE_REGEX)]],
      Usuario: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      Contrasena: [''],
      Confirmar: [''],
      Id_Rol: ['', [Validators.required]],
      Id_Canal: [null],
      Activo: [1]
    }, { validators: passwordMatchValidator });
  }

  ngOnInit(): void {
    this.userId = this.route.snapshot.paramMap.get('id');
    if (!this.userId) {
      this.router.navigate(['/Usuarios']);
      return;
    }

    this.loadInitialData();
    this.setupPasswordStrength();
  }

  ngOnDestroy(): void {
    this.rolePermissionsRequest?.unsubscribe();
    if (this.panelAnimationTimer) clearTimeout(this.panelAnimationTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadInitialData(): void {
    if (!this.userId) return;

    this.isLoading.set(true);
    this.loadError.set('');
    this.rolePermissionsRequest?.unsubscribe();

    forkJoin({
      roles: this.permisosService.obtenerRoles(),
      permisos: this.permisosService.obtenerPermisos(),
      canales: this.turnosService.obtenerCanales(),
      usuario: this.usuariosService.obtenerUsuario(this.userId)
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ roles, permisos, canales, usuario }) => {
          this.roles = roles.roles || [];
          this.permisos = permisos.permisos || [];
          this.canales = canales.canales || [];
          this.form.patchValue({
            Id_Usuario: usuario.Id_Usuario,
            Nombres_Apellidos: usuario.Nombres_Apellidos,
            Telefono_Usuario: usuario.Telefono_Usuario,
            Usuario: usuario.Usuario,
            Correo: usuario.Correo,
            Id_Rol: usuario.Id_Rol,
            Id_Canal: usuario.Id_Canal ?? null,
            Activo: Number(usuario.Activo ?? 1)
          });

          const effectiveIds = this.permissionIds(usuario.permisosEfectivos);
          const individualIds = this.permissionIds(usuario.permisos);
          this.loadRoleDefaults(Number(usuario.Id_Rol), {
            effectiveIds,
            individualIds,
            finishInitialLoad: true
          });
        },
        error: () => {
          this.isLoading.set(false);
          this.loadError.set('No fue posible cargar el usuario, los roles y los permisos. Revisa tu conexión e inténtalo de nuevo.');
          this.cdr.markForCheck();
        }
      });
  }

  private loadRoleDefaults(
    idRol: number,
    options?: { effectiveIds?: number[]; individualIds?: number[]; finishInitialLoad?: boolean }
  ): void {
    this.rolePermissionsRequest?.unsubscribe();
    this.rolePermissionsLoading.set(true);
    this.cdr.markForCheck();

    this.rolePermissionsRequest = this.permisosService.obtenerPermisosPorRol(idRol)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.roleDefaultPermisos = this.permissionIds(response.permisos);

          if (options?.effectiveIds) {
            this.selectedPermisos = options.effectiveIds.length || Array.isArray(options.effectiveIds)
              ? [...options.effectiveIds]
              : [...new Set([...this.roleDefaultPermisos, ...(options.individualIds || [])])];
          } else {
            this.selectedPermisos = [...this.roleDefaultPermisos];
          }

          this.finishRoleLoad(options?.finishInitialLoad);
        },
        error: () => {
          if (options?.effectiveIds) {
            this.selectedPermisos = [...options.effectiveIds];
          }
          this.roleDefaultPermisos = [];
          this.finishRoleLoad(options?.finishInitialLoad);
          this.alerts.errorToast('Permisos no disponibles', 'No pudimos cargar la base del rol seleccionado.');
        }
      });
  }

  private finishRoleLoad(finishInitialLoad = false): void {
    this.rolePermissionsLoading.set(false);
    if (finishInitialLoad) {
      this.isLoading.set(false);
      this.form.markAsPristine();
      // Al editar, todos los datos ya existen: cualquier etapa puede abrirse
      // directamente desde el encabezado sin recorrer el wizard en orden.
      this.maxReachedStep = this.wizardSteps.length - 1;
    }
    this.cdr.markForCheck();
  }

  private permissionIds(values: unknown): number[] {
    if (!Array.isArray(values)) return [];
    return [...new Set(values
      .map((value: any) => Number(value?.Id_Permiso ?? value))
      .filter((id) => Number.isFinite(id)))];
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
    if (ctrl.errors['pattern'] && name === 'Telefono_Usuario') {
      return 'Teléfono inválido (solo números, 7 a 15 dígitos).';
    }
    return 'Valor inválido.';
  }

  onRolChange(): void {
    const idRol = Number(this.form.value.Id_Rol || 0);
    if (!this.isAdvisorRole) {
      this.form.get('Id_Canal')?.setValue(null, { emitEvent: false });
    }
    if (!idRol) {
      this.roleDefaultPermisos = [];
      this.selectedPermisos = [];
      return;
    }
    this.loadRoleDefaults(idRol);
  }

  togglePermiso(idPermiso: number): void {
    if (this.rolePermissionsLoading() || this.isClientRole) return;
    const id = Number(idPermiso);
    this.selectedPermisos = this.selectedPermisos.includes(id)
      ? this.selectedPermisos.filter((permissionId) => permissionId !== id)
      : [...this.selectedPermisos, id];
    this.form.markAsDirty();
    this.cdr.markForCheck();
  }

  isSelected(idPermiso: number): boolean {
    return this.selectedPermisos.includes(Number(idPermiso));
  }

  isRoleDefault(idPermiso: number): boolean {
    return this.roleDefaultPermisos.includes(Number(idPermiso));
  }

  get selectedRole(): Rol | undefined {
    const idRol = Number(this.form.value.Id_Rol || 0);
    return this.roles.find((role) => Number(role.Id_Rol) === idRol);
  }

  get isClientRole(): boolean {
    return String(this.selectedRole?.Nombre_Rol || '').trim().toLocaleLowerCase('es-CO') === 'cliente';
  }

  get isAdvisorRole(): boolean {
    return String(this.selectedRole?.Nombre_Rol || '').trim().toLocaleLowerCase('es-CO') === 'asesor';
  }

  get permissionsByModule(): Array<{ key: string; label: string; permisos: PermisoCompleto[] }> {
    return this.buildPermissionModules(this.permisos);
  }

  get selectedPermissionModules(): Array<{ key: string; label: string; permisos: PermisoCompleto[] }> {
    return this.buildPermissionModules(
      this.permisos.filter((permission) => this.isSelected(permission.Id_Permiso))
    );
  }

  get selectedAdditionalPermissions(): PermisoCompleto[] {
    return this.permisos.filter((permission) =>
      !this.isRoleDefault(permission.Id_Permiso) && this.isSelected(permission.Id_Permiso)
    );
  }

  get removedRoleDefaultPermissions(): PermisoCompleto[] {
    return this.permisos.filter((permission) =>
      this.isRoleDefault(permission.Id_Permiso) && !this.isSelected(permission.Id_Permiso)
    );
  }

  userInitials(): string {
    const names = String(this.form.value.Nombres_Apellidos || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!names.length) return 'U';
    return `${names[0][0] || ''}${names.length > 1 ? names[names.length - 1][0] : ''}`
      .toLocaleUpperCase('es-CO');
  }

  permissionAction(permission: PermisoCompleto): string {
    const codeAction = String(permission.Codigo_Permiso || '').split('.').pop();
    return this.formatModuleName(permission.Accion || codeAction || 'Permiso');
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

    for (const permission of permissions) {
      const key = permission.Codigo_Modulo
        || String(permission.Codigo_Permiso || '').split('.')[0]
        || 'GENERAL';
      groups.set(key, [...(groups.get(key) || []), permission]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => {
        const leftToken = permissionOrderToken(left);
        const rightToken = permissionOrderToken(right);
        const leftIndex = PERMISSION_MODULE_ORDER.indexOf(leftToken);
        const rightIndex = PERMISSION_MODULE_ORDER.indexOf(rightToken);
        const leftRank = leftIndex === -1 ? PERMISSION_MODULE_ORDER.length : leftIndex;
        const rightRank = rightIndex === -1 ? PERMISSION_MODULE_ORDER.length : rightIndex;
        return leftRank - rightRank || leftToken.localeCompare(rightToken, 'es-CO');
      })
      .map(([key, modulePermissions]) => ({
        key,
        label: this.formatModuleName(key),
        permisos: [...modulePermissions].sort((left, right) => {
          const leftAction = permissionOrderToken(
            left.Accion || String(left.Codigo_Permiso || '').split('.').pop()
          ).replace(/ /g, '_');
          const rightAction = permissionOrderToken(
            right.Accion || String(right.Codigo_Permiso || '').split('.').pop()
          ).replace(/ /g, '_');
          return (PERMISSION_ACTION_ORDER[leftAction] ?? 70)
            - (PERMISSION_ACTION_ORDER[rightAction] ?? 70)
            || String(left.Descripcion || left.Codigo_Permiso || '').localeCompare(
              String(right.Descripcion || right.Codigo_Permiso || ''),
              'es-CO'
            );
        })
      }));
  }

  goToStep(step: number): void {
    if (step < 0 || step >= this.wizardSteps.length || step > this.maxReachedStep || step === this.currentStep) return;
    this.goingBack = step < this.currentStep;
    this.currentStep = step;
    this.animatePanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  nextStep(): void {
    if (!this.validateStep(this.currentStep) || this.currentStep >= this.wizardSteps.length - 1) return;
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
      return ['Nombres_Apellidos', 'Telefono_Usuario', 'Correo', 'Activo']
        .every((name) => this.c(name).valid);
    }
    if (step === 1) {
      return this.c('Usuario').valid
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
      return ['Nombres_Apellidos', 'Telefono_Usuario', 'Correo', 'Activo']
        .some((name) => Boolean(this.c(name).touched && this.c(name).invalid));
    }
    if (step === 1) {
      return Boolean(this.c('Usuario').touched && this.c('Usuario').invalid)
        || Boolean(this.c('Confirmar').touched && this.form.errors?.['passwordMismatch'])
        || Boolean(this.c('Contrasena').touched && !this.isPasswordStrongEnough());
    }
    if (step === 2) {
      return Boolean(this.c('Id_Rol').touched && this.c('Id_Rol').invalid);
    }
    return false;
  }

  private validateStep(step: number): boolean {
    const controlsByStep: Record<number, string[]> = {
      0: ['Id_Usuario', 'Nombres_Apellidos', 'Telefono_Usuario', 'Correo', 'Activo'],
      1: ['Usuario', 'Contrasena', 'Confirmar'],
      2: ['Id_Rol']
    };

    (controlsByStep[step] || []).forEach((name) => {
      this.c(name).markAsTouched();
      this.c(name).updateValueAndValidity({ emitEvent: false });
    });
    this.form.updateValueAndValidity({ emitEvent: false });

    if (this.canAdvanceFromStep(step)) return true;

    const messages = [
      'Completa correctamente la información personal y de contacto.',
      'Revisa el usuario y, si cambiarás la contraseña, confirma que sea segura y coincida.',
      'Selecciona un rol válido antes de continuar.'
    ];
    this.alerts.warningToast('Revisa este paso', messages[step] || 'Completa los datos requeridos.');
    this.cdr.markForCheck();
    return false;
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

  private setupPasswordStrength(): void {
    const control = this.form.get('Contrasena');
    if (!control) return;

    control.valueChanges
      .pipe(startWith(control.value || ''), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.passwordStrength = evaluateUserPassword(value || '', true);
        this.cdr.markForCheck();
      });
  }

  isPasswordStrongEnough(): boolean {
    const password = String(this.form.value.Contrasena || '');
    return !password || isUserPasswordStrong(password);
  }

  canUpdateUsers(): boolean {
    return this.permisosService.tienePermiso('USUARIOS.ACTUALIZAR');
  }

  submit(): void {
    this.errorMsg = '';
    this.form.updateValueAndValidity({ emitEvent: false });
    this.form.markAllAsTouched();

    if (this.form.invalid || !this.isPasswordStrongEnough()) {
      const targetStep = this.firstInvalidStep();
      this.goingBack = targetStep < this.currentStep;
      this.currentStep = targetStep;
      this.maxReachedStep = Math.max(this.maxReachedStep, targetStep);
      this.animatePanel();
      this.alerts.showAlert({
        type: 'error',
        title: 'Hay información por revisar',
        message: 'Corrige los campos marcados antes de guardar los cambios.',
        autoClose: true,
        buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.alerts.closeModal() }]
      });
      return;
    }

    if (this.rolePermissionsLoading()) {
      this.alerts.warningToast('Permisos en proceso', 'Espera a que terminemos de cargar los permisos del rol.');
      return;
    }

    const payload = {
      Nombres_Apellidos: normalizeUserName(this.form.value.Nombres_Apellidos),
      Telefono_Usuario: this.form.value.Telefono_Usuario ? String(this.form.value.Telefono_Usuario) : null,
      Usuario: String(this.form.value.Usuario),
      Correo: String(this.form.value.Correo),
      Contrasena: String(this.form.value.Contrasena || ''),
      Id_Rol: Number(this.form.value.Id_Rol),
      Id_Canal: this.isAdvisorRole && this.form.value.Id_Canal ? Number(this.form.value.Id_Canal) : null,
      Activo: Number(this.form.value.Activo ?? 1),
      permisosEfectivos: [...this.selectedPermisos],
      permisos: this.selectedPermisos.filter((id) => !this.roleDefaultPermisos.includes(id))
    };

    const roleName = this.selectedRole?.Nombre_Rol || 'Sin rol';
    const stateName = payload.Activo ? 'Activo' : 'Inactivo';
    const passwordStatus = payload.Contrasena ? 'La contraseña será reemplazada.' : 'La contraseña actual se conservará.';
    const confirmationMessage = [
      `Vas a actualizar a ${payload.Nombres_Apellidos}.`,
      `Rol: ${roleName} · Estado: ${stateName}`,
      `${this.selectedPermisos.length} ${this.selectedPermisos.length === 1 ? 'permiso efectivo' : 'permisos efectivos'}`,
      '',
      passwordStatus
    ].join('\n');

    this.alerts.showConfirm(
      'Confirmar cambios del usuario',
      confirmationMessage,
      [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.alerts.closeModal() },
        { text: 'Guardar cambios', style: 'primary', onClick: () => {
          this.alerts.closeModal();
          this.confirmUpdate(payload);
        } }
      ]
    );
  }

  private confirmUpdate(payload: any): void {
    if (this.isSubmitting() || !this.userId) return;
    this.isSubmitting.set(true);
    this.cdr.markForCheck();

    this.usuariosService.actualizarUsuario(this.userId, payload).subscribe({
      next: () => {
        this.form.markAsPristine();
        this.isSubmitting.set(false);
        this.alerts.successToast('Usuario actualizado', 'Los cambios se guardaron correctamente.');
        this.cdr.markForCheck();
        this.router.navigate(['/Usuarios']);
      },
      error: (error: any) => {
        this.isSubmitting.set(false);
        this.errorMsg = error?.error?.message || 'No se pudo actualizar el usuario.';
        this.alerts.errorToast('No pudimos guardar', this.errorMsg);
        this.cdr.markForCheck();
      }
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
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
