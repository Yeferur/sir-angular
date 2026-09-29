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

  it('aplica la hora exacta sin cerrar el popover y no emite valores restringidos', async () => {
    const component = await createComponent();
    component.mode = 'free';
    component.draftHour = '7';
    component.draftMinute = '00';
    component.draftPeriod = 'PM';
    const close = spyOn(component, 'close');
    const emitted = jasmine.createSpy('emitted');
    component.valueChange.subscribe(emitted);
    const minute = document.createElement('input');
    minute.value = '46';

    component.updateDraftMinute({ target: minute } as unknown as Event);

    expect(emitted).toHaveBeenCalledOnceWith('19:46');
    expect(close).not.toHaveBeenCalled();
    component.minTime = '20:00';
    minute.value = '47';
    component.updateDraftMinute({ target: minute } as unknown as Event);
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(component.value).toBe('19:46');
    expect(component.freeError).toBeTruthy();
  });

  it('confirma la hora libre con Enter', async () => {
    const component = await createComponent();
    const confirm = spyOn(component, 'confirmFreeTime');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(event, 'preventDefault');

    component.onFreeInputKeydown(event, 'hour');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
  });

  it('normaliza la entrada antes de conservar una hora o minuto imposibles', async () => {
    const component = await createComponent();
    component.mode = 'free';
    const hour = document.createElement('input');
    hour.value = '44';
    component.updateDraftHour({ target: hour } as unknown as Event);
    const minute = document.createElement('input');
    minute.value = '88';
    component.updateDraftMinute({ target: minute } as unknown as Event);

    expect(component.draftHour).toBe('4');
    expect(component.draftMinute).toBe('08');
    expect(hour.value).toBe('4');
    expect(minute.value).toBe('08');

    hour.value = '0';
    component.updateDraftHour({ target: hour } as unknown as Event);
    expect(component.draftHour).toBe('');
    expect(hour.value).toBe('');
  });

  it('permite ajustar los segmentos con flechas sin salir de sus rangos', async () => {
    const component = await createComponent();
    component.draftHour = '12';
    component.draftMinute = '00';
    const hour = document.createElement('input');
    const minute = document.createElement('input');

    component.onFreeInputKeydown({ key: 'ArrowUp', target: hour, preventDefault: () => {} } as unknown as KeyboardEvent, 'hour');
    component.onFreeInputKeydown({ key: 'ArrowDown', target: minute, preventDefault: () => {} } as unknown as KeyboardEvent, 'minute');

    expect(component.draftHour).toBe('1');
    expect(component.draftMinute).toBe('59');
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
