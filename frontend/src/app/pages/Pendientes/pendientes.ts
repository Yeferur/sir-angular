import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';

import {
  OperationalPending,
  PendingPriority,
  PendientesService,
  PersonalReminder,
  ReminderInput,
} from '../../services/Pendientes/pendientes.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

type CenterTab = 'pendientes' | 'recordatorios';

@Component({
  selector: 'app-pendientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pendientes.html',
  styleUrl: './pendientes.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendientesComponent implements OnInit {
  private readonly service = inject(PendientesService);
  private readonly permissions = inject(PermisosService);
  private readonly alerts = inject(SirAlertService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly pending = signal<OperationalPending[]>([]);
  readonly reminders = signal<PersonalReminder[]>([]);
  readonly activeTab = signal<CenterTab>('pendientes');
  readonly showReminderForm = signal(false);
  readonly pendingActionId = signal<string | null>(null);
  readonly pendingAction = signal<'posponer' | 'descartar' | null>(null);
  readonly reminderActionId = signal<string | null>(null);
  readonly includeSuppressed = signal(true);

  reminderForm: ReminderInput = { titulo: '', descripcion: '', fecha: '' };
  postponeUntil = '';
  dismissReason = '';

  get canReadPending(): boolean { return this.permissions.tienePermiso('PENDIENTES.LEER'); }
  get canManagePending(): boolean { return this.permissions.tienePermiso('PENDIENTES.GESTIONAR'); }
  get canReadReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.LEER'); }
  get canCreateReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.CREAR'); }
  get canUpdateReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.ACTUALIZAR'); }
  get canDeleteReminders(): boolean { return this.permissions.tienePermiso('RECORDATORIOS.ELIMINAR'); }
  get highPriorityCount(): number {
    return this.pending().filter(item => item.prioridad === 'ALTA' || item.prioridad === 'CRITICA').length;
  }

  ngOnInit(): void {
    if (!this.canReadPending && this.canReadReminders) this.activeTab.set('recordatorios');
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      pending: this.canReadPending ? this.service.listPending(this.includeSuppressed()) : of({ pendientes: [], total: 0 }),
      reminders: this.canReadReminders ? this.service.listReminders() : of({ recordatorios: [], total: 0 }),
    }).subscribe({
      next: ({ pending, reminders }) => {
        this.pending.set(pending.pendientes || []);
        this.reminders.set(reminders.recordatorios || []);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.errorMessage(error, 'No pudimos cargar tu centro de trabajo.'));
        this.loading.set(false);
      },
    });
  }

  setTab(tab: CenterTab): void {
    this.activeTab.set(tab);
    this.cancelPendingAction();
  }

  toggleSuppressed(): void {
    this.includeSuppressed.update(value => !value);
    this.load();
  }

  openReminderForm(): void {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
    this.reminderForm = { titulo: '', descripcion: '', fecha: this.toLocalInput(date) };
    this.showReminderForm.set(true);
    this.activeTab.set('recordatorios');
  }

  closeReminderForm(): void {
    this.showReminderForm.set(false);
  }

  saveReminder(): void {
    const title = String(this.reminderForm.titulo || '').trim();
    if (!title || !this.reminderForm.fecha) {
      this.alerts.warningToast('Revisa el recordatorio', 'Escribe un título y selecciona fecha y hora.');
      return;
    }
    this.saving.set(true);
    this.service.createReminder({
      ...this.reminderForm,
      titulo: title,
      fecha: new Date(this.reminderForm.fecha).toISOString(),
    }).subscribe({
      next: reminder => {
        this.reminders.update(items => [...items, reminder].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)));
        this.saving.set(false);
        this.showReminderForm.set(false);
        this.alerts.successToast('Recordatorio creado', 'Lo verás aquí hasta que lo completes.');
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
      this.postponeUntil = this.toLocalInput(new Date(Date.now() + minutes * 60000));
    }
  }

  cancelPendingAction(): void {
    this.pendingActionId.set(null);
    this.pendingAction.set(null);
    this.dismissReason = '';
    this.postponeUntil = '';
  }

  confirmPostpone(item: OperationalPending): void {
    if (!this.postponeUntil) return;
    this.saving.set(true);
    this.service.postponePending(item.idPendiente, new Date(this.postponeUntil).toISOString()).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelPendingAction();
        this.alerts.successToast('Pendiente pospuesto', 'Continúa activo y volverá a mostrarse en el momento indicado.');
        this.load();
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo posponer', this.errorMessage(error, 'Revisa la fecha seleccionada.'));
      },
    });
  }

  confirmDismiss(item: OperationalPending): void {
    if (item.requiereJustificacion && !this.dismissReason.trim()) {
      this.alerts.warningToast('Explica el descarte', 'Esta regla requiere una justificación para auditoría.');
      return;
    }
    this.saving.set(true);
    this.service.dismissPending(item.idPendiente, this.dismissReason).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelPendingAction();
        this.pending.update(items => items.filter(candidate => candidate.idPendiente !== item.idPendiente));
        this.alerts.successToast('Pendiente descartado', 'La decisión quedó registrada en auditoría.');
      },
      error: error => {
        this.saving.set(false);
        this.alerts.errorToast('No se pudo descartar', this.errorMessage(error, 'La situación debe resolverse en su módulo de origen.'));
      },
    });
  }

  completeReminder(item: PersonalReminder): void {
    this.service.completeReminder(item.idRecordatorio).subscribe({
      next: () => {
        this.reminders.update(items => items.filter(candidate => candidate.idRecordatorio !== item.idRecordatorio));
        this.alerts.successToast('Recordatorio completado');
      },
      error: error => this.alerts.errorToast('No se pudo completar', this.errorMessage(error, 'Intenta nuevamente.')),
    });
  }

  beginReminderPostpone(item: PersonalReminder): void {
    this.reminderActionId.set(item.idRecordatorio);
    this.postponeUntil = this.toLocalInput(new Date(Date.now() + 30 * 60000));
  }

  cancelReminderPostpone(): void {
    this.reminderActionId.set(null);
    this.postponeUntil = '';
  }

  postponeReminder(item: PersonalReminder): void {
    if (!this.postponeUntil) return;
    this.saving.set(true);
    this.service.postponeReminder(item.idRecordatorio, new Date(this.postponeUntil).toISOString()).subscribe({
      next: reminder => {
        this.reminders.update(items => items.map(candidate => candidate.idRecordatorio === reminder.idRecordatorio ? reminder : candidate));
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
    this.service.deleteReminder(item.idRecordatorio).subscribe({
      next: () => {
        this.reminders.update(items => items.filter(candidate => candidate.idRecordatorio !== item.idRecordatorio));
        this.alerts.successToast('Recordatorio eliminado');
      },
      error: error => this.alerts.errorToast('No se pudo eliminar', this.errorMessage(error, 'Intenta nuevamente.')),
    });
  }

  openEntity(item: OperationalPending): void {
    const type = item.entidadTipo.toUpperCase();
    if (type === 'RESERVA') void this.router.navigate(['/Reservas/EditarReserva', item.entidadId]);
    else if (type === 'TRANSFER') void this.router.navigate(['/Transfers/EditarTransfer', item.entidadId]);
    else if (item.datos?.['ruta']) void this.router.navigateByUrl(String(item.datos['ruta']));
  }

  priorityLabel(priority: PendingPriority): string {
    return { BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica' }[priority];
  }

  trackPending(_index: number, item: OperationalPending): string { return item.idPendiente; }
  trackReminder(_index: number, item: PersonalReminder): string { return item.idRecordatorio; }

  private toLocalInput(date: Date): string {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  private errorMessage(error: any, fallback: string): string {
    return error?.error?.message || error?.error?.mensaje || error?.message || fallback;
  }
}
