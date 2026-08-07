import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AsesorTurnos, EstadoTurno, TurnoDia, TurnosService } from '../../services/Turnos/turnos.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

@Component({
  selector: 'app-mi-turno',
  standalone: true,
  imports: [CommonModule, RouterLink, LoadingStateComponent],
  templateUrl: './mi-turno.html',
  styleUrl: './mi-turno.css',
})
export class MiTurnoComponent implements OnInit, OnDestroy {
  readonly jornada = signal<AsesorTurnos | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly now = signal(new Date());
  readonly zone = signal('America/Bogota');
  private timer?: number;

  readonly currentStatus = computed<EstadoTurno>(() => {
    const schedule = this.jornada();
    if (!schedule?.configurado || schedule.turnos.length !== 7) return 'sin_configurar';
    const clock = this.clockParts(this.now());
    const today = schedule.turnos.find((day) => day.diaSemana === clock.day);
    return today?.esLaborable && !!today.horaInicio && !!today.horaFin
      && clock.time >= today.horaInicio && clock.time < today.horaFin ? 'en_turno' : 'fuera_turno';
  });

  readonly weeklyMinutes = computed(() => (this.jornada()?.turnos || []).reduce((total, day) => {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin) return total;
    return total + this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
  }, 0));
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
    this.loading.set(true);
    this.error.set('');
    this.turnosService.obtenerMiJornada().subscribe({
      next: (response) => {
        this.jornada.set(response.jornada);
        this.zone.set(response.zonaHoraria || 'America/Bogota');
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.message || 'No pudimos consultar tu horario.');
        this.loading.set(false);
      },
    });
  }

  statusLabel(): string {
    if (this.currentStatus() === 'en_turno') return 'En turno ahora';
    if (this.currentStatus() === 'fuera_turno') return 'Fuera de turno';
    return 'Pendiente de configurar';
  }

  durationLabel(day: TurnoDia): string {
    if (!day.esLaborable || !day.horaInicio || !day.horaFin) return 'Descanso';
    const minutes = this.toMinutes(day.horaFin) - this.toMinutes(day.horaInicio);
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

  weeklyHoursLabel(): string {
    const minutes = this.weeklyMinutes();
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  isToday(day: TurnoDia): boolean {
    return day.diaSemana === this.clockParts(this.now()).day;
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
}
