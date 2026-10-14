import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, inject } from '@angular/core';

@Component({
  selector: 'app-filter-panel',
  standalone: true,
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirFilterPanelComponent implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private closeTimer?: ReturnType<typeof setTimeout>;
  private openValue = false;
  @Input() panelId = '';
  @Input() closingDuration = 170;
  @Input() label = 'Filtros adicionales';
  rendered = false;
  closing = false;

  @Input() set open(value: boolean) { this.setOpen(value); }
  get open(): boolean { return this.openValue; }

  private setOpen(value: boolean): void {
    this.openValue = value;
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = undefined; }
    if (value) {
      this.rendered = true;
      this.closing = false;
    } else if (this.rendered) {
      this.closing = true;
      const duration = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0 : this.closingDuration;
      if (duration === 0) {
        this.rendered = false;
        this.closing = false;
        this.cdr.markForCheck();
        return;
      }
      this.closeTimer = setTimeout(() => {
        this.closeTimer = undefined;
        this.rendered = false;
        this.closing = false;
        this.cdr.markForCheck();
      }, duration);
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void { if (this.closeTimer) clearTimeout(this.closeTimer); }
}
