import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

import { ComisionesComponent } from './comisiones';
import {
  ComisionCanal,
  ComisionGrupo,
  ComisionReserva,
  ComisionesService,
  PerfilComisionEntidad,
} from '../../services/Comisiones/comisiones.service';
import { ConfirmacionService } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

describe('Comisiones: grupos por entidad y reserva', () => {
  const reserve = (id: string, overrides: Partial<ComisionReserva> = {}): ComisionReserva => ({
    Id_Reserva: id,
    Fecha_Tour: '2026-10-15',
    Nombre_Reportante: null,
    Telefono_Reportante: null,
    Id_Tour: 1,
    Nombre_Tour: 'Tour centro',
    Tipo_Reserva: 'Grupal',
    Num_Pasajeros: 1,
    Total_Comision: 10000,
    Monto_Comision_Pagada: null,
    Comision_Minima: 10000,
    Comision_Maxima: 10000,
    Estado_Liquidacion: 'PENDIENTE',
    Forma_Pago: null,
    Cuenta_Bancaria: null,
    Nombre_Receptor: null,
    DNI_Receptor: null,
    Fecha_Pago: null,
    pasajeros: [{ Id_Pasajero: 1, Nombre_Pasajero: 'Pasajero', DNI: null, Tipo_Pasajero: 'ADULTO', Comision: 10000 }],
    ...overrides,
  });

  const group = (overrides: Partial<ComisionGrupo> = {}): ComisionGrupo => ({
    Id_Entidad_Reportante: 12,
    Id_Perfil_Comision: null,
    Tipo_Entidad: 'HOTEL',
    Nombre_Entidad: 'Hotel Dann Carlton',
    Nombre_Reportante: null,
    Telefono: null,
    Forma_Pago: null,
    Cuenta_Bancaria: null,
    Nombre_Receptor: null,
    DNI_Receptor: null,
    Total_Reportante: 10000,
    Pendiente_Reportante: 10000,
    Pagado_Reportante: 0,
    reservas: [reserve('TG12345')],
    ...overrides,
  });

  const channel = (name: string, id: number, groups: ComisionGrupo[]): ComisionCanal => ({
    Id_Canal: id,
    Nombre_Canal: name,
    Total_Canal: groups.reduce((sum, item) => sum + item.Total_Reportante, 0),
    Pendiente_Canal: groups.reduce((sum, item) => sum + item.Pendiente_Reportante, 0),
    Pagado_Canal: groups.reduce((sum, item) => sum + item.Pagado_Reportante, 0),
    grupos: groups,
  });

  const profile = (overrides: Partial<PerfilComisionEntidad> = {}): PerfilComisionEntidad => ({
    Id_Perfil_Comision: 41,
    Id_Entidad_Reportante: 12,
    Tipo_Entidad: 'HOTEL',
    Nombre_Entidad: 'Hotel Dann Carlton',
    Forma_Pago: 'NEQUI',
    Numero_Cuenta: '3001234567',
    Nombre_Receptor: 'Receptor del hotel',
    DNI_Receptor: 'NIT-1234',
    Activo: 1,
    ...overrides,
  });

  async function mount() {
    spyOn(ComisionesComponent.prototype, 'ngOnInit');
    const alerts = {
      errorToast: jasmine.createSpy('errorToast'),
      successToast: jasmine.createSpy('successToast'),
      warningToast: jasmine.createSpy('warningToast'),
      confirmDecision: jasmine.createSpy('confirmDecision').and.resolveTo(true),
    };
    await TestBed.configureTestingModule({
      imports: [ComisionesComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: PermisosService, useValue: { tienePermiso: () => true } },
        { provide: SirAlertService, useValue: alerts },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesComponent);
    const component = fixture.componentInstance;
    component.catalogLoading = false;
    component.tours = [];
    component.canalesDisponibles = [];
    const service = TestBed.inject(ComisionesService);
    const loadProfile = spyOn(service, 'obtenerPerfilEntidad').and.returnValue(of(null));
    const createProfile = spyOn(service, 'crearPerfilEntidad').and.returnValue(of(profile()));
    const updateProfile = spyOn(service, 'actualizarPerfilEntidad').and.returnValue(of(profile()));
    const pay = spyOn(service, 'actualizarLiquidacion').and.returnValue(of({ updated: 1, montos: { TG12345: 10000 } }));
    const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    render();
    return { fixture, component, service, alerts, loadProfile, createProfile, updateProfile, pay, render };
  }

  it('representa Hotel y Agencia Nacional por el nombre de entidad, no por el contacto', async () => {
    const { fixture, component, render } = await mount();
    component.canales = [
      channel('HOTEL', 1, [group({ Nombre_Entidad: 'Hotel Dann Carlton', Nombre_Reportante: null })]),
      channel('AGENCIA NACIONAL', 2, [group({ Id_Entidad_Reportante: 22, Tipo_Entidad: 'AGENCIA_NACIONAL',
        Nombre_Entidad: 'Viajes Andinos', Nombre_Reportante: null })]),
    ];
    render();

    const titles = Array.from(fixture.nativeElement.querySelectorAll('.reporter-identity > strong') as NodeListOf<Element>)
      .map((element: Element) => element.textContent?.trim());
    expect(titles).toEqual(['Hotel Dann Carlton', 'Viajes Andinos']);
    expect(fixture.nativeElement.textContent).not.toContain('Nombre_Reportante');
  });

  it('mantiene varias reservas de Hotel juntas y separa Freelance homónimos por reserva', async () => {
    const { fixture, component, render } = await mount();
    const hotelGroup = group({ reservas: [reserve('H-1'), reserve('H-2')], Total_Reportante: 30000,
      Pendiente_Reportante: 30000 });
    const freelance = (id: string) => group({ Id_Entidad_Reportante: null, Tipo_Entidad: null,
      Nombre_Entidad: null, Nombre_Reportante: 'Juan Pérez', reservas: [reserve(id)],
      Total_Reportante: 10000, Pendiente_Reportante: 10000 });
    component.canales = [channel('HOTEL', 1, [hotelGroup]), channel('FREELANCE', 4, [freelance('F-1'), freelance('F-2')])];
    render();

    expect(fixture.nativeElement.querySelectorAll('.reporter-group').length).toBe(3);
    expect(fixture.nativeElement.querySelectorAll('.reservation-row').length).toBe(4);
    expect(component.trackGrupo(0, freelance('F-1'))).not.toBe(component.trackGrupo(1, freelance('F-2')));
    const freelanceGroups = Array.from(fixture.nativeElement.querySelectorAll('.reporter-group') as NodeListOf<Element>)
      .slice(1).map((element: Element) => element.textContent || '');
    expect(freelanceGroups.every(text => text.includes('Juan Pérez'))).toBeTrue();
  });

  it('no consulta ni ofrece un perfil reutilizable para Freelance', async () => {
    const { fixture, component, loadProfile, render } = await mount();
    const freelance = group({ Id_Entidad_Reportante: null, Tipo_Entidad: null, Nombre_Entidad: null,
      Nombre_Reportante: 'Juan Pérez', reservas: [reserve('TG12345')] });
    component.abrirPagoGrupo(freelance);
    render();

    expect(loadProfile).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.central-switch')).toBeNull();
    expect(fixture.nativeElement.querySelector('#payment-title')?.textContent).toContain('Juan Pérez');
    expect(fixture.nativeElement.textContent).toContain('Reserva TG12345');
  });

  it('carga el perfil existente de Hotel y precarga los datos de pago', async () => {
    const { fixture, component, loadProfile, render } = await mount();
    loadProfile.and.returnValue(of(profile()));
    const hotel = group();
    component.abrirPagoGrupo(hotel);
    await fixture.whenStable();
    render();

    expect(loadProfile).toHaveBeenCalledOnceWith(12);
    expect(component.panel.formaPago).toBe('NEQUI');
    expect(component.panel.cuenta).toBe('3001234567');
    expect(component.panel.nombreReceptor).toBe('Receptor del hotel');
    expect(component.panel.guardarPerfil).toBeTrue();
    expect((fixture.nativeElement.querySelector('.central-switch input') as HTMLInputElement).checked).toBeTrue();
  });

  it('usa la geometría compartida en los datos de pago en ambos temas', async () => {
    const { fixture, component, loadProfile, render } = await mount();
    loadProfile.and.returnValue(of(profile()));
    component.abrirPagoGrupo(group());
    await fixture.whenStable();
    render();
    const input = fixture.nativeElement.querySelector('#payment-account') as HTMLInputElement;
    expect(input.classList.contains('form-input')).toBeTrue();
    const style = getComputedStyle(input);
    expect(style.height).toBe('40px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('13px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');
    const originalTheme = document.documentElement.getAttribute('data-theme');
    const darkBackground = style.backgroundColor;
    try {
      document.documentElement.setAttribute('data-theme', 'light');
      await new Promise(resolve => setTimeout(resolve, 220));
      expect(getComputedStyle(input).backgroundColor).not.toBe(darkBackground);
    } finally {
      if (originalTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', originalTheme);
    }
    input.disabled = true;
    expect(getComputedStyle(input).opacity).toBe('0.72');
  });

  it('carga también el perfil existente de Agencia Nacional', async () => {
    const { component, loadProfile } = await mount();
    const agency = group({ Id_Entidad_Reportante: 22, Id_Perfil_Comision: 52, Tipo_Entidad: 'AGENCIA_NACIONAL',
      Nombre_Entidad: 'Viajes Andinos' });
    loadProfile.and.returnValue(of(profile({ Id_Perfil_Comision: 52, Id_Entidad_Reportante: 22,
      Tipo_Entidad: 'AGENCIA_NACIONAL', Nombre_Entidad: 'Viajes Andinos', Forma_Pago: 'EFECTIVO',
      Numero_Cuenta: null, Nombre_Receptor: 'Receptor agencia', DNI_Receptor: 'NIT-5678' })));
    component.abrirPagoGrupo(agency);
    await Promise.resolve();

    expect(loadProfile).toHaveBeenCalledOnceWith(22);
    expect(component.panel.formaPago).toBe('EFECTIVO');
    expect(component.panel.nombreReceptor).toBe('Receptor agencia');
  });

  it('permite ingresar datos sin perfil y crea el perfil al pagar si se marca guardar', async () => {
    const { component, loadProfile, createProfile, pay } = await mount();
    const hotel = group({ reservas: [reserve('H-1'), reserve('H-2')], Total_Reportante: 30000,
      Pendiente_Reportante: 30000 });
    loadProfile.and.returnValue(of(null));
    component.abrirPagoGrupo(hotel);
    await Promise.resolve();
    component.panel.formaPago = 'NEQUI';
    component.panel.cuenta = '3001234567';
    component.panel.nombreReceptor = 'Receptor nuevo';
    component.panel.dniReceptor = 'NIT-1234';
    component.panel.guardarPerfil = true;
    pay.and.returnValue(of({ updated: 2, montos: { 'H-1': 10000, 'H-2': 20000 } }));

    await component.registrarPagoActual();

    expect(createProfile).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      Id_Entidad_Reportante: 12, Forma_Pago: 'NEQUI', Numero_Cuenta: '3001234567',
      Nombre_Receptor: 'Receptor nuevo', DNI_Receptor: 'NIT-1234',
    }));
    expect(pay).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      Estado: 'PAGADO', reservas: ['H-1', 'H-2'],
    }));
    expect(hotel.reservas.map(item => item.Monto_Comision_Pagada)).toEqual([10000, 20000]);
    expect(hotel.reservas.every(item => item.Estado_Liquidacion === 'PAGADO')).toBeTrue();
  });

  it('actualiza el perfil existente antes del pago', async () => {
    const { component, loadProfile, createProfile, updateProfile } = await mount();
    loadProfile.and.returnValue(of(profile()));
    const hotel = group();
    component.abrirPagoGrupo(hotel);
    await Promise.resolve();
    component.panel.nombreReceptor = 'Receptor actualizado';
    component.panel.dniReceptor = 'NIT-4321';

    await component.registrarPagoActual();

    expect(updateProfile).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      Id_Perfil_Comision: 41, Id_Entidad_Reportante: 12, Nombre_Receptor: 'Receptor actualizado',
    }));
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('muestra el monto histórico de una comisión pagada en la fila y en el total pagado', async () => {
    const { fixture, component, render } = await mount();
    const paid = reserve('P-1', { Total_Comision: 12000, Monto_Comision_Pagada: 9500,
      Estado_Liquidacion: 'PAGADO', Fecha_Pago: '2026-10-16' });
    component.canales = [channel('HOTEL', 1, [group({ reservas: [paid], Total_Reportante: 12000,
      Pendiente_Reportante: 0, Pagado_Reportante: 9500 })])];
    render();

    expect(fixture.nativeElement.querySelector('.reservation-value')?.textContent).toContain(component.formatCOP(9500));
    expect(fixture.nativeElement.querySelector('.reporter-amounts')?.textContent).toContain(component.formatCOP(9500));
    expect(fixture.nativeElement.textContent).toContain('monto histórico');
  });

  it('reabre el grupo, borra monto histórico y vuelve a sumar la comisión dinámica', async () => {
    const { component, alerts, pay } = await mount();
    const paid = reserve('P-1', { Total_Comision: 12000, Monto_Comision_Pagada: 9500,
      Estado_Liquidacion: 'PAGADO', Fecha_Pago: '2026-10-16' });
    const hotel = group({ reservas: [paid], Total_Reportante: 12000, Pendiente_Reportante: 0, Pagado_Reportante: 9500 });
    component.canales = [channel('HOTEL', 1, [hotel])];
    pay.and.returnValue(of({ updated: 1 }));

    await component.reabrirGrupo(hotel);

    expect(alerts.confirmDecision).toHaveBeenCalled();
    expect(pay).toHaveBeenCalledOnceWith(jasmine.objectContaining({ Estado: 'PENDIENTE', reservas: ['P-1'] }));
    expect(paid.Estado_Liquidacion).toBe('PENDIENTE');
    expect(paid.Monto_Comision_Pagada).toBeNull();
    expect(hotel.Pagado_Reportante).toBe(0);
    expect(hotel.Pendiente_Reportante).toBe(12000);
  });

  it('respeta que el backend no devuelva AGENCIA_INTERNACIONAL', async () => {
    const { fixture, component, render } = await mount();
    component.canales = [channel('HOTEL', 1, [group()]), channel('AGENCIA NACIONAL', 2, [group({
      Id_Entidad_Reportante: 22, Tipo_Entidad: 'AGENCIA_NACIONAL', Nombre_Entidad: 'Viajes Andinos',
    })])];
    render();

    expect(fixture.nativeElement.textContent).not.toContain('AGENCIA INTERNACIONAL');
    expect(fixture.nativeElement.querySelectorAll('.channel-card').length).toBe(2);
  });

  it('deja registrar manualmente si falla la lectura del perfil y muestra errores del pago', async () => {
    const { fixture, component, loadProfile, alerts, pay, createProfile, render } = await mount();
    loadProfile.and.returnValue(throwError(() => ({ error: { message: 'Servicio de perfiles no disponible' } })));
    const hotel = group();
    component.abrirPagoGrupo(hotel);
    await Promise.resolve();
    render();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
      .toContain('Servicio de perfiles no disponible');
    expect(fixture.nativeElement.querySelector('.central-switch')).toBeNull();
    component.panel.formaPago = 'EFECTIVO';
    component.panel.nombreReceptor = 'Receptor manual';
    component.panel.dniReceptor = 'NIT-1234';
    pay.and.returnValue(throwError(() => ({ error: { message: 'No se pudo registrar el pago' } })));

    await component.registrarPagoActual();

    expect(createProfile).not.toHaveBeenCalled();
    expect(alerts.errorToast).toHaveBeenCalledWith('No pudimos registrar el pago', 'No se pudo registrar el pago');
  });

  it('mantiene loading mientras consulta el perfil y bloquea el pago hasta resolver', async () => {
    const { fixture, component, loadProfile, render } = await mount();
    const profileRequest = new Subject<PerfilComisionEntidad | null>();
    loadProfile.and.returnValue(profileRequest as Observable<PerfilComisionEntidad | null>);
    component.abrirPagoGrupo(group());
    render();

    expect(component.panel.perfilCargando).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Cargando los datos de pago');
    expect(fixture.nativeElement.querySelector('.sheet-footer .button--primary').disabled).toBeTrue();

    profileRequest.next(null);
    profileRequest.complete();
    await Promise.resolve();
    render();
    expect(component.panel.perfilCargando).toBeFalse();
    expect(fixture.nativeElement.querySelector('.sheet-footer .button--primary').disabled).toBeFalse();
  });
});
