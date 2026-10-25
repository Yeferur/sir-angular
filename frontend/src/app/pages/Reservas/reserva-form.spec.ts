import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Validators } from '@angular/forms';
import { EMPTY, of, throwError } from 'rxjs';
import { CrearReservaComponent } from './crear-reserva/crear-reserva';
import { EditarReservaComponent } from './editar-reserva/editar-reserva';
import { Reservas } from '../../services/Reservas/reservas';
import { WebSocketService } from '../../services/WebSocket/web-socket';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { apiEnvelopeInterceptor } from '../../interceptors/api-envelope.interceptor';
import { By } from '@angular/platform-browser';
import { SirSelectComponent } from '../../shared/select/select';

for (const [mode, component] of [['crear', CrearReservaComponent], ['editar', EditarReservaComponent]] as const) {
  describe(`${mode} reserva: pasajeros y contacto`, () => {
    let fixture: ComponentFixture<any>;
    let c: any;
    let save: jasmine.Spy;
    let reservasApi: any;
    let alerts: any;
    const dateError = { status: 400, error: { errorCode: 'RESERVA_TOUR_DATE_PAST', message: 'La fecha reservada (2026-06-30) no puede ser pasada respecto a la fecha actual en America/Bogota.' } };
    const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    const input = (index: number, field: string) => fixture.nativeElement.querySelector(`#${mode}-pasajero-${index}-${field}`) as HTMLInputElement;
    const add = (type: string) => c.agregarPasajero(type, true, { skipCuposCheck: true });

    beforeEach(async () => {
      save = jasmine.createSpy('guardar').and.returnValue(throwError(() => dateError));
      reservasApi = {
        getTours: () => of([{ Id_Tour: 2, Nombre_Tour: 'GUATAPÉ' }, { Id_Tour: 3, Nombre_Tour: 'SANTA FE' }]),
        getCanales: () => of([]),
        getMonedas: () => of([]),
        verificarDniDuplicado: () => of({ exists: false }),
        crearReserva: save,
        actualizarReserva: save,
        getEntidadesReportantes: jasmine.createSpy('getEntidadesReportantes').and.returnValue(of([])),
        registrarEntidadReportanteRapida: jasmine.createSpy('registrarEntidadReportanteRapida')
          .and.callFake((idCanal: number, nombre: string) => of({
            Id_Entidad_Reportante: 99,
            Tipo: idCanal === 2 ? 'AGENCIA_NACIONAL' : idCanal === 3 ? 'AGENCIA_INTERNACIONAL' : 'HOTEL',
            Nombre: nombre,
            Activo: 1,
            Estado_Validacion: 'PENDIENTE_VALIDACION',
          })),
      };
      alerts = { showModal: jasmine.createSpy('modal'), showAlert: jasmine.createSpy('alert'), closeModal() {}, warningToast() {} };
      await TestBed.configureTestingModule({
        imports: [component],
        providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(withInterceptors([apiEnvelopeInterceptor])), provideHttpClientTesting(),
          { provide: Reservas, useValue: reservasApi },
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

    it('conserva el tour numérico precargado y el cambio string del select nativo al editar/crear', () => {
      c.currentStep = 0; render();
      const select = fixture.debugElement.query(By.directive(SirSelectComponent)).componentInstance as SirSelectComponent;
      const tourChange = spyOn(c, 'onTourChange');
      expect(fixture.nativeElement.querySelector(`#${mode}-reserva-tour`).textContent).toContain('GUATAPÉ');
      select.open(); select.choose(0); render();
      expect(c.form.get('SelectTour').value).toBe(2);
      expect(tourChange).not.toHaveBeenCalled();
      select.open(); select.choose(1); render();
      expect(c.form.get('SelectTour').value).toBe('3');
      expect(tourChange).toHaveBeenCalledTimes(1);
      c.form.get('SelectTour').reset(''); render();
      expect(c.form.get('SelectTour').invalid).toBeTrue();
      expect(fixture.nativeElement.querySelector(`#${mode}-reserva-tour`).textContent).toContain('Seleccionar un tour...');
    });

    it('migra moneda/idioma/canal conservando precarga, tipos y eventos secundarios', () => {
      const field = (id: string) => fixture.debugElement.queryAll(By.directive(SirSelectComponent))
        .map(el => el.componentInstance as SirSelectComponent).find(el => el.inputId === id)!;
      c.monedas.set([{ Id_Moneda: 1, Nombre_Moneda: 'COP' }, { Id_Moneda: 2, Nombre_Moneda: 'USD' }]);
      c.canales.set([{ Id_Canal: 1, Nombre_Canal: 'Directo' }, { Id_Canal: 2, Nombre_Canal: 'Agencia' }]);
      const pricing = spyOn(c, 'onPlanMonedaChange');
      const commissions = spyOn(c, 'recalcularComisionesPorCanal');
      const prices = spyOn(c, 'autollenarPrecios');
      c.currentStep = 0; render();
      expect(field(`${mode}-reserva-moneda`).selectedOption?.label).toBe('COP');
      field(`${mode}-reserva-moneda`).choose(1); render();
      expect(c.form.get('Id_Moneda').value).toBe('2');
      expect(pricing).toHaveBeenCalledTimes(1);
      field(`${mode}-reserva-idioma`).choose(1); render();
      expect(c.form.get('Idioma_Reserva').value).toBe('INGLÉS');
      c.form.get('Id_Moneda').disable(); render();
      expect(field(`${mode}-reserva-moneda`).effectivelyDisabled).toBeTrue();
      c.currentStep = 1; render();
      field(`${mode}-reserva-canal`).choose(1); render();
      expect(c.form.get('Id_Canal').value).toBe('2');
      expect(commissions).toHaveBeenCalledTimes(1);
      expect(prices).toHaveBeenCalledTimes(1);
      c.form.get('Id_Canal').reset(); c.form.get('Id_Canal').markAsTouched(); render();
      expect(field(`${mode}-reserva-canal`).invalid).toBeTrue();
    });

    it('requiere entidad compatible y sugiere usar un duplicado normalizado sin cambiar contacto ni punto', () => {
      c.canales.set([{ Id_Canal: 1, Nombre_Canal: 'HOTEL' },
        { Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL' }]);
      c.entidadesReportantes.set([{ Id_Entidad_Reportante: 7, Tipo: 'HOTEL',
        Nombre: 'Hotel Poblado Boutique', Activo: 1, Estado_Validacion: 'VALIDADA' }]);
      c.form.get('Id_Entidad_Reportante').setValidators(Validators.required);
      c.form.get('Id_Entidad_Reportante').updateValueAndValidity();
      c.currentStep = 1;
      c.nuevoNombreEntidad = 'HÓTEL   POBLADO - BOUTIQUE';
      c.mostrarRegistroEntidad = true;
      render();
      expect(c.form.get('Id_Entidad_Reportante').invalid).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('Usar entidad existente');
      c.usarCoincidenciaEntidad();
      expect(c.form.get('Id_Entidad_Reportante').value).toBe(7);
      expect(c.form.get('Nombre_Reportante').value).toBe('CONTACTO');
      expect(c.form.get('Telefono_Reportante').value).toBe('+573001234567');
      expect(c.puntosSeleccionados()[0].Id_Punto).toBe(397);
    });

    it('ordena Canal, Entidad, Nombre y Teléfono en Crear y Editar', async () => {
      c.canales.set([{ Id_Canal: 1, Nombre_Canal: 'HOTEL' }]);
      c.form.patchValue({ Id_Canal: 1, Id_Entidad_Reportante: 7 }, { emitEvent: false });
      await c.onCanalEntidadChange(true);
      c.currentStep = 1;
      render();

      const grid = fixture.nativeElement.querySelector('.wizard-step-panel .form-grid') as HTMLElement;
      const labels = Array.from(grid.querySelectorAll(':scope > .form-group > .form-label'))
        .map(label => label.textContent?.replace('*', '').trim());
      expect(labels.slice(0, 4)).toEqual([
        'Canal', 'Entidad reportante', 'Nombre de quien reporta', 'Teléfono del reportante',
      ]);
    });

    it('renderiza Entidad reportante con la geometría y estados del input compartido', async () => {
      c.canales.set([{ Id_Canal: 1, Nombre_Canal: 'HOTEL' }]);
      c.form.get('Id_Canal').setValue(1);
      await c.onCanalEntidadChange();
      c.currentStep = 1;
      render();
      const field = fixture.nativeElement.querySelector(`#${mode}-entidad-reportante`) as HTMLInputElement;
      expect(field.classList.contains('form-input')).toBeTrue();
      const style = getComputedStyle(field);
      expect(style.height).toBe('40px');
      expect(style.borderTopWidth).toBe('1px');
      expect(style.borderRadius).toBe('8px');
      expect(style.paddingLeft).toBe('13px');
      expect(style.fontSize).toBe('14px');
      expect(style.fontWeight).toBe('500');
      const normalBorder = style.borderColor;
      field.focus();
      await new Promise(resolve => setTimeout(resolve, 220));
      expect(getComputedStyle(field).borderColor).not.toBe(normalBorder);
      field.disabled = true;
      expect(getComputedStyle(field).opacity).toBe('0.72');
    });

    it('consulta el tipo del canal al buscar por nombre y oculta Entidad para Freelance y otros canales', async () => {
      c.canales.set([
        { Id_Canal: 1, Nombre_Canal: 'HOTEL' },
        { Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL' },
        { Id_Canal: 3, Nombre_Canal: 'AGENCIA INTERNACIONAL' },
        { Id_Canal: 4, Nombre_Canal: 'FREELANCE' },
        { Id_Canal: 5, Nombre_Canal: 'DIRECTO' },
      ]);
      for (const [id, type] of [[1, 'HOTEL'], [2, 'AGENCIA_NACIONAL'], [3, 'AGENCIA_INTERNACIONAL']] as const) {
        const previousQueries = reservasApi.getEntidadesReportantes.calls.count();
        c.form.get('Id_Canal').setValue(id);
        await c.onCanalEntidadChange();
        expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledTimes(previousQueries);
        expect(c.tipoEntidadSeleccionada()).toBe(type);
        c.busquedaEntidad = 'Entidad';
        await c.buscarEntidades();
        expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledWith(type, 'Entidad');
      }
      const entityQueries = reservasApi.getEntidadesReportantes.calls.count();

      c.form.get('Id_Canal').setValue(4);
      await c.onCanalEntidadChange();
      expect(c.tipoEntidadSeleccionada()).toBeNull();
      expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
      expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledTimes(entityQueries);
      c.currentStep = 1;
      render();
      expect(fixture.nativeElement.textContent).not.toContain('Entidad reportante');

      c.form.get('Id_Canal').setValue(5);
      await c.onCanalEntidadChange();
      expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
      expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledTimes(entityQueries);
    });

    it('limpia Hotel al cambiar a Agencia Nacional y a Freelance', async () => {
      c.canales.set([
        { Id_Canal: 1, Nombre_Canal: 'HOTEL' },
        { Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL' },
        { Id_Canal: 3, Nombre_Canal: 'FREELANCE' },
      ]);
      c.form.get('Id_Canal').setValue(1);
      await c.onCanalEntidadChange();
      expect(reservasApi.getEntidadesReportantes).not.toHaveBeenCalled();
      c.busquedaEntidad = 'Hotel';
      await c.buscarEntidades();
      expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledWith('HOTEL', 'Hotel');
      c.form.get('Id_Entidad_Reportante').setValue(7);

      c.form.get('Id_Canal').setValue(2);
      await c.onCanalEntidadChange();
      expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
      expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledTimes(1);
      c.busquedaEntidad = 'Agencia';
      await c.buscarEntidades();
      expect(reservasApi.getEntidadesReportantes).toHaveBeenCalledWith('AGENCIA_NACIONAL', 'Agencia');

      c.form.get('Id_Entidad_Reportante').setValue(8);
      c.form.get('Id_Canal').setValue(3);
      await c.onCanalEntidadChange();
      expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
      expect(reservasApi.getEntidadesReportantes.calls.count()).toBe(2);
    });

    it('Editar conserva la entidad al cargar la reserva sin cambiar su canal', async () => {
      if (mode !== 'editar') {
        expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
        return;
      }
      c.canales.set([{ Id_Canal: 1, Nombre_Canal: 'HOTEL' }]);
      c.entidadesReportantes.set([{ Id_Entidad_Reportante: 7, Tipo: 'HOTEL', Nombre: 'Hotel Centro',
        Activo: 1, Estado_Validacion: 'VALIDADA' }]);
      c.form.patchValue({ Id_Canal: 1, Id_Entidad_Reportante: 7 }, { emitEvent: false });
      await c.onCanalEntidadChange(true);

      expect(c.form.get('Id_Entidad_Reportante').value).toBe(7);
      expect(c.form.get('Id_Entidad_Reportante').valid).toBeTrue();
    });

    it('crea rápidamente con el canal actual y bloquea el registro rápido en Freelance', async () => {
      c.canales.set([
        { Id_Canal: 1, Nombre_Canal: 'HOTEL' },
        { Id_Canal: 2, Nombre_Canal: 'AGENCIA NACIONAL' },
        { Id_Canal: 3, Nombre_Canal: 'FREELANCE' },
      ]);
      c.form.get('Id_Canal').setValue(2);
      await c.onCanalEntidadChange();
      c.nuevoNombreEntidad = 'Viajes Andinos';
      await c.registrarEntidadRapida();
      expect(reservasApi.registrarEntidadReportanteRapida).toHaveBeenCalledOnceWith(2, 'Viajes Andinos');
      expect(c.form.get('Id_Entidad_Reportante').value).toBe(99);

      c.form.get('Id_Canal').setValue(3);
      await c.onCanalEntidadChange();
      c.nuevoNombreEntidad = 'Freelance libre';
      await c.registrarEntidadRapida();
      expect(reservasApi.registrarEntidadReportanteRapida).toHaveBeenCalledTimes(1);
      expect(c.form.get('Id_Entidad_Reportante').value).toBeNull();
    });

    it('actualiza planes/puntos dinámicos y conserva null disabled y controles de cada pasajero', async () => {
      const field = (id: string) => fixture.debugElement.queryAll(By.directive(SirSelectComponent))
        .map(el => el.componentInstance as SirSelectComponent).find(el => el.inputId === id)!;
      c.planes.set([{ Id_Plan: 1, Nombre_Plan: 'Básico' }, { Id_Plan: 2, Nombre_Plan: 'Completo' }]);
      c.puntosSeleccionados.set([{ Id_Punto: 397, NombrePunto: 'Centro' }, { Id_Punto: 398, NombrePunto: 'Norte' }]);
      spyOn(c, 'onPlanMonedaChange');
      c.modoPlan = 'global'; c.currentStep = 2; c.form.get('Id_Plan').setValue(null); render();
      const global = field(`${mode}-reserva-plan-global`);
      expect(global.selectedOption?.label).toBe('Seleccione un plan...');
      global.choose(0); expect(c.form.get('Id_Plan').value).toBeNull();
      global.choose(2); render(); expect(c.form.get('Id_Plan').value).toBe('2');
      c.planes.set([]); render(); expect(c.planGlobalSelectOptions().length).toBe(1);
      c.planes.set([{ Id_Plan: 1, Nombre_Plan: 'Básico' }, { Id_Plan: 2, Nombre_Plan: 'Completo' }]);
      c.currentStep = 3; c.modoPlan = 'individual';
      await add('ADULTO'); await add('ADULTO'); render();
      field(`${mode}-pasajero-0-punto`).choose(1); render();
      expect(c.pasajeros.at(0).get('Id_Punto').value).toBe('398');
      expect(c.pasajeros.at(1).get('Id_Punto').value).not.toBe('398');
      if (mode === 'crear') {
        field('crear-pasajero-0-plan').choose(2); render();
        expect(c.pasajeros.at(0).get('Id_Plan').value).toBe('2');
        expect(fixture.nativeElement.querySelectorAll('#crear-pasajero-0-plan').length).toBe(1);
        expect(fixture.nativeElement.querySelectorAll('#crear-pasajero-1-plan').length).toBe(1);
      }
    });

    it('requiere teléfono del reportante y de al menos un pasajero', async () => {
      for (const type of ['ADULTO', 'ADULTO', 'NIÑO', 'INFANTE']) await add(type);
      c.pasajeros.at(0).get('Telefono_Pasajero').setValue('+573009876543');
      expect(c.form.valid).toBeTrue();
      await c.onSubmit();
      expect(save).toHaveBeenCalled();
      const payload = save.calls.mostRecent().args[mode === 'crear' ? 0 : 1];
      expect(payload.pasajeros.length).toBe(4);
      expect(payload.pasajeros[0].Telefono_Pasajero).toBe('+573009876543');
      expect(payload.pasajeros.slice(1).every((p: any) => p.Telefono_Pasajero == null)).toBeTrue();
    });

    it('exige el teléfono del reportante aunque un pasajero tenga teléfono', async () => {
      c.form.get('Telefono_Reportante').setValue('');
      await add('ADULTO');
      c.pasajeros.at(0).patchValue({ Nombre_Pasajero: 'ANA', DNI: 'DOC-1', Nacionalidad: 'COLOMBIA', Telefono_Pasajero: '+573001234567', Precio_Pasajero: 100 });
      expect(c.form.get('Telefono_Reportante').hasError('required')).toBeTrue();
      await c.onSubmit();
      expect(save).not.toHaveBeenCalled();
      expect(c.currentStep).toBe(1);
      expect(c.pasajeros.at(0).get('Telefono_Pasajero').value).toBe('+573001234567');
    });

    it('exige teléfono de al menos un pasajero y conserva los campos ante la validación', async () => {
      await add('ADULTO');
      c.pasajeros.at(0).patchValue({ Nombre_Pasajero: 'DATOS SIN GUARDAR', DNI: 'DOC-1', Nacionalidad: 'COLOMBIA' });
      await c.onSubmit(); render();
      expect(save).not.toHaveBeenCalled();
      expect(c.currentStep).toBe(3);
      expect(c.showPassengerPhoneRequiredError).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('Ingresa el teléfono de al menos un pasajero.');
      expect(c.pasajeros.at(0).get('Nombre_Pasajero').value).toBe('DATOS SIN GUARDAR');
    });

    it('rechaza un teléfono adicional mal formado aunque ya exista contacto válido', async () => {
      await add('NIÑO');
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
