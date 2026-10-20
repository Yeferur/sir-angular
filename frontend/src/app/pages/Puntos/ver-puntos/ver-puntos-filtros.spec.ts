import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { EMPTY, of, Subject } from 'rxjs';
import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { SirSelectComponent } from '../../../shared/select/select';
import { VerPuntos } from './ver-puntos';

describe('VerPuntos: consulta y filtros', () => {
  let fixture: ComponentFixture<VerPuntos>;
  let component: VerPuntos;
  let service: jasmine.SpyObj<puntosService>;
  let router: jasmine.SpyObj<Router>;
  let drawer: jasmine.SpyObj<SirDrawerService>;
  let canReadReservations = true;

  const result = { data: [] as Punto[], total: 0, page: 1, limit: 10 };

  beforeEach(() => { canReadReservations = true; });

  async function mount(params: Record<string, string> = {}, points: Punto[] = []): Promise<void> {
    service = jasmine.createSpyObj<puntosService>('puntosService', ['getRutasPuntos', 'getPuntos', 'exportarExcel']);
    service.getRutasPuntos.and.returnValue(of(['1', '2', 'PENDIENTE']));
    service.getPuntos.and.callFake((page) => of({ ...result, data: points,
      total: points.length ? 26 : 0, page }));
    drawer = jasmine.createSpyObj<SirDrawerService>('SirDrawerService', ['openReservasPunto']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [VerPuntos],
      providers: [
        provideZonelessChangeDetection(),
        { provide: puntosService, useValue: service },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        { provide: PermisosService, useValue: { tienePermiso: (code: string) =>
          code !== 'PUNTOS.RESERVAS.LEER' || canReadReservations } },
        { provide: SirDrawerService, useValue: drawer },
        { provide: SirAlertService, useValue: { errorToast() {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VerPuntos);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('muestra Reservas asociadas solo con permiso y abre el drawer sin alterar el listado', async () => {
    canReadReservations = true;
    await mount({ pagina: '2', ruta: '1' }, [{ Id_Punto: 12, Nombre_Punto: 'Estación Poblado' }]);
    const action = fixture.nativeElement.querySelector('.btn-row-reservas') as HTMLButtonElement;
    expect(action?.textContent).toContain('Reservas asociadas');
    const initialCalls = service.getPuntos.calls.count();
    action.click();
    expect(drawer.openReservasPunto).toHaveBeenCalledWith(12, 'Estación Poblado');
    expect(service.getPuntos.calls.count()).toBe(initialCalls);
    expect(component.page()).toBe(2);
    canReadReservations = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.btn-row-reservas')).toBeNull();
    component.verReservasPunto({ Id_Punto: 12, Nombre_Punto: 'Estación Poblado' });
    expect(drawer.openReservasPunto).toHaveBeenCalledTimes(1);
  });

  it('ubica las acciones del listado junto al total y fuera de la búsqueda', async () => {
    await mount();
    expect(service.getPuntos).toHaveBeenCalledWith(1, 10, '', '', []);
    expect(fixture.nativeElement.querySelector('.search-input')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ver-puntos-ruta')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ver-puntos-pendientes')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.reservation-search-button')).toBeNull();
    const toolbar = fixture.nativeElement.querySelector('.points-results-toolbar') as HTMLElement;
    expect(toolbar.textContent).toContain('0 puntos');
    expect(Array.from(toolbar.querySelectorAll('button')).map(button => button.textContent?.trim()))
      .toEqual(['Ordenar puntos', 'Exportar Excel']);
    expect(fixture.nativeElement.querySelector('.reservation-search-panel .points-result-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.route-filter-inline svg')).toBeNull();
  });

  it('ofrece creación solo cuando una búsqueda textual aplicada queda vacía', async () => {
    await mount();
    const create = () => fixture.nativeElement.querySelector('.empty-state .btn-primary') as HTMLButtonElement | null;
    expect(create()).toBeNull();
    component.onRouteChange('2');
    fixture.detectChanges();
    expect(create()).toBeNull();
    component.onRouteChange('');
    component.onPendingChange('sin-ruta');
    fixture.detectChanges();
    expect(create()).toBeNull();
    component.onSearchInput('Inexistente');
    component.submitSearch();
    fixture.detectChanges();
    expect(create()?.textContent).toContain('Crear punto de encuentro');
  });

  it('usa el mismo select simple de Ruta y aplica cada opción al elegirla', async () => {
    await mount();
    const select = fixture.debugElement.queryAll(By.directive(SirSelectComponent))
      .map(item => item.componentInstance as SirSelectComponent)
      .find(item => item.inputId === 'ver-puntos-pendientes')!;
    select.choose(1);
    fixture.detectChanges();
    expect(select.multiple).toBeFalse();
    expect(component.selectedPending).toBe('sin-ruta');
    expect(component.appliedFilters().pendientes).toEqual(['sin-ruta']);
    select.choose(2);
    fixture.detectChanges();
    expect(component.selectedPending).toBe('sin-horario');
    expect(component.appliedFilters().pendientes).toEqual(['sin-horario']);
    select.choose(0);
    fixture.detectChanges();
    expect(component.selectedPending).toBe('');
    expect(component.appliedFilters().pendientes).toEqual([]);
  });

  it('convierte la ruta PENDIENTE antigua en Sin ruta y no la repite en Ruta', async () => {
    await mount({ ruta: 'PENDIENTE' });
    expect(component.selectedRoute).toBe('');
    expect(component.selectedPending).toBe('sin-ruta');
    expect(service.getPuntos.calls.mostRecent().args).toEqual([1, 10, '', '', ['sin-ruta']]);
    expect(component.rutaSelectOptions().some(option => option.value === 'PENDIENTE')).toBeFalse();
  });

  it('aplica Ruta y Pendientes al cambiar, y el texto al pulsar Enter', async () => {
    await mount();
    const initialCalls = service.getPuntos.calls.count();
    component.onRouteChange('2');
    expect(service.getPuntos.calls.count()).toBe(initialCalls + 1);
    component.onPendingChange('sin-horario');
    expect(service.getPuntos.calls.count()).toBe(initialCalls + 2);
    component.onSearchInput('Centro');
    expect(service.getPuntos.calls.count()).toBe(initialCalls + 2);
    component.submitSearch();
    expect(service.getPuntos.calls.mostRecent().args).toEqual([1, 10, 'Centro', '2', ['sin-horario']]);
    expect(component.appliedFilters()).toEqual({ q: 'Centro', ruta: '2', pendientes: ['sin-horario'] });
    expect(router.navigate.calls.mostRecent().args[1]?.queryParams).toEqual(jasmine.objectContaining({
      q: 'Centro', ruta: '2', pendientes: 'sin-horario', pagina: null,
    }));
  });

  it('permite Ruta sola y Pendientes solos, y restaura filtros de la URL', async () => {
    await mount({ ruta: '2', pendientes: 'sin-ruta', pagina: '2' });
    expect(service.getPuntos.calls.mostRecent().args).toEqual([2, 10, '', '2', ['sin-ruta']]);
    component.onRouteChange('1');
    component.onPendingChange('');
    expect(service.getPuntos.calls.mostRecent().args).toEqual([1, 10, '', '1', []]);
    component.onRouteChange('');
    component.onPendingChange('sin-coordenadas');
    expect(service.getPuntos.calls.mostRecent().args).toEqual([1, 10, '', '', ['sin-coordenadas']]);
  });

  it('reemplaza la consulta anterior al cambiar el filtro y muestra loading local', async () => {
    await mount();
    const first = new Subject<typeof result>();
    const second = new Subject<typeof result>();
    service.getPuntos.and.returnValues(first.asObservable(), second.asObservable());
    component.onPendingChange('sin-ruta');
    fixture.detectChanges();
    const count = service.getPuntos.calls.count();
    expect(component.isSearching()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Buscando puntos de encuentro');
    expect(fixture.nativeElement.textContent).not.toContain('Sin puntos encontrados');
    component.onPendingChange('sin-coordenadas');
    expect(service.getPuntos.calls.count()).toBe(count + 1);
    expect(first.observers.length).toBe(0);
    second.next(result);
    second.complete();
    fixture.detectChanges();
    expect(component.isSearching()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Sin puntos encontrados');
  });

  it('conserva criterios aplicados entre páginas y vuelve a página 1 con nueva búsqueda', async () => {
    await mount();
    component.onRouteChange('2');
    component.onPendingChange('sin-horario');
    component.totalPages.set(3);
    component.nextPage();
    expect(service.getPuntos.calls.mostRecent().args).toEqual([2, 10, '', '2', ['sin-horario']]);
    component.onSearchInput('Centro');
    component.submitSearch();
    expect(service.getPuntos.calls.mostRecent().args).toEqual([1, 10, 'Centro', '2', ['sin-horario']]);
  });

  it('exporta con los criterios aplicados, sin tomar cambios del borrador', async () => {
    await mount();
    service.exportarExcel.and.returnValue(EMPTY);
    component.onRouteChange('2');
    component.onPendingChange('sin-coordenadas');
    component.onSearchInput('borrador');
    component.descargarExcel();
    expect(service.exportarExcel).toHaveBeenCalledWith('', '2', ['sin-coordenadas']);
  });
});
