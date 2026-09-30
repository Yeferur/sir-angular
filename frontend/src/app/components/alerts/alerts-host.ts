import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { TimepickerComponent } from '../../shared/timepicker/timepicker';
import {
  isFutureSirDateTime,
  nextSirTime,
  sirLocalDateTimeToIso,
  sirToday,
  toSirLocalDateTime,
} from '../../shared/utils/sir-datetime';
import { AlertType, SirAlertService, SirToast, ToastAction } from '../../services/Alertas/alert.service';

type ToastPhase = 'enter' | 'live' | 'exit';

interface ToastView extends SirToast {
  phase: ToastPhase;
  remainingMs: number;
  startedAt: number;
  paused: boolean;
}

const TYPE_LABEL: Record<AlertType, string> = {
  success: 'Listo',
  info: 'Información',
  warning: 'Atención',
  error: 'Error',
};

@Component({
  selector: 'app-sir-alerts',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, TimepickerComponent],
  templateUrl: './alerts-host.html',
  styleUrls: ['./alerts-host.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirAlertsHostComponent implements OnDestroy {
  readonly alertSvc = inject(SirAlertService);
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly modal = this.alertSvc.modal;
  readonly critical = this.alertSvc.critical;

  visibleToasts: ToastView[] = [];
  postponeToastId: string | null = null;
  postponeAction: ToastAction | null = null;
  postponeUntil = '';
  postponeSaving = false;
  readonly minPostponeDate = sirToday();

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private operationalMountTimer?: ReturnType<typeof setTimeout>;
  private lastOperationalRemovedAt = 0;
  private modalTimer?: ReturnType<typeof setTimeout>;
  private restoreFocusTo: HTMLElement | null = null;
  private dialogWasOpen = false;

  private readonly toastEffect = effect(() => {
    const queued = this.alertSvc.toasts();
    const visibleIds = new Set(this.visibleToasts.map((toast) => toast.id));
    const available = queued.filter((toast) => !visibleIds.has(toast.id));
    const reservedOperationalSlots = Math.min(3, available.filter(toast => toast.operational).length);
    const normalSlots = Math.max(0, 3 - this.visibleToasts.length - reservedOperationalSlots);
    for (const toast of available.filter(item => !item.operational).slice(0, normalSlots)) {
      this.mountToast(toast);
    }

    const operationalSlots = Math.max(0, 3 - this.visibleToasts.length);
    if (!operationalSlots || this.operationalMountTimer) return;
    const nextOperational = available
      .filter(item => item.operational)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, operationalSlots);
    if (!nextOperational.length) return;
    const sensitiveDelay = this.hasSensitiveInteraction() ? 1_200 : 0;
    const delay = Math.max(sensitiveDelay, 700 - (Date.now() - this.lastOperationalRemovedAt));
    if (!delay) {
      nextOperational.forEach(toast => this.mountToast(toast));
      return;
    }
    this.operationalMountTimer = setTimeout(() => this.zone.run(() => {
      this.operationalMountTimer = undefined;
      if (!this.hasSensitiveInteraction()) {
        this.mountOperationalBatch();
      } else if (nextOperational.some(toast => this.alertSvc.toasts().some(item => item.id === toast.id))) {
        this.requestOperationalRetry();
      }
    }), delay);
  });

  private readonly dialogEffect = effect(() => {
    const modal = this.modal();
    const critical = this.critical();
    const dialogOpen = Boolean(modal || critical);

    clearTimeout(this.modalTimer);
    clearTimeout(this.operationalMountTimer);
    this.modalTimer = undefined;
    this.operationalMountTimer = undefined;

    if (modal?.autoClose) {
      const timeout = Math.max(2500, Number(modal.autoCloseTime || 4500));
      this.modalTimer = setTimeout(() => {
        if (this.modal()?.id === modal.id) this.alertSvc.closeModal();
      }, timeout);
    }

    if (dialogOpen && !this.dialogWasOpen) {
      this.restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.classList.add('sir-dialog-open');
      queueMicrotask(() => this.focusDialog());
    } else if (!dialogOpen && this.dialogWasOpen) {
      document.body.classList.remove('sir-dialog-open');
      queueMicrotask(() => this.restoreFocusTo?.focus());
      this.restoreFocusTo = null;
    } else if (dialogOpen) {
      queueMicrotask(() => this.focusDialog());
    }

    this.dialogWasOpen = dialogOpen;
    if (!dialogOpen
      && this.visibleToasts.length < 3
      && this.alertSvc.toasts().some(toast => toast.operational)) {
      this.requestOperationalRetry();
    }
  });

  ngOnDestroy(): void {
    clearTimeout(this.modalTimer);
    clearTimeout(this.operationalMountTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    document.body.classList.remove('sir-dialog-open');
  }

  typeLabel(type: AlertType): string {
    return TYPE_LABEL[type];
  }

  get operationalToasts(): ToastView[] {
    return this.visibleToasts.filter(toast => toast.operational);
  }

  pauseToast(id: string): void {
    const toast = this.visibleToasts.find((item) => item.id === id);
    if (!toast || toast.paused || toast.phase === 'exit') return;

    const elapsed = performance.now() - toast.startedAt;
    toast.remainingMs = Math.max(600, toast.remainingMs - elapsed);
    toast.paused = true;
    this.clearToastTimer(id);
    this.updateToast(id, { ...toast });
  }

  resumeToast(id: string): void {
    const toast = this.visibleToasts.find((item) => item.id === id);
    if (!toast || !toast.paused || toast.phase === 'exit') return;

    toast.paused = false;
    toast.startedAt = performance.now();
    this.updateToast(id, { ...toast });
    this.scheduleDismiss(toast);
  }

  dismissToast(id: string): void {
    const toast = this.visibleToasts.find((item) => item.id === id);
    if (!toast || toast.phase === 'exit') return;

    this.clearToastTimer(id);
    this.updateToast(id, { ...toast, phase: 'exit', paused: false });
    this.zone.runOutsideAngular(() => {
      const timer = setTimeout(() => this.zone.run(() => this.removeToast(id)), 220);
      this.timers.set(id, timer);
    });
  }

  runToastAction(toast: ToastView, action = toast.action): void {
    if (!action) return;
    if (action.postpone) {
      this.beginPostpone(toast, action);
      return;
    }
    try {
      action?.onClick();
    } finally {
      this.dismissToast(toast.id);
    }
  }

  beginPostpone(toast: ToastView, action: ToastAction): void {
    const minutes = Math.max(1, Number(action.postpone?.initialMinutes || 30));
    this.postponeToastId = toast.id;
    this.postponeAction = action;
    this.postponeUntil = toSirLocalDateTime(new Date(Date.now() + minutes * 60_000));
    this.pauseToast(toast.id);
    this.cdr.markForCheck();
  }

  cancelPostpone(toast: ToastView): void {
    this.postponeToastId = null;
    this.postponeAction = null;
    this.postponeUntil = '';
    this.postponeSaving = false;
    this.resumeToast(toast.id);
    this.cdr.markForCheck();
  }

  async confirmPostpone(toast: ToastView): Promise<void> {
    const action = this.postponeAction;
    if (!action?.postpone) return;
    const until = sirLocalDateTimeToIso(this.postponeUntil);
    if (!until || !isFutureSirDateTime(this.postponeUntil) || this.postponeSaving) {
      this.alertSvc.warningToast('Revisa la fecha y hora', 'Selecciona un momento futuro válido.');
      return;
    }
    const maxMinutes = action.postpone?.maxMinutes;
    if (maxMinutes && new Date(until).getTime() > Date.now() + maxMinutes * 60_000 + 60_000) {
      this.alertSvc.warningToast('Revisa la fecha y hora', `Este aviso admite hasta ${maxMinutes} minutos.`);
      return;
    }
    this.postponeSaving = true;
    this.cdr.markForCheck();
    try {
      const completed = await action.postpone?.onConfirm(until);
      if (completed !== false) this.dismissToast(toast.id);
    } finally {
      this.postponeSaving = false;
      this.postponeToastId = null;
      this.postponeAction = null;
      this.postponeUntil = '';
      this.cdr.markForCheck();
    }
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

  onModalBackdrop(): void {
    if (this.modal()?.closeOnBackdrop) this.alertSvc.closeModal();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.critical()?.closeOnEscape) this.alertSvc.closeCritical();
      else if (this.modal()?.closeOnEscape) this.alertSvc.closeModal();
      return;
    }

    if (event.key === 'Tab' && (this.modal() || this.critical())) {
      this.trapFocus(event);
    }
  }

  private mountToast(toast: SirToast): void {
    const view: ToastView = {
      ...toast,
      phase: 'enter',
      remainingMs: toast.durationMs,
      startedAt: performance.now(),
      paused: false,
    };

    this.visibleToasts = [...this.visibleToasts, view];
    this.cdr.markForCheck();

    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.zone.run(() => {
          const current = this.visibleToasts.find((item) => item.id === toast.id);
          if (!current) return;
          current.phase = 'live';
          current.startedAt = performance.now();
          this.updateToast(current.id, { ...current });
          this.scheduleDismiss(current);
        });
      }));
    });
  }

  private scheduleDismiss(toast: ToastView): void {
    this.clearToastTimer(toast.id);
    this.zone.runOutsideAngular(() => {
      const timer = setTimeout(() => this.zone.run(() => this.dismissToast(toast.id)), toast.remainingMs);
      this.timers.set(toast.id, timer);
    });
  }

  private clearToastTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private removeToast(id: string): void {
    this.clearToastTimer(id);
    if (this.visibleToasts.find(toast => toast.id === id)?.operational) {
      this.lastOperationalRemovedAt = Date.now();
    }
    this.visibleToasts = this.visibleToasts.filter((toast) => toast.id !== id);
    if (this.postponeToastId === id) {
      this.postponeToastId = null;
      this.postponeAction = null;
      this.postponeUntil = '';
      this.postponeSaving = false;
    }
    this.alertSvc.dismissToast(id);
    this.cdr.markForCheck();
  }

  private hasSensitiveInteraction(): boolean {
    if (typeof document === 'undefined') return false;
    if (document.body.classList.contains('sir-dialog-open')) return true;
    const active = document.activeElement as HTMLElement | null;
    const editing = active?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
    return editing || !!document.querySelector('form.ng-dirty');
  }

  private requestOperationalRetry(): void {
    clearTimeout(this.operationalMountTimer);
    this.operationalMountTimer = setTimeout(() => this.zone.run(() => {
      this.operationalMountTimer = undefined;
      if (this.hasSensitiveInteraction()) {
        this.requestOperationalRetry();
        return;
      }
      this.mountOperationalBatch();
    }), 1_200);
  }

  private mountOperationalBatch(): void {
    const slots = Math.max(0, 3 - this.visibleToasts.length);
    if (!slots) return;
    const visibleIds = new Set(this.visibleToasts.map(toast => toast.id));
    this.alertSvc.toasts()
      .filter(toast => toast.operational && !visibleIds.has(toast.id))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, slots)
      .forEach(toast => this.mountToast(toast));
  }

  private updateToast(id: string, replacement: ToastView): void {
    this.visibleToasts = this.visibleToasts.map((toast) => toast.id === id ? replacement : toast);
    this.cdr.markForCheck();
  }

  private focusDialog(): void {
    const panel = document.querySelector<HTMLElement>('[data-sir-dialog]');
    if (!panel) return;
    const preferred = panel.querySelector<HTMLElement>('[data-autofocus], button:not([disabled])');
    (preferred ?? panel).focus();
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = document.querySelector<HTMLElement>('[data-sir-dialog]');
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
