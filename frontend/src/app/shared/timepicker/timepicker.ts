import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  EventEmitter,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
  ViewEncapsulation,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Overlay, OverlayRef, OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal, PortalModule } from '@angular/cdk/portal';
import { TemplateRef, ViewContainerRef } from '@angular/core';

/**
 * SirTimepickerComponent
 * ─────────────────────────────────────────────────────────────
 * Selector de hora propio (formato 24h 'HH:MM'), montado con CDK
 * Overlay como el datepicker de la app. Muestra una única lista de
 * horarios ya combinados ("8:00 a. m.", "8:30 a. m."...) en pasos
 * fijos — un clic selecciona y cierra, sin flujo de dos columnas.
 *
 * Uso:
 *   <app-timepicker [value]="hora" (valueChange)="hora = $event" />
 *   <app-timepicker [value]="hora" [maxTime]="'22:59'" [step]="30" />
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTime(value: string | null): { h: number; m: number } | null {
  if (!value) return null;
  const match = String(value).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

function formatDisplay(value: string): string {
  const parsed = parseTime(value);
  if (!parsed) return '';
  const period = parsed.h < 12 ? 'a. m.' : 'p. m.';
  const h12 = parsed.h % 12 === 0 ? 12 : parsed.h % 12;
  return `${h12}:${pad(parsed.m)} ${period}`;
}

@Component({
  selector: 'app-timepicker',
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './timepicker.html',
  styleUrls: ['./timepicker.css'],
})
export class TimepickerComponent implements OnChanges, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private el = inject(ElementRef);
  private overlay = inject(Overlay);
  private vcr = inject(ViewContainerRef);

  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<void>;
  @ViewChild('slotList') slotListRef?: ElementRef<HTMLElement>;

  @Input() value: string | null = null;
  @Input() placeholder = 'Seleccionar hora';
  @Input() disabled = false;
  @Input() invalid = false;
  @Input() minTime: string | null = null;
  @Input() maxTime: string | null = null;
  @Input() step = 30;

  @Output() valueChange = new EventEmitter<string | null>();

  isOpen = false;
  slots: string[] = [];

  private overlayRef: OverlayRef | null = null;
  private portal: TemplatePortal<void> | null = null;

  get displayText(): string {
    return this.value ? formatDisplay(this.value) : '';
  }

  constructor() {
    this.buildSlots();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['step'] || changes['minTime'] || changes['maxTime']) this.buildSlots();
  }

  ngOnDestroy(): void {
    this.destroyOverlay();
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    if (this.isOpen || this.disabled) return;

    const positions: ConnectedPosition[] = [
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    ];

    const triggerEl = this.el.nativeElement.querySelector('.sir-tp-field') as HTMLElement;

    const posStrategy = this.overlay
      .position()
      .flexibleConnectedTo(triggerEl)
      .withPositions(positions)
      .withPush(true)
      .withViewportMargin(8);

    this.overlayRef = this.overlay.create({
      positionStrategy: posStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'sir-tp-backdrop',
      width: 168,
      panelClass: 'sir-tp-overlay-panel',
    });

    this.overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') this.close();
    });

    this.portal = new TemplatePortal(this.panelTpl, this.vcr);
    this.overlayRef.attach(this.portal);

    this.isOpen = true;
    this.cdr.detectChanges();

    setTimeout(() => this.scrollSelectedIntoView(), 0);
  }

  close(): void {
    if (!this.isOpen) return;
    this.destroyOverlay();
    this.isOpen = false;
    this.cdr.markForCheck();
  }

  private destroyOverlay(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.portal = null;
    }
  }

  selectSlot(slot: string): void {
    if (this.isSlotDisabled(slot)) return;
    this.value = slot;
    this.valueChange.emit(slot);
    this.cdr.markForCheck();
    this.close();
  }

  isSlotDisabled(slot: string): boolean {
    if (this.minTime && slot < this.minTime) return true;
    if (this.maxTime && slot > this.maxTime) return true;
    return false;
  }

  slotLabel(slot: string): string {
    return formatDisplay(slot);
  }

  trackBySlot(_: number, slot: string): string {
    return slot;
  }

  private buildSlots(): void {
    const step = this.step > 0 ? this.step : 30;
    const values: string[] = [];
    for (let mins = 0; mins < 24 * 60; mins += step) {
      values.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
    }
    this.slots = values;
  }

  private scrollSelectedIntoView(): void {
    const el = this.slotListRef?.nativeElement.querySelector('.is-selected') as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center' });
  }
}
