import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { MiActividadFacade, MiActividadTab } from '../../services/MiActividad/mi-actividad.facade';
import { SirNotification } from '../../services/Notificaciones/notificaciones.service';
import { OperationalPending, PendingPriority, PersonalReminder, ReminderInput } from '../../services/Pendientes/pendientes.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { ReminderFormComponent } from '../reminder-form/reminder-form';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { isFutureSirDateTime, nextSirMinute, nextSirTime, sirLocalDateTimeToIso, sirToday, toSirLocalDateTime } from '../../shared/utils/sir-datetime';

@Component({
  selector: 'app-mi-actividad-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent, ReminderFormComponent, DatepickerComponent, TimepickerComponent],
  templateUrl: './mi-actividad-panel.html',
  styleUrl: './mi-actividad-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiActividadPanelComponent {
  readonly activity = inject(MiActividadFacade);
  private readonly drawer = inject(SirDrawerService);
  private readonly alerts = inject(SirAlertService);
  private readonly router = inject(Router);

  readonly tab = signal<MiActividadTab>('pendientes');
  readonly actionId = signal<string | null>(null);
  readonly action = signal<'posponer-pendiente' | 'descartar' | 'posponer-recordatorio' | null>(null);
  readonly saving = signal(false);
  readonly showReminderForm = signal(false);

  postponeUntil = '';
  dismissReason = '';
  reminderForm: ReminderInput = { titulo: '', descripcion: '', fecha: '' };
  readonly minActivityDate = sirToday();

  constructor() {
    effect(() => {
      const props = this.drawer.drawer()?.props || {};
      const requested = props['tab'] as MiActividadTab | undefined;
      this.tab.set(requested === 'recordatorios' || !this.activity.canReadPending ? 'recordatorios' : 'pendientes');
      const focusId = String(props['focusId'] || '');
      if (focusId) requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-activity-id="${CSS.escape(focusId)}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
    this.activity.refresh();
  }

  setTab(tab: MiActividadTab): void {
    this.tab.set(tab);
    this.cancelAction();
  }

  close(): void { this.drawer.close(); }

  openFullPage(): void {
    this.drawer.close(true);
    void this.router.navigate(['/Pendientes']);
  }

  beginPendingAction(item: OperationalPending, action: 'posponer-pendiente' | 'descartar'): void {
    this.actionId.set(item.idPendiente);
    this.action.set(action);
    this.dismissReason = '';
    this.postponeUntil = action === 'posponer-pendiente'
      ? toSirLocalDateTime(new Date(Date.now() + Math.min(item.posposicionMaxMinutos || 30, 30) * 60000))
      : '';
  }

  beginReminderPostpone(item: PersonalReminder): void {
    this.actionId.set(item.idRecordatorio);
    this.action.set('posponer-recordatorio');
    this.postponeUntil = toSirLocalDateTime(new Date(Date.now() + 30 * 60000));
  }

  cancelAction(): void {
    this.actionId.set(null);
    this.action.set(null);
    this.postponeUntil = '';
    this.dismissReason = '';
  }

  confirmPostpone(item: OperationalPending): void {
    const postponeIso = sirLocalDateTimeToIso(this.postponeUntil);
    if (this.saving()) return;
    if (!postponeIso || !isFutureSirDateTime(this.postponeUntil)) {
      this.alerts.warningToast('Revisa la fecha y hora', 'Selecciona un momento futuro válido.');
      return;
    }
    this.saving.set(true);
    this.activity.postponePending(item, postponeIso).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelAction();
        this.alerts.successToast('Pendiente pospuesto', 'Volverá a mostrarse en el momento indicado.');
      },
      error: error => this.finishWithError('No se pudo posponer', error),
    });
  }

  confirmDismiss(item: OperationalPending): void {
    if (item.requiereJustificacion && !this.dismissReason.trim()) {
      this.alerts.warningToast('Explica el descarte', 'Esta regla requiere una justificación.');
      return;
    }
    this.saving.set(true);
    this.activity.dismissPending(item, this.dismissReason).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelAction();
        this.alerts.successToast('Pendiente descartado', 'La decisión quedó registrada.');
      },
      error: error => this.finishWithError('No se pudo descartar', error),
    });
  }

  openReminderForm(): void {
    this.reminderForm = { titulo: '', descripcion: '', fecha: nextSirMinute(), enviarCorreo: false };
    this.showReminderForm.set(true);
    this.tab.set('recordatorios');
  }

  saveReminder(): void {
    const title = String(this.reminderForm.titulo || '').trim();
    const dateIso = sirLocalDateTimeToIso(this.reminderForm.fecha);
    if (!title || !dateIso || !isFutureSirDateTime(this.reminderForm.fecha)) {
      this.alerts.warningToast('Revisa el recordatorio', 'Escribe un título y selecciona fecha y hora.');
      return;
    }
    this.saving.set(true);
    this.activity.createReminder({ ...this.reminderForm, titulo: title, fecha: dateIso }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showReminderForm.set(false);
        this.alerts.successToast('Recordatorio creado');
      },
      error: error => this.finishWithError('No se pudo crear', error),
    });
  }

  postponeReminder(item: PersonalReminder): void {
    const postponeIso = sirLocalDateTimeToIso(this.postponeUntil);
    if (this.saving()) return;
    if (!postponeIso || !isFutureSirDateTime(this.postponeUntil)) {
      this.alerts.warningToast('Revisa la fecha y hora', 'El momento seleccionado ya pasó.');
      return;
    }
    this.saving.set(true);
    this.activity.postponeReminder(item, postponeIso).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelAction();
        this.alerts.successToast('Recordatorio pospuesto');
      },
      error: error => this.finishWithError('No se pudo posponer', error),
    });
  }

  completeReminder(item: PersonalReminder): void {
    this.activity.completeReminder(item).subscribe({
      next: () => this.alerts.successToast('Recordatorio completado'),
      error: error => this.alerts.errorToast('No se pudo completar', this.errorMessage(error)),
    });
  }

  async deleteReminder(item: PersonalReminder): Promise<void> {
    if (!await this.alerts.confirmDecision('Eliminar recordatorio', `“${item.titulo}” se eliminará de forma permanente.`, { confirmText: 'Eliminar', destructive: true })) return;
    this.activity.deleteReminder(item).subscribe({
      next: () => this.alerts.successToast('Recordatorio eliminado'),
      error: error => this.alerts.errorToast('No se pudo eliminar', this.errorMessage(error)),
    });
  }

  priorityLabel(priority: PendingPriority): string {
    return { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' }[priority];
  }

  openNotification(item: SirNotification): void {
    this.activity.markNotificationRead(item);
    this.activity.openNotification(item);
  }

  markRead(item: SirNotification): void {
    this.activity.markNotificationRead(item);
  }

  notificationIcon(item: SirNotification): string {
    if (item.tipo.startsWith('turnos_semana_')) return 'bx-calendar-check';
    if (item.tipo.startsWith('turno_intercambio_')) return 'bx-transfer-alt';
    if (item.tipo.toUpperCase() === 'APP_UPDATE') return 'bx-history';
    return 'bx-bell';
  }

  private finishWithError(title: string, error: any): void {
    this.saving.set(false);
    this.alerts.errorToast(title, this.errorMessage(error));
  }

  private errorMessage(error: any): string {
    return error?.error?.message || error?.error?.mensaje || error?.message || 'Intenta nuevamente.';
  }

  get postponeDate(): string { return this.postponeUntil.split('T')[0] || ''; }
  get postponeTime(): string { return (this.postponeUntil.split('T')[1] || '').slice(0, 5); }
  get postponeMinTime(): string | null {
    return this.postponeDate === sirToday() ? nextSirTime(1) : null;
  }

  updatePostponeDate(value: string | null): void {
    this.postponeUntil = `${value || ''}T${this.postponeTime}`;
  }

  updatePostponeTime(value: string | null): void {
    this.postponeUntil = `${this.postponeDate}T${value || ''}`;
  }
}
