import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { UsuariosService } from '../../services/Usuarios/usuarios';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { AuthService } from '../../services/Login/login-service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

interface UsuarioDetalle {
  Id_Usuario: string | number;
  Usuario: string;
  Nombres_Apellidos: string;
  Correo: string;
  Telefono_Usuario?: string | null;
  Id_Rol?: number | null;
  Nombre_Rol?: string | null;
  Activo: number | boolean;
  permisos?: Array<{
    Id_Permiso: number;
  }>;
  permisosEfectivos?: UsuarioPermiso[];
}

interface UsuarioPermiso {
  Id_Permiso: number;
  Descripcion?: string;
}

@Component({
  selector: 'app-usuario-detail',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent],
  templateUrl: './usuario.html',
  styleUrl: './usuario.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuarioDetailComponent implements OnChanges {
  @Input({ required: true }) Id_Usuario!: string;
  @Output() onClose = new EventEmitter<void>();

  private readonly usuariosService = inject(UsuariosService);
  private readonly permisosService = inject(PermisosService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(SirAlertService);
  private readonly router = inject(Router);

  readonly usuario = signal<UsuarioDetalle | null>(null);
  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly activeAction = signal<'sessions' | 'deactivate' | null>(null);
  readonly estados = this.usuariosService.getEstadosSignal();

  readonly sessionState = computed(() => this.estados().get(String(this.Id_Usuario)) || 'cerrada');
  readonly hasOpenSession = computed(() => this.sessionState() !== 'cerrada');
  readonly isCurrentUser = computed(() => String(this.auth.getUser()?.id || '') === String(this.Id_Usuario));
  readonly canUpdate = computed(() => this.permisosService.tienePermiso('USUARIOS.ACTUALIZAR'));
  readonly canDeactivate = computed(() =>
    this.permisosService.tienePermiso('USUARIOS.ELIMINAR')
    && !this.isCurrentUser()
    && this.isActive()
  );
  readonly effectivePermissions = computed(() => this.usuario()?.permisosEfectivos || []);
  readonly effectivePermissionCount = computed(() =>
    this.effectivePermissions().length
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Usuario']) this.loadUsuario();
  }

  loadUsuario(): void {
    if (!this.Id_Usuario) return;
    this.isLoading.set(true);
    this.loadError.set('');

    this.usuariosService.obtenerUsuario(String(this.Id_Usuario)).subscribe({
      next: (usuario) => {
        this.usuario.set(usuario);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.loadError.set(error?.error?.message || 'No se pudo cargar la información del usuario.');
        this.isLoading.set(false);
      },
    });
  }

  isActive(): boolean {
    const value = this.usuario()?.Activo;
    return value === true || Number(value) === 1;
  }

  initials(): string {
    const parts = String(this.usuario()?.Nombres_Apellidos || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() || '?';
  }

  sessionLabel(): string {
    if (this.sessionState() === 'activa') return 'En línea';
    if (this.sessionState() === 'inactiva') return 'Sesión abierta';
    return 'Sin sesión';
  }

  editar(): void {
    if (!this.canUpdate()) return;
    this.onClose.emit();
    void this.router.navigate(['/Usuarios/Editar', this.Id_Usuario]);
  }

  cerrarSesiones(): void {
    if (!this.hasOpenSession() || this.activeAction()) return;

    const ownSession = this.isCurrentUser();
    this.alerts.confirm(
      ownSession ? 'Cerrar todas tus sesiones' : 'Cerrar sesiones del usuario',
      ownSession
        ? 'Se cerrará tu sesión en todos los navegadores y dispositivos.'
        : 'El usuario deberá iniciar sesión nuevamente en sus dispositivos.',
      () => this.performSessionClose(ownSession),
      undefined,
      { confirmText: 'Cerrar sesiones', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  desactivar(): void {
    if (!this.canDeactivate() || this.activeAction()) return;

    this.alerts.confirm(
      '¿Desactivar usuario?',
      'El usuario no podrá iniciar sesión y sus sesiones abiertas se cerrarán. Su información e historial se conservarán.',
      () => this.performDeactivate(),
      undefined,
      { confirmText: 'Desactivar', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  private performSessionClose(ownSession: boolean): void {
    this.activeAction.set('sessions');
    const request$ = ownSession
      ? this.auth.logoutAllSessions()
      : this.usuariosService.forzarCierreSesion(String(this.Id_Usuario));

    request$.subscribe({
      next: () => {
        this.activeAction.set(null);
        if (ownSession) {
          this.auth.clearLocalSession();
          this.onClose.emit();
          return;
        }
        this.usuariosService.recargar();
        this.alerts.successToast('Sesiones cerradas', 'El usuario deberá iniciar sesión nuevamente.');
      },
      error: (error) => {
        this.activeAction.set(null);
        this.alerts.errorToast('No se pudieron cerrar', error?.error?.message || 'Intenta nuevamente.');
      },
    });
  }

  private performDeactivate(): void {
    this.activeAction.set('deactivate');
    const snapshot = this.usuariosService.marcarUsuarioInactivo(String(this.Id_Usuario));

    this.usuariosService.eliminarUsuario(String(this.Id_Usuario)).subscribe({
      next: () => {
        this.activeAction.set(null);
        this.usuario.update((current) => current ? { ...current, Activo: 0 } : current);
        this.alerts.successToast('Usuario desactivado', 'La cuenta quedó inactiva y sus sesiones fueron cerradas.');
      },
      error: (error) => {
        this.activeAction.set(null);
        if (snapshot.user) {
          this.usuariosService.restoreUsuarioInSignal(snapshot.user, snapshot.estado, snapshot.index);
        }
        this.alerts.errorToast('No se pudo desactivar', error?.error?.message || 'Intenta nuevamente.');
      },
    });
  }
}
