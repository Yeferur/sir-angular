import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: '.sir-autocomplete-panel--overlay',
  standalone: true,
})
export class SirAutocompletePanelPositionDirective implements AfterViewInit, OnDestroy {
  private readonly panel = inject(ElementRef<HTMLElement>).nativeElement;
  private resizeObserver?: ResizeObserver;
  private animationFrame = 0;
  private configuredMaxHeight = 280;

  private readonly schedulePosition = (): void => {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.positionPanel();
    });
  };

  ngAfterViewInit(): void {
    const configured = Number.parseFloat(getComputedStyle(this.panel).getPropertyValue('--sir-autocomplete-max-height'));
    if (Number.isFinite(configured) && configured > 0) this.configuredMaxHeight = configured;
    window.addEventListener('resize', this.schedulePosition);
    window.addEventListener('scroll', this.schedulePosition, true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.schedulePosition);
      this.resizeObserver.observe(this.panel);
      if (this.panel.parentElement) this.resizeObserver.observe(this.panel.parentElement);
    }
    this.schedulePosition();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.schedulePosition);
    window.removeEventListener('scroll', this.schedulePosition, true);
    this.resizeObserver?.disconnect();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }

  private positionPanel(): void {
    const anchor = this.panel.parentElement;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelStyle = getComputedStyle(this.panel);
    const viewportMaxHeight = Number.parseFloat(panelStyle.maxHeight);
    const desiredHeight = Math.min(this.panel.scrollHeight, this.configuredMaxHeight,
      Number.isFinite(viewportMaxHeight) ? viewportMaxHeight : this.configuredMaxHeight);
    const gap = 12;
    const safeSpaceBelow = Math.max(0, window.innerHeight - anchorRect.bottom - gap - 8);
    const safeSpaceAbove = Math.max(0, anchorRect.top - gap - 8);
    const placeAbove = safeSpaceBelow < desiredHeight && safeSpaceAbove > safeSpaceBelow;
    const availableSpace = placeAbove ? safeSpaceAbove : safeSpaceBelow;
    const heightLimit = Math.min(this.configuredMaxHeight, availableSpace);
    const inlineLimit = this.panel.style.getPropertyValue('--sir-autocomplete-max-height');
    if (heightLimit < this.configuredMaxHeight) {
      const nextLimit = `${heightLimit}px`;
      if (inlineLimit !== nextLimit) this.panel.style.setProperty('--sir-autocomplete-max-height', nextLimit);
    } else if (inlineLimit) {
      this.panel.style.removeProperty('--sir-autocomplete-max-height');
    }
    this.panel.classList.toggle('sir-autocomplete-panel--above', placeAbove);
  }
}
