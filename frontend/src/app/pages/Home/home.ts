import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  HomeActivity,
  HomeCapacityAlert,
  HomeDayOverview,
  HomeProcess,
  HomeReservation,
  HomeService,
  HomeSummary,
  HomeTransfer,
} from '../../services/Home/home.service';
import { WebSocketConnectionState, WebSocketService } from '../../services/WebSocket/web-socket';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { CountUpDirective } from '../Inicio/count-up.directive';
import { MiJornadaSemana, TurnoDia, TurnosService } from '../../services/Turnos/turnos.service';

const UPDATE_FEEDBACK_MS = 1100;

const ACTIVITY_LABELS: Record<string, string> = {
  GUARDAR_LISTADO: 'Guardó la programación de buses',
  GUARDAR_PROGRAMACION_PRIVADA: 'Guardó la programación de un servicio privado',
  PAGAR_COMISIONES: 'Marcó comisiones como pagadas',
  REABRIR_COMISIONES: 'Reabrió comisiones para revisión',
  ACTUALIZAR_DATOS_PAGO_COMISION: 'Actualizó los datos de pago de comisiones',
  CREAR_BENEFICIARIO_COMISION: 'Agregó un beneficiario de comisión',
  ACTUALIZAR_BENEFICIARIO_COMISION: 'Actualizó un beneficiario de comisión',
  ACTUALIZAR_ASISTENCIA: 'Actualizó la asistencia de pasajeros',
  CAMBIAR_AFORO_TOUR: 'Actualizó el aforo de un tour',
  REORDENAR_RUTA: 'Reordenó una ruta de recogida',
  CREAR_HORARIOS: 'Configuró horarios de puntos de encuentro',
  UPSERT_PRECIOS: 'Actualizó los precios de un tour',
  EXPORTAR_EXCEL_LISTADO: 'Descargó un listado de programación',
  EXPORTAR_EXCEL_PRIVADO: 'Descargó el listado de un servicio privado',
  ACTUALIZAR_PERFIL: 'Actualizó su información personal',
  ACTUALIZAR_AVATAR: 'Cambió su foto de perfil',
  ELIMINAR_AVATAR: 'Eliminó su foto de perfil',
  AGREGAR_COMPROBANTE_TRANSFER: 'Agregó un comprobante a un transfer',
  ELIMINAR_COMPROBANTE_RESERVA: 'Eliminó un comprobante de una reserva',
  LOGIN: 'Inició sesión',
  LOGOUT: 'Cerró sesión',
  LOGOUT_ALL_SESSIONS: 'Cerró todas sus sesiones',
  PASSWORD_RESET_REQUEST: 'Solicitó restablecer su contraseña',
  PASSWORD_CHANGED_BY_RESET: 'Cambió su contraseña',
  FORCE_LOGOUT_USER: 'Cerró las sesiones de un usuario',
};

interface QuickAction {
  label: string;
  detail: string;
  icon: string;
  route: string;
  visible: boolean;
  primary?: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent, CountUpDirective],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly homeService = inject(HomeService);
  private readonly webSocket = inject(WebSocketService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly turnosService = inject(TurnosService);

  summary: HomeSummary | null = null;
  loading = true;
  refreshing = false;
  dataUpdated = false;
  error = '';
  connectionState: WebSocketConnectionState = 'connecting';
  mySchedule: MiJornadaSemana | null = null;
  scheduleLoading = false;
  scheduleError = '';
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private updateFeedbackTimer?: ReturnType<typeof setTimeout>;
  private updateFeedbackStartTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadSummary();
    this.listenForChanges();
    this.listenForConnectionState();
  }

  get firstName(): string {
    return String(this.summary?.profile.name || '').trim().split(/\s+/)[0];
  }

  get greeting(): string {
    const hour = Number(new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()));
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  }

  get initials(): string {
    return String(this.summary?.profile.name || 'SIR')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  get quickActions(): QuickAction[] {
    const capabilities = this.summary?.capabilities;
    if (!capabilities) return [];
    return [
      {
        label: 'Nueva reserva',
        detail: capabilities.clientMode ? 'Crear una reserva' : 'Registrar una venta',
        icon: 'bx bx-calendar-plus',
        route: '/Reservas/NuevaReserva',
        visible: capabilities.canCreateReservations,
        primary: true,
      },
      {
        label: 'Nuevo transfer',
        detail: 'Programar un traslado',
        icon: 'bx bx-car',
        route: '/Transfers/NuevoTransfer',
        visible: capabilities.canCreateTransfers,
      },
      {
        label: 'Reservas',
        detail: 'Consultar y gestionar',
        icon: 'bx bx-list-ul',
        route: '/Reservas/VerReservas',
        visible: capabilities.canReadReservations,
      },
      {
        label: 'Aforos',
        detail: 'Revisar disponibilidad',
        icon: 'bx bxs-dashboard',
        route: '/Aforos',
        visible: capabilities.canReadAforos,
      },
      {
        label: 'Programación',
        detail: 'Organizar la operación',
        icon: 'bx bx-list-check',
        route: '/Programacion/Listado',
        visible: capabilities.canReadProgramming,
      },
      {
        label: 'Informes',
        detail: 'Analizar la empresa',
        icon: 'bx bx-line-chart',
        route: '/Informes',
        visible: capabilities.canReadReports,
      },
      {
        label: 'Mi perfil',
        detail: 'Actualizar mis datos',
        icon: 'bx bx-user-circle',
        route: '/Perfil/Editar',
        visible: capabilities.clientMode,
      },
      {
        label: 'Mi horario',
        detail: 'Consultar mi jornada',
        icon: 'bx bx-time-five',
        route: '/MiHorario',
        visible: this.summary?.profile.mode === 'advisor',
      },
    ].filter((action) => action.visible);
  }

  loadSummary(silent = false): void {
    if (this.refreshing) return;
    if (!silent) {
      this.loading = !this.summary;
      this.error = '';
    }
    this.refreshing = !!this.summary;
    this.cdr.markForCheck();

    this.homeService.getSummary(silent)
      .pipe(
        finalize(() => {
          this.loading = false;
          this.refreshing = false;
          this.cdr.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (summary) => {
          const changed = !!this.summary && this.summaryChanged(this.summary, summary);
          this.summary = summary;
          this.error = '';
          if (summary.profile.mode === 'advisor' && !this.mySchedule && !this.scheduleLoading) {
            this.loadMySchedule();
          }
          if (changed) this.showUpdateFeedback();
        },
        error: () => {
          if (!this.summary) {
            this.error = 'No pudimos cargar tu resumen de trabajo.';
          }
        },
      });
  }

  navigate(route: string): void {
    this.router.navigateByUrl(route);
  }

  openReservation(reservation: HomeReservation): void {
    if (this.summary?.capabilities.canUpdateReservations) {
      this.navigate(`/Reservas/EditarReserva/${reservation.Id_Reserva}`);
      return;
    }
    this.navigate('/Reservas/VerReservas');
  }

  openTransfer(transfer: HomeTransfer): void {
    if (this.summary?.capabilities.canUpdateTransfers) {
      this.navigate(`/Transfers/EditarTransfer/${transfer.Id_Transfer}`);
      return;
    }
    this.navigate('/Transfers/VerTransfers');
  }

  overviewMetrics(day: HomeDayOverview): Array<{ label: string; value: number; detail: string; detailValue?: number; icon: string }> {
    const metrics = [
      { label: 'Reservas', value: day.reservations, detail: 'privadas', detailValue: day.privateReservations, icon: 'bx bx-calendar-check' },
      { label: 'Pasajeros', value: day.passengers, detail: 'en tours', icon: 'bx bx-group' },
      { label: 'Transfers', value: day.transfers, detail: 'servicios', icon: 'bx bx-car' },
      { label: 'Pasajeros', value: day.transferPassengers, detail: 'en transfers', icon: 'bx bx-user-voice' },
    ];
    return this.summary?.capabilities.canReadTransfers ? metrics : metrics.slice(0, 2);
  }

  dayLabel(date: string): string {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${date}T12:00:00Z`));
  }

  shortDate(date: string): string {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${date}T12:00:00Z`));
  }

  relativeDay(date: string): string {
    if (date === this.summary?.dates.today) return 'Hoy';
    if (date === this.summary?.dates.tomorrow) return 'Mañana';
    return this.shortDate(date);
  }

  timeLabel(value: string | null): string {
    if (!value) return 'Hora por definir';
    return String(value).slice(0, 5);
  }

  get todayShift(): TurnoDia | null {
    if (!this.mySchedule?.configurado) return null;
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      weekday: 'short',
    }).format(new Date());
    const dayNumber: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return this.mySchedule.turnos.find((day) => day.diaSemana === dayNumber[weekday]) || null;
  }

  get scheduleStatusLabel(): string {
    if (this.isOnVacationToday) return 'Vacaciones';
    if (!this.mySchedule?.configurado) return 'Sin configurar';
    return this.mySchedule.estadoActual === 'en_turno' ? 'En turno' : 'Fuera de turno';
  }

  get scheduleVisualStatus(): string {
    return this.isOnVacationToday ? 'vacaciones' : (this.mySchedule?.estadoActual || 'sin_configurar');
  }

  get isOnVacationToday(): boolean {
    const vacation = this.mySchedule?.vacacion;
    if (!vacation) return false;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = `${values['year']}-${values['month']}-${values['day']}`;
    return today >= vacation.fechaInicio && today <= vacation.fechaFin;
  }

  get todayShiftLabel(): string {
    if (this.isOnVacationToday && this.mySchedule?.vacacion) {
      return `Hoy estás de vacaciones · regreso ${this.shortDate(this.mySchedule.vacacion.fechaRegreso)}`;
    }
    if (!this.mySchedule?.configurado) return 'Tu jornada aún no ha sido configurada';
    const shift = this.todayShift;
    if (!shift?.esLaborable) return 'Hoy es tu día de descanso';
    return `${this.shiftTimeLabel(shift.horaInicio)} – ${this.shiftTimeLabel(shift.horaFin)}`;
  }

  shiftTimeLabel(value: string | null): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    const period = hours >= 12 ? 'p. m.' : 'a. m.';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  activityLabel(activity: HomeActivity): string {
    const action = this.normalizeActivityCode(activity.Accion);
    const explicitLabel = ACTIVITY_LABELS[action];
    if (explicitLabel) return explicitLabel;

    const entity = this.entityLabel(activity);
    if (action === 'ACTUALIZAR_ESTADO_AUTOMATICO') return `Se actualizó automáticamente ${entity}`;
    if (action.includes('CREAR_O_ACTUALIZAR')) return `Guardó ${entity}`;
    if (action.includes('CREAR')) return `Creó ${entity}`;
    if (action.includes('AGREGAR')) return `Agregó ${entity}`;
    if (action.includes('ACTUALIZAR') || action.includes('EDITAR') || action.includes('CAMBIAR')) return `Actualizó ${entity}`;
    if (action.includes('ELIMINAR') || action.includes('ANULAR')) return `Eliminó ${entity}`;
    if (action.includes('CANCELAR')) return `Canceló ${entity}`;
    if (action.includes('DESACTIVAR')) return `Desactivó ${entity}`;
    if (action.includes('EXPORTAR')) return `Descargó información de ${entity}`;
    if (action.includes('GUARDAR')) return `Guardó ${entity}`;
    return `Actualizó ${entity}`;
  }

  activityIcon(activity: HomeActivity): string {
    const action = this.normalizeActivityCode(activity.Accion);
    if (action.includes('PAGAR')) return 'bx bx-wallet';
    if (action.includes('REABRIR')) return 'bx bx-refresh';
    if (action.includes('GUARDAR')) return 'bx bx-save';
    if (action.includes('EXPORTAR')) return 'bx bx-download';
    if (action.includes('LOGIN')) return 'bx bx-log-in';
    if (action.includes('LOGOUT')) return 'bx bx-log-out';
    if (action.includes('CREAR') || action.includes('AGREGAR')) return 'bx bx-plus';
    if (action.includes('ELIMINAR') || action.includes('ANULAR')) return 'bx bx-trash';
    if (action.includes('CANCELAR') || action.includes('DESACTIVAR')) return 'bx bx-x-circle';
    return 'bx bx-edit-alt';
  }

  activityUserName(value: string | null | undefined): string {
    const safe = String(value || '').trim();
    if (!safe || safe !== safe.toLocaleUpperCase('es')) return safe;
    return safe
      .toLocaleLowerCase('es')
      .replace(/(^|[\s'-])(\p{L})/gu, (_, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase('es')}`);
  }

  activityDate(value: string): string {
    const raw = String(value || '').trim();
    const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  processTone(process: HomeProcess): string {
    return process.count > 0 ? 'pending' : 'ready';
  }

  alertLabel(alert: HomeCapacityAlert): string {
    if (alert.status === 'missing') return 'Sin aforo';
    if (alert.status === 'full') return 'Completo';
    return `${alert.percentage}% ocupado`;
  }

  isCriticalAlert(alert: HomeCapacityAlert): boolean {
    return alert.status === 'critical' || alert.status === 'full' || alert.status === 'missing';
  }

  trackById(_: number, item: HomeReservation | HomeTransfer | HomeProcess | HomeCapacityAlert): number | string {
    if ('Id_Reserva' in item) return item.Id_Reserva;
    if ('Id_Transfer' in item) return item.Id_Transfer;
    if ('tourId' in item) return `${item.tourId}-${item.date}`;
    return item.id;
  }

  private listenForChanges(): void {
    const relevantEvents = new Set([
      'aforoActualizado',
      'reservaCreada',
      'reservaActualizada',
      'reservaEliminada',
      'transferCreado',
      'transferActualizado',
      'transferEliminado',
      'listadoActualizado',
    ]);

    this.webSocket.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (!relevantEvents.has(String(event.type))) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.loadSummary(true), 450);
      });

    this.destroyRef.onDestroy(() => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      if (this.updateFeedbackTimer) clearTimeout(this.updateFeedbackTimer);
      if (this.updateFeedbackStartTimer) clearTimeout(this.updateFeedbackStartTimer);
    });
  }

  private loadMySchedule(): void {
    this.scheduleLoading = true;
    this.scheduleError = '';
    this.cdr.markForCheck();
    this.turnosService.obtenerMiJornada()
      .pipe(
        finalize(() => {
          this.scheduleLoading = false;
          this.cdr.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => {
          this.mySchedule = response.jornada;
          this.scheduleError = '';
        },
        error: () => {
          this.scheduleError = 'No pudimos consultar tu jornada en este momento.';
        },
      });
  }

  private showUpdateFeedback(): void {
    this.dataUpdated = false;
    if (this.updateFeedbackTimer) clearTimeout(this.updateFeedbackTimer);
    if (this.updateFeedbackStartTimer) clearTimeout(this.updateFeedbackStartTimer);
    this.cdr.detectChanges();

    this.updateFeedbackStartTimer = setTimeout(() => {
      this.dataUpdated = true;
      this.cdr.markForCheck();
      this.updateFeedbackTimer = setTimeout(() => {
        this.dataUpdated = false;
        this.cdr.markForCheck();
      }, UPDATE_FEEDBACK_MS);
    }, 0);
  }

  private listenForConnectionState(): void {
    this.webSocket.connectionState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.connectionState = state;
        this.cdr.markForCheck();
      });
  }

  private summaryChanged(previous: HomeSummary, current: HomeSummary): boolean {
    const comparable = (summary: HomeSummary) => ({
      dates: summary.dates,
      profile: summary.profile,
      capabilities: summary.capabilities,
      overview: summary.overview,
      personalWork: summary.personalWork,
      operations: summary.operations,
    });
    return JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(current));
  }

  private normalizeActivityCode(value: string): string {
    return String(value || '').trim().toLocaleUpperCase('es').replace(/[\s-]+/g, '_');
  }

  private entityLabel(activity: HomeActivity): string {
    const table = String(activity.Tabla || '').trim().toLocaleLowerCase('es');
    const id = String(activity.Id_Registro || '').trim();
    if (table.includes('reserva')) return id ? `la reserva #${id}` : 'una reserva';
    if (table.includes('transfer')) return id ? `el transfer #${id}` : 'un transfer';
    if (table.includes('pasaj')) return 'los datos de un pasajero';
    if (table === 'tours' || table === 'tour') return 'un tour';
    if (table.includes('tour_precios') || table.includes('precio')) return 'los precios de un tour';
    if (table.includes('punto')) return 'un punto de encuentro';
    if (table.includes('horario')) return 'los horarios de recogida';
    if (table.includes('usuario')) return 'un usuario';
    if (table.includes('aforo')) return 'el aforo de un tour';
    if (table.includes('liquidacion') || table.includes('comision')) return 'las comisiones';
    if (table.includes('programacion') || table.includes('listado')) return 'la programación de buses';
    if (table.includes('seguro')) return 'la información de seguros';
    if (table.includes('confirmacion') || table.includes('asistencia')) return 'la asistencia de pasajeros';
    return 'la información operativa';
  }
}
