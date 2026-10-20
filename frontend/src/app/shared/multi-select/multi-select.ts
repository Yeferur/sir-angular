import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener,
  forwardRef, inject, Input, ViewEncapsulation,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SirMultiSelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-multi-select',
  standalone: true,
  templateUrl: './multi-select.html',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SirMultiSelectComponent), multi: true }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class SirMultiSelectComponent implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);
  private formDisabled = false;
  private onChange: (value: Array<string | number>) => void = () => {};
  private onTouched: () => void = () => {};

  @Input() options: readonly SirMultiSelectOption[] = [];
  @Input() placeholder = 'Todos';
  @Input() inputId = '';
  @Input() ariaLabel: string | null = null;
  @Input() disabled = false;
  value: Array<string | number> = [];
  isOpen = false;

  get effectivelyDisabled(): boolean { return this.disabled || this.formDisabled; }
  get selectionText(): string {
    if (!this.value.length) return this.placeholder;
    if (this.value.length === 1) return '1 seleccionado';
    return `${this.value.length} seleccionados`;
  }

  writeValue(value: unknown): void {
    this.value = Array.isArray(value) ? [...value] : [];
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: Array<string | number>) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.formDisabled = disabled;
    if (disabled) this.isOpen = false;
    this.cdr.markForCheck();
  }

  toggle(): void {
    if (this.effectivelyDisabled) return;
    this.isOpen = !this.isOpen;
    if (!this.isOpen) this.onTouched();
    this.cdr.markForCheck();
  }

  isSelected(value: string | number): boolean {
    return this.value.some(selected => String(selected) === String(value));
  }

  toggleOption(option: SirMultiSelectOption): void {
    if (this.effectivelyDisabled || option.disabled) return;
    this.value = this.isSelected(option.value)
      ? this.value.filter(selected => String(selected) !== String(option.value))
      : [...this.value, option.value];
    this.onChange([...this.value]);
    this.cdr.markForCheck();
  }

  clear(): void {
    if (this.effectivelyDisabled || !this.value.length) return;
    this.value = [];
    this.onChange([]);
    this.onTouched();
    this.cdr.markForCheck();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (this.isOpen && event.target instanceof Node && !this.host.nativeElement.contains(event.target)) {
      this.isOpen = false;
      this.onTouched();
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onTouched();
    this.cdr.markForCheck();
  }
}
