import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectedPosition, Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { PortalModule, TemplatePortal } from '@angular/cdk/portal';

export type TimepickerMode = 'intervals' | 'free';
type Meridiem = 'AM' | 'PM';

let timepickerId = 0;

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
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly el = inject(ElementRef);
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly generatedId = `sir-timepicker-${++timepickerId}`;

  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<void>;
  @ViewChild('slotList') slotListRef?: ElementRef<HTMLElement>;
  @ViewChild('freeHourInput') freeHourInput?: ElementRef<HTMLInputElement>;
  @ViewChild('freeMinuteInput') freeMinuteInput?: ElementRef<HTMLInputElement>;
  @ViewChild('periodAmButton') periodAmButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('periodPmButton') periodPmButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('triggerButton') triggerButton?: ElementRef<HTMLButtonElement>;

  @Input() value: string | null = null;
  @Input() placeholder = 'Seleccionar hora';
  @Input() disabled = false;
  @Input() readOnly = false;
  @Input() invalid = false;
  @Input() minTime: string | null = null;
  @Input() maxTime: string | null = null;
  @Input() step = 30;
  @Input() mode: TimepickerMode = 'intervals';
  @Input() inputId = '';
  @Input() ariaLabelledby: string | null = null;
  @Input() ariaDescribedby: string | null = null;

  @Output() valueChange = new EventEmitter<string | null>();

  isOpen = false;
  slots: string[] = [];
  draftHour = '12';
  draftMinute = '00';
  draftPeriod: Meridiem = 'AM';
  freeError = '';

  private overlayRef: OverlayRef | null = null;
  private portal: TemplatePortal<void> | null = null;

  get resolvedInputId(): string { return this.inputId || this.generatedId; }
  get displayText(): string { return this.value ? formatDisplay(this.value) : ''; }

  constructor() {
    this.buildSlots();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['step'] || changes['minTime'] || changes['maxTime'] || changes['mode']) this.buildSlots();
  }

  ngOnDestroy(): void {
    this.destroyOverlay();
  }

  toggle(): void {
    if (this.disabled || this.readOnly) return;
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    if (this.isOpen || this.disabled || this.readOnly) return;
    if (this.mode === 'free') this.prepareFreeDraft();

    const positions: ConnectedPosition[] = [
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    ];

    const triggerEl = this.el.nativeElement.querySelector('.sir-tp-field') as HTMLElement;
    const posStrategy = this.overlay.position().flexibleConnectedTo(triggerEl)
      .withPositions(positions).withPush(true).withViewportMargin(8);

    this.overlayRef = this.overlay.create({
      positionStrategy: posStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'sir-tp-backdrop',
      width: this.mode === 'free' ? 272 : 168,
      panelClass: 'sir-tp-overlay-panel',
    });

    this.overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.portal = new TemplatePortal(this.panelTpl, this.vcr);
    this.overlayRef.attach(this.portal);
    this.isOpen = true;
    this.cdr.detectChanges();

    setTimeout(() => this.focusPanel(), 0);
  }

  close(restoreFocus = true): void {
    if (!this.isOpen) return;
    this.destroyOverlay();
    this.isOpen = false;
    this.cdr.markForCheck();
    if (restoreFocus) setTimeout(() => this.triggerButton?.nativeElement.focus(), 0);
  }

  selectSlot(slot: string): void {
    if (this.isSlotDisabled(slot)) return;
    this.value = slot;
    this.valueChange.emit(slot);
    this.cdr.markForCheck();
    this.close();
  }

  isSlotDisabled(slot: string): boolean {
    if (!parseTime(slot)) return true;
    if (this.minTime && slot < this.minTime) return true;
    if (this.maxTime && slot > this.maxTime) return true;
    return false;
  }

  slotLabel(slot: string): string { return formatDisplay(slot); }
  trackBySlot(_: number, slot: string): string { return slot; }

  updateDraftHour(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 2);
    if (!digits) {
      this.draftHour = '';
    } else if (digits.length === 1) {
      this.draftHour = digits === '0' ? '' : digits;
    } else {
      const numeric = Number(digits);
      const lastDigit = Number(digits.at(-1));
      this.draftHour = numeric >= 1 && numeric <= 12
        ? String(numeric)
        : lastDigit >= 1 ? String(lastDigit) : '12';
    }
    input.value = this.draftHour;
    this.applyFreeTime(false);
    if (this.draftHour.length === 2 || Number(this.draftHour) >= 2) {
      queueMicrotask(() => {
        this.freeMinuteInput?.nativeElement.focus();
        this.freeMinuteInput?.nativeElement.select();
      });
    }
  }

  updateDraftMinute(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 2);
    if (!digits) {
      this.draftMinute = '';
    } else if (digits.length === 1 && Number(digits) <= 5) {
      this.draftMinute = digits;
    } else {
      const numeric = Number(digits);
      this.draftMinute = numeric <= 59 ? pad(numeric) : pad(Number(digits.at(-1)));
    }
    input.value = this.draftMinute;
    this.applyFreeTime(false);
    if (this.draftMinute.length === 2) {
      queueMicrotask(() => (this.draftPeriod === 'AM' ? this.periodAmButton : this.periodPmButton)?.nativeElement.focus());
    }
  }

  setDraftPeriod(period: Meridiem): void {
    this.draftPeriod = period;
    this.applyFreeTime(false);
    this.cdr.markForCheck();
  }

  onFreeInputKeydown(event: KeyboardEvent, field: 'hour' | 'minute'): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmFreeTime();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? 1 : -1;
    if (field === 'hour') {
      const current = Number(this.draftHour) || 12;
      this.draftHour = String(((current - 1 + delta + 12) % 12) + 1);
      (event.target as HTMLInputElement).value = this.draftHour;
    } else {
      const current = Number(this.draftMinute) || 0;
      this.draftMinute = pad((current + delta + 60) % 60);
      (event.target as HTMLInputElement).value = this.draftMinute;
    }
    this.applyFreeTime(false);
    (event.target as HTMLInputElement).select();
  }

  normalizeFreeInput(field: 'hour' | 'minute'): void {
    if (field === 'hour') {
      const hour = Number(this.draftHour);
      this.draftHour = Number.isInteger(hour) && hour >= 1 && hour <= 12 ? String(hour) : '12';
    } else {
      const minute = Number(this.draftMinute);
      this.draftMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? pad(minute) : '00';
    }
    this.applyFreeTime(false);
    this.cdr.markForCheck();
  }

  onPeriodKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmFreeTime();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next: Meridiem = this.draftPeriod === 'AM' ? 'PM' : 'AM';
    this.setDraftPeriod(next);
    queueMicrotask(() => (next === 'AM' ? this.periodAmButton : this.periodPmButton)?.nativeElement.focus());
  }

  confirmFreeTime(): void {
    this.applyFreeTime(true);
  }

  private applyFreeTime(closeAfter: boolean): void {
    const candidate = this.freeCandidate();
    if (!candidate) {
      this.freeError = closeAfter ? 'Escribe una hora y minutos válidos.' : '';
      this.cdr.markForCheck();
      if (closeAfter) this.freeHourInput?.nativeElement.focus();
      return;
    }
    if (this.isSlotDisabled(candidate)) {
      this.freeError = this.minTime && candidate < this.minTime
        ? `Selecciona una hora posterior a ${formatDisplay(this.minTime)}.`
        : 'La hora seleccionada no está permitida.';
      this.cdr.markForCheck();
      return;
    }
    this.freeError = '';
    if (candidate !== this.value) {
      this.value = candidate;
      this.valueChange.emit(candidate);
    }
    this.cdr.markForCheck();
    if (closeAfter) this.close();
  }

  onSlotKeydown(event: KeyboardEvent, index: number): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? this.slots.length - 1 : index + direction;
    while (next >= 0 && next < this.slots.length && this.isSlotDisabled(this.slots[next])) next += direction;
    const buttons = this.slotListRef?.nativeElement.querySelectorAll<HTMLButtonElement>('.sir-tp-item');
    buttons?.item(Math.max(0, Math.min(next, this.slots.length - 1)))?.focus();
  }

  private prepareFreeDraft(): void {
    const parsed = parseTime(this.value) || { h: 12, m: 0 };
    this.draftHour = String(parsed.h % 12 === 0 ? 12 : parsed.h % 12);
    this.draftMinute = pad(parsed.m);
    this.draftPeriod = parsed.h < 12 ? 'AM' : 'PM';
    this.freeError = '';
  }

  private freeCandidate(): string | null {
    if (!this.draftHour || !this.draftMinute) return null;
    const hour = Number(this.draftHour);
    const minute = Number(this.draftMinute);
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    const h24 = this.draftPeriod === 'AM' ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
    return `${pad(h24)}:${pad(minute)}`;
  }

  private buildSlots(): void {
    if (this.mode === 'free') {
      this.slots = [];
      return;
    }
    const step = this.step > 0 ? Math.min(this.step, 24 * 60) : 30;
    const values: string[] = [];
    for (let mins = 0; mins < 24 * 60; mins += step) {
      values.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
    }
    this.slots = values;
  }

  private focusPanel(): void {
    if (this.mode === 'free') {
      this.freeHourInput?.nativeElement.focus();
      this.freeHourInput?.nativeElement.select();
      return;
    }
    const list = this.slotListRef?.nativeElement;
    const selected = list?.querySelector<HTMLButtonElement>('.is-selected');
    const firstEnabled = list?.querySelector<HTMLButtonElement>('.sir-tp-item:not(:disabled)');
    (selected || firstEnabled)?.focus();
    selected?.scrollIntoView({ block: 'center' });
  }

  private destroyOverlay(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.portal = null;
  }
}
