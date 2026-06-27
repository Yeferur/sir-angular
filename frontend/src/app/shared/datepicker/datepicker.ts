import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  SimpleChanges,
  forwardRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
  ViewEncapsulation,
  inject,
  NgZone,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CommonModule } from '@angular/common';

// CDK Overlay
import { Overlay, OverlayRef, OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal, PortalModule } from '@angular/cdk/portal';
import { TemplateRef, ViewContainerRef } from '@angular/core';

/**
 * SirDatepickerComponent v2
 * ─────────────────────────────────────────────────────────────
 * Usa Angular CDK Overlay para posicionamiento correcto:
 * - Panel siempre visible, sin cortes por overflow del padre
 * - Flip automático arriba/abajo según espacio disponible
 * - Ancho fijo 280px independiente del trigger
 * - Compatible con [(ngModel)] y ReactiveFormsModule
 *
 * Uso:
 *   <app-datepicker [(ngModel)]="fecha" placeholder="Fecha de operación" />
 *   <app-datepicker [formControl]="fechaCtrl" [minDate]="hoy" />
 *
 * Salida: string ISO 'YYYY-MM-DD'
 */

type DpView = 'day' | 'month' | 'year';

interface DayCell {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_FULL   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fromISO(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}
function asDateOnly(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const parsed = fromISO(String(value));
  return parsed ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) : null;
}
function compareDateOnly(a: Date, b: Date): number {
  return new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
       - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
}

@Component({
  selector: 'app-datepicker',
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './datepicker.html',
  styleUrls: ['./datepicker.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatepickerComponent),
      multi: true,
    },
  ],
})
export class DatepickerComponent implements OnInit, OnChanges, OnDestroy, ControlValueAccessor {

  private cdr   = inject(ChangeDetectorRef);
  private el    = inject(ElementRef);
  private overlay = inject(Overlay);
  private vcr   = inject(ViewContainerRef);
  private zone  = inject(NgZone);

  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<void>;

  // ── Inputs ──────────────────────────────────────────────────
  @Input() placeholder = 'Seleccionar fecha';
  @Input() minDate: string | Date | null = null;
  @Input() maxDate: string | Date | null = null;
  @Input() invalid = false;
  @Input() dateFilter: ((date: Date) => boolean) | null = null;

  @Output() dateChange = new EventEmitter<string | null>();

  // ── Estado ──────────────────────────────────────────────────
  isOpen   = false;
  view: DpView = 'day';
  selected: Date | null = null;
  cursor: Date = new Date();

  days: DayCell[] = [];
  months          = MESES_SHORT;
  years: number[] = [];
  diasSemana      = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  // ── CVA ─────────────────────────────────────────────────────
  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  isDisabled = false;

  // ── CDK Overlay ─────────────────────────────────────────────
  private overlayRef: OverlayRef | null = null;
  private portal: TemplatePortal<void> | null = null;

  // ── Getters ─────────────────────────────────────────────────
  get cursorMonth(): number     { return this.cursor.getMonth(); }
  get cursorYear():  number     { return this.cursor.getFullYear(); }
  get cursorMonthName(): string { return MESES[this.cursor.getMonth()]; }

  get displayText(): string {
    if (!this.selected) return '';
    const d = this.selected;
    return `${DIAS_FULL[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  }

  // ── Lifecycle ───────────────────────────────────────────────
  ngOnInit(): void {
    this.cursor = this.selected
      ? new Date(this.selected.getFullYear(), this.selected.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this.buildDays();
    this.buildYears();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['minDate'] || changes['maxDate'] || changes['dateFilter']) {
      this.buildDays();
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.destroyOverlay();
  }

  // ── CVA ─────────────────────────────────────────────────────
  writeValue(value: string | null): void {
    this.selected = value ? fromISO(value) : null;
    if (this.selected) {
      this.cursor = new Date(this.selected.getFullYear(), this.selected.getMonth(), 1);
    }
    this.buildDays();
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: string | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
    this.cdr.markForCheck();
  }

  // ── Abrir / cerrar ──────────────────────────────────────────
  toggle(): void {
    if (this.isDisabled) return;
    this.isOpen ? this.close() : this.open();
    this.onTouched();
  }

  open(): void {
    if (this.isOpen) return;

    // Restaurar vista
    this.view = 'day';
    if (this.selected) {
      this.cursor = new Date(this.selected.getFullYear(), this.selected.getMonth(), 1);
    }
    this.buildDays();

    // Posiciones: preferimos abajo-izquierda, fallback arriba-izquierda
    const positions: ConnectedPosition[] = [
      // Abajo alineado a la izquierda del trigger
      {
        originX: 'start', originY: 'bottom',
        overlayX: 'start', overlayY: 'top',
        offsetY: 6,
      },
      // Arriba (flip) cuando no hay espacio abajo
      {
        originX: 'start', originY: 'top',
        overlayX: 'start', overlayY: 'bottom',
        offsetY: -6,
      },
      // Abajo alineado a la derecha (pantallas angostas)
      {
        originX: 'end', originY: 'bottom',
        overlayX: 'end', overlayY: 'top',
        offsetY: 6,
      },
      // Arriba alineado a la derecha
      {
        originX: 'end', originY: 'top',
        overlayX: 'end', overlayY: 'bottom',
        offsetY: -6,
      },
    ];

    const triggerEl = this.el.nativeElement.querySelector('.sir-dp-field') as HTMLElement;

    const posStrategy = this.overlay
      .position()
      .flexibleConnectedTo(triggerEl)
      .withPositions(positions)
      .withPush(true)         // empuja dentro del viewport si es necesario
      .withViewportMargin(8); // margen mínimo del borde de pantalla

    this.overlayRef = this.overlay.create({
      positionStrategy: posStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'sir-dp-backdrop',
      width: 280,
      panelClass: 'sir-dp-overlay-panel',
    });

    // Cerrar al hacer click fuera (backdrop)
    this.overlayRef.backdropClick().subscribe(() => this.close());

    // Cerrar con Escape
    this.overlayRef.keydownEvents().subscribe(e => {
      if (e.key === 'Escape') this.close();
    });

    this.portal = new TemplatePortal(this.panelTpl, this.vcr);
    this.overlayRef.attach(this.portal);

    this.isOpen = true;
    this.cdr.markForCheck();
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

  // ── Navegación mes ──────────────────────────────────────────
  prevMonth(): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() - 1, 1);
    this.buildDays();
    this.cdr.markForCheck();
  }
  nextMonth(): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + 1, 1);
    this.buildDays();
    this.cdr.markForCheck();
  }

  // ── Cambiar vista ───────────────────────────────────────────
  showMonthView(): void { this.view = 'month'; this.cdr.markForCheck(); }
  showYearView(): void  { this.view = 'year';  this.buildYears(); this.cdr.markForCheck(); }
  backToDayView(): void { this.view = 'day';   this.buildDays();  this.cdr.markForCheck(); }

  selectMonth(m: number): void {
    this.cursor = new Date(this.cursor.getFullYear(), m, 1);
    this.view = 'day';
    this.buildDays();
    this.cdr.markForCheck();
  }
  selectYear(y: number): void {
    this.cursor = new Date(y, this.cursor.getMonth(), 1);
    this.view = 'day';
    this.buildDays();
    this.cdr.markForCheck();
  }

  // ── Seleccionar día ─────────────────────────────────────────
  selectDay(cell: DayCell): void {
    if (!cell.isCurrentMonth || cell.isDisabled) return;
    this.selected = cell.date;
    this.cursor   = new Date(cell.date.getFullYear(), cell.date.getMonth(), 1);
    const iso = toISO(cell.date);
    this.onChange(iso);
    this.dateChange.emit(iso);
    this.close();
    this.buildDays();
  }

  goToday(): void {
    const today = new Date();
    if (!this.isDateAllowed(today)) return;
    this.selected = today;
    this.cursor   = new Date(today.getFullYear(), today.getMonth(), 1);
    const iso = toISO(today);
    this.onChange(iso);
    this.dateChange.emit(iso);
    this.close();
    this.buildDays();
    this.cdr.markForCheck();
  }

  clearDate(): void {
    this.selected = null;
    this.onChange(null);
    this.dateChange.emit(null);
    this.close();
    this.buildDays();
    this.cdr.markForCheck();
  }

  // ── Builders ────────────────────────────────────────────────
  private buildDays(): void {
    const y   = this.cursor.getFullYear();
    const m   = this.cursor.getMonth();
    const today    = new Date();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Lun=0
    const dim      = new Date(y, m + 1, 0).getDate();
    const dimPrev  = new Date(y, m, 0).getDate();

    const cells: DayCell[] = [];

    for (let i = firstDow - 1; i >= 0; i--) {
      const d    = dimPrev - i;
      const date = new Date(y, m - 1, d);
      cells.push({ day: d, date, isCurrentMonth: false, isToday: false, isSelected: false, isDisabled: true });
    }
    for (let d = 1; d <= dim; d++) {
      const date = new Date(y, m, d);
      cells.push({
        day: d, date,
        isCurrentMonth: true,
        isToday:    isSameDay(date, today),
        isSelected: this.selected ? isSameDay(date, this.selected) : false,
        isDisabled: !this.isDateAllowed(date),
      });
    }
    const total   = firstDow + dim;
    const padding = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let d = 1; d <= padding; d++) {
      const date = new Date(y, m + 1, d);
      cells.push({ day: d, date, isCurrentMonth: false, isToday: false, isSelected: false, isDisabled: true });
    }

    this.days = cells;
  }

  private buildYears(): void {
    const cy = this.cursor.getFullYear();
    this.years = [];
    for (let y = cy + 12; y >= cy - 12; y--) this.years.push(y);
  }

  trackByDay(_: number, cell: DayCell): string {
    return cell.date.toISOString();
  }

  private isDateAllowed(date: Date): boolean {
    const n   = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const min = asDateOnly(this.minDate);
    const max = asDateOnly(this.maxDate);
    if (min && compareDateOnly(n, min) < 0) return false;
    if (max && compareDateOnly(n, max) > 0) return false;
    if (this.dateFilter && !this.dateFilter(n)) return false;
    return true;
  }
}