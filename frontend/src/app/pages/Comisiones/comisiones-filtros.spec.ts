import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { ComisionesComponent } from './comisiones';
import { ComisionesService, ComisionCanal } from '../../services/Comisiones/comisiones.service';
import { ConfirmacionService } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

describe('Comisiones: filtros', () => {
  async function mount(query: Record<string, string> = {}) {
    spyOn(ComisionesComponent.prototype, 'ngOnInit');
    await TestBed.configureTestingModule({
      imports: [ComisionesComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: PermisosService, useValue: { tienePermiso: () => true } },
        { provide: SirAlertService, useValue: { errorToast() {}, successToast() {} } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ComisionesComponent);
    const component = fixture.componentInstance;
    component.catalogLoading = false;
    component.tours = [{ Id_Tour: 7, Nombre_Tour: 'Tour 7' }];
    component.canalesDisponibles = [{ Id_Canal: 3, Nombre_Canal: 'Agencia' }];
    fixture.detectChanges();
    const commissions = spyOn(TestBed.inject(ComisionesService), 'listarComisiones');
    spyOn(TestBed.inject(ConfirmacionService), 'getEstado').and.returnValue(of(null as any));
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
    const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    return { fixture, component, commissions, navigate, render };
  }

  it('aplica Canal y Estado solo al buscar y quita cada filtro desde su pill', async () => {
    const { fixture, component, commissions, navigate, render } = await mount();
    const response = new Subject<ComisionCanal[]>();
    commissions.and.returnValues(response, of([]));
    component.actualizarFiltro('fecha', '2026-10-14');
    component.actualizarFiltro('idTour', '7');
    component.actualizarFiltro('idCanal', '3');
    component.actualizarFiltro('filtroEstado', 'PENDIENTE');
    render();

    expect(component.activeAdvancedFilters).toBe(0);
    expect(fixture.nativeElement.querySelector('.active-filters')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    component.buscar();
    expect(commissions.calls.mostRecent().args[0]).toEqual({ Fecha: '2026-10-14', Id_Tour: '7', Id_Canal: '3', Estado: 'PENDIENTE' });
    expect(component.activeAdvancedFilters).toBe(0);
    response.next([]);
    response.complete();
    render();

    expect(component.activeAdvancedFilters).toBe(2);
    expect(fixture.nativeElement.querySelector('.active-filters').textContent).toContain('Canal: Agencia');
    expect(fixture.nativeElement.querySelector('.active-filters').textContent).toContain('Estado: Pendiente');
    expect(navigate.calls.mostRecent().args[1]?.queryParams).toEqual(jasmine.objectContaining({
      fechaTour: '2026-10-14', tour: '7', canal: '3', estado: 'PENDIENTE', buscar: 1,
    }));

    component.actualizarFiltro('idCanal', '');
    expect(component.activeAdvancedFilters).toBe(2);
    expect(fixture.nativeElement.querySelector('.clear-filters-link')).toBeNull();
    commissions.and.returnValue(of([]));
    fixture.nativeElement.querySelector('.active-filters .remove-token-btn').click();
    render();
    expect(commissions.calls.mostRecent().args[0]).toEqual({ Fecha: '2026-10-14', Id_Tour: '7', Id_Canal: undefined, Estado: 'PENDIENTE' });
    expect(component.activeAdvancedFilters).toBe(1);
    fixture.nativeElement.querySelector('.active-filters .remove-token-btn').click();
    render();
    expect(commissions.calls.mostRecent().args[0]).toEqual({ Fecha: '2026-10-14', Id_Tour: '7', Id_Canal: undefined, Estado: '' });
    expect(component.activeAdvancedFilters).toBe(0);
    expect(fixture.nativeElement.querySelector('.active-filters')).toBeNull();
    expect(navigate.calls.mostRecent().args[1]?.queryParams).toEqual(jasmine.objectContaining({
      fechaTour: '2026-10-14', tour: '7', canal: null, estado: null, buscar: 1,
    }));
  });

  it('restaura los query params existentes y mantiene el panel cerrado con pills aplicadas', async () => {
    const { fixture, component, commissions, render } = await mount({
      fechaTour: '2026-10-14', tour: '7', canal: '3', estado: 'PAGADO', buscar: '1',
    });
    commissions.and.returnValue(of([]));
    expect((component as any).restoreFiltersFromQuery()).toBeTrue();
    component.buscar(false);
    render();

    expect(commissions.calls.mostRecent().args[0]).toEqual({ Fecha: '2026-10-14', Id_Tour: '7', Id_Canal: '3', Estado: 'PAGADO' });
    expect(component.showAdvancedFilters).toBeFalse();
    expect(component.activeAdvancedFilters).toBe(2);
    expect(fixture.nativeElement.querySelector('.active-filters').textContent).toContain('Estado: Pagada');
    expect(fixture.nativeElement.querySelector('#commission-extra-filters')).toBeNull();

    const toggle = fixture.nativeElement.querySelector('.btn-filter');
    expect(toggle.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(toggle.querySelector('svg line')?.getAttribute('x1')).toBe('4');
    component.toggleAdvancedFilters();
    render();
    expect(fixture.nativeElement.querySelector('#commission-extra-filters')?.classList.contains('advanced-filters-panel')).toBeTrue();
    component.toggleAdvancedFilters();
    render();
    expect(fixture.nativeElement.querySelector('#commission-extra-filters')).toBeNull();
  });

  it('muestra carga local real y evita una segunda búsqueda mientras la request sigue activa', async () => {
    const { fixture, component, commissions, render } = await mount();
    const response = new Subject<ComisionCanal[]>();
    commissions.and.returnValue(response);

    expect(fixture.nativeElement.querySelector('app-query-empty-state h3')?.textContent).toContain('Listo para buscar');
    component.buscar();
    render();

    const button = fixture.nativeElement.querySelector('.reservation-search-button');
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.btn-spinner--active')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.loading-state')?.textContent).toContain('Buscando comisiones');
    expect(fixture.nativeElement.querySelector('app-query-empty-state')).toBeNull();
    component.buscar();
    expect(commissions).toHaveBeenCalledTimes(1);

    response.next([]);
    response.complete();
    render();
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(fixture.nativeElement.querySelector('app-query-empty-state h3')?.textContent).toContain('No hay comisiones registradas');
  });

  it('conserva resultados al actualizar y muestra el error local al fallar', async () => {
    const { fixture, component, commissions, render } = await mount();
    const refresh = new Subject<ComisionCanal[]>();
    commissions.and.returnValues(of([{ Id_Canal: 3, Nombre_Canal: 'Agencia', Total_Canal: 0,
      Pendiente_Canal: 0, Pagado_Canal: 0, grupos: [] }]), refresh);

    component.buscar();
    render();
    component.buscar();
    render();
    expect(fixture.nativeElement.querySelector('.updating-pill')?.textContent).toContain('Actualizando');
    expect(fixture.nativeElement.querySelector('.results-list--updating')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.channel-card')).not.toBeNull();

    refresh.error(new Error('Falló la consulta'));
    render();
    expect(component.isSearching).toBeFalse();
    expect(fixture.nativeElement.querySelector('.results-list--updating')).toBeNull();
    expect(fixture.nativeElement.querySelector('.results-notice--error')?.textContent).toContain('Falló la consulta');
    expect(fixture.nativeElement.querySelector('.channel-card')).not.toBeNull();
  });

  it('retira la carga al fallar la primera búsqueda y ofrece reintentar', async () => {
    const { fixture, component, commissions, render } = await mount();
    const response = new Subject<ComisionCanal[]>();
    commissions.and.returnValue(response);

    component.buscar();
    render();
    response.error(new Error('Sin conexión'));
    render();

    expect(component.isSearching).toBeFalse();
    expect(fixture.nativeElement.querySelector('.reservation-search-button').disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.loading-state[data-mode="error"]')?.textContent).toContain('Sin conexión');
    expect(fixture.nativeElement.querySelector('#commissions-ready-title')).toBeNull();
  });
});
