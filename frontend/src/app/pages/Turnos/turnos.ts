import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import {
  AsesorSemana, CanalTurno, SemanaTurno, TurnoDia, TurnosService, VacacionTurno,
} from '../../services/Turnos/turnos.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { SirDrawerService } from '../../services/Drawer/drawer.service';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function parseYMD(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatYMD(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value: string, amount: number): string {
  const date = parseYMD(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatYMD(date);
}

function easterSunday(year: number): Date {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nextMonday(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDay();
  if (day !== 1) result.setUTCDate(result.getUTCDate() + ((8 - day) % 7));
  return result;
}

function colombianHolidays(year: number): Set<string> {
  const dates = new Set<string>();
  const fixed = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]];
  fixed.forEach(([month, day]) => dates.add(formatYMD(new Date(Date.UTC(year, month - 1, day)))));
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]
    .forEach(([month, day]) => dates.add(formatYMD(nextMonday(new Date(Date.UTC(year, month - 1, day))))));
  const easter = easterSunday(year);
  [-3, -2, 43, 64, 71].forEach((offset) => {
    const holiday = new Date(easter); holiday.setUTCDate(holiday.getUTCDate() + offset); dates.add(formatYMD(holiday));
  });
  return dates;
}

interface AdvisorGroup { name: string; advisors: AsesorSemana[]; }
interface ScheduleWarning {
  idUsuario: string;
  nombre: string;
  code: 'NO_WORK_DAYS' | 'NO_REST_DAY';
  message: string;
  shortLabel: string;
}

@Component({
  selector: 'app-turnos', standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent, TimepickerComponent],
  templateUrl: './turnos.html', styleUrl: './turnos.css',
})
export class TurnosComponent implements OnInit {
  private readonly drawer = inject(SirDrawerService);
  private readonly route = inject(ActivatedRoute);
  readonly fechaReferencia = signal(new Date().toISOString().slice(0, 10));
  readonly semana = signal<SemanaTurno | null>(null);
  readonly asesores = signal<AsesorSemana[]>([]);
  readonly canales = signal<CanalTurno[]>([]);
  readonly loading = signal(true);
  readonly publishing = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly dirtyAdvisorIds = signal<string[]>([]);
  readonly selectedAdvisorId = signal<string | null>(null);
  readonly selectedDayIndex = signal<number | null>(null);
  readonly panelMode = signal<'day' | 'vacation' | null>(null);
  readonly vacationDraft = signal<VacacionTurno | null>(null);
  private baseline = new Map<string, AsesorSemana>();
  private requestId = 0;

  readonly dirty = computed(() => this.dirtyAdvisorIds().length > 0);
  readonly filteredAdvisors = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('es-CO');
    return this.asesores().filter((advisor) => !query
      || advisor.nombre.toLocaleLowerCase('es-CO').includes(query)
      || (advisor.canal?.nombreCanal || '').toLocaleLowerCase('es-CO').includes(query));
  });
  readonly groupedAdvisors = computed<AdvisorGroup[]>(() => {
    const groups = new Map<string, AsesorSemana[]>();
    for (const advisor of this.filteredAdvisors()) {
      const name = advisor.canal?.nombreCanal || 'Sin canal asignado';
      groups.set(name, [...(groups.get(name) || []), advisor]);
    }
    return [...groups].map(([name, advisors]) => ({ name, advisors }));
  });
  readonly selectedAdvisor = computed(() => this.asesores().find((item) => item.idUsuario === this.selectedAdvisorId()) || null);
  readonly selectedDay = computed(() => {
    const advisor = this.selectedAdvisor(); const index = this.selectedDayIndex();
    return advisor && index != null ? advisor.turnos[index] : null;
  });
  readonly weekWarnings = computed<ScheduleWarning[]>(() => this.asesores()
    .filter((advisor) => advisor.activo && !this.isFullWeekVacation(advisor))
    .flatMap((advisor): ScheduleWarning[] => {
      const workDays = this.workingDays(advisor);
      if (workDays === 0) return [{
        idUsuario: advisor.idUsuario, nombre: advisor.nombre, code: 'NO_WORK_DAYS' as const,
        message: 'No tiene ninguna jornada asignada.', shortLabel: 'Sin horario',
      }];
      if (workDays === 7) return [{
        idUsuario: advisor.idUsuario, nombre: advisor.nombre, code: 'NO_REST_DAY' as const,
        message: 'Tiene los siete días programados.', shortLabel: '7 días',
      }];
      return [];
    }));
  readonly warningSummary = computed(() => {
    const warnings = this.weekWarnings();
    const withoutSchedule = warnings.filter((warning) => warning.code === 'NO_WORK_DAYS').length;
    const withoutRest = warnings.filter((warning) => warning.code === 'NO_REST_DAY').length;
    return [
      withoutSchedule ? `${withoutSchedule} sin horario` : '',
      withoutRest ? `${withoutRest} con 7 días` : '',
    ].filter(Boolean).join(' · ');
  });
  readonly weekLabel = computed(() => {
    const week = this.semana(); if (!week) return '';
    const from = parseYMD(week.fechaInicio); const to = parseYMD(week.fechaFin);
    return from.getUTCMonth() === to.getUTCMonth()
      ? `${from.getUTCDate()} al ${to.getUTCDate()} de ${MESES[from.getUTCMonth()]}`
      : `${from.getUTCDate()} de ${MESES[from.getUTCMonth()]} al ${to.getUTCDate()} de ${MESES[to.getUTCMonth()]}`;
  });
  readonly weekStatusLabel = computed(() => this.semana()?.estado === 'publicado' ? 'Publicado'
    : this.semana()?.estado === 'pendiente_republicacion' ? 'Cambios sin publicar' : 'Borrador');
  readonly publishLabel = computed(() => this.semana()?.estado === 'borrador' ? 'Publicar semana' : 'Republicar semana');
  readonly canPublish = computed(() => this.semana()?.estado !== 'publicado' || this.dirty());

  constructor(private readonly service: TurnosService, private readonly permissions: PermisosService, private readonly alerts: SirAlertService) {}

  ngOnInit(): void {
    const requestedAdvisor = this.route.snapshot.queryParamMap.get('asesor');
    if (requestedAdvisor) this.selectedAdvisorId.set(requestedAdvisor);
    this.service.obtenerCanales().subscribe({ next: (r) => this.canales.set(r.canales) });
    this.load();
  }
  canUpdate(): boolean { return this.permissions.tienePermiso('TURNOS.ACTUALIZAR'); }

  load(): void {
    const id = ++this.requestId; this.loading.set(true); this.error.set(null);
    this.service.obtenerSemana(this.fechaReferencia()).subscribe({
      next: (response) => {
        if (id !== this.requestId) return;
        const advisors = response.asesores.map((advisor) => this.cloneAdvisor(advisor));
        this.semana.set(response.semana); this.asesores.set(advisors);
        this.baseline = new Map(advisors.map((advisor) => [advisor.idUsuario, this.cloneAdvisor(advisor)]));
        this.dirtyAdvisorIds.set([]); this.panelMode.set(null); this.vacationDraft.set(null);
        this.selectedAdvisorId.set(advisors.find((item) => item.idUsuario === this.selectedAdvisorId())?.idUsuario || advisors[0]?.idUsuario || null);
        this.loading.set(false);
      },
      error: (error) => { if (id === this.requestId) { this.error.set(error?.error?.message || 'No se pudo cargar la semana.'); this.loading.set(false); } },
    });
  }

  changeWeek(days: number): void {
    const proceed = () => { this.fechaReferencia.set(addDays(this.fechaReferencia(), days)); this.load(); };
    if (!this.dirty()) { proceed(); return; }
    this.alerts.confirm('¿Cambiar de semana?', 'Los cambios del borrador se perderán.', proceed, undefined,
      { confirmText: 'Descartar cambios', cancelText: 'Seguir editando', type: 'warning' });
  }

  selectAdvisor(advisor: AsesorSemana): void { this.selectedAdvisorId.set(advisor.idUsuario); this.panelMode.set(null); }

  advisorWarning(advisor: AsesorSemana): ScheduleWarning | null {
    return this.weekWarnings().find((warning) => warning.idUsuario === advisor.idUsuario) || null;
  }

  reviewFirstWarning(): void {
    const warning = this.weekWarnings()[0];
    if (!warning) return;
    this.selectedAdvisorId.set(warning.idUsuario);
    this.panelMode.set(null);
    queueMicrotask(() => document.querySelector('.schedule-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  openVacation(advisor: AsesorSemana): void {
    this.selectedAdvisorId.set(advisor.idUsuario);
    const initial = advisor.vacacion ? { ...advisor.vacacion } : this.suggestVacation(this.semana()?.fechaInicio || this.fechaReferencia());
    this.drawer.openTurnosVacaciones({
      advisorName: advisor.nombre,
      vacation: initial,
      hasVacation: !!advisor.vacacion,
      suggest: (start: string, idVacacion: string | null) => this.suggestVacation(start, idVacacion),
      onApply: (vacation: VacacionTurno) => this.applyVacationFor(advisor.idUsuario, vacation),
      onRemove: () => this.removeVacationFor(advisor.idUsuario),
    });
  }

  closePanel(): void { this.panelMode.set(null); this.selectedDayIndex.set(null); this.vacationDraft.set(null); }

  toggleDay(index: number, checked: boolean): void {
    const day = this.selectedAdvisor()?.turnos[index]; if (!day || this.isVacationDate(this.selectedAdvisor(), day.fecha)) return;
    this.updateSelectedDay(index, { esLaborable: checked, horaInicio: checked ? day.horaInicio || '08:00' : null, horaFin: checked ? day.horaFin || '17:00' : null });
  }

  updateTime(index: number, field: 'horaInicio' | 'horaFin', value: string): void { this.updateSelectedDay(index, { [field]: value }); }

  private updateSelectedDay(index: number, changes: Partial<TurnoDia>): void {
    const id = this.selectedAdvisorId(); if (!id || !this.canUpdate()) return;
    this.asesores.update((items) => items.map((advisor) => advisor.idUsuario !== id ? advisor : {
      ...advisor, configurado: true, turnos: advisor.turnos.map((day, i) => i === index ? { ...day, ...changes } : day),
    })); this.markDirty(id);
  }

  changeChannel(advisor: AsesorSemana, idCanal: string): void {
    const channel = this.canales().find((item) => item.idCanal === idCanal) || null;
    this.asesores.update((items) => items.map((item) => item.idUsuario === advisor.idUsuario
      ? { ...item, canal: channel, canalSemanal: channel } : item)); this.markDirty(advisor.idUsuario);
  }

  toggleSuper(advisor: AsesorSemana, checked: boolean): void {
    this.asesores.update((items) => items.map((item) => item.idUsuario === advisor.idUsuario ? { ...item, esSupernumerario: checked } : item));
    this.markDirty(advisor.idUsuario);
  }

  copyFirstWorkingDay(): void {
    const advisor = this.selectedAdvisor(); if (!advisor || !this.canUpdate()) return;
    const source = advisor.turnos.find((day) => day.esLaborable && day.horaInicio && day.horaFin); if (!source) return;
    this.asesores.update((items) => items.map((item) => item.idUsuario !== advisor.idUsuario ? item : {
      ...item, turnos: item.turnos.map((day) => day.esLaborable && !this.isVacationDate(item, day.fecha)
        ? { ...day, horaInicio: source.horaInicio, horaFin: source.horaFin } : day),
    })); this.markDirty(advisor.idUsuario);
  }

  updateVacationStart(value: string): void { if (value) this.vacationDraft.set(this.suggestVacation(value, this.vacationDraft()?.idVacacion)); }
  updateVacationField(field: 'fechaFin' | 'fechaRegreso' | 'observaciones', value: string): void {
    const draft = this.vacationDraft(); if (draft) this.vacationDraft.set({ ...draft, [field]: value });
  }

  applyVacation(): void {
    const id = this.selectedAdvisorId(); const vacation = this.vacationDraft(); if (!id || !vacation) return;
    if (!vacation.fechaInicio || !vacation.fechaFin || !vacation.fechaRegreso || vacation.fechaInicio > vacation.fechaFin || vacation.fechaRegreso <= vacation.fechaFin) {
      this.alerts.errorToast('Revisa las fechas', 'El regreso debe ser posterior al último día de vacaciones.'); return;
    }
    this.applyVacationFor(id, vacation);
    this.closePanel();
  }

  private applyVacationFor(id: string, vacation: VacacionTurno): void {
    vacation.diasHabiles = this.countBusinessDays(vacation.fechaInicio, vacation.fechaFin);
    this.asesores.update((items) => items.map((advisor) => advisor.idUsuario !== id ? advisor : {
      ...advisor, vacacion: { ...vacation },
      turnos: advisor.turnos.map((day) => day.fecha >= vacation.fechaInicio && day.fecha <= vacation.fechaFin
        ? { ...day, esLaborable: false, horaInicio: null, horaFin: null } : day),
    })); this.markDirty(id);
  }

  removeVacation(): void {
    const id = this.selectedAdvisorId(); if (!id) return;
    this.removeVacationFor(id); this.closePanel();
  }

  private removeVacationFor(id: string): void {
    this.asesores.update((items) => items.map((advisor) => advisor.idUsuario === id ? { ...advisor, vacacion: null } : advisor));
    this.markDirty(id);
  }

  resetAdvisor(advisor: AsesorSemana): void {
    const original = this.baseline.get(advisor.idUsuario); if (!original) return;
    this.asesores.update((items) => items.map((item) => item.idUsuario === advisor.idUsuario ? this.cloneAdvisor(original) : item));
    this.dirtyAdvisorIds.update((ids) => ids.filter((id) => id !== advisor.idUsuario)); this.panelMode.set(null);
  }

  copyPrevious(): void {
    const week = this.semana(); if (!week) return;
    this.service.obtenerSemana(addDays(week.fechaInicio, -7)).subscribe({ next: (previous) => {
      const byId = new Map(previous.asesores.map((advisor) => [advisor.idUsuario, advisor]));
      this.asesores.update((items) => items.map((advisor) => {
        const source = byId.get(advisor.idUsuario); if (!source) return advisor;
        return { ...advisor, turnos: advisor.turnos.map((day, index) => ({ ...day,
          esLaborable: source.turnos[index]?.esLaborable || false,
          horaInicio: source.turnos[index]?.horaInicio || null, horaFin: source.turnos[index]?.horaFin || null,
        })) };
      })); this.dirtyAdvisorIds.set(this.asesores().filter((a) => a.activo).map((a) => a.idUsuario));
      this.alerts.successToast('Semana copiada', 'Los horarios quedaron en el borrador actual.');
    }, error: () => this.alerts.errorToast('No se pudo copiar', 'La semana anterior no tiene horarios disponibles.') });
  }

  publish(): void {
    const week = this.semana(); if (!week || !this.canUpdate() || !this.canPublish() || this.publishing()) return;
    const invalid = this.asesores().flatMap((advisor) => advisor.turnos.filter((day) => this.isDayInvalid(day)).map(() => advisor.nombre))[0];
    if (invalid) { this.alerts.errorToast('Revisa la semana', `${invalid} tiene un rango horario incompleto.`); return; }
    const perform = (accept: boolean) => {
      this.publishing.set(true);
      this.service.publicarSemana(week.idSemana, { aceptarAdvertencias: accept, jornadas: this.asesores().filter((a) => a.activo).map((advisor) => ({
        idUsuario: advisor.idUsuario, esSupernumerario: advisor.esSupernumerario,
        idCanalSemanal: advisor.canal?.idCanal || null,
        vacacion: advisor.vacacion ? { ...advisor.vacacion } : null,
        turnos: advisor.turnos.map(({ diaSemana, esLaborable, horaInicio, horaFin }) => ({ diaSemana, esLaborable, horaInicio, horaFin })),
      })) }).subscribe({ next: () => { this.publishing.set(false); this.alerts.successToast('Semana publicada', 'Horarios, canales y vacaciones ya están disponibles.'); this.load(); },
        error: (error) => { this.publishing.set(false); this.alerts.errorToast('No se pudo publicar', error?.error?.message || 'Intenta nuevamente.'); } });
    };
    if (this.weekWarnings().length) {
      this.alerts.confirm(
        `${this.weekWarnings().length} asesores por revisar`,
        `${this.warningSummary()}. Puedes revisar sus jornadas o publicar la semana conservando estas advertencias.`,
        () => perform(true),
        () => this.reviewFirstWarning(),
        { confirmText: 'Publicar de todas formas', cancelText: 'Revisar primero', type: 'warning' },
      );
      return;
    }

    this.alerts.confirm(
      this.semana()?.estado === 'borrador' ? '¿Publicar esta semana?' : '¿Republicar esta semana?',
      `Los horarios, canales y vacaciones de ${this.asesores().filter((advisor) => advisor.activo).length} asesores quedarán visibles en la aplicación.`,
      () => perform(false),
      undefined,
      { confirmText: this.publishLabel(), cancelText: 'Seguir revisando', type: 'info' },
    );
  }

  weeklyHours(advisor: AsesorSemana): string {
    const minutes = advisor.turnos.reduce((sum, day) => sum + (day.esLaborable && day.horaInicio && day.horaFin ? this.minutes(day.horaFin) - this.minutes(day.horaInicio) : 0), 0);
    return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
  }
  workingDays(advisor: AsesorSemana): number { return advisor.turnos.filter((day) => day.esLaborable).length; }
  isDayInvalid(day: TurnoDia): boolean { return day.esLaborable && (!day.horaInicio || !day.horaFin || day.horaInicio >= day.horaFin || day.horaFin > '23:00'); }
  isVacationDate(advisor: AsesorSemana | null, date: string): boolean { return !!advisor?.vacacion && date >= advisor.vacacion.fechaInicio && date <= advisor.vacacion.fechaFin; }
  initials(advisor: AsesorSemana): string { return advisor.nombre.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
  shortDate(value: string): string { const date = parseYMD(value); return `${date.getUTCDate()} ${MESES[date.getUTCMonth()].slice(0, 3)}`; }

  private isFullWeekVacation(advisor: AsesorSemana): boolean { const week = this.semana(); return !!week && !!advisor.vacacion && advisor.vacacion.fechaInicio <= week.fechaInicio && advisor.vacacion.fechaFin >= week.fechaFin; }
  private markDirty(id: string): void { this.dirtyAdvisorIds.update((ids) => ids.includes(id) ? ids : [...ids, id]); }
  private minutes(value: string): number { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
  private cloneAdvisor(advisor: AsesorSemana): AsesorSemana { return { ...advisor, canal: advisor.canal ? { ...advisor.canal } : null, canalBase: advisor.canalBase ? { ...advisor.canalBase } : null, canalSemanal: advisor.canalSemanal ? { ...advisor.canalSemanal } : null, vacacion: advisor.vacacion ? { ...advisor.vacacion } : null, turnos: advisor.turnos.map((day) => ({ ...day })) }; }
  private isBusinessDay(value: string): boolean { const date = parseYMD(value); const day = date.getUTCDay(); return day !== 0 && !colombianHolidays(date.getUTCFullYear()).has(value); }
  private countBusinessDays(from: string, to: string): number { let count = 0; for (let date = from; date <= to; date = addDays(date, 1)) if (this.isBusinessDay(date)) count++; return count; }
  private suggestVacation(from: string, idVacacion: string | null = null): VacacionTurno {
    let start = from; while (!this.isBusinessDay(start)) start = addDays(start, 1);
    let end = start; let count = 0; while (count < 15) { if (this.isBusinessDay(end)) count++; if (count < 15) end = addDays(end, 1); }
    let returnDate = addDays(end, 1); while (!this.isBusinessDay(returnDate)) returnDate = addDays(returnDate, 1);
    return { idVacacion, fechaInicio: start, fechaFin: end, fechaRegreso: returnDate, diasHabiles: 15, estado: 'programada', observaciones: null };
  }
}
