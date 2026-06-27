import { Injectable, signal } from '@angular/core';

export type AlertType   = 'success' | 'info' | 'warning' | 'error';

export interface SirToast {
  id: string;
  type: AlertType;
  title: string;
  message?: string;
  durationMs: number;
}

export interface AlertButton {
  text:    string;
  style:   'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface SirModalAlert {
  id:       string;
  type:     AlertType;
  title:    string;
  message?: string;
  buttons?: AlertButton[];
  loading?: boolean;
  autoClose?: boolean;
  autoCloseTime?: number;
}

export interface SirCriticalAlert extends SirModalAlert {
  icon?: 'trash' | 'warning' | 'info' | 'success' | 'error';
}

let _seq = 0;
const uid = () => `sir-${++_seq}-${Date.now()}`;

/** Única fuente de verdad para "cuánto debe durar visible" un toast.
 *  Se usa como default cuando no se pasa durationMs explícito;
 *  si se pasa, ese valor manda y el componente visual lo respeta tal cual. */
function readTime(title: string, message = '', floor = 2800, ceiling = 6000): number {
  const chars = title.length + message.length;
  return Math.min(ceiling, Math.max(floor, chars * 45));
}

@Injectable({ providedIn: 'root' })
export class SirAlertService {
  private _toasts = signal<SirToast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  // Nivel 2: modal flotante
  private _modal = signal<SirModalAlert | null>(null);
  readonly modal = this._modal.asReadonly();

  showModal(opts: Omit<SirModalAlert, 'id'>): string {
    const id = uid();
    this._modal.set({ ...opts, id });
    return id;
  }

  closeModal(): void { this._modal.set(null); }

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
      autoCloseTime: opts?.autoCloseTime,
    });
  }

  showToast(toast: Omit<SirToast, 'id'>): string {
    const id = uid();
    const safeDuration = Math.max(1000, Number(toast.durationMs || 3500));
    this._toasts.update((list) => [...list, { ...toast, id, durationMs: safeDuration }]);
    setTimeout(() => this.dismissToast(id), safeDuration);
    return id;
  }

  dismissToast(id: string): void {
    this._toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  successToast(title: string, message = '', durationMs?: number): string {
    return this.showToast({ type: 'success', title, message, durationMs: durationMs ?? readTime(title, message, 2600) });
  }

  infoToast(title: string, message = '', durationMs?: number): string {
    return this.showToast({ type: 'info', title, message, durationMs: durationMs ?? readTime(title, message, 2800) });
  }

  warningToast(title: string, message = '', durationMs?: number): string {
    return this.showToast({ type: 'warning', title, message, durationMs: durationMs ?? readTime(title, message, 3200) });
  }

  errorToast(title: string, message = '', durationMs?: number): string {
    return this.showToast({ type: 'error', title, message, durationMs: durationMs ?? readTime(title, message, 4000) });
  }

  confirm(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    opts?: { confirmText?: string; cancelText?: string; type?: AlertType }
  ): string {
    return this.showConfirm(title, message, [
      { text: opts?.cancelText  ?? 'Cancelar',  style: 'secondary', onClick: () => { this.closeModal(); onCancel?.(); } },
      { text: opts?.confirmText ?? 'Confirmar', style: 'primary',   onClick: () => { this.closeModal(); onConfirm(); } },
    ], { type: opts?.type ?? 'warning' });
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
      autoCloseTime: opts?.autoCloseTime,
    });
  }

  // Nivel 3: modal critico bloqueante
  private _critical = signal<SirCriticalAlert | null>(null);
  readonly critical = this._critical.asReadonly();

  showCritical(opts: Omit<SirCriticalAlert, 'id'>): string {
    const id = uid();
    this._critical.set({ ...opts, id });
    return id;
  }

  closeCritical(): void { this._critical.set(null); }

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
        { text: opts?.cancelText  ?? 'Cancelar', style: 'secondary', onClick: () => { this.closeCritical(); onCancel?.(); } },
        { text: opts?.confirmText ?? 'Eliminar', style: 'danger',    onClick: () => { this.closeCritical(); onConfirm(); } },
      ],
    });
  }

  // ─── Smart alerts: píldora para mensajes cortos, modal para mensajes largos ───

  private readonly SMART_MSG_LIMIT = 60;

  smartError(title: string, message = '', durationMs?: number): string {
    if (message.length <= this.SMART_MSG_LIMIT) {
      return this.errorToast(title, message, durationMs);
    }
    return this.showModal({
      type: 'error',
      title,
      message,
      autoClose: true,
      autoCloseTime: durationMs ?? readTime(title, message, 4000),
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.closeModal() }],
    });
  }

  smartSuccess(title: string, message = '', durationMs?: number): string {
    if (message.length <= this.SMART_MSG_LIMIT) {
      return this.successToast(title, message, durationMs);
    }
    return this.showModal({
      type: 'success',
      title,
      message,
      autoClose: true,
      autoCloseTime: durationMs ?? readTime(title, message, 2600),
      buttons: [{ text: 'OK', style: 'primary', onClick: () => this.closeModal() }],
    });
  }

  smartWarning(title: string, message = '', durationMs?: number): string {
    if (message.length <= this.SMART_MSG_LIMIT) {
      return this.warningToast(title, message, durationMs);
    }
    return this.showModal({
      type: 'warning',
      title,
      message,
      autoClose: true,
      autoCloseTime: durationMs ?? readTime(title, message, 3200),
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.closeModal() }],
    });
  }

  smartInfo(title: string, message = '', durationMs?: number): string {
    if (message.length <= this.SMART_MSG_LIMIT) {
      return this.infoToast(title, message, durationMs);
    }
    return this.showModal({
      type: 'info',
      title,
      message,
      autoClose: true,
      autoCloseTime: durationMs ?? readTime(title, message, 2800),
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.closeModal() }],
    });
  }
}