import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  forwardRef, inject, Injectable, Input, OnChanges, OnDestroy, Output, TemplateRef,
  Pipe, PipeTransform, ViewChild, ViewContainerRef, ViewEncapsulation,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Overlay, OverlayContainer, OverlayModule, OverlayPositionBuilder, OverlayRef, ViewportRuler } from '@angular/cdk/overlay';
import { PortalModule, TemplatePortal } from '@angular/cdk/portal';
import { fromEvent, Subscription } from 'rxjs';

export interface SirSelectOption<T = any> {
  value: T;
  label: string;
  disabled?: boolean;
}

// For migrated [value] options only: native selects compare their string representation.
// Selection still emits the option's value, without coercing numeric/null [ngValue] options.
export function compareSelectValuesAsStrings(a: any, b: any): boolean {
  return a == null || b == null ? Object.is(a, b) : String(a) === String(b);
}

@Pipe({ name: 'selectOptions', standalone: true })
export class SirSelectOptionsPipe implements PipeTransform {
  transform(items: readonly any[], valueKey: string, labelKey: string, stringify = false, fallbackValueKey?: string): SirSelectOption[] {
    return (items || []).map(item => {
      const value = item[valueKey] ?? (fallbackValueKey ? item[fallbackValueKey] : undefined);
      return { value: stringify ? String(value) : value, label: String(item[labelKey] ?? '') };
    });
  }
}

@Injectable()
class SirSelectOverlayContainer extends OverlayContainer {
  protected override _createContainer(): void {
    super._createContainer();
    this._containerElement.classList.add('sir-select-overlay-container');
  }
}

let selectId = 0;

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [OverlayModule, PortalModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SirSelectComponent), multi: true },
    Overlay, OverlayPositionBuilder,
    { provide: OverlayContainer, useClass: SirSelectOverlayContainer },
  ],
  templateUrl: './select.html',
  styleUrls: ['./select.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirSelectComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly viewport = inject(ViewportRuler);
  private readonly generatedId = `sir-select-${++selectId}`;

  @ViewChild('trigger', { static: true }) trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<void>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  @Input() value: any = null;
  @Input() options: readonly SirSelectOption[] = [];
  @Input() multiple = false;
  @Input() searchable = false;
  @Input() searchPlaceholder = 'Buscar opciones';
  @Input() disabled = false;
  @Input() invalid = false;
  @Input() required = false;
  @Input() placeholder = 'Seleccionar';
  @Input() inputId = '';
  @Input() ariaLabel: string | null = null;
  @Input() ariaLabelledby: string | null = null;
  @Input() ariaDescribedby: string | null = null;
  @Input() compareWith: (a: any, b: any) => boolean = Object.is;
  @Output() valueChange = new EventEmitter<any>();

  isOpen = false;
  activeIndex = -1;
  searchTerm = '';
  private formDisabled = false;
  private overlayRef: OverlayRef | null = null;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private subscriptions = new Subscription();
  private resizeObserver?: ResizeObserver;
  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};

  get resolvedInputId(): string { return this.inputId || this.generatedId; }
  get listId(): string { return `${this.generatedId}-list`; }
  get effectivelyDisabled(): boolean { return this.disabled || this.formDisabled; }
  get selectedIndex(): number {
    const values = this.multiple && Array.isArray(this.value) ? this.value : [this.value];
    return this.options.findIndex(option => values.some(value => this.compareWith(option.value, value)));
  }
  get selectedOption(): SirSelectOption | undefined { return this.options[this.selectedIndex]; }
  get selectedCount(): number { return this.multiple && Array.isArray(this.value) ? this.value.length : Number(this.selectedIndex >= 0); }
  get selectionText(): string {
    if (!this.multiple) return this.selectedOption?.label ?? this.placeholder;
    if (this.selectedCount === 0) return this.placeholder;
    if (this.selectedCount === 1) return '1 seleccionado';
    return `${this.selectedCount} seleccionados`;
  }
  get visibleOptions(): Array<{ option: SirSelectOption; index: number }> {
    const search = this.searchable ? this.searchTerm.trim().toLocaleLowerCase('es-CO') : '';
    return this.options.map((option, index) => ({ option, index }))
      .filter(({ option }) => !search || option.label.toLocaleLowerCase('es-CO').includes(search));
  }
  isOptionSelected(value: any): boolean {
    const values = this.multiple && Array.isArray(this.value) ? this.value : [this.value];
    return values.some(selected => this.compareWith(value, selected));
  }
  optionId(index: number): string { return `${this.generatedId}-option-${index}`; }

  ngOnChanges(): void {
    if (this.effectivelyDisabled) this.close(false);
    if (this.isOpen) {
      this.activeIndex = this.initialIndex();
      this.cdr.markForCheck();
    }
  }

  writeValue(value: any): void {
    this.value = value;
    if (this.isOpen) this.activeIndex = this.initialIndex();
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: any) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.formDisabled = disabled;
    if (disabled) this.close(false);
    this.cdr.markForCheck();
  }

  toggle(): void { this.isOpen ? this.close(false) : this.open(); }

  open(): void {
    if (this.isOpen || this.effectivelyDisabled) return;
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
      this.disposeOverlay();
    }
    const origin = this.trigger.nativeElement;
    this.searchTerm = '';
    const strategy = this.overlay.position().flexibleConnectedTo(origin)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
      ]).withFlexibleDimensions(true).withPush(true).withViewportMargin(8);
    this.overlayRef = this.overlay.create({
      usePopover: false,
      positionStrategy: strategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      width: Math.min(origin.getBoundingClientRect().width, this.viewport.getViewportSize().width - 16),
      maxHeight: 280,
      panelClass: this.searchable
        ? ['sir-select-overlay-panel', 'sir-select-overlay-panel--searchable']
        : 'sir-select-overlay-panel',
    });
    // No backdrop: clicking another field closes the select and activates that field.
    this.subscriptions.add(this.overlayRef.outsidePointerEvents().subscribe(event => {
      if (!origin.contains(event.target as Node)) this.close(false);
    }));
    this.subscriptions.add(this.viewport.change().subscribe(() => this.updateOverlaySize()));
    // Existing drawers use plain scroll containers, without cdkScrollable.
    this.subscriptions.add(fromEvent<Event>(origin.ownerDocument, 'scroll', { capture: true }).subscribe(event => {
      if (event.target instanceof Element && event.target.contains(origin)) this.overlayRef?.updatePosition();
    }));
    this.resizeObserver = new ResizeObserver(() => this.updateOverlaySize());
    this.resizeObserver.observe(origin);
    origin.focus({ preventScroll: true });
    this.isOpen = true;
    this.activeIndex = this.initialIndex();
    this.overlayRef.attach(new TemplatePortal(this.panelTpl, this.vcr));
    this.cdr.detectChanges();
    this.overlayRef.updatePosition();
    this.scrollActiveOption();
    if (this.searchable) this.searchInput?.nativeElement.focus({ preventScroll: true });
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    const panel = this.overlayRef?.overlayElement;
    if (panel && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.classList.add('is-closing');
      this.closeTimer = setTimeout(() => {
        this.closeTimer = undefined;
        this.disposeOverlay();
      }, 170);
    } else {
      this.disposeOverlay();
    }
    this.onTouched();
    this.cdr.markForCheck();
    if (restoreFocus && !this.effectivelyDisabled) this.trigger.nativeElement.focus({ preventScroll: true });
  }

  choose(index: number): void {
    const option = this.options[index];
    if (!option || option.disabled || this.effectivelyDisabled) return;
    if (this.multiple) {
      const current = Array.isArray(this.value) ? [...this.value] : [];
      const selected = current.some(value => this.compareWith(option.value, value));
      const next = selected
        ? current.filter(value => !this.compareWith(option.value, value))
        : [...current, option.value];
      this.value = next;
      this.onChange(next);
      this.valueChange.emit(next);
      this.activeIndex = index;
      this.cdr.markForCheck();
      return;
    }
    const changed = !this.compareWith(option.value, this.value);
    if (changed) {
      this.value = option.value;
      this.onChange(option.value);
    }
    this.close(true);
    if (changed) this.valueChange.emit(option.value);
    this.cdr.markForCheck();
  }

  onBlur(event: FocusEvent): void {
    if (this.overlayRef?.overlayElement.contains(event.relatedTarget as Node)) return;
    this.close(false);
    this.onTouched();
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.effectivelyDisabled) return;
    switch (event.key) {
      case 'Tab': this.close(false); return;
      case 'Escape':
        if (this.isOpen) { event.preventDefault(); event.stopPropagation(); this.close(true); }
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.isOpen ? this.choose(this.activeIndex) : this.open();
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.isOpen) {
          this.open();
          if (this.selectedIndex < 0 && event.key === 'ArrowUp') this.moveToEdge(false);
        } else this.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        this.open();
        this.moveToEdge(event.key === 'Home');
        return;
    }
  }

  onSearchInput(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    this.activeIndex = this.initialIndex();
    this.cdr.markForCheck();
    this.scrollActiveOption();
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (!['Tab', 'Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.key !== 'Tab') event.stopPropagation();
    this.onKeydown(event);
  }

  setActive(index: number): void {
    if (!this.options[index]?.disabled) this.activeIndex = index;
  }

  private initialIndex(): number {
    const visible = this.visibleOptions;
    const selected = visible.find(({ option }) => this.isOptionSelected(option.value) && !option.disabled);
    return selected?.index ?? visible.find(({ option }) => !option.disabled)?.index ?? -1;
  }

  private move(step: number): void {
    const visibleIndexes = this.visibleOptions.map(({ index }) => index);
    let position = visibleIndexes.indexOf(this.activeIndex) + step;
    while (position >= 0 && position < visibleIndexes.length) {
      const index = visibleIndexes[position];
      if (!this.options[index].disabled) { this.activeIndex = index; this.scrollActiveOption(); break; }
      position += step;
    }
  }

  private moveToEdge(first: boolean): void {
    const enabled = this.visibleOptions.filter(({ option }) => !option.disabled).map(({ index }) => index);
    this.activeIndex = (first ? enabled[0] : enabled.at(-1)) ?? -1;
    this.scrollActiveOption();
  }

  private scrollActiveOption(): void {
    this.overlayRef?.overlayElement.querySelector<HTMLElement>(`#${this.optionId(this.activeIndex)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  private updateOverlaySize(): void {
    this.overlayRef?.updateSize({ width: Math.min(this.trigger.nativeElement.getBoundingClientRect().width, this.viewport.getViewportSize().width - 16) });
    this.overlayRef?.updatePosition();
  }

  private disposeOverlay(): void {
    this.resizeObserver?.disconnect();
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  ngOnDestroy(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.disposeOverlay();
  }
}
