import { AfterViewInit, Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

/** Fits the rendered title to its actual slot without changing the topbar controls. */
@Directive({ selector: '[sirFitTopbarTitle]', standalone: true })
export class FitTopbarTitleDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('sirFitTopbarTitle') title = '';
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer?: ResizeObserver;
  private frame = 0;

  ngAfterViewInit(): void {
    const slot = this.element.parentElement;
    if (slot) {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(slot);
    }
    document.fonts?.ready.then(() => this.schedule());
    this.schedule();
  }

  ngOnChanges(): void { this.schedule(); }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.fit());
  }

  private fit(): void {
    const slot = this.element.parentElement;
    if (!slot || !slot.clientWidth) return;
    const slotStyle = getComputedStyle(slot);
    const available = slot.clientWidth - parseFloat(slotStyle.paddingLeft) - parseFloat(slotStyle.paddingRight);
    this.element.style.removeProperty('font-size');
    const normal = parseFloat(getComputedStyle(this.element).fontSize);
    if (!normal || available <= 0) return;
    if (this.element.scrollWidth <= available) return;

    const minimum = Math.min(normal, Math.max(12, normal * .7));
    let low = minimum;
    let high = normal;
    this.element.style.fontSize = `${minimum}px`;
    if (this.element.scrollWidth > available) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const middle = (low + high) / 2;
      this.element.style.fontSize = `${middle}px`;
      if (this.element.scrollWidth <= available) low = middle;
      else high = middle;
    }
    this.element.style.fontSize = `${low}px`;
  }
}
