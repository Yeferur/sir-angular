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
      'getCategorias', 'getUsuarios', 'buscarEntidadesReportantes', 'buscarOrigen', 'exportarOrigen',
    ]);
    api.getCategorias.and.returnValue(of([{ Id_Canal: 1, Nombre_Canal: 'Hotel' }]));
    api.getUsuarios.and.returnValue(of([{ Id_Usuario: 8, Nombres_Apellidos: 'Usuario Uno', Activo: 1 }]));
    api.buscarEntidadesReportantes.and.returnValue(of([]));
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

  it('muestra el estado inicial compartido y no agrega una acción de limpiar filtros', () => {
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Listo para buscar');
    expect(html.querySelector('button[aria-label*="limpiar filtros" i]')).toBeNull();
    expect(html.textContent).not.toContain('Preparando…');
  });

  it('consulta origen unificado y sincroniza el tipo seleccionado en la URL', async () => {
    component.setFilter('tipo', 'RESERVA');
    component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'RESERVA' }), 1, 25);
    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: jasmine.objectContaining({ tipo: 'RESERVA', vista: 'origen', consultar: '1' }),
      queryParamsHandling: 'merge',
    }));
  });

  it('restaura Transfers desde la ruta anterior y ejecuta la consulta', async () => {
    params.next(convertToParamMap({ tipo: 'Transfers', consultar: '1', vista: 'origen' }));
    await fixture.whenStable();

    expect(api.buscarOrigen).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'TRANSFER' }), 1, 25);
    expect(component.appliedFilters().tipo).toBe('TRANSFER');
  });
});
