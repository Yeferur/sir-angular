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
import { AlertType, SirAlertService, SirToast } from '../../services/Alertas/alert.service';

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
  imports: [],
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

  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private modalTimer?: ReturnType<typeof setTimeout>;
  private restoreFocusTo: HTMLElement | null = null;
  private dialogWasOpen = false;

  private readonly toastEffect = effect(() => {
    const queued = this.alertSvc.toasts();
    const visibleIds = new Set(this.visibleToasts.map((toast) => toast.id));
    const available = queued.filter((toast) => !visibleIds.has(toast.id));
    const slots = Math.max(0, 3 - this.visibleToasts.length);

    for (const toast of available.slice(0, slots)) {
      this.mountToast(toast);
    }
  });

  private readonly dialogEffect = effect(() => {
    const modal = this.modal();
    const critical = this.critical();
    const dialogOpen = Boolean(modal || critical);

    clearTimeout(this.modalTimer);
    this.modalTimer = undefined;

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
  });

  ngOnDestroy(): void {
    clearTimeout(this.modalTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    document.body.classList.remove('sir-dialog-open');
  }

  typeLabel(type: AlertType): string {
    return TYPE_LABEL[type];
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

  runToastAction(toast: ToastView): void {
    try {
      toast.action?.onClick();
    } finally {
      this.dismissToast(toast.id);
    }
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
    this.visibleToasts = this.visibleToasts.filter((toast) => toast.id !== id);
    this.alertSvc.dismissToast(id);
    this.cdr.markForCheck();
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
