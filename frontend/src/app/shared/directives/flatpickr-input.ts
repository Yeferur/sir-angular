import {
  Directive,
  ElementRef,
  forwardRef,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import flatpickr from 'flatpickr';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';

import { Spanish } from 'flatpickr/dist/l10n/es';

type DateValue = Date | string | null;

@Directive({
  selector: 'input[appFlatpickrInput]',
  standalone: true,
  exportAs: 'fp',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FlatpickrInputDirective),
      multi: true
    }
  ]
})
export class FlatpickrInputDirective implements OnInit, OnDestroy, OnChanges, ControlValueAccessor {
  @Input() fpOptions: Partial<FlatpickrOptions> = {};

  // Exponer la instancia para que el componente pueda manipularla
  instance!: FlatpickrInstance;

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  private lastValue: string | null = null;

  constructor(private el: ElementRef<HTMLInputElement>, private zone: NgZone) {}

  ngOnInit(): void {
    // SSR guard
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    this.zone.runOutsideAngular(() => {
      const defaultOptions: Partial<FlatpickrOptions> = {
        allowInput: true,
        clickOpens: true,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        locale: Spanish,
        onChange: (selectedDates: Date[], dateStr: string) => {
          this.lastValue = dateStr || null;
          this.zone.run(() => this.onChange(this.lastValue));
        },
        onClose: () => {
          this.zone.run(() => this.onTouched());
        }
      };

      const merged: Partial<FlatpickrOptions> = {
        ...defaultOptions,
        ...this.fpOptions
      };

      this.instance = flatpickr(this.el.nativeElement, merged) as unknown as FlatpickrInstance;

      if (this.lastValue) this.instance.setDate(this.lastValue, false, merged.dateFormat as string);
    });

    this.el.nativeElement.addEventListener('blur', this.handleBlur, { passive: true });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.instance) return;
    if (changes['fpOptions']?.currentValue) {
      const opts = changes['fpOptions'].currentValue as Partial<FlatpickrOptions>;
      if (opts.minDate !== undefined) this.instance.set('minDate', opts.minDate as any);
      if (opts.maxDate !== undefined) this.instance.set('maxDate', opts.maxDate as any);
      if (opts.disable !== undefined) this.instance.set('disable', opts.disable as any);
      this.instance.redraw();
    }
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('blur', this.handleBlur);
    this.instance?.destroy();
  }

  private handleBlur = () => {
    this.onTouched();
  };

  // ControlValueAccessor
  writeValue(value: DateValue): void {
    const v = value == null ? null : String(value);
    this.lastValue = v;

    if (!this.instance) {
      this.el.nativeElement.value = v ?? '';
      return;
    }

    if (!v) {
      this.instance.clear();
      return;
    }

    this.instance.setDate(v, false);
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.disabled = isDisabled;
    if (this.instance) this.instance.set('disable', isDisabled ? [() => true] : []);
  }
}
