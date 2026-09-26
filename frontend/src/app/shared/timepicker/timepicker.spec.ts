import { provideZonelessChangeDetection, SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TimepickerComponent } from './timepicker';

describe('TimepickerComponent', () => {
  async function createComponent(): Promise<TimepickerComponent> {
    await TestBed.configureTestingModule({
      imports: [TimepickerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    return TestBed.createComponent(TimepickerComponent).componentInstance;
  }

  it('acepta 3:08 p. m. en modo de hora libre', async () => {
    const component = await createComponent();
    component.mode = 'free';
    component.draftHour = '3';
    component.draftMinute = '08';
    component.draftPeriod = 'PM';
    let emitted: string | null | undefined;
    component.valueChange.subscribe(value => emitted = value);

    component.confirmFreeTime();

    expect(emitted).toBe('15:08');
  });

  it('acepta 3:01 p. m. sin redondear el minuto', async () => {
    const component = await createComponent();
    component.mode = 'free';
    component.draftHour = '3';
    component.draftMinute = '01';
    component.draftPeriod = 'PM';
    let emitted: string | null | undefined;
    component.valueChange.subscribe(value => emitted = value);

    component.confirmFreeTime();

    expect(emitted).toBe('15:01');
  });

  it('conserva el modo por intervalos y el paso configurado para Turnos', async () => {
    const component = await createComponent();
    component.step = 30;
    component.ngOnChanges({ step: new SimpleChange(15, 30, false) });

    expect(component.mode).toBe('intervals');
    expect(component.slots.length).toBe(48);
    expect(component.slots).toContain('08:30');
    expect(component.slots).not.toContain('08:08');
  });

  it('confirma la hora libre con Enter', async () => {
    const component = await createComponent();
    const confirm = spyOn(component, 'confirmFreeTime');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(event, 'preventDefault');

    component.onFreeInputKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
  });

  it('rechaza horas fuera de las restricciones configuradas', async () => {
    const component = await createComponent();
    component.mode = 'free';
    component.minTime = '15:04';
    component.draftHour = '3';
    component.draftMinute = '01';
    component.draftPeriod = 'PM';
    const emitted = jasmine.createSpy('emitted');
    component.valueChange.subscribe(emitted);

    component.confirmFreeTime();

    expect(emitted).not.toHaveBeenCalled();
    expect(component.freeError).toContain('3:04 p. m.');
  });
});
