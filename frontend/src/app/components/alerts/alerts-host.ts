import {
  Component, inject, HostListener, OnInit, OnDestroy,
  NgZone, ChangeDetectorRef, ChangeDetectionStrategy, effect
} from '@angular/core';
import { SirAlertService } from '../../services/Alertas/alert.service';

interface PillToast {
  id:      string;
  type:    'success' | 'info' | 'warning' | 'error';
  title:   string;
  message?: string;
  phase:   'drop' | 'expand' | 'live' | 'collapse' | 'fade';
  width:   number;
}

const COLORS: Record<string, { icon: string; bg: string }> = {
  success: { icon: '#30d158', bg: 'rgba(48,209,88,0.15)'  },
  error:   { icon: '#ff453a', bg: 'rgba(255,69,58,0.15)'  },
  info:    { icon: '#5ac8fa', bg: 'rgba(10,132,255,0.15)' },
  warning: { icon: '#ffd60a', bg: 'rgba(255,214,10,0.12)' },
};

@Component({
  selector: 'app-sir-alerts',
  standalone: true,
  imports: [],
  templateUrl: './alerts-host.html',
  styleUrls:  ['./alerts-host.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirAlertsHostComponent implements OnInit, OnDestroy {
  readonly alertSvc  = inject(SirAlertService);
  private  zone      = inject(NgZone);
  private  cdr       = inject(ChangeDetectorRef);

  readonly modal    = this.alertSvc.modal;
  readonly critical = this.alertSvc.critical;

  pills: PillToast[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private prevToastIds = new Set<string>();
  private modalTimer?: ReturnType<typeof setTimeout>;

  private readonly T_DROP     = 260;
  private readonly T_WAIT1    = 100;
  private readonly T_EXPAND   = 360;
  private readonly T_LIVE_MIN = 2800;
  private readonly T_LIVE_MAX = 6000;
  private readonly T_COLLAPSE = 300;
  private readonly T_WAIT2    = 180;
  private readonly T_FADE     = 220;

  private readonly toastEffect = effect(() => {
    const current = this.alertSvc.toasts();
    this.zone.runOutsideAngular(() => {
      for (const toast of current) {
        if (!this.prevToastIds.has(toast.id)) {
          this.prevToastIds.add(toast.id);
          this.zone.run(() => this.addPill(toast.id, toast.type, toast.title, toast.message, toast.durationMs));
        }
      }
    });
  });

  private readonly modalEffect = effect(() => {
    const modal = this.modal();
    clearTimeout(this.modalTimer);
    this.modalTimer = undefined;

    if (!modal?.autoClose) {
      return;
    }

    const timeout = Math.max(500, Number(modal.autoCloseTime || 3000));
    this.modalTimer = setTimeout(() => {
      if (this.modal()?.id === modal.id) {
        this.alertSvc.closeModal();
      }
    }, timeout);
  });

  ngOnInit(): void {}

  ngOnDestroy(): void {
    clearTimeout(this.modalTimer);
    for (const timers of this.timers.values()) timers.forEach(clearTimeout);
  }

  iconColor(type: string): string { return COLORS[type]?.icon ?? '#fff'; }
  iconBg(type: string):    string { return COLORS[type]?.bg   ?? 'rgba(255,255,255,0.1)'; }

  /** Ancho objetivo de la píldora según cuánto texto trae.
   *  Ya no se intenta caber todo en una sola línea: el mensaje
   *  puede ocupar hasta 2 líneas (ver CSS), así que esto solo
   *  define una columna de lectura cómoda, no el ancho exacto del texto. */
  private computePillWidth(title: string, message?: string): number {
    if (!message) {
      // solo título -> píldora compacta ajustada al texto
      return Math.min(260, Math.max(150, 76 + title.length * 6.5));
    }
    const longest = Math.max(title.length, message.length);
    if (longest <= 28) return 280;
    if (longest <= 48) return 320;
    return 360; // a partir de aquí, el clamp de 2 líneas + ellipsis hace el resto
  }

  /** Tiempo "vivo" proporcional a la cantidad de texto — solo se usa
   *  como fallback si el servicio no mandó un durationMs explícito. */
  private computeLiveDuration(title: string, message?: string): number {
    const chars = title.length + (message?.length ?? 0);
    return Math.min(this.T_LIVE_MAX, Math.max(this.T_LIVE_MIN, chars * 45));
  }

  addPill(id: string, type: any, title: string, message?: string, durationMs?: number): void {
    const width = this.computePillWidth(title, message);
    const liveDuration = durationMs && durationMs > 0
      ? durationMs
      : this.computeLiveDuration(title, message);

    const pill: PillToast = { id, type, title, message, phase: 'drop', width };
    this.pills = [...this.pills, pill];
    this.cdr.markForCheck();

    const t = (ms: number, fn: () => void) => setTimeout(fn, ms);
    const ts: ReturnType<typeof setTimeout>[] = [];
    const total = (a: number, b: number) => a + b;

    const t1 = total(this.T_DROP, this.T_WAIT1);
    const t2 = total(t1, this.T_EXPAND + liveDuration);
    const t3 = total(t2, this.T_COLLAPSE + this.T_WAIT2);
    const t4 = total(t3, this.T_FADE + 60);

    ts.push(t(t1, () => this.setPhase(id, 'expand')));
    ts.push(t(t2, () => this.setPhase(id, 'collapse')));
    ts.push(t(t3, () => this.setPhase(id, 'fade')));
    ts.push(t(t4, () => { this.removePill(id); this.alertSvc.dismissToast(id); }));

    this.timers.set(id, ts);
  }

  private setPhase(id: string, phase: PillToast['phase']): void {
    this.pills = this.pills.map(p => p.id === id ? { ...p, phase } : p);
    this.cdr.markForCheck();
  }

  private removePill(id: string): void {
    this.pills = this.pills.filter(p => p.id !== id);
    this.timers.get(id)?.forEach(clearTimeout);
    this.timers.delete(id);
    this.prevToastIds.delete(id);
    this.cdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modal()) this.alertSvc.closeModal();
  }

  onModalBackdrop(): void {
    const m = this.modal();
    if (!m) return;
    const hasRequired = (m.buttons ?? []).some(b => b.style !== 'secondary');
    if (!hasRequired) this.alertSvc.closeModal();
  }
}