import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, forwardRef, inject, Injectable,
  Input, OnDestroy, Output, TemplateRef, ViewChild, ViewContainerRef, ViewEncapsulation,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ConnectedPosition, Overlay, OverlayContainer, OverlayModule, OverlayPositionBuilder, OverlayRef } from '@angular/cdk/overlay';
import { PortalModule, TemplatePortal } from '@angular/cdk/portal';

export interface SirDateRange {
  start: string | null;
  end: string | null;
}

interface CalendarDay {
  iso: string;
  day: number;
  disabled: boolean;
}

interface CalendarMonth {
  key: string;
  year: number;
  month: number;
  cells: (CalendarDay | null)[];
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FULL_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
type CalendarView = 'day' | 'month' | 'year';
let rangeId = 0;

@Injectable()
class SirRangeOverlayContainer extends OverlayContainer {
  protected override _createContainer(): void {
    super._createContainer();
    this._containerElement.classList.add('sir-range-overlay-container');
  }
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed : null;
}

@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [OverlayModule, PortalModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SirDateRangePickerComponent), multi: true },
    Overlay, OverlayPositionBuilder,
    { provide: OverlayContainer, useClass: SirRangeOverlayContainer },
  ],
  templateUrl: './date-range-picker.html',
  styleUrls: ['../datepicker/datepicker.css', './date-range-picker.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirDateRangePickerComponent implements ControlValueAccessor, OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly generatedId = `sir-date-range-${++rangeId}`;
  private overlayRef: OverlayRef | null = null;
  private onChange: (value: SirDateRange) => void = () => {};
  private onTouched: () => void = () => {};
  private formDisabled = false;
  private selectedRange: SirDateRange = { start: null, end: null };

  @ViewChild('trigger', { static: true }) trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<void>;
  @Input() inputId = '';
  @Input() placeholder = 'Seleccionar rango';
  @Input() displayPrefix = '';
  @Input() minDate: string | Date | null = null;
  @Input() maxDate: string | Date | null = null;
  @Input() dateFilter: ((date: Date) => boolean) | null = null;
  @Input() allowClear = true;
  @Input() disabled = false;
  @Input() invalid = false;
  @Input() ariaLabelledby: string | null = null;
  @Input() ariaDescribedby: string | null = null;
  @Input() set value(value: SirDateRange | null) { this.writeValue(value); }
  @Output() rangeChange = new EventEmitter<SirDateRange>();

  readonly weekdays = WEEKDAYS;
  readonly months = MONTHS;
  readonly fullMonths = FULL_MONTHS;
  readonly todayIso = isoFromDate(new Date());
  isOpen = false;
  cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  rightCursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + 1, 1);
  calendarView: { side: number; view: CalendarView } = { side: 0, view: 'day' };
  draftStart: string | null = null;
  rangeError = '';

  get resolvedInputId(): string { return this.inputId || this.generatedId; }
  get statusId(): string { return `${this.generatedId}-status`; }
  get effectivelyDisabled(): boolean { return this.disabled || this.formDisabled; }
  get range(): SirDateRange { return this.selectedRange; }
  get visibleMonths(): CalendarMonth[] {
    return [this.buildMonth(this.cursor), this.buildMonth(this.rightCursor)];
  }
  get years(): number[] {
    const year = this.monthForSide(this.calendarView.side).getFullYear();
    return Array.from({ length: 25 }, (_, index) => year + 12 - index);
  }
  get displayText(): string {
    if (this.draftStart) return this.displayPrefix + this.formatDate(this.draftStart);
    if (this.selectedRange.start && this.selectedRange.end) {
      if (this.selectedRange.start === this.selectedRange.end) return this.displayPrefix + this.formatDate(this.selectedRange.start);
      const rangeText = this.displayPrefix
        ? this.formatRange(this.selectedRange.start, this.selectedRange.end)
        : `${this.formatDate(this.selectedRange.start)} — ${this.formatDate(this.selectedRange.end)}`;
      return this.displayPrefix + rangeText;
    }
    return this.displayPrefix + this.placeholder;
  }
  get selectionHint(): string {
    return this.rangeError || 'Selecciona otra fecha para completar el rango.';
  }

  writeValue(value: SirDateRange | null): void {
    const start = parseLocalDate(value?.start)?.valueOf();
    const end = parseLocalDate(value?.end)?.valueOf();
    this.selectedRange = start != null && end != null && start <= end
      ? { start: isoFromDate(new Date(start)), end: isoFromDate(new Date(end)) }
      : { start: null, end: null };
    if (this.selectedRange.start) {
      const date = parseLocalDate(this.selectedRange.start)!;
      this.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
      this.rightCursor = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    }
    this.draftStart = null;
    this.rangeError = '';
    this.calendarView = { side: 0, view: 'day' };
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: SirDateRange) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.formDisabled = disabled;
    if (disabled) this.cancelSelection();
    this.cdr.markForCheck();
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }
  open(): void {
    if (this.isOpen || this.effectivelyDisabled) return;
    const origin = this.trigger.nativeElement;
    const positions: ConnectedPosition[] = [
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    ];
    const width = Math.min(window.innerWidth < 640 ? 320 : 568, window.innerWidth - 16);
    this.overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(origin)
        .withPositions(positions).withPush(true).withViewportMargin(8),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'sir-range-backdrop',
      panelClass: 'sir-range-overlay',
      width,
    });
    this.overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') { event.preventDefault(); this.cancelSelection(); origin.focus({ preventScroll: true }); }
    });
    this.overlayRef.attach(new TemplatePortal(this.panelTpl, this.vcr));
    this.isOpen = true;
    this.cdr.markForCheck();
    const focusedDay = this.overlayRef.overlayElement.querySelector<HTMLElement>(
      '.sir-range-day.is-start:not(:disabled), .sir-range-day:not(:disabled)',
    );
    focusedDay?.focus({ preventScroll: true });
  }
  close(commitSingleDay = true): void {
    if (!this.isOpen && !this.overlayRef) return;
    if (commitSingleDay && this.draftStart) {
      this.selectedRange = { start: this.draftStart, end: this.draftStart };
      this.onChange({ ...this.selectedRange });
      this.rangeChange.emit({ ...this.selectedRange });
    }
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.isOpen = false;
    this.calendarView = { side: 0, view: 'day' };
    this.draftStart = null;
    this.rangeError = '';
    this.onTouched();
    this.cdr.markForCheck();
  }
  cancelSelection(): void { this.close(false); }
  ngOnDestroy(): void { this.overlayRef?.dispose(); }

  moveMonth(delta: number): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + delta, 1);
    this.rightCursor = new Date(this.rightCursor.getFullYear(), this.rightCursor.getMonth() + delta, 1);
    this.calendarView = { side: 0, view: 'day' };
    this.cdr.markForCheck();
  }
  viewForSide(side: number): CalendarView {
    return this.calendarView.side === side ? this.calendarView.view : 'day';
  }
  showView(side: number, view: CalendarView): void {
    this.calendarView = { side, view };
    this.cdr.markForCheck();
  }
  selectMonth(side: number, month: number): void {
    if (!Number.isInteger(month) || month < 0 || month > 11) return;
    const current = this.monthForSide(side);
    let selected = new Date(current.getFullYear(), month, 1);
    // Al elegir enero a la derecha de octubre, continuar en el año siguiente.
    if (side === 1 && selected <= this.cursor) {
      selected = new Date(this.cursor.getFullYear() + 1, month, 1);
    }
    this.setMonthForSide(side, selected);
  }
  selectYear(side: number, year: number): void {
    if (!Number.isInteger(year) || year < 1 || year > 9999) return;
    const current = this.monthForSide(side);
    this.setMonthForSide(side, new Date(year, current.getMonth(), 1));
  }
  private monthForSide(side: number): Date { return side === 1 ? this.rightCursor : this.cursor; }
  private setMonthForSide(side: number, selected: Date): void {
    if (side === 0) {
      this.cursor = selected;
      if (this.rightCursor <= selected) this.rightCursor = new Date(selected.getFullYear(), selected.getMonth() + 1, 1);
    } else {
      this.rightCursor = selected;
      if (this.cursor >= selected) this.cursor = new Date(selected.getFullYear(), selected.getMonth() - 1, 1);
    }
    this.calendarView = { side, view: 'day' };
    this.cdr.markForCheck();
  }
  selectDate(iso: string): void {
    const date = parseLocalDate(iso);
    if (!date || !this.isAllowed(date)) return;
    this.rangeError = '';
    if (!this.draftStart) {
      this.draftStart = iso;
      this.cdr.markForCheck();
      return;
    }
    const start = iso < this.draftStart ? iso : this.draftStart;
    const end = iso < this.draftStart ? this.draftStart : iso;
    if (!this.isRangeAllowed(start, end)) {
      this.rangeError = 'El rango incluye fechas no disponibles. Elige otra fecha final.';
      this.cdr.markForCheck();
      return;
    }
    this.selectedRange = { start, end };
    this.draftStart = null;
    this.onChange({ ...this.selectedRange });
    this.rangeChange.emit({ ...this.selectedRange });
    this.close();
    this.trigger.nativeElement.focus({ preventScroll: true });
  }
  clearRange(): void {
    if (!this.allowClear) return;
    this.selectedRange = { start: null, end: null };
    this.onChange({ ...this.selectedRange });
    this.rangeChange.emit({ ...this.selectedRange });
    this.close(false);
    this.trigger.nativeElement.focus({ preventScroll: true });
  }
  isStart(iso: string): boolean { return iso === (this.draftStart || this.selectedRange.start); }
  isEnd(iso: string): boolean { return !this.draftStart && iso === this.selectedRange.end; }
  isBetween(iso: string): boolean {
    return !this.draftStart && !!this.selectedRange.start && !!this.selectedRange.end
      && iso > this.selectedRange.start && iso < this.selectedRange.end;
  }
  dayLabel(iso: string): string { return this.formatDate(iso); }

  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(parseLocalDate(iso)!);
  }
  private formatRange(startIso: string, endIso: string): string {
    const start = parseLocalDate(startIso)!;
    const end = parseLocalDate(endIso)!;
    const month = (date: Date) => new Intl.DateTimeFormat('es-CO', { month: 'short' })
      .format(date).replace(/\./g, '').toLocaleLowerCase('es-CO');
    const formatStart = `${start.getDate()} ${month(start)}${start.getFullYear() === end.getFullYear() ? '' : ' ' + start.getFullYear()}`;
    return `${formatStart} – ${end.getDate()} ${month(end)} ${end.getFullYear()}`;
  }
  private isAllowed(date: Date): boolean {
    const iso = isoFromDate(date);
    const min = parseLocalDate(this.minDate);
    const max = parseLocalDate(this.maxDate);
    return (!min || iso >= isoFromDate(min)) && (!max || iso <= isoFromDate(max))
      && (!this.dateFilter || this.dateFilter(date));
  }
  private isRangeAllowed(start: string, end: string): boolean {
    if (!this.dateFilter) return true;
    const cursor = parseLocalDate(start)!;
    const last = parseLocalDate(end)!.getTime();
    while (cursor.getTime() <= last) {
      if (!this.isAllowed(cursor)) return false;
      cursor.setDate(cursor.getDate() + 1);
    }
    return true;
  }
  private buildMonth(date: Date): CalendarMonth {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells: (CalendarDay | null)[] = Array.from({ length: firstOffset }, (): null => null);
    for (let day = 1; day <= days; day++) {
      const current = new Date(year, month, day);
      cells.push({ iso: isoFromDate(current), day, disabled: !this.isAllowed(current) });
    }
    return {
      key: `${year}-${month}`,
      year,
      month,
      cells,
    };
  }
}
