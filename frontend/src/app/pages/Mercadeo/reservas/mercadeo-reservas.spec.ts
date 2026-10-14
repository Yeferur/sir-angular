import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MercadeoReservasComponent } from './mercadeo-reservas';
import { MercadeoPage, MercadeoService } from '../../../services/Mercadeo/mercadeo.service';
import { routes } from '../../../app.routes';
import { permisoGuard } from '../../../guards/permission.guard';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import localeEsCO from '@angular/common/locales/es-CO';

registerLocaleData(localeEsCO);

const result: MercadeoPage = {
  page: 1, pageSize: 25, totalPages: 4, totalReservas: 80, totalPasajeros: 88,
  items: [
    { Id_Reserva: 'MK-A', Fecha_Registro: '2026-08-10T09:30:00', Fecha_Tour: '2026-09-04', NombreReporta: 'Agencia', Telefono: '3001234567', Categoria: 'AGENCIA', CreadorId: 1, UsuarioCreador: 'Usuario Uno', pasajeros: [{ id: 1, nombre: 'Ana', documento: 'CC-1' }] },
    { Id_Reserva: 'MK-B', Fecha_Registro: '2026-08-11T10:00:00', Fecha_Tour: '2026-09-05', NombreReporta: 'Contacto', Telefono: null, Categoria: 'WEB', CreadorId: null, UsuarioCreador: null, pasajeros: [{ id: 2, nombre: 'Luis', documento: null }] },
  ],
};

describe('MercadeoReservasComponent', () => {
  let fixture: ComponentFixture<MercadeoReservasComponent>;
  let component: MercadeoReservasComponent;
  let api: jasmine.SpyObj<MercadeoService>;
  let permissions: { asegurarPermisosCargados: jasmine.Spy; tieneAlgunPermiso: jasmine.Spy; tieneTodosPermisos: jasmine.Spy };
  let alerts: { errorToast: jasmine.Spy };

  beforeEach(async () => {
    api = jasmine.createSpyObj<MercadeoService>('MercadeoService', ['getCategorias', 'buscar']);
    api.getCategorias.and.returnValue(of([{ Id_Canal: 1, Nombre_Canal: 'AGENCIA' }]));
    api.buscar.and.returnValue(of(result));
    permissions = {
      asegurarPermisosCargados: jasmine.createSpy().and.resolveTo(true),
      tieneAlgunPermiso: jasmine.createSpy().and.returnValue(true),
      tieneTodosPermisos: jasmine.createSpy().and.returnValue(true),
    };
    alerts = { errorToast: jasmine.createSpy() };
    await TestBed.configureTestingModule({
      imports: [MercadeoReservasComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]),
        { provide: MercadeoService, useValue: api },
        { provide: PermisosService, useValue: permissions },
        { provide: SirAlertService, useValue: alerts }],
    }).compileComponents();
    fixture = TestBed.createComponent(MercadeoReservasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga categorías y consulta con page size 25 mostrando resultados y creadores', () => {
    expect(api.getCategorias).toHaveBeenCalled();
    expect(component.categoryOptions().map((option) => option.label)).toEqual(['Todas las categorías', 'AGENCIA']);
    component.search();
    fixture.detectChanges();
    expect(api.buscar).toHaveBeenCalledWith(jasmine.objectContaining({ codigoReserva: '' }), 1, 25);
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('80 reservas · 88 pasajeros');
    expect(html.textContent).toContain('Usuario Uno');
    expect(html.textContent).toContain('No disponible');
    expect(html.textContent).toContain('Quién reporta');
    expect(html.querySelector('h1')).toBeNull();
    expect(html.querySelector('.marketing-tabs')).toBeNull();
    expect(html.querySelector('.marketing-summary')).toBeNull();
    expect(html.querySelector('app-date-range-picker')).not.toBeNull();
    expect(html.querySelector('app-search-input')).not.toBeNull();
    expect(html.querySelector('app-filter-bar')).not.toBeNull();
  });

  it('envía filtros activos, avanza de página y reinicia a página 1 al buscar filtros cambiados', () => {
    component.setFilter('fechaRegistroDesde', '2026-08-01');
    component.setFilter('fechaRegistroHasta', '2026-08-31');
    component.setFilter('fechaTour', '2026-09-04');
    component.setFilter('codigoReserva', 'MK-A');
    component.setFilter('categoria', '1');
    component.setFilter('nombrePasajero', 'Ana');
    component.setFilter('documento', 'CC-1');
    component.search();
    expect(api.buscar.calls.mostRecent().args[0]).toEqual({
      fechaRegistroDesde: '2026-08-01', fechaRegistroHasta: '2026-08-31', fechaTour: '2026-09-04',
      codigoReserva: 'MK-A', categoria: '1', nombrePasajero: 'Ana', documento: 'CC-1',
    });
    component.changePage(2);
    expect(api.buscar.calls.mostRecent().args[1]).toBe(2);
    component.setFilter('codigoReserva', 'MK-B');
    component.search();
    expect(api.buscar.calls.mostRecent().args[1]).toBe(1);
  });

  it('limpia filtros/resultados y muestra estado vacío y error del backend', () => {
    component.search();
    component.clearFilters();
    expect(component.filters().codigoReserva).toBe('');
    expect(component.result()).toBeNull();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Prepara tu consulta');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-query-empty-state')).not.toBeNull();

    api.buscar.and.returnValue(of({ ...result, items: [], totalReservas: 0, totalPasajeros: 0 }));
    component.search();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sin resultados');

    api.buscar.and.returnValue(throwError(() => ({ error: { message: 'Backend no disponible' } })));
    component.search();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Backend no disponible');
  });

  it('protege la ruta con el permiso granular de Mercadeo y rechaza acceso directo sin permiso', async () => {
    const route = routes.find((item) => item.path === 'Mercadeo/Reservas');
    expect(route?.data?.['permiso']).toBe('MERCADEO.RESERVAS.LEER');
    expect(route?.title).toBe('Mercadeo');
    expect(route?.canActivate).toBeTruthy();
    const snapshot = route as unknown as ActivatedRouteSnapshot;
    const state = { url: '/Mercadeo/Reservas' } as RouterStateSnapshot;
    const allowed = await TestBed.runInInjectionContext(() => permisoGuard(snapshot, state));
    expect(allowed).toBeTrue();
    permissions.tieneAlgunPermiso.and.returnValue(false);
    const denied = await TestBed.runInInjectionContext(() => permisoGuard(snapshot, state));
    expect(denied instanceof UrlTree).toBeTrue();
    expect(alerts.errorToast).toHaveBeenCalled();
  });
});
