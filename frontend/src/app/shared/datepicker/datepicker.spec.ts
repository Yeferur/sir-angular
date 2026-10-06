import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DatepickerComponent } from './datepicker';

describe('Datepicker: días de meses adyacentes', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatepickerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  function createAt(year: number, month: number) {
    const fixture = TestBed.createComponent(DatepickerComponent);
    fixture.detectChanges();
    const picker = fixture.componentInstance;
    picker.cursor = new Date(year, month - 1, 1);
    picker.nextMonth();
    picker.prevMonth();
    return { fixture, picker };
  }

  it('selecciona el 1 de octubre desde septiembre y actualiza el valor', () => {
    const { fixture, picker } = createAt(2026, 9);
    const changed = jasmine.createSpy('changed');
    picker.registerOnChange(changed);
    const emitted = spyOn(picker.dateChange, 'emit');
    picker.open();
    fixture.detectChanges();

    const octoberFirst = document.querySelector<HTMLButtonElement>(
      '.sir-dp-panel .sir-dp-day.dp-other[aria-label="1 de Octubre de 2026"]');
    expect(octoberFirst).not.toBeNull();
    expect(octoberFirst!.disabled).toBeFalse();
    octoberFirst!.click();

    expect(changed).toHaveBeenCalledOnceWith('2026-10-01');
    expect(emitted).toHaveBeenCalledOnceWith('2026-10-01');
    expect(picker.cursorMonth).toBe(9);
    expect(picker.isOpen).toBeFalse();
    fixture.destroy();
  });

  it('selecciona un día del mes anterior', () => {
    const { fixture, picker } = createAt(2026, 10);
    const previous = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getMonth() === 8 && cell.day === 30)!;
    expect(previous.isDisabled).toBeFalse();
    picker.selectDay(previous);
    expect(picker.selected?.getMonth()).toBe(8);
    expect(picker.selected?.getDate()).toBe(30);
    expect(picker.cursorMonth).toBe(8);
    fixture.destroy();
  });

  it('respeta minDate, maxDate y dateFilter en días adyacentes', () => {
    const { fixture, picker } = createAt(2026, 9);
    picker.minDate = '2026-09-29';
    picker.maxDate = '2026-10-02';
    picker.dateFilter = date => date.getDate() !== 1;
    picker.nextMonth();
    picker.prevMonth();
    const august = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getMonth() === 7)!;
    const octoberFirst = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getMonth() === 9 && cell.day === 1)!;
    const octoberSecond = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getMonth() === 9 && cell.day === 2)!;
    const octoberThird = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getMonth() === 9 && cell.day === 3)!;
    expect([august, octoberFirst, octoberThird].every(cell => cell.isDisabled)).toBeTrue();
    expect(octoberSecond.isDisabled).toBeFalse();
    picker.selectDay(octoberFirst);
    expect(picker.selected).toBeNull();
    fixture.destroy();
  });

  it('selecciona enero del año siguiente desde diciembre', () => {
    const { fixture, picker } = createAt(2026, 12);
    const january = picker.days.find(cell => !cell.isCurrentMonth && cell.date.getFullYear() === 2027 && cell.day === 1)!;
    expect(january.isDisabled).toBeFalse();
    picker.selectDay(january);
    expect(picker.selected?.getFullYear()).toBe(2027);
    expect(picker.cursorYear).toBe(2027);
    expect(picker.cursorMonth).toBe(0);
    fixture.destroy();
  });
});
