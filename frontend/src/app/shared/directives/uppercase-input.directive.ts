import { Directive, ElementRef, HostListener, Input, Optional, Renderer2 } from '@angular/core';
import { NgControl } from '@angular/forms';

@Directive({
  selector: 'input:not([type]), input[type=text], textarea, [appUppercaseInput]',
  standalone: true,
})
export class UppercaseInputDirective {
  @Input('appUppercaseInput') appUppercaseInput: boolean | string | null = true;
  private composing = false;

  private readonly excludedControlNames = [
    'correo',
    'email',
    'mail',
    'usuario',
    'password',
    'contrasena',
    'contraseña',
    'confirmar',
    'telefono',
    'teléfono',
    'phone',
    'fecha',
    'hora',
    'monto',
    'valor',
    'total',
    'saldo',
    'precio',
    'comision',
    'comisión',
    'token',
    'url',
    'archivo',
    'file',
  ];

  constructor(
    private readonly el: ElementRef<HTMLInputElement | HTMLTextAreaElement>,
    private readonly renderer: Renderer2,
    @Optional() private readonly ngControl: NgControl | null,
  ) {}

  @HostListener('compositionstart')
  onCompositionStart(): void {
    this.composing = true;
  }

  @HostListener('compositionend')
  onCompositionEnd(): void {
    this.composing = false;
    this.applyUppercase();
  }

  @HostListener('input')
  onInput(): void {
    if (!this.composing) this.applyUppercase();
  }

  private applyUppercase(): void {
    const element = this.el.nativeElement;
    if (this.shouldSkip(element)) return;

    const currentValue = element.value;
    const nextValue = currentValue.toLocaleUpperCase('es-CO');
    if (currentValue === nextValue) return;

    const start = element.selectionStart;
    const end = element.selectionEnd;

    this.renderer.setProperty(element, 'value', nextValue);
    this.ngControl?.control?.setValue(nextValue, { emitEvent: false });

    try {
      if (start !== null && end !== null && typeof element.setSelectionRange === 'function') {
        element.setSelectionRange(start, end);
      }
    } catch {
      // Some input types do not support cursor restoration.
    }
  }

  private shouldSkip(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    if (this.appUppercaseInput === false || this.appUppercaseInput === 'false') return true;
    if (element.disabled || element.readOnly || element.hasAttribute('data-no-uppercase')) return true;

    const tag = element.tagName.toLowerCase();
    const type = tag === 'textarea'
      ? 'textarea'
      : String((element as HTMLInputElement).type || 'text').toLowerCase();

    if (['email', 'password', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'file', 'hidden', 'url'].includes(type)) {
      return true;
    }

    const controlName =
      element.getAttribute('formControlName') ||
      element.getAttribute('ngModel') ||
      element.getAttribute('name') ||
      element.id ||
      '';

    const normalizedName = controlName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return this.excludedControlNames.some((name) =>
      normalizedName.includes(
        name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      )
    );
  }
}
