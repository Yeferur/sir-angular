import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { TourProgramacion } from '../../../interfaces/Programacion/reservas';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { InicioService } from '../../../services/inicio';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { Listado } from './listado';

describe('Listado', () => {
  let programacionService: jasmine.SpyObj<ProgramacionDashboardService>;
  let router: jasmine.SpyObj<Router>;
  let routeSnapshot: {
    data: Record<string, unknown>;
    url: unknown[];
    paramMap: { get: (key: string) => string | null };
    queryParamMap: { get: (key: string) => string | null };
  };

  beforeEach(async () => {
    programacionService = jasmine.createSpyObj<ProgramacionDashboardService>(
      'ProgramacionDashboardService',
      ['obtenerListadoFinal', 'resumenPrivadosDia']
    );
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    routeSnapshot = {
      data: {},
      url: [],
      paramMap: { get: (): string | null => null },
      queryParamMap: { get: (): string | null => null },
    };

    await TestBed.configureTestingModule({
      imports: [Listado],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProgramacionDashboardService, useValue: programacionService },
        { provide: InicioService, useValue: {} },
        {
          provide: PermisosService,
          useValue: { tienePermiso: () => true },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: routeSnapshot },
        },
        {
          provide: Router,
          useValue: router,
        },
      ],
    }).compileComponents();
  });

  it('marca la vista antes de abrir el drawer de un listado guardado', () => {
    programacionService.obtenerListadoFinal.and.returnValue(of({
      exists: true,
      buses: [],
      reservasSinAsignar: [],
    }));

    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.isPageLoading = false;
    const drawer = TestBed.inject(SirDrawerService);
    const changeDetector = (component as any).cdr;
    const markForCheck = spyOn(changeDetector, 'markForCheck').and.callThrough();
    const openDrawer = spyOn(drawer, 'openProgramacionListado').and.callThrough();
    const tour: TourProgramacion = {
      Id_Tour: 7,
      NombreTour: 'Tour de prueba',
      estado: 'Generado',
      planGenerado: null,
      totalPasajeros: 4,
    };

    component.generarPlan(tour);

    expect(component.isPageLoading).toBeFalse();
    expect(component.editorLoadingMode).toBeNull();
    expect(markForCheck).toHaveBeenCalledBefore(openDrawer);
    expect(drawer.drawer()?.type).toBe('programacion-listado');
  });

  for (const estado of ['Generado', 'Confirmado'] as const) {
    it(`mantiene visible el dashboard mientras consulta un listado ${estado.toLowerCase()}`, () => {
      const response$ = new Subject<any>();
      programacionService.obtenerListadoFinal.and.returnValue(response$);

      const fixture = TestBed.createComponent(Listado);
      const component = fixture.componentInstance;
      component.isPageLoading = false;
      component.editorLoadingMode = null;
      const drawer = TestBed.inject(SirDrawerService);
      const openDrawer = spyOn(drawer, 'openProgramacionListado').and.callThrough();
      const tour: TourProgramacion = {
        Id_Tour: 7,
        NombreTour: 'Tour de prueba',
        estado,
        planGenerado: null,
        totalPasajeros: 4,
      };

      component.generarPlan(tour);

      expect(programacionService.obtenerListadoFinal).toHaveBeenCalled();
      expect(component.isPageLoading).toBeFalse();
      expect(component.editorLoadingMode).toBeNull();
      expect(openDrawer).not.toHaveBeenCalled();

      response$.next({
        exists: true,
        buses: [],
        reservasSinAsignar: [],
      });

      expect(component.isPageLoading).toBeFalse();
      expect(component.editorLoadingMode).toBeNull();
      expect(openDrawer).toHaveBeenCalledTimes(1);
      expect(drawer.drawer()?.type).toBe('programacion-listado');
    });
  }

  it('navega desde la card privada a su ruta fechada sin activar el loader del dashboard', () => {
    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.fechaSeleccionada = '2026-08-14';
    component.isPageLoading = false;
    component.busesPrivados = [{ Id_Reserva_Privada: 'TRC-1', ocupados: 4 }];

    component.abrirVistaPrivados();

    expect(component.isPageLoading).toBeFalse();
    expect(router.navigate).toHaveBeenCalledOnceWith([
      '/Programacion/Privados',
      '2026-08-14',
    ]);
  });

  it('recarga la ruta privada directamente y vuelve al dashboard conservando la fecha', () => {
    routeSnapshot.data = { programacionView: 'privados' };
    routeSnapshot.paramMap = {
      get: (key: string): string | null => key === 'fecha' ? '2026-08-15' : null,
    };
    const privateBuses = [{ Id_Reserva_Privada: 'TRC-2', ocupados: 7 }];
    programacionService.resumenPrivadosDia.and.returnValue(of({
      totalReservas: 1,
      totalBuses: 1,
      totalPax: 7,
      privados: privateBuses,
    }));

    const fixture = TestBed.createComponent(Listado);
    fixture.componentInstance.ngOnInit();
    const component = fixture.componentInstance;

    expect(component.modoVista).toBe('privados');
    expect(component.fechaSeleccionada).toBe('2026-08-15');
    expect(component.isPageLoading).toBeFalse();
    expect(component.busesPrivados).toEqual(privateBuses);
    expect(programacionService.resumenPrivadosDia).toHaveBeenCalledOnceWith('2026-08-15');
    expect(programacionService.obtenerListadoFinal).not.toHaveBeenCalled();

    component.volverAlDashboard();

    expect(router.navigate).toHaveBeenCalledOnceWith(
      ['/Programacion/Listado'],
      {
        queryParams: { fecha: '2026-08-15' },
        replaceUrl: false,
      }
    );
  });

  it('rechaza una fecha privada inválida sin consultar ni guardar sobre el día actual', () => {
    routeSnapshot.data = { programacionView: 'privados' };
    routeSnapshot.paramMap = {
      get: (key: string): string | null => key === 'fecha' ? '2026-02-31' : null,
    };

    const fixture = TestBed.createComponent(Listado);
    fixture.componentInstance.ngOnInit();

    expect(programacionService.resumenPrivadosDia).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledOnceWith(
      ['/Programacion/Listado'],
      {
        queryParams: { fecha: jasmine.any(String) },
        replaceUrl: true,
      }
    );
  });

  it('advierte al navegador antes de recargar cuando Privados tiene cambios', () => {
    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.privateDirty = true;

    component.beforeUnload(event);

    expect(event.defaultPrevented).toBeTrue();
  });

});
