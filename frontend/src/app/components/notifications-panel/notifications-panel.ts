import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { NotificacionesService, SirNotification } from '../../services/Notificaciones/notificaciones.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { IntercambioTurno, TurnosService } from '../../services/Turnos/turnos.service';
import { WebSocketService } from '../../services/WebSocket/web-socket';

@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-panel.html',
  styleUrl: './notifications-panel.css',
})
export class NotificationsPanelComponent implements OnInit, OnDestroy {
  readonly notifications = inject(NotificacionesService);
  private readonly turnos = inject(TurnosService);
  private readonly drawer = inject(SirDrawerService);
  private readonly alerts = inject(SirAlertService);
  private readonly permissions = inject(PermisosService);
  private readonly router = inject(Router);
  private readonly webSocket = inject(WebSocketService);
  private eventSub?: Subscription;
  private exchangeSub?: Subscription;

  readonly exchanges = signal<IntercambioTurno[]>([]);
  readonly busy = signal(false);
  readonly isAdvisor = String(this.permissions.getRoleSnapshot() || '')
    .trim().toLocaleLowerCase('es-CO') === 'asesor';
  readonly pending = computed(() => this.exchanges()
    .filter((item) => !item.esSolicitante && item.estado === 'pendiente'));
  readonly outgoing = computed(() => this.exchanges()
    .filter((item) => item.esSolicitante && item.estado === 'pendiente'));

  ngOnInit(): void {
    this.reload();
    if (this.isAdvisor) {
      this.eventSub = this.webSocket.events$.subscribe((event) => {
        if (event.type === 'turnoIntercambioActualizado') this.reloadExchanges();
      });
    }
  }

  ngOnDestroy(): void {
    this.eventSub?.unsubscribe();
    this.exchangeSub?.unsubscribe();
  }

  close(): void {
    this.drawer.close();
  }

  reload(): void {
    this.notifications.load();
    // Hoy los intercambios pertenecen únicamente al rol Asesor. Evita un 403
    // silencioso si el componente se abre por código desde otro perfil.
    this.reloadExchanges();
  }

  private reloadExchanges(): void {
    if (!this.isAdvisor) return;
    this.exchangeSub?.unsubscribe();
    this.exchangeSub = this.turnos.obtenerMisIntercambios().subscribe({
      next: (response) => this.exchanges.set(response.intercambios || []),
      error: () => this.exchanges.set([]),
    });
  }

  openNotification(item: SirNotification): void {
    if (!item.leida) this.notifications.markRead(item.idNotificacion);
    const route = item.datos?.['route'];
    if (typeof route === 'string' && route.startsWith('/')) {
      this.drawer.close(true);
      void this.router.navigateByUrl(route);
    }
  }

  notificationIcon(item: SirNotification): string {
    if (item.tipo.startsWith('turnos_semana_')) return 'bx-calendar-check';
    if (item.tipo.startsWith('turno_intercambio_')) return 'bx-transfer-alt';
    return 'bx-bell';
  }

  respond(item: IntercambioTurno, accept: boolean): void {
    this.busy.set(true);
    this.turnos.responderIntercambio(item.idIntercambio, accept).subscribe({
      next: () => {
        this.busy.set(false);
        this.alerts.successToast(
          accept ? 'Turno intercambiado' : 'Solicitud rechazada',
          accept ? 'Ambos horarios ya fueron actualizados para ese día.' : 'La jornada no cambió.',
        );
        this.reload();
      },
      error: (error) => {
        this.busy.set(false);
        this.alerts.errorToast('No se pudo responder', error?.error?.message || 'Inténtalo nuevamente.');
      },
    });
  }

  cancel(item: IntercambioTurno): void {
    this.busy.set(true);
    this.turnos.cancelarIntercambio(item.idIntercambio).subscribe({
      next: () => {
        this.busy.set(false);
        this.alerts.infoToast('Solicitud cancelada', 'Ningún horario fue modificado.');
        this.reload();
      },
      error: (error) => {
        this.busy.set(false);
        this.alerts.errorToast('No se pudo cancelar', error?.error?.message || 'Inténtalo nuevamente.');
      },
    });
  }

  time(value: string): string {
    const [hour, minute] = value.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'p. m.' : 'a. m.'}`;
  }

  dateLabel(value: string): string {
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
  }

  relative(value: string): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    }).format(new Date(value));
  }
}
