import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import {
  AsesorTurnos,
  EstadoTurno,
  TurnoDia,
  TurnosService,
} from '../../services/Turnos/turnos.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

@Component({
  selector: 'app-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent],
  templateUrl: './turnos.html',
  styleUrl: './turnos.css',
})
export class TurnosComponent implements OnInit, OnDestroy {
  readonly asesores = signal<AsesorTurnos[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly editorDays = signal<TurnoDia[]>(this.emptyWeek());
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly now = signal(new Date());
  readonly dirty = signal(false);
  readonly zone = signal('America/Bogota');

  private clockTimer?: number;

  readonly filteredAdvisors = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('es-CO');
    if (!query) return this.asesores();
    return this.asesores().filter((advisor) =>
      advisor.nombre.toLocaleLowerCase('es-CO').includes(query)
      || advisor.usuario.toLocaleLowerCase('es-CO').includes(query)
      || advisor.correo.toLocaleLowerCase('es-CO').includes(query)
    );
  });

  readonly selectedAdvisor = computed(() =>
    this.asesores().find((advisor) => advisor.idUsuario === this.selectedId()) || null
  );

  readonly configuredCount = computed(() => this.asesores().filter((advisor) => advisor.configurado).length);
  readonly workingNowCount = computed(() => this.asesores().filter((advisor) => this.currentStatus(advisor) === 'en_turno').length);
  readonly activeCount = computed(() => this.editorDays().filter((day) => day.esLaborable).length);
  readonly weeklyMinutes = computed(() => this.editorDays().reduce((total, day) => {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin) return total;
    return total + Math.max(0, this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio));
  }, 0));
  readonly validationMessage = computed(() => this.validateEditor());

  constructor(
    private readonly turnosService: TurnosService,
    private readonly permissions: PermisosService,
    private readonly alerts: SirAlertService,
  ) {}

  ngOnInit(): void {
    this.load();
    this.clockTimer = window.setInterval(() => this.now.set(new Date()), 60_000);
  }

  ngOnDestroy(): void {
    if (this.clockTimer) window.clearInterval(this.clockTimer);
  }

  canUpdate(): boolean {
    return this.permissions.tienePermiso('TURNOS.ACTUALIZAR');
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.turnosService.listarAsesores().subscribe({
      next: (response) => {
        const advisors = response?.asesores || [];
        this.asesores.set(advisors);
        this.zone.set(response?.zonaHoraria || 'America/Bogota');
        const selected = advisors.find((advisor) => advisor.idUsuario === this.selectedId()) || advisors[0] || null;
        this.selectedId.set(selected?.idUsuario || null);
        this.editorDays.set(this.scheduleFor(selected));
        this.dirty.set(false);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.message || 'No se pudieron cargar las jornadas.');
        this.loading.set(false);
      },
    });
  }

  selectAdvisor(advisor: AsesorTurnos): void {
    if (this.saving() || advisor.idUsuario === this.selectedId()) return;
    if (this.dirty()) {
      this.alerts.confirm(
        '¿Cambiar de asesor?',
        'Hay cambios de jornada sin guardar.',
        () => this.applySelection(advisor),
        undefined,
        { confirmText: 'Descartar cambios', cancelText: 'Seguir editando', type: 'warning' }
      );
      return;
    }
    this.applySelection(advisor);
  }

  updateSearch(value: string): void {
    this.search.set(value);
  }

  toggleDay(index: number, checked: boolean): void {
    if (!this.canUpdate()) return;
    this.editorDays.update((days) => days.map((day, currentIndex) => currentIndex === index
      ? {
          ...day,
          esLaborable: checked,
          horaInicio: checked ? (day.horaInicio || '08:00') : null,
          horaFin: checked ? (day.horaFin || '17:00') : null,
        }
      : day));
    this.dirty.set(true);
  }

  updateTime(index: number, field: 'horaInicio' | 'horaFin', value: string): void {
    if (!this.canUpdate()) return;
    this.editorDays.update((days) => days.map((day, currentIndex) => currentIndex === index
      ? { ...day, [field]: value }
      : day));
    this.dirty.set(true);
  }

  copyFirstWorkingDay(): void {
    if (!this.canUpdate()) return;
    const source = this.editorDays().find((day) => day.esLaborable && day.horaInicio && day.horaFin);
    if (!source) return;
    this.editorDays.update((days) => days.map((day) => day.esLaborable
      ? { ...day, horaInicio: source.horaInicio, horaFin: source.horaFin }
      : day));
    this.dirty.set(true);
  }

  resetEditor(): void {
    this.editorDays.set(this.scheduleFor(this.selectedAdvisor()));
    this.dirty.set(false);
  }

  save(): void {
    const advisor = this.selectedAdvisor();
    if (!advisor || !this.canUpdate() || this.saving()) return;
    const validation = this.validationMessage();
    if (validation) {
      this.alerts.errorToast('Revisa la jornada', validation);
      return;
    }

    this.saving.set(true);
    this.turnosService.actualizarJornada(advisor.idUsuario, this.editorDays()).subscribe({
      next: (result) => {
        this.asesores.update((items) => items.map((item) => item.idUsuario === advisor.idUsuario
          ? { ...item, configurado: true, estadoActual: result.estadoActual, turnos: result.turnos }
          : item));
        this.editorDays.set(result.turnos.map((day) => ({ ...day })));
        this.dirty.set(false);
        this.saving.set(false);
        this.alerts.successToast('Jornada guardada', `El horario de ${advisor.nombre} quedó actualizado.`);
      },
      error: (error) => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo guardar', error?.error?.message || 'Intenta nuevamente.');
      },
    });
  }

  currentStatus(advisor: AsesorTurnos): EstadoTurno {
    if (!advisor.configurado || advisor.turnos.length !== 7) return 'sin_configurar';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.zone(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(this.now());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const dayNumber: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const today = advisor.turnos.find((day) => day.diaSemana === dayNumber[values['weekday']]);
    const time = `${values['hour']}:${values['minute']}`;
    return today?.esLaborable && !!today.horaInicio && !!today.horaFin
      && time >= today.horaInicio && time < today.horaFin ? 'en_turno' : 'fuera_turno';
  }

  statusLabel(advisor: AsesorTurnos): string {
    const status = this.currentStatus(advisor);
    if (status === 'en_turno') return 'En turno';
    if (status === 'fuera_turno') return 'Fuera de turno';
    return 'Sin configurar';
  }

  formatWeeklyHours(): string {
    const minutes = this.weeklyMinutes();
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  durationLabel(day: TurnoDia): string {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin || day.horaFin <= day.horaInicio) return '—';
    const minutes = this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  initials(advisor: AsesorTurnos): string {
    const names = advisor.nombre.trim().split(/\s+/).filter(Boolean);
    return `${names[0]?.[0] || ''}${names[1]?.[0] || ''}`.toUpperCase() || '?';
  }

  private applySelection(advisor: AsesorTurnos): void {
    this.selectedId.set(advisor.idUsuario);
    this.editorDays.set(this.scheduleFor(advisor));
    this.dirty.set(false);
  }

  private scheduleFor(advisor: AsesorTurnos | null): TurnoDia[] {
    if (advisor?.turnos?.length === 7) return advisor.turnos.map((day) => ({ ...day }));
    return this.emptyWeek();
  }

  private emptyWeek(): TurnoDia[] {
    return DAY_NAMES.map((nombreDia, index): TurnoDia => ({
      diaSemana: index + 1,
      nombreDia,
      esLaborable: false,
      horaInicio: null,
      horaFin: null,
    }));
  }

  private validateEditor(): string | null {
    for (const day of this.editorDays()) {
      if (!day.esLaborable) continue;
      if (!day.horaInicio || !day.horaFin) return `${day.nombreDia} necesita hora de entrada y salida.`;
      if (day.horaInicio >= day.horaFin) return `La salida del ${day.nombreDia.toLowerCase()} debe ser posterior a la entrada.`;
      if (day.horaFin > '23:00') return 'La salida máxima permitida es a las 11:00 p. m.';
    }
    return null;
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours * 60) + minutes;
  }
}
