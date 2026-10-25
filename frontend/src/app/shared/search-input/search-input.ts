import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, forwardRef, inject, Input, Output } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let searchId = 0;

@Component({
  selector: 'app-search-input',
  standalone: true,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SirSearchInputComponent), multi: true }],
  templateUrl: './search-input.html',
  styleUrl: './search-input.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirSearchInputComponent implements ControlValueAccessor {
  private cdr = inject(ChangeDetectorRef);
  @Input() value = '';
  @Input() placeholder = 'Buscar';
  @Input() inputId = '';
  @Input() ariaLabel = 'Buscar';
  @Input() inputType: 'search' | 'text' = 'search';
  @Input() showClear = true;
  @Input() clearLabel = 'Limpiar búsqueda';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() search = new EventEmitter<string>();
  @Output() clear = new EventEmitter<void>();
  private formDisabled = false;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  readonly generatedId = `sir-search-${++searchId}`;

  get resolvedId(): string { return this.inputId || this.generatedId; }
  get effectivelyDisabled(): boolean { return this.disabled || this.formDisabled; }
  writeValue(value: string | null): void { this.value = value || ''; this.cdr.markForCheck(); }
  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.formDisabled = disabled; this.cdr.markForCheck(); }
  update(value: string): void {
    this.value = value;
    this.onChange(value);
    this.valueChange.emit(value);
  }
  clearValue(): void {
    if (this.effectivelyDisabled) return;
    this.update('');
    this.clear.emit();
  }
  submit(): void { if (!this.effectivelyDisabled) this.search.emit(this.value); }
  touch(): void { this.onTouched(); }
}
