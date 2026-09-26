import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ReminderFormComponent } from './reminder-form';
import { nextSirMinute, sirToday, toSirLocalDateTime } from '../../shared/utils/sir-datetime';

describe('Formulario compartido de recordatorios', () => {
  it('usa los selectores de SIR y conserva los valores cuando la validación falla', async () => {
    await TestBed.configureTestingModule({
      imports: [ReminderFormComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReminderFormComponent);
    const component = fixture.componentInstance;
    component.value = { titulo: 'Seguimiento importante', descripcion: 'No perder este contexto', fecha: '2000-01-01T08:00' };
    component.ngOnChanges({ value: {} as any });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-datepicker')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-timepicker')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('input[type="datetime-local"]')).toBeNull();

    const saved = jasmine.createSpy('saved');
    component.save.subscribe(saved);
    component.submit();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    expect(saved).not.toHaveBeenCalled();
    expect(component.value.titulo).toBe('Seguimiento importante');
    expect(component.value.descripcion).toBe('No perder este contexto');
    expect(component.value.fecha).toBe('2000-01-01T08:00');
    expect(component.timeInvalid).toBeTrue();
  });

  it('combina fecha y hora sin alterar los demás campos', () => {
    const component = new ReminderFormComponent();
    component.value = { titulo: 'Llamar', descripcion: 'Cliente', fecha: '2099-10-15T12:00' };
    component.ngOnChanges({ value: {} as any });
    let emitted: any;
    component.valueChange.subscribe(value => emitted = value);

    component.updateTime('14:35');

    expect(emitted).toEqual({ titulo: 'Llamar', descripcion: 'Cliente', fecha: '2099-10-15T14:35' });
  });

  it('acepta un recordatorio para el siguiente minuto disponible', () => {
    const component = new ReminderFormComponent();
    component.value = { titulo: 'Inmediato', descripcion: 'Contexto', fecha: nextSirMinute(), enviarCorreo: true };
    component.ngOnChanges({ value: {} as any });
    const saved = jasmine.createSpy('saved');
    component.save.subscribe(saved);

    component.submit();

    expect(component.timeInvalid).toBeFalse();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('al cambiar de mañana a hoy conserva hora, título, nota y correo aunque la hora haya pasado', () => {
    const component = new ReminderFormComponent();
    const pastTime = toSirLocalDateTime(new Date(Date.now() - 60 * 60_000)).slice(11);
    component.value = {
      titulo: 'Conservar contenido', descripcion: 'Nota importante',
      fecha: '2099-10-15T' + pastTime, enviarCorreo: true,
    };
    component.ngOnChanges({ value: {} as any });
    let emitted: any;
    component.valueChange.subscribe(value => emitted = value);

    component.updateDate(sirToday());
    component.value = emitted;
    component.ngOnChanges({ value: {} as any });
    component.submitted = true;

    expect(component.selectedTime).toBe(pastTime);
    expect(component.timeInvalid).toBeTrue();
    expect(emitted.titulo).toBe('Conservar contenido');
    expect(emitted.descripcion).toBe('Nota importante');
    expect(emitted.enviarCorreo).toBeTrue();
  });

  it('muestra el correo registrado sin permitir editar el destinatario', async () => {
    await TestBed.configureTestingModule({
      imports: [ReminderFormComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(ReminderFormComponent);
    fixture.componentInstance.value = { titulo: '', fecha: '', enviarCorreo: false };
    fixture.componentInstance.registeredEmail = 'propietario@example.test';
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector('input[name="reminderEmail"]') as HTMLInputElement;
    expect(checkbox.disabled).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('propietario@example.test');
    expect(fixture.nativeElement.querySelector('input[type="email"]')).toBeNull();
  });
});
