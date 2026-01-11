import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { PermisosService, Rol } from '../../../services/Permisos/permisos.service';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const pass = group.get('Contrasena')?.value;
  const confirm = group.get('Confirmar')?.value;
  if (!pass || !confirm) return null;
  return pass === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-crear-usuario',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './crear-usuario.html',
  styleUrls: ['./crear-usuario.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CrearUsuarioComponent implements OnInit, OnDestroy {
  form: FormGroup;

  roles: Rol[] = [];
  permisos: any[] = [];
  selectedPermisos: number[] = [];

  isLoading = signal(false);
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
    private cdr: ChangeDetectorRef,
    private global: DynamicIslandGlobalService
  ) {
    this.form = this.fb.group({
      Id_Usuario: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(30)]],
      Nombres_Apellidos: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
      Telefono_Usuario: ['', [Validators.required, Validators.pattern(this.PHONE_REGEX)]],
      Usuario: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      Correo: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      Contrasena: ['', [Validators.required]],
      Confirmar: ['', [Validators.required]],
      Id_Rol: ['', [Validators.required]]
    }, { validators: passwordMatchValidator });
  }

  ngOnInit(): void {
    // show loading until roles and permisos are fetched
    this.isLoading.set(true);
    // update navbar/global loading state
    this.navbar('Cargando...', 'Cargando datos...', true, false);
    this.pendingLoads = 0;
    this.loadRoles();
    this.loadPermisos();
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

  private navbar(title: string, message: string, loading = false, autoClose = true) {
    this.global.alert.set({ title, message, loading, autoClose });
  }

  private loadRoles() {
    this.pendingLoads++;
    this.permisosService.obtenerRoles().subscribe({
      next: (r) => {
        this.roles = r.roles || [];
        this.cdr.markForCheck();
        this.pendingLoads--;
        this.checkLoadingFinish();
      },
      error: () => {
        this.roles = [];
        this.cdr.markForCheck();
        this.pendingLoads--;
        this.checkLoadingFinish();
      }
    });
  }

  private loadPermisos() {
    this.pendingLoads++;
    this.permisosService.obtenerPermisos().subscribe({
      next: (res) => {
        this.permisos = res.permisos || [];
        this.cdr.markForCheck();
        this.pendingLoads--;
        this.checkLoadingFinish();
      },
      error: () => {
        this.permisos = [];
        this.cdr.markForCheck();
        this.pendingLoads--;
        this.checkLoadingFinish();
      }
    });
  }

  private checkLoadingFinish() {
    if (this.pendingLoads <= 0) {
      this.isLoading.set(false);
      // clear navbar/global loading state
      this.global.alert.set(null);
      this.cdr.markForCheck();
    }
  }

  onRolChange() {
    const idRol = Number(this.form.value.Id_Rol || 0);
    if (!idRol) {
      this.selectedPermisos = [];
      this.cdr.markForCheck();
      return;
    }

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
        this.passwordStrength = this.evaluatePassword(String(v || ''));
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
      this.form.markAllAsTouched();

      const invalid = Object.keys(this.form.controls).filter((k) => this.form.get(k)?.invalid);
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

      this.global.alert?.set?.({
        type: 'error',
        title: 'Campos inválidos',
        message: msg,
        autoClose: true,
        buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.global.alert?.set?.(null) }]
      });

      this.cdr.markForCheck();
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
      Nombres_Apellidos: String(this.form.value.Nombres_Apellidos),
      Telefono_Usuario: this.form.value.Telefono_Usuario ? String(this.form.value.Telefono_Usuario) : null,
      Usuario: String(this.form.value.Usuario),
      Correo: String(this.form.value.Correo),
      Contrasena: String(this.form.value.Contrasena),
      Id_Rol: Number(this.form.value.Id_Rol),
      Activo: 1,
      permisos: this.selectedPermisos
    };

    // Show confirmation using global navbar alert with action buttons
    this.global.alert?.set?.({
      type: 'info',
      title: '¿Crear usuario?',
      message: 'Se creará el usuario con los datos ingresados. ¿Deseas continuar?',
      autoClose: false,
      buttons: [
        { text: 'Cancelar', style: 'secondary', onClick: () => this.global.alert?.set?.(null) },
        { text: 'Crear', style: 'primary', onClick: () => { this.global.alert?.set?.(null); this.confirmCreateUser(payload); } }
      ]
    });
  }

  private confirmCreateUser(payload: any) {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    this.navbar('Creando usuario...', 'Guardando información, por favor espera.', true);
    this.cdr.markForCheck();

    this.usuariosService.crearUsuario(payload).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.navbar('Usuario creado', 'El usuario se creó correctamente.', false);
        this.cdr.markForCheck();
        this.router.navigate(['/Usuarios']);
      },
      error: (err: any) => {
        this.isLoading.set(false);
        this.errorMsg = err?.error?.error || 'Error creando usuario';
        this.navbar('Error', this.errorMsg, false);
        this.cdr.markForCheck();
      }
    });
  }
}
