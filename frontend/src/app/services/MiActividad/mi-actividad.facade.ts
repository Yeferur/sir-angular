import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EMPTY, Observable, catchError, finalize, forkJoin, of, tap } from 'rxjs';

import { SirAlertService, ToastAction } from '../Alertas/alert.service';
import { SirDrawerService } from '../Drawer/drawer.service';
import { NotificacionesService, SirNotification } from '../Notificaciones/notificaciones.service';
import { DesktopNotificationsService } from '../Notificaciones/desktop-notifications.service';
import {
  OperationalPending,
  PendientesService,
  PersonalReminder,
  ReminderInput,
} from '../Pendientes/pendientes.service';
import { PermisosService } from '../Permisos/permisos.service';
import { WebSocketEvent, WebSocketService } from '../WebSocket/web-socket';

export type MiActividadTab = 'pendientes' | 'recordatorios';
export type ReminderPresentationState = 'PROGRAMADO' | 'ATENDER' | 'POSPUESTO' | 'COMPLETADO';

export function reminderPresentationState(item: PersonalReminder, now = Date.now()): ReminderPresentationState {
  if (item.estado === 'COMPLETADO') return 'COMPLETADO';
  if (item.estaSuprimido) return 'POSPUESTO';
  const time = new Date(item.siguienteTrigger || item.fecha).getTime();
  return Number.isNaN(time) || time > now ? 'PROGRAMADO' : 'ATENDER';
}

export function isDerivedActivityNotification(item: SirNotification): boolean {
  const type = String(item.tipo || '').toUpperCase();
  if (type === 'RECORDATORIO') {
    return !!(item.entidadId || item.datos?.['recordatorioId']);
  }
  if (type === 'PENDIENTE') {
    return !!item.datos?.['pendienteId'];
  }
  return false;
}

export function pendingActionLabel(item: Pick<OperationalPending, 'entidadTipo' | 'entidadId' | 'datos'>): string {
  const type = String(item.entidadTipo || '').toUpperCase();
  const route = String(item.datos?.['ruta'] || item.datos?.['route'] || '');
  if (type === 'PROGRAMACION_CAMBIO') return 'Revisar cambios';
  if (type === 'RESERVA') return 'Ver reserva';
  if (type === 'TRANSFER') return 'Ver transfer';
  if (String(item.entidadId) === 'commissions' || route.startsWith('/Comisiones')) return 'Ver comisiones';
  if (route.startsWith('/Programacion')) return 'Revisar programación';
  if (route.startsWith('/Seguros')) return 'Ver seguros';
  if (route.startsWith('/Aforos')) return 'Ver aforos';
  if (route.startsWith('/Control') || route.startsWith('/Reservas/Confirmacion')) return 'Ver control de viaje';
  return 'Abrir origen';
}

export function activityFeedCounts(
  pendings: OperationalPending[], reminders: PersonalReminder[], notificationItems: SirNotification[], now = Date.now(),
): { todos: number; pendientes: number; recordatorios: number; novedades: number; badge: number } {
  const novedades = notificationItems.filter(item => !isDerivedActivityNotification(item)).length;
  return {
    todos: pendings.length + reminders.length + novedades,
    pendientes: pendings.length,
    recordatorios: reminders.length,
    novedades,
    badge: pendings.filter(item => !item.estaSuprimido).length
      + reminders.filter(item => reminderPresentationState(item, now) === 'ATENDER').length,
  };
}

export function contextualNotificationPriority(notification: SirNotification): number {
  const priority = String(notification.datos?.['prioridad'] || '').toUpperCase();
  if (priority === 'CRITICA') return 4;
  if (priority === 'ALTA') return 3;
  if (notification.tipo.toUpperCase() === 'RECORDATORIO') return 3;
  if (notification.tipo.toUpperCase() === 'PENDIENTE') return 2;
  return 1;
}

export function planContextualBatch(notifications: SirNotification[]): {
  summary: boolean;
  notifications: SirNotification[];
} {
  const ordered = [...notifications]
    .sort((a, b) => contextualNotificationPriority(b) - contextualNotificationPriority(a));
  return { summary: ordered.length >= 3, notifications: ordered };
}

@Injectable({ providedIn: 'root' })
export class MiActividadFacade {
  private readonly pendientesService = inject(PendientesService);
  readonly notifications = inject(NotificacionesService);
  private readonly desktopNotifications = inject(DesktopNotificationsService);
  private readonly permissions = inject(PermisosService);
  private readonly websocket = inject(WebSocketService);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly pendientes = signal<OperationalPending[]>([]);
  readonly recordatorios = signal<PersonalReminder[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly registeredEmail = signal('');

  readonly pendientesAtendibles = computed(() => this.pendientes().filter(item => !item.estaSuprimido));
  readonly pendientesPospuestos = computed(() => this.pendientes().filter(item => item.estaSuprimido));
  readonly pendientesPrioritarios = computed(() => this.pendientesAtendibles()
    .filter(item => item.prioridad === 'ALTA' || item.prioridad === 'CRITICA'));
  readonly recordatoriosVencidos = computed(() => this.recordatorios()
    .filter(item => reminderPresentationState(item) === 'ATENDER'));
  readonly recordatoriosProgramados = computed(() => this.recordatorios()
    .filter(item => reminderPresentationState(item) === 'PROGRAMADO'));
  readonly recordatoriosPospuestos = computed(() => this.recordatorios().filter(item => item.estaSuprimido));
  readonly attentionCount = computed(() => this.pendientesAtendibles().length + this.recordatoriosVencidos().length);
  readonly postponedCount = computed(() => this.pendientesPospuestos().length + this.recordatoriosPospuestos().length);
  readonly nextReminder = computed(() => [...this.recordatorios()]
    .filter(item => reminderPresentationState(item) !== 'ATENDER')
    .sort((a, b) => this.reminderTime(a) - this.reminderTime(b))[0] || null);
  // Las notificaciones relacionadas siguen existiendo como canal de entrega e
  // historial, pero la situación se representa mediante su pendiente/recordatorio.
  readonly feedNotifications = computed(() => this.notifications.items()
    .filter(item => !isDerivedActivityNotification(item)));
  readonly allFeedCount = computed(() => this.pendientes().length
    + this.recordatorios().length
    + this.feedNotifications().length);
  readonly feedUnreadCount = computed(() => this.feedNotifications().filter(item => !item.leida).length);
  // Compatibilidad con topbar: este contador significa atención inmediata.
  readonly unifiedCount = this.attentionCount;
  readonly topActivities = computed(() => this.pendientesAtendibles().slice(0, 2));

  private active = false;
  private requestInFlight = false;
  private readonly announcedNotificationIds = new Set<string>();
  private contextualBatch: SirNotification[] = [];
  private contextualBatchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.websocket.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => this.handleWebSocketEvent(event));
    this.destroyRef.onDestroy(() => clearTimeout(this.contextualBatchTimer));
  }

  get canReadPending(): boolean { return this.permissions.tienePermiso('PENDIENTES.LEER'); }
  get canManagePending(): boolean { return this.permissions.tienePermiso('PENDIENTES.GESTIONAR'); }
  get canReadReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.LEER'); }
  get canCreateReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.CREAR'); }
  get canUpdateReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.ACTUALIZAR'); }
  get canDeleteReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.ELIMINAR'); }
  get isAvailable(): boolean {
    // Las notificaciones personales pertenecen a todo usuario autenticado y no
    // dependen de NOTIFICACIONES.LEER ni de los permisos operativos.
    return true;
  }

  start(): void {
    if (this.active) {
      this.refresh();
      return;
    }
    this.active = true;
    this.refresh();
    this.notifications.load();
  }

  clear(): void {
    this.active = false;
    this.requestInFlight = false;
    this.pendientes.set([]);
    this.recordatorios.set([]);
    this.loading.set(false);
    this.loaded.set(false);
    this.error.set('');
    this.registeredEmail.set('');
    this.announcedNotificationIds.clear();
    this.contextualBatch = [];
    clearTimeout(this.contextualBatchTimer);
    this.contextualBatchTimer = undefined;
  }

  refresh(force = false): void {
    if (!this.active || (this.requestInFlight && !force)) return;
    this.requestInFlight = true;
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      pendientes: this.canReadPending
        ? this.pendientesService.listPending(true)
        : of({ pendientes: [], total: 0 }),
      recordatorios: this.canReadReminders
        ? this.pendientesService.listReminders()
        : of({ recordatorios: [], total: 0, correoRecordatorios: '' }),
    }).pipe(
      finalize(() => {
        this.requestInFlight = false;
        this.loading.set(false);
        this.loaded.set(true);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: response => {
        this.pendientes.set(response.pendientes.pendientes || []);
        this.recordatorios.set(response.recordatorios.recordatorios || []);
        this.registeredEmail.set(String(response.recordatorios.correoRecordatorios || '').trim());
      },
      error: error => this.error.set(this.errorMessage(error, 'No fue posible consultar Avisos.')),
    });
  }

  refreshPending(): void {
    if (!this.active || !this.canReadPending) return;
    this.pendientesService.listPending(true).pipe(
      catchError(() => EMPTY),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(response => this.pendientes.set(response.pendientes || []));
  }

  refreshReminders(): void {
    if (!this.active || !this.canReadReminders) return;
    this.pendientesService.listReminders().pipe(
      catchError(() => EMPTY),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(response => {
      this.recordatorios.set(response.recordatorios || []);
      this.registeredEmail.set(String(response.correoRecordatorios || '').trim());
    });
  }

  postponePending(item: OperationalPending, until: string): Observable<unknown> {
    return this.pendientesService.postponePending(item.idPendiente, until)
      .pipe(tap(() => {
        this.notifications.markActivityHandled('PENDIENTE', item.idPendiente);
        this.refreshPending();
      }));
  }

  dismissPending(item: OperationalPending, reason: string): Observable<unknown> {
    return this.pendientesService.dismissPending(item.idPendiente, reason).pipe(tap(() => {
      this.pendientes.update(items => items.filter(candidate => candidate.idPendiente !== item.idPendiente));
      this.notifications.markActivityHandled('PENDIENTE', item.idPendiente);
    }));
  }

  createReminder(input: ReminderInput): Observable<PersonalReminder> {
    return this.pendientesService.createReminder(input).pipe(tap(reminder => {
      this.recordatorios.update(items => this.sortReminders([...items, reminder]));
    }));
  }

  postponeReminder(item: PersonalReminder, until: string): Observable<PersonalReminder> {
    return this.pendientesService.postponeReminder(item.idRecordatorio, until).pipe(tap(reminder => {
      this.recordatorios.update(items => this.sortReminders(items.map(candidate =>
        candidate.idRecordatorio === reminder.idRecordatorio ? reminder : candidate)));
      this.notifications.markActivityHandled('RECORDATORIO', item.idRecordatorio);
    }));
  }

  completeReminder(item: PersonalReminder): Observable<PersonalReminder> {
    return this.pendientesService.completeReminder(item.idRecordatorio).pipe(tap(reminder => {
      this.recordatorios.update(items => reminder.estado === 'ACTIVO'
        ? this.sortReminders(items.map(candidate => candidate.idRecordatorio === reminder.idRecordatorio ? reminder : candidate))
        : items.filter(candidate => candidate.idRecordatorio !== item.idRecordatorio));
      this.notifications.markActivityHandled('RECORDATORIO', item.idRecordatorio);
    }));
  }

  deleteReminder(item: PersonalReminder): Observable<unknown> {
    return this.pendientesService.deleteReminder(item.idRecordatorio).pipe(tap(() => {
      this.recordatorios.update(items => items.filter(candidate => candidate.idRecordatorio !== item.idRecordatorio));
      this.notifications.markActivityHandled('RECORDATORIO', item.idRecordatorio);
    }));
  }

  markNotificationRead(notification: SirNotification): void {
    if (!notification.leida) this.notifications.markRead(notification.idNotificacion);
  }

  canOpenOrigin(item: OperationalPending): boolean {
    const type = item.entidadTipo.toUpperCase();
    if (type === 'RESERVA') return this.permissions.tienePermiso('RESERVAS.LEER');
    if (type === 'TRANSFER') return this.permissions.tienePermiso('TRANSFERS.LEER');
    const route = typeof item.datos?.['ruta'] === 'string' ? String(item.datos['ruta']) : '';
    if (!route.startsWith('/')) return false;
    const routePermissions: Array<[string, string]> = [
      ['/Programacion', 'PROGRAMACION.LEER'], ['/Seguros', 'SEGUROS.LEER'],
      ['/Comisiones', 'COMISIONES.LEER'], ['/Aforos', 'AFOROS.LEER'],
      ['/Control', 'CONTROL_VIAJE.LEER'], ['/Reservas', 'RESERVAS.LEER'],
      ['/Transfers', 'TRANSFERS.LEER'],
    ];
    const match = routePermissions.find(([prefix]) => route.startsWith(prefix));
    return !match || this.permissions.tienePermiso(match[1]);
  }

  openOrigin(item: OperationalPending): void {
    if (!this.canOpenOrigin(item)) return;
    const type = item.entidadTipo.toUpperCase();
    this.drawer.close(true);
    if (type === 'RESERVA') {
      const route = this.permissions.tienePermiso('RESERVAS.ACTUALIZAR')
        ? `/Reservas/EditarReserva/${item.entidadId}` : '/Reservas/VerReservas';
      void this.router.navigateByUrl(route);
      return;
    }
    if (type === 'TRANSFER') {
      const route = this.permissions.tienePermiso('TRANSFERS.ACTUALIZAR')
        ? `/Transfers/EditarTransfer/${item.entidadId}` : '/Transfers/VerTransfers';
      void this.router.navigateByUrl(route);
      return;
    }
    void this.router.navigateByUrl(String(item.datos?.['ruta']));
  }

  open(tab?: MiActividadTab, focusId?: string): void {
    this.drawer.openActivity({ tab: tab || (this.canReadPending ? 'pendientes' : 'recordatorios'), focusId });
    this.refresh();
  }

  pendingContext(item: OperationalPending): string | null {
    const type = String(item.entidadTipo || '').toUpperCase();
    if (type === 'RESERVA') return `Reserva ${item.entidadId}`;
    if (type === 'TRANSFER') return `Transfer ${String(item.entidadId).startsWith('TR-') ? item.entidadId : `TR-${item.entidadId}`}`;
    if (type === 'PROGRAMACION_CAMBIO') {
      const tour = String(item.datos?.['tourName'] || '').trim();
      const date = String(item.datos?.['fecha'] || '').trim();
      return [tour || 'Programación', date].filter(Boolean).join(' · ');
    }
    if (String(item.entidadId) === 'commissions' || String(item.datos?.['ruta'] || '').startsWith('/Comisiones')) {
      const count = Number(item.datos?.['count'] || 0);
      const from = String(item.datos?.['periodoDesde'] || '').trim();
      const to = String(item.datos?.['periodoHasta'] || '').trim();
      const period = from && to ? (from === to ? from : `${from} – ${to}`) : from || to;
      const tour = String(item.datos?.['tourName'] || '').trim();
      return [count ? `${count} ${count === 1 ? 'reserva' : 'reservas'}` : '', period, tour].filter(Boolean).join(' · ') || null;
    }
    return null;
  }

  reminderContext(item: PersonalReminder): string | null {
    const type = String(item.entidadTipo || '').toUpperCase();
    if (type === 'RESERVA' && item.entidadId) return `Reserva ${item.entidadId}`;
    if (type === 'TRANSFER' && item.entidadId) return `Transfer ${String(item.entidadId).startsWith('TR-') ? item.entidadId : `TR-${item.entidadId}`}`;
    return null;
  }

  reminderState(item: PersonalReminder): ReminderPresentationState {
    return reminderPresentationState(item);
  }

  reminderStateLabel(item: PersonalReminder): string {
    return ({
      PROGRAMADO: 'Programado', ATENDER: 'Llegó su momento', POSPUESTO: 'Pospuesto', COMPLETADO: 'Completado',
    } as const)[this.reminderState(item)];
  }

  pendingActionLabel(item: OperationalPending): string {
    return pendingActionLabel(item);
  }

  notificationActionLabel(item: SirNotification): string {
    const type = String(item.entidadTipo || item.tipo || '').toUpperCase();
    const route = String(item.datos?.['ruta'] || item.datos?.['route'] || '');
    if (type === 'APP_UPDATE') return 'Ver novedades';
    if (type === 'PROGRAMACION_CAMBIO' || route.startsWith('/Programacion')) return 'Revisar cambios';
    if (type === 'RESERVA' || route.startsWith('/Reservas/')) return 'Ver reserva';
    if (type === 'TRANSFER' || route.startsWith('/Transfers/')) return 'Ver transfer';
    if (String(item.entidadId) === 'commissions' || route.startsWith('/Comisiones')) return 'Ver comisiones';
    return 'Ver detalles';
  }

  private handleWebSocketEvent(event: WebSocketEvent): void {
    if (!this.active) return;
    if (event.type === 'programacionNovedadesActualizadas' || event.type === 'actividadActualizada') {
      this.refreshPending();
      if (event.type === 'actividadActualizada') {
        this.refreshReminders();
        this.notifications.load();
      }
      return;
    }
    if (event.type !== 'notificacionNueva') return;

    const category = String(event.payload?.categoria || '').toLocaleLowerCase('es-CO');
    if (category === 'pendientes') this.refreshPending();
    if (category === 'recordatorios') this.refreshReminders();

    const id = String(event.payload?.idNotificacion || '');
    this.notifications.load(items => {
      const notification = items.find(item => item.idNotificacion === id);
      if (notification) void this.announce(notification);
    });
  }

  private async announce(notification: SirNotification): Promise<void> {
    if (this.announcedNotificationIds.has(notification.idNotificacion)) return;
    this.announcedNotificationIds.add(notification.idNotificacion);
    const type = notification.tipo.toUpperCase();
    // Las actualizaciones informativas permanecen en la bandeja; no interrumpen.
    if (type === 'APP_UPDATE') return;
    if (type === 'PENDIENTE' && !this.canReadPending) return;
    if (type === 'RECORDATORIO' && !this.canReadReminders) return;

    const open = () => this.openNotification(notification);
    if (!this.desktopNotifications.isCurrentTabActive()) {
      await this.desktopNotifications.show(notification, open);
      return;
    }
    if (!await this.desktopNotifications.claimInternal(notification.idNotificacion)) return;
    if (this.router.url.startsWith('/Pendientes') || this.drawer.drawer()?.type === 'mi-actividad') return;

    this.contextualBatch.push(notification);
    clearTimeout(this.contextualBatchTimer);
    this.contextualBatchTimer = setTimeout(() => this.flushContextualBatch(), 700);
  }

  private flushContextualBatch(): void {
    const plan = planContextualBatch(this.contextualBatch.splice(0));
    const notifications = plan.notifications;
    this.contextualBatchTimer = undefined;
    if (!notifications.length) return;
    if (plan.summary) {
      this.alerts.notify({
        type: 'warning', operational: true,
        priority: Math.max(...notifications.map(contextualNotificationPriority)),
        title: `Tienes ${notifications.length} novedades nuevas`,
        message: 'Están guardadas en Avisos para que puedas revisarlas cuando sea oportuno.',
        actions: [{ label: 'Ver avisos', onClick: () => this.open() }],
        durationMs: 12_000,
      });
      return;
    }
    notifications.forEach(notification => this.showContextual(notification));
  }

  private showContextual(notification: SirNotification): void {
    const type = notification.tipo.toUpperCase();
    this.alerts.notify({
      type: type === 'RECORDATORIO' ? 'info' : 'warning',
      title: notification.titulo,
      message: notification.mensaje,
      operational: true,
      priority: contextualNotificationPriority(notification),
      durationMs: type === 'RECORDATORIO' || type === 'PENDIENTE' ? 12_000 : 8_000,
      actions: this.contextualActions(notification),
    });
  }

  openNotification(notification: SirNotification): void {
    const type = notification.tipo.toUpperCase();
    const tab: MiActividadTab = type === 'RECORDATORIO' ? 'recordatorios' : 'pendientes';
    const focusId = type === 'RECORDATORIO'
      ? notification.entidadId || undefined
      : String(notification.datos?.['pendienteId'] || notification.entidadId || '') || undefined;
    const route = notification.datos?.['route'] ?? notification.datos?.['ruta'];
    if ((type === 'PENDIENTE' || type === 'RECORDATORIO') && focusId) {
      this.open(tab, focusId);
      return;
    }
    if (type === 'APP_UPDATE' && !this.permissions.esCliente()) {
      this.drawer.openAppUpdates();
      return;
    }
    if (typeof route === 'string' && route.startsWith('/')) {
      void this.router.navigateByUrl(route);
      return;
    }
    this.open();
  }

  private contextualActions(notification: SirNotification): ToastAction[] {
    const type = notification.tipo.toUpperCase();
    if (type === 'RECORDATORIO') {
      const reminder = this.recordatorios().find(item => item.idRecordatorio === notification.entidadId);
      const actions: ToastAction[] = [];
      if (reminder && this.canUpdateReminders) {
        actions.push({ label: 'Completar', onClick: () => this.completeReminder(reminder).subscribe({
          next: () => this.notifications.markRead(notification.idNotificacion),
          error: error => this.alerts.errorToast('No se pudo completar', this.errorMessage(error, 'Intenta nuevamente.')),
        }) });
        actions.push({
          label: 'Recordar más tarde',
          postpone: {
            initialMinutes: 30,
            onConfirm: until => new Promise<boolean>(resolve => this.postponeReminder(reminder, until).subscribe({
              next: () => { this.notifications.markRead(notification.idNotificacion); resolve(true); },
              error: error => {
                this.alerts.errorToast('No se pudo posponer', this.errorMessage(error, 'Intenta nuevamente.'));
                resolve(false);
              },
            })),
          },
        });
      }
      if (!actions.length) actions.push({ label: 'Ver avisos', onClick: () => this.openNotification(notification) });
      return actions;
    }
    if (type === 'PENDIENTE') {
      const pendingId = String(notification.datos?.['pendienteId'] || '');
      const pending = this.pendientes().find(item => item.idPendiente === pendingId);
      const isScheduleChange = String(notification.entidadTipo || '').toUpperCase() === 'PROGRAMACION_CAMBIO';
      const actions: ToastAction[] = [{
        label: isScheduleChange ? 'Revisar cambios' : pending ? this.pendingActionLabel(pending) : this.notificationActionLabel(notification),
        onClick: () => pending && this.canOpenOrigin(pending) ? this.openOrigin(pending) : this.openNotification(notification),
      }];
      if (pending && this.canManagePending && !pending.estaSuprimido) {
        const minutes = Math.min(pending.posposicionMaxMinutos || 30, 30);
        actions.push({
          label: 'Recordar más tarde',
          postpone: {
            initialMinutes: minutes,
            maxMinutes: pending.posposicionMaxMinutos,
            onConfirm: until => new Promise<boolean>(resolve => this.postponePending(pending, until).subscribe({
              next: () => { this.notifications.markRead(notification.idNotificacion); resolve(true); },
              error: error => {
                this.alerts.errorToast('No se pudo posponer', this.errorMessage(error, 'Intenta nuevamente.'));
                resolve(false);
              },
            })),
          },
        });
      }
      return actions;
    }
    return [{ label: 'Ver detalles', onClick: () => this.openNotification(notification) }];
  }

  private reminderTime(item: PersonalReminder): number {
    const time = new Date(item.siguienteTrigger || item.fecha).getTime();
    return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
  }

  private sortReminders(items: PersonalReminder[]): PersonalReminder[] {
    return [...items].sort((a, b) => this.reminderTime(a) - this.reminderTime(b));
  }

  private errorMessage(error: any, fallback: string): string {
    return error?.error?.message || error?.error?.mensaje || error?.message || fallback;
  }
}
