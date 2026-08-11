import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { EstadoTurno, MiJornadaSemana, TurnoDia, TurnosService } from '../../services/Turnos/turnos.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { CountUpDirective } from '../Inicio/count-up.directive';

@Component({
  selector: 'app-mi-turno',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent, CountUpDirective],
  templateUrl: './mi-turno.html',
  styleUrl: './mi-turno.css',
})
export class MiTurnoComponent implements OnInit, OnDestroy {
  readonly jornada = signal<MiJornadaSemana | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notPublished = signal(false);
  readonly now = signal(new Date());
  readonly zone = signal('America/Bogota');
  private timer?: number;
  private loadRequestId = 0;

  readonly currentStatus = computed<EstadoTurno>(() => {
    const schedule = this.jornada();
    if (!schedule?.configurado || schedule.turnos.length !== 7) return 'sin_configurar';
    const clock = this.clockParts(this.now());
    const today = schedule.turnos.find((day) => day.diaSemana === clock.day);
    return today?.esLaborable && !!today.horaInicio && !!today.horaFin
      && clock.time >= today.horaInicio && clock.time < today.horaFin ? 'en_turno' : 'fuera_turno';
  });

  readonly workingDays = computed(() => (this.jornada()?.turnos || []).filter((day) => day.esLaborable).length);

  constructor(private readonly turnosService: TurnosService) {}

  ngOnInit(): void {
    this.load();
    this.timer = window.setInterval(() => this.now.set(new Date()), 60_000);
  }

  ngOnDestroy(): void {
    if (this.timer) window.clearInterval(this.timer);
  }

  load(): void {
    const requestId = ++this.loadRequestId;
    this.loading.set(true);
    this.error.set('');
    this.notPublished.set(false);
    this.turnosService.obtenerMiJornada().subscribe({
      next: (response) => {
        if (requestId !== this.loadRequestId) return;
        this.jornada.set(response.jornada);
        this.zone.set(response.zonaHoraria || 'America/Bogota');
        this.loading.set(false);
      },
      error: (error) => {
        if (requestId !== this.loadRequestId) return;
        if (error?.error?.errorCode === 'WEEK_NOT_PUBLISHED') {
          this.notPublished.set(true);
        } else {
          this.error.set(error?.error?.message || 'No pudimos consultar tu horario.');
        }
        this.loading.set(false);
      },
    });
  }

  statusLabel(): string {
    if (this.currentStatus() === 'en_turno') return 'En horario ahora';
    if (this.currentStatus() === 'fuera_turno') return 'Fuera de horario';
    return 'Sin jornada';
  }

  durationLabel(day: TurnoDia): string {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin) return 'Descanso';
    const minutes = this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  weeklyDurationLabel(): string {
    const minutes = (this.jornada()?.turnos || []).reduce((total, day) => {
      if (!day.esLaborable || !day.horaInicio || !day.horaFin) return total;
      return total + this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
    }, 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  timeLabel(value: string | null): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    const period = hours >= 12 ? 'p. m.' : 'a. m.';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  weekRangeLabel(): string {
    const schedule = this.jornada();
    if (!schedule) return 'Semana actual';
    const start = this.parseDate(schedule.semana.fechaInicio);
    const end = this.parseDate(schedule.semana.fechaFin);
    const startMonth = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(start);
    const endMonth = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(end);
    if (startMonth === endMonth) return `${start.getUTCDate()} al ${end.getUTCDate()} de ${endMonth}`;
    return `${start.getUTCDate()} de ${startMonth} al ${end.getUTCDate()} de ${endMonth}`;
  }

  shortDate(value: string): string {
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(this.parseDate(value))
      .replace('.', '');
  }

  dayNumber(value: string): number {
    return this.parseDate(value).getUTCDate();
  }

  monthLabel(value: string): string {
    return new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' })
      .format(this.parseDate(value))
      .replace('.', '');
  }

  isToday(day: TurnoDia): boolean {
    return day.diaSemana === this.clockParts(this.now()).day;
  }

  isVacationDay(day: TurnoDia): boolean {
    const vacation = this.jornada()?.vacacion;
    return !!vacation && day.fecha >= vacation.fechaInicio && day.fecha <= vacation.fechaFin;
  }

  vacationLabel(): string {
    const vacation = this.jornada()?.vacacion;
    if (!vacation) return '';
    return `${this.shortDate(vacation.fechaInicio)} al ${this.shortDate(vacation.fechaFin)} · regreso ${this.shortDate(vacation.fechaRegreso)}`;
  }

  private clockParts(date: Date): { day: number; time: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.zone(), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const dayNumber: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return { day: dayNumber[values['weekday']], time: `${values['hour']}:${values['minute']}` };
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours * 60) + minutes;
  }

  private parseDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00Z`);
  }
}
