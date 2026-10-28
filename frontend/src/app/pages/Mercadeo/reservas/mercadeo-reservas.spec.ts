import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { MercadeoReservasComponent } from './mercadeo-reservas';
import { MercadeoService, MercadeoOrigenPage } from '../../../services/Mercadeo/mercadeo.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';

registerLocaleData(localeEsCO);

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

  it('muestra la entidad seleccionada como pill activa y la incluye en el conteo', async () => {
    component.setFilter('idEntidadReportante', '7');
    component.entitySearch.set('Hotel Niño');
    component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.filterCount()).toBe(1);
    expect(fixture.nativeElement.querySelector('.active-filter-tokens .filter-token')?.textContent).toContain('Entidad: Hotel Niño');
  });

  it('restaura Transfers desde la ruta anterior y ejecuta la consulta', async () => {
    params.next(convertToParamMap({ tipo: 'Transfers', consultar: '1', vista: 'origen' }));
    await fixture.whenStable();

    expect(api.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'TRANSFER' }), 1, 25);
    expect(component.appliedFilters().tipo).toBe('TRANSFER');
  });

  it('mantiene una tabla compacta con Estado visible y exportación Excel', async () => {
    api.buscarOrigen.and.returnValue(of({
      ...emptyPage,
      items: [{ tipo: 'RESERVA', id_operacion: 'R-1', id_reserva: 'R-1', id_transfer: null,
        fecha_registro: '2026-10-27T10:00:00', fecha_servicio: '2026-11-01', id_canal: 1,
        canal: 'Hotel', id_entidad_reportante: 7, entidad: 'Hotel Niño', tipo_entidad: 'HOTEL',
        nombre_reportante: 'Andrea', telefono_reportante: '300', creador_id: 8, creador: 'Mercadeo',
        pasajeros: 2, estado: 'Confirmada', pendiente_por_entidad_en: null }],
      page: 1, totalPages: 1, totalOperaciones: 1, totalPasajeros: 2, totalPasajerosEnPagina: 2,
    }));
    component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    const headers = Array.from(html.querySelectorAll('.origin-table th')).map(cell => cell.textContent?.trim());
    expect(headers).toEqual(['Tipo', 'Código', 'Creación', 'Fecha del servicio', 'Pasajeros', 'Canal', 'Entidad reportante', 'Estado']);
    expect(headers).not.toContain('Quién reportó');
    expect(html.querySelector('.sir-results-heading')).not.toBeNull();
    expect(html.querySelector('.origin-table td:last-child')?.textContent).toContain('Confirmada');
    expect(html.querySelector('.sir-results-heading button')?.textContent).toContain('Exportar Excel');
    expect(html.querySelector('.sir-results-heading .bx-download')).not.toBeNull();
  });
});
