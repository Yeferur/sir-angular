import { SirSelectComponent, SirSelectOption, compareSelectValuesAsStrings } from '../../shared/select/select';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  OperationalPending,
  PendingPriority,
  PersonalReminder,
  ReminderInput,
} from '../../services/Pendientes/pendientes.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { MiActividadFacade } from '../../services/MiActividad/mi-actividad.facade';
import { SirNotification } from '../../services/Notificaciones/notificaciones.service';
import { ReminderFormComponent } from '../../components/reminder-form/reminder-form';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { isFutureSirDateTime, nextSirMinute, nextSirTime, sirLocalDateTimeToIso, sirToday, toSirLocalDateTime } from '../../shared/utils/sir-datetime';

type CenterTab = 'todos' | 'pendientes' | 'recordatorios' | 'novedades';

@Component({
  selector: 'app-pendientes',
  standalone: true,
  imports: [SirSelectComponent, CommonModule, FormsModule, ReminderFormComponent, DatepickerComponent, TimepickerComponent, LoadingStateComponent],
  templateUrl: './pendientes.html',
  styleUrl: './pendientes.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendientesComponent implements OnInit {
  readonly compareSelectValues = compareSelectValuesAsStrings;

  readonly prioridadSelectOptions: SirSelectOption[] = [{ value: "TODAS", label: "Todas" },
      { value: "CRITICA", label: "Crítica" },
      { value: "ALTA", label: "Alta" },
      { value: "MEDIA", label: "Media" },
      { value: "BAJA", label: "Baja" }];

  readonly activity = inject(MiActividadFacade);
  private readonly alerts = inject(SirAlertService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = this.activity.loading;
  readonly loaded = this.activity.loaded;
  readonly saving = signal(false);
  readonly error = this.activity.error;
  readonly pending = this.activity.pendientes;
  readonly reminders = this.activity.recordatorios;
  readonly activeTab = signal<CenterTab>('todos');
  readonly showReminderForm = signal(false);
  readonly pendingActionId = signal<string | null>(null);
  readonly pendingAction = signal<'posponer' | 'descartar' | null>(null);
  readonly reminderActionId = signal<string | null>(null);
  readonly includeSuppressed = signal(true);
  readonly priorityFilter = signal<PendingPriority | 'TODAS'>('TODAS');
  readonly visiblePending = computed(() => this.pending().filter(item =>
    (this.includeSuppressed() || !item.estaSuprimido)
    && (this.priorityFilter() === 'TODAS' || item.prioridad === this.priorityFilter())));

  reminderForm: ReminderInput = { titulo: '', descripcion: '', fecha: '' };
  postponeUntil = '';
  dismissReason = '';
  readonly minActivityDate = sirToday();

  get canReadPending(): boolean { return this.activity.canReadPending; }
  get canManagePending(): boolean { return this.activity.canManagePending; }
  get canReadReminders(): boolean { return this.activity.canReadReminders; }
  get canCreateReminders(): boolean { return this.activity.canCreateReminders; }
  get canUpdateReminders(): boolean { return this.activity.canUpdateReminders; }
  get canDeleteReminders(): boolean { return this.activity.canDeleteReminders; }
  get highPriorityCount(): number {
    return this.activity.pendientesPrioritarios().length;
  }

  ngOnInit(): void {
    const requested = this.route.snapshot.queryParamMap.get('tab');
    if (requested === 'recordatorios' && this.canReadReminders) this.activeTab.set('recordatorios');
    else if (requested === 'pendientes' && this.canReadPending) this.activeTab.set('pendientes');
    else if (requested === 'novedades') this.activeTab.set('novedades');
    this.activity.start();
  }

  load(): void {
    this.activity.refresh(true);
  }

  setTab(tab: CenterTab): void {
    this.activeTab.set(tab);
    this.cancelPendingAction();
  }

  toggleSuppressed(): void {
    this.includeSuppressed.update(value => !value);
  }

  openReminderForm(): void {
    this.reminderForm = { titulo: '', descripcion: '', fecha: nextSirMinute(), enviarCorreo: false };
    this.showReminderForm.set(true);
    this.activeTab.set('recordatorios');
  }

  closeReminderForm(): void {
    this.showReminderForm.set(false);
  }

  saveReminder(): void {
    const title = String(this.reminderForm.titulo || '').trim();
    const dateIso = sirLocalDateTimeToIso(this.reminderForm.fecha);
    if (!title || !dateIso || !isFutureSirDateTime(this.reminderForm.fecha)) {
      this.alerts.warningToast('Revisa el recordatorio', 'Escribe un título y selecciona fecha y hora.');
      return;
    }
    this.saving.set(true);
    this.activity.createReminder({
      ...this.reminderForm,
      titulo: title,
      fecha: dateIso,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showReminderForm.set(false);
        this.alerts.successToast('Recordatorio creado');
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo crear', this.errorMessage(error, 'Intenta nuevamente.'));
      },
    });
  }

  beginPendingAction(item: OperationalPending, action: 'posponer' | 'descartar'): void {
    this.pendingActionId.set(item.idPendiente);
    this.pendingAction.set(action);
    this.dismissReason = '';
    if (action === 'posponer') {
      const minutes = Math.min(item.posposicionMaxMinutos || 30, 30);
      this.postponeUntil = toSirLocalDateTime(new Date(Date.now() + minutes * 60000));
    }
  }

  cancelPendingAction(): void {
    this.pendingActionId.set(null);
    this.pendingAction.set(null);
    this.dismissReason = '';
    this.postponeUntil = '';
  }

  confirmPostpone(item: OperationalPending): void {
    const postponeIso = sirLocalDateTimeToIso(this.postponeUntil);
    if (!postponeIso || !isFutureSirDateTime(this.postponeUntil)) {
      this.alerts.warningToast('Revisa la fecha y hora', 'Selecciona un momento futuro válido.');
      return;
    }
    this.saving.set(true);
    this.activity.postponePending(item, postponeIso).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelPendingAction();
        this.alerts.successToast('Pendiente pospuesto', 'Continúa activo y volverá a mostrarse en el momento indicado.');
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo posponer', this.errorMessage(error, 'Revisa la fecha seleccionada.'));
      },
    });
  }

  async confirmDismiss(item: OperationalPending): Promise<void> {
    if (item.requiereJustificacion && !this.dismissReason.trim()) {
      this.alerts.warningToast('Explica el descarte', 'Escribe el motivo para continuar.');
      return;
    }
    const confirmed = await this.alerts.confirmDecision(
      'Descartar pendiente',
      `“${item.titulo}” dejará de aparecer como pendiente.`,
      { confirmText: 'Descartar', destructive: true },
    );
    if (!confirmed) return;
    this.saving.set(true);
    this.activity.dismissPending(item, this.dismissReason).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelPendingAction();
        this.alerts.successToast('Pendiente descartado');
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo descartar', this.errorMessage(error, 'La situación debe resolverse en su módulo de origen.'));
      },
    });
  }

  completeReminder(item: PersonalReminder): void {
    this.activity.completeReminder(item).subscribe({
      next: () => {
        this.alerts.successToast('Recordatorio completado');
      },
      error: error => this.alerts.errorToast('No se pudo completar', this.errorMessage(error, 'Intenta nuevamente.')),
    });
  }

  beginReminderPostpone(item: PersonalReminder): void {
    this.reminderActionId.set(item.idRecordatorio);
    this.postponeUntil = toSirLocalDateTime(new Date(Date.now() + 30 * 60000));
  }

  cancelReminderPostpone(): void {
    this.reminderActionId.set(null);
    this.postponeUntil = '';
  }

  postponeReminder(item: PersonalReminder): void {
    const postponeIso = sirLocalDateTimeToIso(this.postponeUntil);
    if (!postponeIso || !isFutureSirDateTime(this.postponeUntil)) {
      this.alerts.warningToast('Revisa la fecha y hora', 'El momento seleccionado ya pasó.');
      return;
    }
    this.saving.set(true);
    this.activity.postponeReminder(item, postponeIso).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelReminderPostpone();
        this.alerts.successToast('Recordatorio pospuesto', 'Te avisaremos en el nuevo momento.');
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo posponer', this.errorMessage(error, 'Revisa la fecha seleccionada.'));
      },
    });
  }

  async deleteReminder(item: PersonalReminder): Promise<void> {
    const confirmed = await this.alerts.confirmDecision(
      'Eliminar recordatorio',
      `“${item.titulo}” se eliminará de forma permanente.`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!confirmed) return;
    this.activity.deleteReminder(item).subscribe({
      next: () => {
        this.alerts.successToast('Recordatorio eliminado');
      },
      error: error => this.alerts.errorToast('No se pudo eliminar', this.errorMessage(error, 'Intenta nuevamente.')),
    });
  }

  openEntity(item: OperationalPending): void {
    this.activity.openOrigin(item);
  }

  openNotification(item: SirNotification): void {
    this.activity.markNotificationRead(item);
    this.activity.openNotification(item);
  }

  markNotificationRead(item: SirNotification): void {
    this.activity.markNotificationRead(item);
  }

  priorityLabel(priority: PendingPriority): string {
    return { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' }[priority];
  }

  trackPending(_index: number, item: OperationalPending): string { return item.idPendiente; }
  trackReminder(_index: number, item: PersonalReminder): string { return item.idRecordatorio; }

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

  private errorMessage(error: any, fallback: string): string {
    return error?.error?.message || error?.error?.mensaje || error?.message || fallback;
  }
}
