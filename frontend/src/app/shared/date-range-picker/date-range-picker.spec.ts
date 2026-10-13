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
        (rangeChange)="changes.push($event)" />
    </div>`,
})
class RangeTestHost {
  @ViewChild(SirDateRangePickerComponent) picker!: SirDateRangePickerComponent;
  control = new FormControl<SirDateRange>({ start: null, end: null }, { nonNullable: true });
  minDate: string | null = null;
  maxDate: string | null = null;
  dateFilter: ((date: Date) => boolean) | null = null;
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

  it('integra Reactive Forms y permite un rango de un solo día sin emitir el inicio parcial', () => {
    trigger.click(); render();
    expect(panel()).not.toBeNull();
    host.picker.selectDate('2026-10-12'); render();
    expect(host.control.value).toEqual({ start: null, end: null });
    expect(host.changes.length).toBe(0);
    expect(trigger.textContent).toContain('Elige la fecha final');
    host.picker.selectDate('2026-10-12'); render();
    expect(host.control.value).toEqual({ start: '2026-10-12', end: '2026-10-12' });
    expect(host.changes).toEqual([{ start: '2026-10-12', end: '2026-10-12' }]);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('reinicia el inicio si se elige una fecha anterior y distingue inicio, fin e intermedios', () => {
    trigger.click(); render();
    host.picker.selectDate('2026-10-15');
    host.picker.selectDate('2026-10-10');
    expect(host.picker.draftStart).toBe('2026-10-10');
    host.picker.selectDate('2026-10-15');
    trigger.click(); render();
    expect(host.picker.isStart('2026-10-10')).toBeTrue();
    expect(host.picker.isBetween('2026-10-12')).toBeTrue();
    expect(host.picker.isEnd('2026-10-15')).toBeTrue();
    expect(panel()?.querySelectorAll('.sir-range-month').length).toBe(2);
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
