import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';

/**
 * Anima el textContent de su elemento host desde el valor previo hasta el nuevo
 * cada vez que [countUp] cambia. Pensada para números en dashboards en vivo
 * (aforos, contadores) donde un salto seco se siente "muerto".
 *
 * Uso: <span [countUp]="miValorNumerico"></span>
 * La primera vez que se asigna un valor, se pinta directo (sin animar) para
 * no animar la carga inicial de la pantalla.
 */
@Directive({
  selector: '[countUp]',
  standalone: true,
})
export class CountUpDirective implements OnChanges, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);

  @Input('countUp') value = 0;
  @Input('countUpDuration') duration = 600;
  @Input() countUpLocale = 'es-CO';
  @Input() countUpCurrency: string | null = null;
  @Input() countUpDecimals = 0;
  @Input() countUpPrefix = '';
  @Input() countUpSuffix = '';

  private displayed = 0;
  private rafId: number | null = null;
  private hasRendered = false;

  ngOnChanges(changes: SimpleChanges): void {
    const next = Number(this.value) || 0;

    if (!this.hasRendered) {
      this.hasRendered = true;
      this.displayed = next;
      this.render(next);
      return;
    }

    const change = changes['value'];
    if (change && !change.firstChange && change.previousValue !== change.currentValue) {
      this.animateTo(next);
      return;
    }

    if (
      changes['countUpLocale'] ||
      changes['countUpCurrency'] ||
      changes['countUpDecimals'] ||
      changes['countUpPrefix'] ||
      changes['countUpSuffix']
    ) {
      this.render(this.displayed);
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private animateTo(target: number): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const start = this.displayed;
    const delta = target - start;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.displayed = target;
      this.render(target);
      return;
    }

    if (delta === 0) {
      this.render(target);
      return;
    }

    const startTime = performance.now();
    const duration = this.duration;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const precision = 10 ** Math.max(0, this.countUpDecimals);
      const current = Math.round((start + delta * eased) * precision) / precision;

      this.displayed = current;
      this.render(current);

      if (t < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(step);
  }

  private render(value: number): void {
    const decimals = Math.max(0, this.countUpDecimals);
    let formatted: string;

    try {
      formatted = new Intl.NumberFormat(this.countUpLocale, {
        ...(this.countUpCurrency
          ? { style: 'currency' as const, currency: this.countUpCurrency }
          : {}),
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    } catch {
      formatted = value.toFixed(decimals);
    }

    this.el.nativeElement.textContent = `${this.countUpPrefix}${formatted}${this.countUpSuffix}`;
  }
}
