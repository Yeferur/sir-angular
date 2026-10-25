import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { MercadeoReservasComponent } from './mercadeo-reservas';
import { MercadeoService, MercadeoOrigenPage } from '../../../services/Mercadeo/mercadeo.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';

const emptyPage: MercadeoOrigenPage = {
  items: [], page: 1, pageSize: 25, totalPages: 0, totalOperaciones: 0,
  totalPasajeros: 0, totalPasajerosEnPagina: 0, tipo: 'TODOS',
};

describe('MercadeoReservasComponent', () => {
  let fixture: ComponentFixture<MercadeoReservasComponent>;
  let component: MercadeoReservasComponent;
  let api: jasmine.SpyObj<MercadeoService>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: Router;

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    api = jasmine.createSpyObj<MercadeoService>('MercadeoService', [
      'getCategorias', 'getUsuarios', 'buscarOrigen', 'exportarOrigen',
    ]);
    api.getCategorias.and.returnValue(of([{ Id_Canal: 1, Nombre_Canal: 'Hotel' }]));
    api.getUsuarios.and.returnValue(of([{ Id_Usuario: 8, Nombres_Apellidos: 'Usuario Uno', Activo: 1 }]));
    api.buscarOrigen.and.returnValue(of(emptyPage));
    api.exportarOrigen.and.returnValue(of(new Blob()));

    await TestBed.configureTestingModule({
      imports: [MercadeoReservasComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: params.asObservable() } },
        { provide: MercadeoService, useValue: api },
        { provide: PermisosService, useValue: { tienePermiso: (code: string) => code === 'MERCADEO.EXPORTAR' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MercadeoReservasComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture.detectChanges();
  });

  it('muestra el estado vacío, sin búsqueda de entidad ni acción global para limpiar', () => {
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Listo para buscar');
    expect(html.querySelector('button[aria-label*="limpiar filtros" i]')).toBeNull();
    expect(html.textContent).not.toContain('Preparando…');
    expect(html.querySelector('app-search-input')).toBeNull();
    expect(html.textContent).toContain('Aplicar');
    expect(html.textContent).not.toContain('Entidad reportante');
  });

  it('inicia sin período implícito', () => {
    const filters = component.filters();
    expect(filters.fechaRegistroDesde).toBe('');
    expect(filters.fechaRegistroHasta).toBe('');
  });

  it('mantiene el multiselect de creadores en la geometría de SirSelect', () => {
    component.filtersOpen.set(true);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('#marketing-creators') as HTMLButtonElement;
    const style = getComputedStyle(trigger);
    expect(style.height).toBe('40px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('13px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');

    trigger.click(); fixture.detectChanges();
    const list = document.querySelector<HTMLElement>('.sir-select-overlay-panel .sir-select-list')!;
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(getComputedStyle(list).borderTopWidth).toBe('1px');
    expect(getComputedStyle(list).borderRadius).toBe('12px');
  });

  it('ubica las pills en el buscador, cierra filtros al aplicar y muestra solo el vacío cuando no hay operaciones', async () => {
    component.filtersOpen.set(true);
    component.setFilter('tipo', 'TRANSFER');
    component.search();
    await fixture.whenStable();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(component.filtersOpen()).toBeFalse();
    expect(html.querySelector('.reservation-search-panel .filter-token')?.textContent).toContain('Transfers');
    expect(html.textContent).toContain('Sin coincidencias');
    expect(html.querySelector('.results-heading')).toBeNull();
    expect(html.textContent).not.toContain('Exportar detalle');
  });

  it('consulta origen unificado y sincroniza el tipo seleccionado en la URL', async () => {
    component.setFilter('tipo', 'RESERVA');
    component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'RESERVA' }), 1, 25);
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: jasmine.objectContaining({ tipo: 'RESERVA', consultar: '1' }),
      queryParamsHandling: 'merge',
    }));
    const navigation = (router.navigate as jasmine.Spy).calls.mostRecent().args[1] as any;
    expect(navigation.queryParams.vista).toBeUndefined();
    expect(navigation.queryParams.idEntidadReportante).toBeNull();
  });

  it('restaura Transfers desde la ruta anterior y ejecuta la consulta', async () => {
    params.next(convertToParamMap({ tipo: 'Transfers', consultar: '1', vista: 'origen' }));
    await fixture.whenStable();

    expect(api.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'TRANSFER' }), 1, 25);
    expect(component.appliedFilters().tipo).toBe('TRANSFER');
  });
});
