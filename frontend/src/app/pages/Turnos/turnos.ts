import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import {
  AsesorSemana,
  SemanaTurno,
  TurnoDia,
  TurnosService,
} from '../../services/Turnos/turnos.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { CountUpDirective } from '../Inicio/count-up.directive';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function parseYMD(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number);
  return { y, m, d };
}

function addDaysToYMD(value: string, amount: number): string {
  const { y, m, d } = parseYMD(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

interface AdvisorGroup {
  nombreCanal: string;
  asesores: AsesorSemana[];
}

interface ScheduleWarning {
  idUsuario: string;
  asesor: string;
  code: 'NO_WORK_DAYS' | 'NO_REST_DAY';
  message: string;
}

@Component({
  selector: 'app-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent, TimepickerComponent, CountUpDirective],
  templateUrl: './turnos.html',
  styleUrl: './turnos.css',
})
export class TurnosComponent implements OnInit {
  readonly fechaReferencia = signal(new Date().toISOString().slice(0, 10));
  readonly semana = signal<SemanaTurno | null>(null);
  readonly asesores = signal<AsesorSemana[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly editorDays = signal<TurnoDia[]>([]);
  readonly editorSupernumerario = signal(false);
  readonly loading = signal(true);
  readonly publishing = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly dirtyAdvisorIds = signal<string[]>([]);
  readonly dirty = computed(() => this.dirtyAdvisorIds().length > 0);
  private baselineAdvisors = new Map<string, AsesorSemana>();
  private loadRequestId = 0;

  readonly filteredAdvisors = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('es-CO');
    if (!query) return this.asesores();
    return this.asesores().filter((advisor) =>
      advisor.nombre.toLocaleLowerCase('es-CO').includes(query)
      || advisor.usuario.toLocaleLowerCase('es-CO').includes(query)
      || advisor.correo.toLocaleLowerCase('es-CO').includes(query)
    );
  });

  readonly groupedAdvisors = computed<AdvisorGroup[]>(() => {
    const groups: AdvisorGroup[] = [];
    let current: AdvisorGroup | null = null;
    for (const advisor of this.filteredAdvisors()) {
      const nombreCanal = advisor.canal?.nombreCanal || 'Sin canal asignado';
      if (!current || current.nombreCanal !== nombreCanal) {
        current = { nombreCanal, asesores: [] };
        groups.push(current);
      }
      current.asesores.push(advisor);
    }
    return groups;
  });

  readonly selectedAdvisor = computed(() =>
    this.asesores().find((advisor) => advisor.idUsuario === this.selectedId()) || null
  );

  readonly configuredCount = computed(() => this.asesores().filter((advisor) => advisor.configurado).length);
  readonly configuredPercent = computed(() => this.asesores().length
    ? Math.round((this.configuredCount() / this.asesores().length) * 100)
    : 0);
  readonly activeCount = computed(() => this.editorDays().filter((day) => day.esLaborable).length);
  readonly validationMessage = computed(() => this.validateEditor());
  readonly weekWarnings = computed<ScheduleWarning[]>(() => this.asesores()
    .filter((advisor) => advisor.activo)
    .flatMap((advisor) => this.scheduleWarnings(advisor)));
  readonly selectedWarnings = computed(() => this.weekWarnings().filter((warning) => warning.idUsuario === this.selectedId()));

  readonly weekLabel = computed(() => {
    const s = this.semana();
    if (!s) return '';
    const a = parseYMD(s.fechaInicio);
    const b = parseYMD(s.fechaFin);
    return a.m === b.m
      ? `Semana del ${a.d} al ${b.d} de ${MESES[a.m - 1]}`
      : `Semana del ${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`;
  });

  readonly weekStatusLabel = computed(() => {
    switch (this.semana()?.estado) {
      case 'publicado': return 'Publicado';
      case 'pendiente_republicacion': return 'Cambios sin publicar';
      default: return 'Borrador';
    }
  });

  readonly publishButtonLabel = computed(() => this.semana()?.estado === 'publicado' || this.semana()?.estado === 'pendiente_republicacion'
    ? 'Republicar semana'
    : 'Publicar semana');
  readonly canPublish = computed(() => this.semana()?.estado !== 'publicado' || this.dirty());
  readonly canCopyPreviousWeek = computed(() => this.semana()?.estado === 'borrador');

  constructor(
    private readonly turnosService: TurnosService,
    private readonly permissions: PermisosService,
    private readonly alerts: SirAlertService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  canUpdate(): boolean {
    return this.permissions.tienePermiso('TURNOS.ACTUALIZAR');
  }

  load(): void {
    const requestId = ++this.loadRequestId;
    this.loading.set(true);
    this.error.set(null);
    this.turnosService.obtenerSemana(this.fechaReferencia()).subscribe({
      next: (response) => {
        if (requestId !== this.loadRequestId) return;
        this.semana.set(response.semana);
        const advisors = response.asesores.map((advisor) => this.cloneAdvisor(advisor));
        this.asesores.set(advisors);
        this.baselineAdvisors = new Map(advisors.map((advisor) => [advisor.idUsuario, this.cloneAdvisor(advisor)]));
        this.dirtyAdvisorIds.set([]);
        const selected = advisors.find((advisor) => advisor.idUsuario === this.selectedId()) || advisors[0] || null;
        this.applySelection(selected);
        this.loading.set(false);
      },
      error: (error) => {
        if (requestId !== this.loadRequestId) return;
        this.error.set(error?.error?.message || 'No se pudieron cargar los turnos de la semana.');
        this.loading.set(false);
      },
    });
  }

  prevWeek(): void {
    this.changeWeek(-7);
  }

  nextWeek(): void {
    this.changeWeek(7);
  }

  private changeWeek(deltaDays: number): void {
    if (this.dirty()) {
      this.alerts.confirm(
        '¿Cambiar de semana?',
        'Hay cambios de jornada sin guardar.',
        () => {
          this.fechaReferencia.set(addDaysToYMD(this.fechaReferencia(), deltaDays));
          this.selectedId.set(null);
          this.load();
        },
        undefined,
        { confirmText: 'Descartar cambios', cancelText: 'Seguir editando', type: 'warning' }
      );
      return;
    }
    this.fechaReferencia.set(addDaysToYMD(this.fechaReferencia(), deltaDays));
    this.load();
  }

  selectAdvisor(advisor: AsesorSemana): void {
    if (advisor.idUsuario === this.selectedId()) return;
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
    this.syncEditorDraft();
  }

  updateTime(index: number, field: 'horaInicio' | 'horaFin', value: string): void {
    if (!this.canUpdate()) return;
    this.editorDays.update((days) => days.map((day, currentIndex) => currentIndex === index
      ? { ...day, [field]: value }
      : day));
    this.syncEditorDraft();
  }

  toggleSupernumerario(checked: boolean): void {
    if (!this.canUpdate()) return;
    this.editorSupernumerario.set(checked);
    this.syncEditorDraft();
  }

  copyFirstWorkingDay(): void {
    if (!this.canUpdate()) return;
    const source = this.editorDays().find((day) => day.esLaborable && day.horaInicio && day.horaFin);
    if (!source) return;
    this.editorDays.update((days) => days.map((day) => day.esLaborable
      ? { ...day, horaInicio: source.horaInicio, horaFin: source.horaFin }
      : day));
    this.syncEditorDraft();
  }

  resetEditor(): void {
    const id = this.selectedId();
    const baseline = id ? this.baselineAdvisors.get(id) : null;
    if (!id || !baseline) return;
    const restored = this.cloneAdvisor(baseline);
    this.asesores.update((items) => items.map((item) => item.idUsuario === id ? restored : item));
    this.dirtyAdvisorIds.update((ids) => ids.filter((value) => value !== id));
    this.applySelection(restored);
  }

  publish(): void {
    const semana = this.semana();
    if (!semana || !this.canUpdate() || !this.canPublish() || this.publishing()) return;
    const invalid = this.asesores().filter((advisor) => advisor.activo).map((advisor) => ({ advisor, message: this.validateDays(advisor.turnos) })).find((item) => item.message);
    if (invalid) {
      this.alerts.errorToast('Revisa la semana', `${invalid.advisor.nombre}: ${invalid.message}`);
      return;
    }
    const warnings = this.weekWarnings();
    if (warnings.length) {
      const preview = warnings.slice(0, 3).map((warning) => `${warning.asesor}: ${warning.message}`).join(' ');
      this.alerts.confirm(
        'La semana tiene advertencias',
        `${preview}${warnings.length > 3 ? ` Hay ${warnings.length - 3} advertencias adicionales.` : ''}`,
        () => this.performPublish(true),
        undefined,
        { confirmText: 'Publicar de todas formas', cancelText: 'Seguir revisando', type: 'warning' }
      );
      return;
    }
    this.performPublish(false);
  }

  private performPublish(aceptarAdvertencias: boolean): void {
    const semana = this.semana();
    if (!semana) return;
    const jornadas = this.asesores().filter((advisor) => advisor.activo).map((advisor) => ({
      idUsuario: advisor.idUsuario,
      esSupernumerario: advisor.esSupernumerario,
      turnos: advisor.turnos.map((day) => ({
        diaSemana: day.diaSemana,
        esLaborable: day.esLaborable,
        horaInicio: day.horaInicio,
        horaFin: day.horaFin,
      })),
    }));
    this.publishing.set(true);
    this.turnosService.publicarSemana(semana.idSemana, { jornadas, aceptarAdvertencias }).subscribe({
      next: () => {
        this.publishing.set(false);
        this.alerts.successToast('Semana publicada', 'Los asesores ya pueden ver su horario.');
        this.load();
      },
      error: (error) => {
        this.publishing.set(false);
        this.alerts.errorToast('No se pudo publicar', error?.error?.message || 'Intenta nuevamente.');
      },
    });
  }

  copyFromPreviousWeek(): void {
    const semana = this.semana();
    if (!semana || !this.canUpdate()) return;
    this.alerts.confirm(
      '¿Copiar la semana anterior?',
      'Se copiarán como borrador los días, horarios y descansos de la semana pasada. Nada se guardará hasta publicar.',
      () => {
        const previousDate = addDaysToYMD(semana.fechaInicio, -7);
        this.turnosService.obtenerSemana(previousDate).subscribe({
          next: (previous) => {
            if (!previous.asesores.some((advisor) => advisor.configurado)) {
              this.alerts.errorToast('No se pudo copiar', 'La semana anterior no tiene jornadas configuradas.');
              return;
            }
            const previousById = new Map(previous.asesores.map((advisor) => [advisor.idUsuario, advisor]));
            this.asesores.update((items) => items.map((advisor) => {
              const source = previousById.get(advisor.idUsuario);
              if (!source) return advisor;
              const sourceByDay = new Map(source.turnos.map((day) => [day.diaSemana, day]));
              return {
                ...advisor,
                esSupernumerario: false,
                configurado: source.configurado,
                turnos: advisor.turnos.map((day) => {
                  const sourceDay = sourceByDay.get(day.diaSemana);
                  return sourceDay ? {
                    ...day,
                    esLaborable: sourceDay.esLaborable,
                    horaInicio: sourceDay.horaInicio,
                    horaFin: sourceDay.horaFin,
                    esSupernumerario: false,
                  } : day;
                }),
              };
            }));
            this.dirtyAdvisorIds.set(this.asesores().filter((advisor) => advisor.activo).map((advisor) => advisor.idUsuario));
            this.applySelection(this.selectedAdvisor());
            this.alerts.successToast('Semana copiada al borrador', 'Revisa los horarios y publícalos cuando estén listos.');
          },
          error: (error) => {
            this.alerts.errorToast('No se pudo copiar', error?.error?.message || 'No existe una semana anterior disponible.');
          },
        });
      },
      undefined,
      { confirmText: 'Copiar', cancelText: 'Cancelar', type: 'warning' }
    );
  }

  advisorWorkingDays(advisor: AsesorSemana): number {
    return advisor.turnos.filter((day) => day.esLaborable).length;
  }

  advisorScheduleSummary(advisor: AsesorSemana): string {
    const days = this.advisorWorkingDays(advisor);
    if (!days) return 'Sin jornada definida';
    return `${days} ${days === 1 ? 'día programado' : 'días programados'}`;
  }

  shortDayDate(value: string): string {
    const { m, d } = parseYMD(value);
    return `${d} ${MESES[m - 1].slice(0, 3)}`;
  }

  isDayInvalid(day: TurnoDia): boolean {
    if (!day.esLaborable) return false;
    return !day.horaInicio || !day.horaFin || day.horaInicio >= day.horaFin || day.horaFin > '23:00';
  }

  durationLabel(day: TurnoDia): string {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin || day.horaFin <= day.horaInicio) return '—';
    const minutes = this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  initials(advisor: AsesorSemana): string {
    const names = advisor.nombre.trim().split(/\s+/).filter(Boolean);
    return `${names[0]?.[0] || ''}${names[1]?.[0] || ''}`.toUpperCase() || '?';
  }

  private applySelection(advisor: AsesorSemana | null | undefined): void {
    this.selectedId.set(advisor?.idUsuario || null);
    this.editorDays.set(advisor ? advisor.turnos.map((day) => ({ ...day })) : []);
    this.editorSupernumerario.set(advisor?.esSupernumerario || false);
  }

  private validateEditor(): string | null {
    return this.validateDays(this.editorDays());
  }

  private validateDays(days: TurnoDia[]): string | null {
    for (const day of days) {
      if (!day.esLaborable) continue;
      if (!day.horaInicio || !day.horaFin) return `${DAY_NAMES[day.diaSemana - 1]} necesita hora de entrada y salida.`;
      if (day.horaInicio >= day.horaFin) return `La salida del ${DAY_NAMES[day.diaSemana - 1].toLowerCase()} debe ser posterior a la entrada.`;
      if (day.horaFin > '23:00') return 'La salida máxima permitida es a las 11:00 p. m.';
    }
    return null;
  }

  private syncEditorDraft(): void {
    const id = this.selectedId();
    if (!id) return;
    const days = this.editorDays().map((day) => ({ ...day, esSupernumerario: this.editorSupernumerario() }));
    this.asesores.update((items) => items.map((advisor) => advisor.idUsuario === id
      ? {
          ...advisor,
          turnos: days,
          esSupernumerario: this.editorSupernumerario(),
          configurado: days.some((day) => day.esLaborable),
        }
      : advisor));
    this.dirtyAdvisorIds.update((ids) => ids.includes(id) ? ids : [...ids, id]);
  }

  private scheduleWarnings(advisor: AsesorSemana): ScheduleWarning[] {
    const workDays = advisor.turnos.filter((day) => day.esLaborable && day.horaInicio && day.horaFin);
    const warnings: ScheduleWarning[] = [];
    const add = (code: ScheduleWarning['code'], message: string) => warnings.push({ idUsuario: advisor.idUsuario, asesor: advisor.nombre, code, message });
    if (!workDays.length) {
      add('NO_WORK_DAYS', 'No tiene ninguna jornada asignada.');
      return warnings;
    }
    if (workDays.length === 7) add('NO_REST_DAY', 'No tiene un día de descanso durante la semana.');
    return warnings;
  }

  private cloneAdvisor(advisor: AsesorSemana): AsesorSemana {
    return { ...advisor, canal: advisor.canal ? { ...advisor.canal } : null, turnos: advisor.turnos.map((day) => ({ ...day })) };
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours * 60) + minutes;
  }
}
