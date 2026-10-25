import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SirSearchInputComponent } from './search-input';

describe('SirSearchInputComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SirSearchInputComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('usa la geometría compartida, foco visible y tipografía de 14 px', () => {
    const fixture = TestBed.createComponent(SirSearchInputComponent);
    fixture.componentRef.setInput('placeholder', 'Buscar referencia');
    fixture.detectChanges();

    const shell = fixture.nativeElement.querySelector('.sir-search-input') as HTMLElement;
    const input = shell.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Buscar referencia');
    expect(shell.querySelector('i.bx-search')).not.toBeNull();
    expect(getComputedStyle(shell).height).toBe('40px');
    expect(getComputedStyle(shell).borderTopWidth).toBe('1px');
    expect(getComputedStyle(shell).borderRadius).toBe('8px');
    expect(getComputedStyle(shell).transitionDuration).toBe('0.18s, 0.18s');
    expect(getComputedStyle(input).fontSize).toBe('14px');
    expect(getComputedStyle(input).fontWeight).toBe('500');

    input.focus();
    expect(getComputedStyle(shell).boxShadow).not.toBe('none');
    fixture.destroy();
  });

  it('mantiene el estado deshabilitado en la envoltura y en el input', () => {
    const fixture = TestBed.createComponent(SirSearchInputComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const shell = fixture.nativeElement.querySelector('.sir-search-input') as HTMLElement;
    const input = shell.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBeTrue();
    expect(shell.classList.contains('is-disabled')).toBeTrue();
    expect(getComputedStyle(shell).opacity).toBe('0.55');
    fixture.destroy();
  });

  it('permite conservar type y control de limpieza originales', () => {
    const fixture = TestBed.createComponent(SirSearchInputComponent);
    fixture.componentRef.setInput('value', 'Entidad');
    fixture.componentRef.setInput('inputType', 'text');
    fixture.componentRef.setInput('showClear', false);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    fixture.destroy();
  });

  it('consume los tokens del tema claro y oscuro', () => {
    const fixture = TestBed.createComponent(SirSearchInputComponent);
    const originalTheme = document.documentElement.getAttribute('data-theme');
    try {
      document.documentElement.setAttribute('data-theme', 'dark');
      fixture.detectChanges();
      const shell = fixture.nativeElement.querySelector('.sir-search-input') as HTMLElement;
      const darkBackground = getComputedStyle(shell).backgroundColor;

      document.documentElement.setAttribute('data-theme', 'light');
      fixture.detectChanges();
      const lightBackground = getComputedStyle(shell).backgroundColor;
      expect(lightBackground).not.toBe(darkBackground);
    } finally {
      if (originalTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', originalTheme);
      fixture.destroy();
    }
  });

  it('conserva input, Enter y limpieza como eventos independientes', () => {
    const fixture = TestBed.createComponent(SirSearchInputComponent);
    const component = fixture.componentInstance;
    let changed = '';
    let submitted = '';
    let cleared = 0;
    component.valueChange.subscribe(value => changed = value);
    component.search.subscribe(value => submitted = value);
    component.clear.subscribe(() => cleared++);
    fixture.componentRef.setInput('value', 'TRS-123');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'TRS-456';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(changed).toBe('TRS-456');
    expect(submitted).toBe('TRS-456');

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(changed).toBe('');
    expect(cleared).toBe(1);
    fixture.destroy();
  });
});
