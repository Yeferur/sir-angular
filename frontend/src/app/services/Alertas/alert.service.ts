import { Injectable, signal } from '@angular/core';
import { sanitizeUserErrorMessage } from '../../shared/errors/user-error-message';

export type AlertType = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface SirToast {
  id: string;
  type: AlertType;
  title: string;
  message?: string;
  durationMs: number;
  dismissible: boolean;
  action?: ToastAction;
}

export interface AlertButton {
  text: string;
  style: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface SirModalAlert {
  id: string;
  type: AlertType;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  loading?: boolean;
  autoClose?: boolean;
  autoCloseTime?: number;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export interface SirCriticalAlert extends SirModalAlert {
  icon?: 'trash' | 'warning' | 'info' | 'success' | 'error';
}

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  type?: AlertType;
  destructive?: boolean;
}

let sequence = 0;
const uid = () => `sir-${++sequence}-${Date.now()}`;

/**
 * Tiempo de lectura aproximado con un mínimo generoso. El movimiento llama la
 * atención; la duración permite leer sin convertir cada acción en un bloqueo.
 */
function readTime(title: string, message = '', floor = 4000, ceiling = 9000): number {
  const words = `${title} ${message}`.trim().split(/\s+/).filter(Boolean).length;
  const readingMs = words * 330 + 1800;
  return Math.min(ceiling, Math.max(floor, readingMs));
}

@Injectable({ providedIn: 'root' })
export class SirAlertService {
  private readonly _toasts = signal<SirToast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private readonly _modal = signal<SirModalAlert | null>(null);
  readonly modal = this._modal.asReadonly();

  private readonly _critical = signal<SirCriticalAlert | null>(null);
  readonly critical = this._critical.asReadonly();

  showModal(opts: Omit<SirModalAlert, 'id'>): string {
    const id = uid();
    const hasDecision = Boolean(opts.buttons?.length);
    const dismissible = opts.dismissible ?? (!opts.loading && !hasDecision);
    const mayAutoClose = opts.type === 'success' || opts.type === 'info';

    this._modal.set({
      ...opts,
      message: opts.type === 'error'
        ? sanitizeUserErrorMessage(opts.message)
        : opts.message,
      id,
      // Advertencias y errores nunca desaparecen antes de ser reconocidos.
      autoClose: mayAutoClose && !hasDecision ? opts.autoClose : false,
      dismissible,
      closeOnBackdrop: opts.closeOnBackdrop ?? dismissible,
      closeOnEscape: opts.closeOnEscape ?? dismissible,
    });
    return id;
  }

  closeModal(): void {
    this._modal.set(null);
  }

  /** Alias conservado para no romper los módulos existentes. */
  showAlert(opts: Omit<SirModalAlert, 'id'>): string {
    return this.showModal(opts);
  }

  showLoading(
    title = 'Cargando datos...',
    message = '',
    opts?: Partial<Omit<SirModalAlert, 'id' | 'title' | 'message' | 'loading' | 'buttons'>>
  ): string {
    return this.showModal({
      type: opts?.type ?? 'info',
      title,
      message,
      loading: true,
      autoClose: false,
      dismissible: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
    });
  }

  showToast(toast: Omit<SirToast, 'id' | 'dismissible'> & { dismissible?: boolean }): string {
    const id = uid();
    const safeDuration = Math.max(2500, Number(toast.durationMs || 4500));
    const next: SirToast = {
      ...toast,
      message: toast.type === 'error'
        ? sanitizeUserErrorMessage(toast.message)
        : toast.message,
      id,
      durationMs: safeDuration,
      dismissible: toast.dismissible ?? true,
    };

    // Evita crecimiento sin límite si un proceso defectuoso emite en ráfaga.
    this._toasts.update((list) => [...list.slice(-11), next]);
    return id;
  }

  notify(opts: {
    type: AlertType;
    title: string;
    message?: string;
    durationMs?: number;
    dismissible?: boolean;
    action?: ToastAction;
  }): string {
    return this.showToast({
      ...opts,
      message: opts.message ?? '',
      durationMs: opts.durationMs ?? readTime(opts.title, opts.message),
    });
  }

  dismissToast(id: string): void {
    this._toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  successToast(title: string, message = '', durationMs?: number): string {
    return this.notify({ type: 'success', title, message, durationMs: durationMs ?? readTime(title, message, 3600, 7000) });
  }

  infoToast(title: string, message = '', durationMs?: number): string {
    return this.notify({ type: 'info', title, message, durationMs: durationMs ?? readTime(title, message, 4200) });
  }

  warningToast(title: string, message = '', durationMs?: number): string {
    return this.notify({ type: 'warning', title, message, durationMs: durationMs ?? readTime(title, message, 5200) });
  }

  errorToast(title: string, message = '', durationMs?: number): string {
    return this.notify({ type: 'error', title, message, durationMs: durationMs ?? readTime(title, message, 6200) });
  }

  confirm(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    opts?: ConfirmOptions
  ): string {
    const style = opts?.destructive ? 'danger' : 'primary';
    return this.showConfirm(title, message, [
      { text: opts?.cancelText ?? 'Cancelar', style: 'secondary', onClick: () => { this.closeModal(); onCancel?.(); } },
      { text: opts?.confirmText ?? 'Confirmar', style, onClick: () => { this.closeModal(); onConfirm(); } },
    ], { type: opts?.type ?? 'warning' });
  }

  /** API nueva para flujos async; la API con callbacks sigue siendo compatible. */
  confirmDecision(title: string, message: string, opts?: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.confirm(title, message, () => resolve(true), () => resolve(false), opts);
    });
  }

  showConfirm(
    title: string,
    message: string,
    buttons: AlertButton[],
    opts?: Partial<Omit<SirModalAlert, 'id' | 'title' | 'message' | 'buttons'>>
  ): string {
    return this.showModal({
      type: opts?.type ?? 'warning',
      title,
      message,
      buttons,
      loading: false,
      autoClose: false,
      dismissible: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
    });
  }

  showCritical(opts: Omit<SirCriticalAlert, 'id'>): string {
    const id = uid();
    this._modal.set(null);
    this._critical.set({
      ...opts,
      id,
      dismissible: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
    });
    return id;
  }

  closeCritical(): void {
    this._critical.set(null);
  }

  confirmDelete(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    opts?: { confirmText?: string; cancelText?: string }
  ): string {
    return this.showCritical({
      type: 'error',
      icon: 'trash',
      title,
      message,
      buttons: [
        { text: opts?.cancelText ?? 'Cancelar', style: 'secondary', onClick: () => { this.closeCritical(); onCancel?.(); } },
        { text: opts?.confirmText ?? 'Eliminar', style: 'danger', onClick: () => { this.closeCritical(); onConfirm(); } },
      ],
    });
  }

  // Compatibilidad: los mensajes largos importantes requieren reconocimiento.
  private readonly SMART_MSG_LIMIT = 60;

  smartError(title: string, message = '', durationMs?: number): string {
    return this.smart('error', title, message, durationMs);
  }

  smartSuccess(title: string, message = '', durationMs?: number): string {
    return this.smart('success', title, message, durationMs);
  }

  smartWarning(title: string, message = '', durationMs?: number): string {
    return this.smart('warning', title, message, durationMs);
  }

  smartInfo(title: string, message = '', durationMs?: number): string {
    return this.smart('info', title, message, durationMs);
  }

  private smart(type: AlertType, title: string, message: string, durationMs?: number): string {
    if (message.length <= this.SMART_MSG_LIMIT) {
      return this.notify({ type, title, message, durationMs });
    }

    return this.showModal({
      type,
      title,
      message,
      autoClose: false,
      dismissible: false,
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.closeModal() }],
    });
  }
}
