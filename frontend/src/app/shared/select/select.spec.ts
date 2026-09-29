import { Component, provideZonelessChangeDetection, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { SirSelectComponent, SirSelectOption, compareSelectValuesAsStrings } from './select';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, SirSelectComponent],
  template: `<button id="before-select">Antes</button>
    <div class="test-clip" style="overflow:hidden; width:240px">
      <label for="test-select">Tour</label>
      <app-select inputId="test-select" [formControl]="control" [options]="options"
        [required]="true" [invalid]="control.touched && control.invalid" [compareWith]="compareWith"
        placeholder="Seleccionar tour" (valueChange)="changes.push($event)" />
    </div><button id="after-select">Después</button>`,
})
class SelectTestHost {
  @ViewChild(SirSelectComponent) select!: SirSelectComponent;
  control = new FormControl<any>(null, Validators.required);
  options: SirSelectOption[] = [
    { value: null, label: 'Todos los tours' },
    { value: 2, label: 'Guatapé' },
    { value: '3', label: 'Santa Fe' },
    { value: 4, label: 'Deshabilitado', disabled: true },
    { value: 5, label: 'Último' },
  ];
  compareWith = Object.is;
  changes: any[] = [];
}

describe('SirSelectComponent: formulario, interacción y overlay', () => {
  let fixture: ComponentFixture<SelectTestHost>;
  let host: SelectTestHost;
  let trigger: HTMLButtonElement;
  const panel = () => document.querySelector<HTMLElement>('.sir-select-list')!;
  const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
  const key = (value: string, shiftKey = false) => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
    render();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectTestHost], providers: [provideZonelessChangeDetection()] }).compileComponents();
    fixture = TestBed.createComponent(SelectTestHost);
    host = fixture.componentInstance;
    render();
    trigger = fixture.nativeElement.querySelector('#test-select');
  });

  it('muestra patchValue/reset sin emitir cambios y conserva tipos numérico/string/null', () => {
    host.control.patchValue(2); render();
    expect(trigger.textContent).toContain('Guatapé');
    trigger.focus(); trigger.click(); render();
    panel().querySelector<HTMLElement>('[aria-selected="true"]')!.click(); render();
    expect(host.control.value).toBe(2);
    trigger.click(); render(); host.select.choose(2); render();
    expect(host.control.value).toBe('3');
    host.control.reset(); render();
    expect(trigger.textContent).toContain('Todos los tours');
    expect(host.control.pristine).toBeTrue();
    expect(host.control.untouched).toBeTrue();
    expect(host.changes).toEqual(['3']);
  });

  it('respeta la equivalencia explícita de selects nativos precargados sin convertir lo emitido', () => {
    host.compareWith = compareSelectValuesAsStrings;
    host.control.patchValue(3); render();
    expect(trigger.textContent).toContain('Santa Fe');
    host.select.open(); host.select.choose(2); render();
    expect(host.control.value).toBe(3);
    expect(host.changes).toEqual([]);
    expect(host.control.pristine).toBeTrue();
    host.select.open(); host.select.choose(1); render();
    expect(host.control.value).toBe(2);
  });

  it('conecta etiqueta, combobox, lista, selección, required e invalid al error existente', () => {
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.labels?.[0]?.textContent).toBe('Tour');
    expect(trigger.getAttribute('aria-required')).toBe('true');
    host.control.markAsTouched(); render();
    expect(trigger.classList.contains('errorInput')).toBeTrue();
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    host.control.setValue(2); render();
    trigger.click(); render();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel().id);
    const selected = panel().querySelector<HTMLElement>('[aria-selected="true"]')!;
    expect(trigger.getAttribute('aria-activedescendant')).toBe(selected.id);
    expect(selected.textContent).toContain('Guatapé');
  });

  it('navega con flechas, Home/End, omite disabled y confirma con Enter devolviendo foco', () => {
    host.control.setValue(2); render(); trigger.focus();
    key('ArrowDown');
    expect(host.select.activeIndex).toBe(1);
    key('ArrowDown'); expect(host.select.activeIndex).toBe(2);
    key('ArrowDown'); expect(host.select.activeIndex).toBe(4);
    key('ArrowUp'); expect(host.select.activeIndex).toBe(2);
    key('Home'); expect(host.select.activeIndex).toBe(0);
    key('End'); expect(host.select.activeIndex).toBe(4);
    expect(host.control.value).toBe(2);
    key('Enter');
    expect(host.control.value).toBe(5);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.control.touched).toBeTrue();
  });

  it('abre y selecciona con Space sin enviar el formulario', () => {
    key(' '); key('ArrowDown'); key(' ');
    expect(host.control.value).toBe(2);
    expect(host.changes).toEqual([2]);
    expect(host.select.isOpen).toBeFalse();
  });

  it('Escape conserva valor, cierra y no se propaga al drawer', () => {
    const parentEscape = jasmine.createSpy('parentEscape');
    fixture.nativeElement.addEventListener('keydown', parentEscape);
    host.control.setValue(2); render(); trigger.focus(); key('Enter'); key('End');
    parentEscape.calls.reset(); key('Escape');
    expect(host.control.value).toBe(2);
    expect(host.changes).toEqual([]);
    expect(host.select.isOpen).toBeFalse();
    expect(parentEscape).not.toHaveBeenCalled();
  });

  for (const shiftKey of [false, true]) {
    it(`cierra con ${shiftKey ? 'Shift+Tab' : 'Tab'} sin impedir el recorrido de foco`, () => {
      trigger.focus(); key('Enter');
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      trigger.dispatchEvent(event); render();
      expect(event.defaultPrevented).toBeFalse();
      expect(host.select.isOpen).toBeFalse();
      expect(host.changes).toEqual([]);
    });
  }

  it('click exterior activa el siguiente control sin recuperar el foco', () => {
    trigger.focus(); trigger.click(); render();
    const after = fixture.nativeElement.querySelector('#after-select') as HTMLButtonElement;
    after.focus(); after.click(); render();
    expect(host.select.isOpen).toBeFalse();
    expect(document.activeElement).toBe(after);
  });

  it('cierra ante disabled de Reactive Forms y no admite seleccionar opciones disabled', () => {
    trigger.click(); render(); host.select.choose(3);
    expect(host.changes).toEqual([]);
    host.control.disable(); render();
    expect(trigger.disabled).toBeTrue();
    expect(host.select.isOpen).toBeFalse();
    host.select.open(); expect(host.select.isOpen).toBeFalse();
    host.control.enable(); render(); key('Enter');
    expect(host.select.isOpen).toBeTrue();
  });

  it('usa un overlay aislado sobre modales, fuera de overflow hidden', () => {
    trigger.click(); render();
    expect(fixture.nativeElement.contains(panel())).toBeFalse();
    const container = panel().closest('.sir-select-overlay-container')!;
    expect(+getComputedStyle(container).zIndex).toBeGreaterThan(1500);
    expect(panel().getBoundingClientRect().width).toBeCloseTo(trigger.getBoundingClientRect().width, 0);
  });

  it('abre arriba cerca del borde inferior y mantiene el panel dentro del viewport', () => {
    fixture.nativeElement.style.cssText = 'position:fixed;bottom:8px;left:8px;width:240px';
    host.options = Array.from({ length: 12 }, (_, i) => ({ value: i, label: `Opción ${i}` })); render();
    trigger.click(); render();
    const rect = panel().getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(trigger.getBoundingClientRect().top);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(innerWidth);
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });

  it('limpia panel y observadores al destruir un formulario con el select abierto', () => {
    trigger.click(); render();
    fixture.destroy();
    expect(panel()).toBeNull();
    expect(document.querySelector('.sir-select-overlay-container')).toBeNull();
  });

  it('hace visible la selección precargada al final de una lista sin desplazar la página', () => {
    host.options = Array.from({ length: 40 }, (_, i) => ({ value: i, label: `Tour ${i}` }));
    host.control.setValue(39); render();
    const before = scrollY;
    trigger.click(); render();
    const selected = panel().querySelector<HTMLElement>('[aria-selected="true"]')!.getBoundingClientRect();
    const list = panel().getBoundingClientRect();
    expect(panel().scrollTop).toBeGreaterThan(0);
    expect(selected.top).toBeGreaterThanOrEqual(list.top);
    expect(selected.bottom).toBeLessThanOrEqual(list.bottom);
    expect(scrollY).toBe(before);
  });
});
