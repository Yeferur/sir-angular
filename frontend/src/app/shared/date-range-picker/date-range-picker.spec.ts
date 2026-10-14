import { Component, provideZonelessChangeDetection, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SirDateRange, SirDateRangePickerComponent } from './date-range-picker';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, SirDateRangePickerComponent],
  template: `<label for="test-range">Rango de fechas</label>
    <div style="overflow:hidden;max-width:340px">
      <app-date-range-picker inputId="test-range" [formControl]="control"
        [minDate]="minDate" [maxDate]="maxDate" [dateFilter]="dateFilter"
        [allowClear]="allowClear"
        (rangeChange)="changes.push($event)" />
    </div>`,
})
class RangeTestHost {
  @ViewChild(SirDateRangePickerComponent) picker!: SirDateRangePickerComponent;
  control = new FormControl<SirDateRange>({ start: null, end: null }, { nonNullable: true });
  minDate: string | null = null;
  maxDate: string | null = null;
  dateFilter: ((date: Date) => boolean) | null = null;
  allowClear = true;
  changes: SirDateRange[] = [];
}

describe('SirDateRangePickerComponent', () => {
  let fixture: ComponentFixture<RangeTestHost>;
  let host: RangeTestHost;
  let trigger: HTMLButtonElement;
  const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
  const panel = () => document.querySelector<HTMLElement>('.sir-range-panel');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RangeTestHost], providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(RangeTestHost);
    host = fixture.componentInstance;
    render();
    trigger = fixture.nativeElement.querySelector('#test-range');
  });

  afterEach(() => fixture.destroy());

  it('mantiene abierto el calendario tras A y confirma A–A al repetir la fecha', () => {
    trigger.click(); render();
    expect(panel()).not.toBeNull();
    host.picker.selectDate('2026-10-12'); render();
    expect(host.control.value).toEqual({ start: null, end: null });
    expect(host.changes.length).toBe(0);
    expect(trigger.textContent).toContain('12 de oct de 2026');
    expect(panel()).not.toBeNull();
    host.picker.selectDate('2026-10-12'); render();
    expect(host.control.value).toEqual({ start: '2026-10-12', end: '2026-10-12' });
    expect(host.changes).toEqual([{ start: '2026-10-12', end: '2026-10-12' }]);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('oculta la ayuda inicial y la muestra solo después del primer día', () => {
    host.allowClear = false; render();
    trigger.click(); render();
    expect(panel()?.querySelector('.sir-range-footer')).toBeNull();
    host.picker.selectDate('2026-10-12'); render();
    expect(panel()?.querySelector('.sir-range-footer')?.textContent).toContain('Selecciona otra fecha para completar el rango.');
    host.picker.selectDate('2026-10-15'); render();
    expect(host.control.value).toEqual({ start: '2026-10-12', end: '2026-10-15' });
  });

  it('elige el mes directamente en cada calendario y preserva meses separados', () => {
    host.control.setValue({ start: '2026-10-01', end: '2026-10-01' }); render();
    trigger.click(); render();
    const monthButtons = () => panel()!.querySelectorAll<HTMLButtonElement>('button[aria-label^="Elegir mes"]');
    monthButtons()[1].click(); render();
    expect(panel()!.querySelectorAll('.sir-dp-month-item').length).toBe(12);
    panel()!.querySelectorAll<HTMLButtonElement>('.sir-dp-month-item')[11].click(); render();
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2026-9', '2026-11']);
    monthButtons()[0].click(); render();
    panel()!.querySelectorAll<HTMLButtonElement>('.sir-dp-month-item')[0].click(); render();
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2026-0', '2026-11']);
    host.picker.moveMonth(-1);
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2025-11', '2026-10']);
  });

  it('al elegir enero a la derecha de octubre continúa en el año siguiente', () => {
    host.control.setValue({ start: '2026-10-01', end: '2026-10-01' }); render();
    host.picker.selectMonth(1, 0);
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2026-9', '2027-0']);
  });

  it('elige el año directamente sin duplicar calendarios y selecciona un rango entre años', () => {
    host.control.setValue({ start: '2026-10-01', end: '2026-10-01' }); render();
    trigger.click(); render();
    const yearButtons = () => panel()!.querySelectorAll<HTMLButtonElement>('button[aria-label^="Elegir año"]');
    yearButtons()[0].click(); render();
    const year2025 = [...panel()!.querySelectorAll<HTMLButtonElement>('.sir-dp-year-item')]
      .find(button => button.textContent?.trim() === '2025')!;
    year2025.click(); render();
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2025-9', '2026-10']);
    host.picker.selectDate('2025-10-31'); render();
    host.picker.selectDate('2026-11-02'); render();
    expect(host.control.value).toEqual({ start: '2025-10-31', end: '2026-11-02' });

    trigger.click(); render();
    yearButtons()[1].click(); render();
    const year2025Right = [...panel()!.querySelectorAll<HTMLButtonElement>('.sir-dp-year-item')]
      .find(button => button.textContent?.trim() === '2025')!;
    year2025Right.click(); render();
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2025-9', '2025-10']);
    host.picker.selectMonth(0, 11);
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2025-11', '2026-0']);
    host.picker.selectMonth(1, 9);
    expect(host.picker.visibleMonths.map(month => month.key)).toEqual(['2025-11', '2026-9']);
  });

  it('no muestra modos y confirma A–A al cerrar el calendario', () => {
    host.allowClear = false;
    render();
    trigger.click(); render();
    expect(panel()?.querySelector('.sir-range-mode')).toBeNull();
    expect(panel()?.querySelector('.sir-range-footer button')).toBeNull();
    expect(panel()?.getAttribute('aria-label')).toBe('Seleccionar período');
    host.picker.selectDate('2026-10-13'); render();
    expect(host.control.value).toEqual({ start: null, end: null });
    host.picker.close(); render();
    expect(host.control.value).toEqual({ start: '2026-10-13', end: '2026-10-13' });
    expect(host.changes).toEqual([{ start: '2026-10-13', end: '2026-10-13' }]);
    expect(panel()).toBeNull();
  });

  it('normaliza B menor que A y distingue inicio, fin e intermedios', () => {
    trigger.click(); render();
    host.picker.selectDate('2026-10-15');
    host.picker.selectDate('2026-10-10');
    expect(host.picker.draftStart).toBeNull();
    expect(host.control.value).toEqual({ start: '2026-10-10', end: '2026-10-15' });
    expect(host.picker.isStart('2026-10-10')).toBeTrue();
    expect(host.picker.isBetween('2026-10-12')).toBeTrue();
    expect(host.picker.isEnd('2026-10-15')).toBeTrue();
    expect(host.picker.visibleMonths.length).toBe(2);
  });

  it('respeta min/max y no acepta un intervalo que atraviesa un día bloqueado', () => {
    host.minDate = '2026-10-01';
    host.maxDate = '2026-10-31';
    host.dateFilter = date => date.getDay() !== 0;
    render();
    trigger.click(); render();
    host.picker.selectDate('2026-09-30');
    expect(host.picker.draftStart).toBeNull();
    host.picker.selectDate('2026-10-10');
    host.picker.selectDate('2026-10-12'); render();
    expect(host.control.value).toEqual({ start: null, end: null });
    expect(host.picker.rangeError).toContain('fechas no disponibles');
    host.picker.selectDate('2026-10-10'); render();
    expect(host.control.value).toEqual({ start: '2026-10-10', end: '2026-10-10' });
  });

  it('al cerrar fuera confirma el día y Escape cancela el borrador conservando el valor anterior', () => {
    host.control.setValue({ start: '2026-10-01', end: '2026-10-05' }); render();
    trigger.click(); render();
    host.picker.selectDate('2026-10-13'); render();
    host.picker.close(); render();
    expect(host.control.value).toEqual({ start: '2026-10-13', end: '2026-10-13' });

    trigger.click(); render();
    host.picker.selectDate('2026-10-20'); render();
    const day = panel()!.querySelector<HTMLButtonElement>('.sir-range-day:focus')!;
    day.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); render();
    expect(host.control.value).toEqual({ start: '2026-10-13', end: '2026-10-13' });
    expect(host.picker.draftStart).toBeNull();
    expect(panel()).toBeNull();
  });

  it('carga y limpia un rango sin emisión espuria; disabled impide abrir', () => {
    host.control.setValue({ start: '2026-10-01', end: '2026-10-12' }); render();
    expect(trigger.textContent).toContain('2026');
    expect(host.changes.length).toBe(0);
    trigger.click(); render();
    host.picker.clearRange(); render();
    expect(host.control.value).toEqual({ start: null, end: null });
    expect(host.changes.length).toBe(1);
    host.control.disable(); render();
    expect(trigger.disabled).toBeTrue();
    host.picker.open();
    expect(panel()).toBeNull();
  });

  it('monta el calendario fuera del contenedor recortado y adapta los meses al ancho', () => {
    trigger.click(); render();
    expect(fixture.nativeElement.contains(panel())).toBeFalse();
    const second = panel()!.querySelector<HTMLElement>('.sir-range-month--second')!;
    expect(getComputedStyle(second).display === 'none').toBe(window.innerWidth < 640);
    expect(panel()!.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });
});
