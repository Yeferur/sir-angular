import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { CrearReservaComponent } from './crear-reserva/crear-reserva';
import { EditarReservaComponent } from './editar-reserva/editar-reserva';
import { Reservas } from '../../services/Reservas/reservas';
import { WebSocketService } from '../../services/WebSocket/web-socket';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { apiEnvelopeInterceptor } from '../../interceptors/api-envelope.interceptor';

for (const [mode, component] of [['crear', CrearReservaComponent], ['editar', EditarReservaComponent]] as const) {
  describe(`${mode} reserva: pasajeros y contacto`, () => {
    let fixture: ComponentFixture<any>;
    let c: any;
    let save: jasmine.Spy;
    let alerts: any;
    const dateError = { status: 400, error: { errorCode: 'RESERVA_TOUR_DATE_PAST', message: 'La fecha reservada (2026-06-30) no puede ser pasada respecto a la fecha actual en America/Bogota.' } };
    const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    const input = (index: number, field: string) => fixture.nativeElement.querySelector(`#${mode}-pasajero-${index}-${field}`) as HTMLInputElement;
    const add = (type: string) => c.agregarPasajero(type, true, { skipCuposCheck: true });

    beforeEach(async () => {
      save = jasmine.createSpy('guardar').and.returnValue(throwError(() => dateError));
      alerts = { showModal: jasmine.createSpy('modal'), showAlert: jasmine.createSpy('alert'), closeModal() {}, warningToast() {} };
      await TestBed.configureTestingModule({
        imports: [component],
        providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(withInterceptors([apiEnvelopeInterceptor])), provideHttpClientTesting(),
          { provide: Reservas, useValue: {
            getTours: () => of([{ Id_Tour: 2, Nombre_Tour: 'GUATAPÉ' }]), getCanales: () => of([]), getMonedas: () => of([]),
            verificarDniDuplicado: () => of({ exists: false }), crearReserva: save, actualizarReserva: save,
          } },
          { provide: WebSocketService, useValue: { reservationEvents$: EMPTY, aforoEvents$: EMPTY } },
          { provide: PermisosService, useValue: { tienePermiso: () => true, esCliente: () => false } },
          { provide: SirAlertService, useValue: alerts },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(component as any);
      c = fixture.componentInstance;
      fixture.detectChanges();
      // ngOnInit awaits catalog requests before completing its route lookup.
      await new Promise(resolve => setTimeout(resolve, 0));
      await fixture.whenStable();
      c.initialLoadError.set(''); c.isLoading.set(false);
      c.form.patchValue({ SelectTour: 2, Fecha_Tour: '2099-10-15', Nombre_Reportante: 'CONTACTO', Telefono_Reportante: '+573001234567', Id_Canal: 1, Id_Moneda: 1, Id_Punto: 397 });
      c.puntosSeleccionados.set([{ Id_Punto: 397, NombrePunto: 'PUNTO' }]);
      if (mode === 'editar') c.reservaId.set('SYNTHETIC');
      c.currentStep = 3; c.maxReachedStep = 5;
      spyOn(c, 'validarTodosLosDniAntesDeGuardar').and.resolveTo(true);
      spyOn(c, 'verificarCuposDisponibles').and.resolveTo(true);
      spyOn(c, mode === 'crear' ? 'confirmarReserva' : 'confirmar').and.resolveTo(true);
      render();
    });

    it('acepta un solo teléfono del reportante con adultos, niños e infantes sin teléfono', async () => {
      for (const type of ['ADULTO', 'ADULTO', 'NINO', 'INFANTE']) await add(type);
      expect(c.form.valid).toBeTrue();
      await c.onSubmit();
      expect(save).toHaveBeenCalled();
      const payload = save.calls.mostRecent().args[mode === 'crear' ? 0 : 1];
      expect(payload.pasajeros.length).toBe(4);
      expect(payload.pasajeros.every((p: any) => p.Telefono_Pasajero === null)).toBeTrue();
    });

    it('acepta contacto de un pasajero, conserva teléfonos y no los copia al agregar otro', async () => {
      c.form.get('Telefono_Reportante').setValue('');
      await add('ADULTO');
      c.pasajeros.at(0).patchValue({ Nombre_Pasajero: 'ANA', Telefono_Pasajero: '+573001234567' });
      await add('ADULTO');
      await add('INFANTE');
      expect(c.form.valid).toBeTrue();
      const before = c.form.getRawValue();
      await c.onSubmit();
      expect(save).toHaveBeenCalled();
      expect(c.form.getRawValue()).toEqual(before);
      const payload = save.calls.mostRecent().args[mode === 'crear' ? 0 : 1];
      expect(payload.pasajeros.map((p: any) => p.Telefono_Pasajero)).toEqual(['+573001234567', null, null]);
      expect(c.isSubmitting()).toBeFalse();
      const shown = mode === 'crear' ? alerts.showModal : alerts.showAlert;
      expect(shown.calls.mostRecent().args[0].message).toContain('fecha del tour ya pasó');
    });

    it('señala el contacto faltante y conserva los campos ante la validación', async () => {
      await add('ADULTO');
      c.pasajeros.at(0).get('Nombre_Pasajero').setValue('DATOS SIN GUARDAR');
      c.form.get('Telefono_Reportante').setValue('');
      await c.onSubmit(); render();
      expect(save).not.toHaveBeenCalled();
      expect(c.currentStep).toBe(1);
      const field = fixture.nativeElement.querySelector(`#${mode}-telefono-contacto`);
      expect(field.classList.contains('errorInput')).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('al menos un teléfono de contacto válido');
      expect(c.pasajeros.at(0).get('Nombre_Pasajero').value).toBe('DATOS SIN GUARDAR');
    });

    it('rechaza un teléfono adicional mal formado aunque ya exista contacto válido', async () => {
      await add('NINO');
      c.pasajeros.at(0).get('Telefono_Pasajero').setValue('123');
      await c.onSubmit();
      expect(save).not.toHaveBeenCalled();
      expect(c.getPassengerValidationIssue().focusId).toBe(`${mode}-pasajero-0-telefono`);
    });

    it('inserta un adulto vacío antes del infante y mantiene identidad al eliminar y cambiar de vista', async () => {
      await add('ADULTO'); await add('INFANTE');
      const infant = c.pasajeros.at(1);
      infant.patchValue({ Nombre_Pasajero: 'INFANTE ORIGINAL', DNI: 'INF-1', Nacionalidad: 'COLOMBIA', Telefono_Pasajero: '+573009876543' });
      render();
      await add('ADULTO'); render();
      const newAdult = c.pasajeros.at(1);
      expect(c.pasajeros.at(2)).toBe(infant);
      for (const field of ['Nombre_Pasajero', 'DNI', 'Nacionalidad', 'Telefono_Pasajero']) expect(newAdult.get(field).value).toBe('');
      expect(input(1, 'nombre').value).toBe('');
      expect(input(2, 'nombre').value).toBe('INFANTE ORIGINAL');
      input(1, 'nombre').value = 'ADULTO NUEVO'; input(1, 'nombre').dispatchEvent(new Event('input'));
      c.eliminarPasajero(0); render();
      expect(c.pasajeros.at(0)).toBe(newAdult);
      expect(input(0, 'nombre').value).toBe('ADULTO NUEVO');
      c.goToStep(4); render(); c.goToStep(3); render();
      expect(input(0, 'nombre').value).toBe('ADULTO NUEVO');
      expect(input(1, 'nombre').value).toBe('INFANTE ORIGINAL');
      expect(infant.get('Telefono_Pasajero').value).toBe('+573009876543');
    });

    it('mantiene el error de fecha específica al atravesar el interceptor real', () => {
      let message = '';
      TestBed.inject(HttpClient).put('/api/reservas/SYNTHETIC', {}).subscribe({ error: error => { message = c.getFriendlyReservaErrorMessage(error); } });
      TestBed.inject(HttpTestingController).expectOne('/api/reservas/SYNTHETIC').flush({ success: false, data: null, ...dateError.error }, { status: 400, statusText: 'Bad Request' });
      expect(message).toContain('fecha del tour ya pasó');
      TestBed.inject(HttpTestingController).verify();
    });
  });
}
