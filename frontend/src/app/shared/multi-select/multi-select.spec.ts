import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SirMultiSelectComponent, SirMultiSelectOption } from './multi-select';

@Component({
  standalone: true,
  imports: [FormsModule, SirMultiSelectComponent],
  template: `<app-multi-select inputId="test-multi" ariaLabel="Filtrar por tipo"
    [options]="options" [ngModel]="values" (ngModelChange)="values = $event"
    placeholder="Todos los tipos" [disabled]="disabled" />`,
})
class MultiSelectTestHost {
  options: SirMultiSelectOption[] = [
    { value: 'hotel', label: 'Hotel' },
    { value: 'agency', label: 'Agencia' },
    { value: 'disabled', label: 'No disponible', disabled: true },
  ];
  values: Array<string | number> = [];
  disabled = false;
}

describe('SirMultiSelectComponent', () => {
  let fixture: ComponentFixture<MultiSelectTestHost>;
  let host: MultiSelectTestHost;
  const render = () => fixture.detectChanges();
  const root = () => fixture.nativeElement as HTMLElement;
  const trigger = () => root().querySelector<HTMLButtonElement>('#test-multi')!;
  const menu = () => root().querySelector<HTMLElement>('.multi-filter-menu');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiSelectTestHost],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(MultiSelectTestHost);
    host = fixture.componentInstance;
    render();
  });

  afterEach(() => fixture.destroy());

  it('comparte geometría con SirSelect y presenta menú, icono y texto equivalentes', () => {
    const button = trigger();
    const style = getComputedStyle(button);
    expect(style.height).toBe('40px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('13px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');
    expect(style.transitionDuration.split(',').every(value => value.trim() === '0.18s')).toBeTrue();
    expect(button.getAttribute('aria-label')).toBe('Filtrar por tipo');
    button.focus();
    expect(button.matches(':focus-visible')).toBeTrue();
    expect(getComputedStyle(button).boxShadow).not.toBe('none');
    button.blur();

    button.click(); render();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('svg')).not.toBeNull();
    const panel = menu()!;
    const panelStyle = getComputedStyle(panel);
    expect(panelStyle.borderTopWidth).toBe('1px');
    expect(panelStyle.borderRadius).toBe('12px');
    expect(panelStyle.animationName).toBe('sirMultiFilterFadeDown');
    expect(panelStyle.animationDuration).toBe('0.18s');
    expect(panel.getAttribute('aria-multiselectable')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-label')).toBe('Filtrar por tipo opciones');
    expect(getComputedStyle(panel.querySelector('.multi-filter-option')!).fontSize).toBe('14px');
  });

  it('selecciona uno o varios valores, deselecciona y limpia sin cambiar el resumen', () => {
    trigger().click(); render();
    const options = () => Array.from(menu()!.querySelectorAll('.multi-filter-option')) as HTMLButtonElement[];
    options()[0].click(); render();
    expect(host.values).toEqual(['hotel']);
    expect(trigger().textContent).toContain('1 seleccionado');
    const checkedBackground = getComputedStyle(root().querySelector('.multi-filter-checkbox.checked')!).backgroundColor;
    const uncheckedBackground = getComputedStyle(root().querySelector('.multi-filter-checkbox:not(.checked)')!).backgroundColor;
    expect(checkedBackground).not.toBe(uncheckedBackground);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');

    options()[1].click(); render();
    expect(host.values).toEqual(['hotel', 'agency']);
    expect(trigger().textContent).toContain('2 seleccionados');
    options()[0].click(); render();
    expect(host.values).toEqual(['agency']);
    options()[2].click(); render();
    expect(host.values).toEqual(['agency']);

    (menu()!.querySelector('.multi-filter-clear') as HTMLButtonElement).click(); render();
    expect(host.values).toEqual([]);
    expect(trigger().textContent).toContain('Todos los tipos');
    expect(menu()).not.toBeNull();
  });

  it('cierra al recibir Escape o un pointerdown fuera del selector', () => {
    trigger().click(); render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    render();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();

    trigger().click(); render();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    render();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
  });

  it('mantiene el disabled coordinado con el multiselect de SirSelect', () => {
    host.disabled = true; render();
    const button = trigger();
    expect(button.disabled).toBeTrue();
    expect(getComputedStyle(button).opacity).toBe('0.55');
    button.click(); render();
    expect(menu()).toBeNull();
  });

  it('resuelve fondo del menú con tokens de ambos temas', () => {
    const originalTheme = document.documentElement.getAttribute('data-theme');
    try {
      document.documentElement.setAttribute('data-theme', 'dark');
      trigger().click(); render();
      const darkBackground = getComputedStyle(menu()!).backgroundColor;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); render();

      document.documentElement.setAttribute('data-theme', 'light');
      trigger().click(); render();
      const lightBackground = getComputedStyle(menu()!).backgroundColor;
      expect(lightBackground).not.toBe(darkBackground);
    } finally {
      if (originalTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', originalTheme);
    }
  });
});
