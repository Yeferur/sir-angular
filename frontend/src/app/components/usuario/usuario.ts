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
import { AsesorSemana, TurnoDia, TurnosService } from '../../services/Turnos/turnos.service';

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
  Modulo_Permiso?: string;
}

interface PermissionGroup {
  module: string;
  permissions: UsuarioPermiso[];
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
  private readonly turnosService = inject(TurnosService);

  readonly usuario = signal<UsuarioDetalle | null>(null);
  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly activeAction = signal<'sessions' | 'deactivate' | null>(null);
  readonly advisorSchedule = signal<AsesorSemana | null>(null);
  readonly scheduleLoading = signal(false);
  readonly scheduleError = signal('');
  readonly estados = this.usuariosService.getEstadosSignal();

  readonly sessionState = computed(() => this.estados().get(String(this.Id_Usuario)) || 'cerrada');
  readonly hasOpenSession = computed(() => this.sessionState() !== 'cerrada');
  readonly isCurrentUser = computed(() => String(this.auth.getUser()?.id || '') === String(this.Id_Usuario));
  readonly canUpdate = computed(() => this.permisosService.tienePermiso('USUARIOS.ACTUALIZAR'));
  readonly canViewSchedule = computed(() =>
    this.permisosService.tienePermiso('TURNOS.LEER')
    || this.permisosService.tienePermiso('TURNOS.ACTUALIZAR')
  );
  readonly canEditSchedule = computed(() => this.permisosService.tienePermiso('TURNOS.ACTUALIZAR'));
  readonly isAdvisor = computed(() =>
    String(this.usuario()?.Nombre_Rol || '').toLocaleLowerCase('es-CO').includes('asesor')
  );
  readonly canDeactivate = computed(() =>
    this.permisosService.tienePermiso('USUARIOS.ELIMINAR')
    && !this.isCurrentUser()
    && this.isActive()
  );
  readonly permissionGroups = computed<PermissionGroup[]>(() => {
    const grouped = new Map<string, UsuarioPermiso[]>();

    for (const permission of this.usuario()?.permisosEfectivos || []) {
      const module = String(permission.Modulo_Permiso || 'Otros').trim() || 'Otros';
      grouped.set(module, [...(grouped.get(module) || []), permission]);
    }

    return [...grouped.entries()].map(([module, permissions]) => ({ module, permissions }));
  });
  readonly effectivePermissionCount = computed(() =>
    this.usuario()?.permisosEfectivos?.length || 0
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Usuario']) this.loadUsuario();
  }

  loadUsuario(): void {
    if (!this.Id_Usuario) return;
    this.isLoading.set(true);
    this.loadError.set('');
    this.advisorSchedule.set(null);
    this.scheduleError.set('');

    this.usuariosService.obtenerUsuario(String(this.Id_Usuario)).subscribe({
      next: (usuario) => {
        this.usuario.set(usuario);
        this.isLoading.set(false);
        if (this.isAdvisor() && this.canViewSchedule()) this.loadSchedule();
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

  editarTurnos(): void {
    if (!this.canEditSchedule()) return;
    this.onClose.emit();
    void this.router.navigate(['/Turnos'], { queryParams: { asesor: this.Id_Usuario } });
  }

  workingDays(): number {
    return this.advisorSchedule()?.turnos.filter((day) => day.esLaborable).length || 0;
  }

  weeklyHours(): string {
    const minutes = (this.advisorSchedule()?.turnos || []).reduce((total, day) => {
      if (!day.esLaborable || !day.horaInicio || !day.horaFin) return total;
      return total + this.timeMinutes(day.horaFin) - this.timeMinutes(day.horaInicio);
    }, 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  isVacationDay(day: TurnoDia): boolean {
    const vacation = this.advisorSchedule()?.vacacion;
    return !!vacation && day.fecha >= vacation.fechaInicio && day.fecha <= vacation.fechaFin;
  }

  shiftLabel(day: TurnoDia): string {
    if (this.isVacationDay(day)) return 'Vacaciones';
    if (!day.esLaborable) return 'Descanso';
    return `${this.shortTime(day.horaInicio)}–${this.shortTime(day.horaFin)}`;
  }

  shortDate(value: string): string {
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(`${value}T12:00:00Z`)).replace('.', '');
  }

  private loadSchedule(): void {
    this.scheduleLoading.set(true);
    this.scheduleError.set('');
    this.turnosService.obtenerSemana().subscribe({
      next: (response) => {
        this.advisorSchedule.set(response.asesores.find((advisor) => String(advisor.idUsuario) === String(this.Id_Usuario)) || null);
        this.scheduleLoading.set(false);
      },
      error: (error) => {
        this.scheduleError.set(error?.error?.message || 'No se pudo consultar el horario de esta semana.');
        this.scheduleLoading.set(false);
      },
    });
  }

  private timeMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private shortTime(value: string | null): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'p. m.' : 'a. m.'}`;
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
