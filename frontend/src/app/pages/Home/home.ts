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
import { WebSocketService } from '../../services/WebSocket/web-socket';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

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
  imports: [CommonModule, LoadingStateComponent],
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

  summary: HomeSummary | null = null;
  loading = true;
  refreshing = false;
  error = '';
  private refreshTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.loadSummary();
    this.listenForChanges();
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
        detail: 'Registrar una venta',
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
          this.summary = summary;
          this.error = '';
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

  overviewMetrics(day: HomeDayOverview): Array<{ label: string; value: number; detail: string; icon: string }> {
    return [
      { label: 'Reservas', value: day.reservations, detail: `${day.privateReservations} privadas`, icon: 'bx bx-calendar-check' },
      { label: 'Pasajeros', value: day.passengers, detail: 'en tours', icon: 'bx bx-group' },
      { label: 'Transfers', value: day.transfers, detail: 'servicios', icon: 'bx bx-car' },
      { label: 'Pasajeros', value: day.transferPassengers, detail: 'en transfers', icon: 'bx bx-user-voice' },
    ];
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

  activityLabel(activity: HomeActivity): string {
    const action = String(activity.Accion || '').toLowerCase();
    const table = this.entityLabel(activity.Tabla);
    if (action.includes('cre')) return `Creó ${table}`;
    if (action.includes('actual') || action.includes('edit')) return `Actualizó ${table}`;
    if (action.includes('elimin') || action.includes('anul')) return `Eliminó ${table}`;
    return `${activity.Accion || 'Actividad'} · ${table}`;
  }

  activityIcon(activity: HomeActivity): string {
    const action = String(activity.Accion || '').toLowerCase();
    if (action.includes('cre')) return 'bx bx-plus';
    if (action.includes('elimin') || action.includes('anul')) return 'bx bx-trash';
    return 'bx bx-edit-alt';
  }

  processTone(process: HomeProcess): string {
    return process.count > 0 ? 'pending' : 'ready';
  }

  alertLabel(alert: HomeCapacityAlert): string {
    if (alert.status === 'missing') return 'Sin aforo';
    if (alert.status === 'full') return 'Completo';
    return `${alert.percentage}% ocupado`;
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
    });
  }

  private entityLabel(value: string): string {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('reserva')) return 'una reserva';
    if (normalized.includes('transfer')) return 'un transfer';
    if (normalized.includes('pasaj')) return 'un pasajero';
    if (normalized.includes('tour')) return 'un tour';
    if (normalized.includes('usuario')) return 'un usuario';
    return 'un registro';
  }
}
