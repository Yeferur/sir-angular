import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { TourProgramacion } from '../../../interfaces/Programacion/reservas';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import {
  ProgramacionDashboardService,
  TransfersProgramacionResponse,
} from '../../../services/Programacion/programacion';
import { Listado } from './listado';

describe('Listado', () => {
  let programacionService: jasmine.SpyObj<ProgramacionDashboardService>;
  let router: jasmine.SpyObj<Router>;
  let grantedPermissions: Set<string>;
  let routeSnapshot: {
    data: Record<string, unknown>;
    url: unknown[];
    paramMap: { get: (key: string) => string | null };
    queryParamMap: { get: (key: string) => string | null };
  };

  beforeEach(async () => {
    programacionService = jasmine.createSpyObj<ProgramacionDashboardService>(
      'ProgramacionDashboardService',
      [
        'obtenerListadoFinal',
        'obtenerResumenDashboard',
        'resumenPrivadosDia',
        'obtenerTransfersDia',
        'generarPlanLogistico',
        'exportarTransfersDia',
        'exportarListadoBus',
        'exportarListadosZip',
      ]
    );
    grantedPermissions = new Set(['PROGRAMACION.LEER', 'PROGRAMACION.EXPORTAR']);
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
        {
          provide: PermisosService,
          useValue: { tienePermiso: (permission: string) => grantedPermissions.has(permission) },
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

  it('carga métricas, tours combinados, estados, Privados y Transfers desde fuentes de Programación', () => {
    const privateBuses = [{ Id_Reserva_Privada: 'P-1', Nombre_Tour: 'Medellín', ocupados: 3 }];
    const transfers: TransfersProgramacionResponse = {
      fecha: '2026-09-20',
      totalTransfers: 2,
      totalPasajeros: 5,
      totalServicios: 1,
      totalPendientes: 1,
      servicios: [{
        servicio: 'Aeropuerto a hotel',
        totalTransfers: 2,
        totalPasajeros: 5,
        pendientes: 1,
        primeraRecogida: null,
        ultimaRecogida: null,
      }],
      transfers: [],
    };
    programacionService.obtenerResumenDashboard.and.returnValue(of([
      { Id_Tour: 1, Nombre_Tour: 'Medellín', NombreTour: 'Medellín', NumeroPasajeros: 4, totalReservas: 2 },
      { Id_Tour: 5, Nombre_Tour: 'Guatapé', NombreTour: 'Guatapé', NumeroPasajeros: 5, totalReservas: 3 },
      { Id_Tour: 2, Nombre_Tour: 'Santa Fe', NombreTour: 'Santa Fe', NumeroPasajeros: 7, totalReservas: 4 },
      { Id_Tour: 9, Nombre_Tour: 'Cañón', NombreTour: 'Cañón', NumeroPasajeros: 0, totalReservas: 0 },
    ]));
    programacionService.obtenerListadoFinal.and.callFake((payload: any) => {
      if (payload.idTour === 9) {
        return of({ exists: false, buses: [], reservasSinAsignar: [] });
      }
      return of({
        exists: true,
        buses: [{ reservas: Array.from({ length: 4 }, () => ({})) }],
        reservasSinAsignar: payload.idsTours ? [{}] : [],
      });
    });
    programacionService.resumenPrivadosDia.and.returnValue(of({
      totalReservas: 1,
      totalBuses: 1,
      totalPax: 3,
      privados: privateBuses,
    }));
    programacionService.obtenerTransfersDia.and.returnValue(of(transfers));

    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.fechaSeleccionada = '2026-09-20';
    component.cargarToursDelDia();

    expect(programacionService.obtenerResumenDashboard).toHaveBeenCalledOnceWith('2026-09-20');
    expect(programacionService.obtenerListadoFinal).toHaveBeenCalledTimes(3);
    expect(programacionService.obtenerListadoFinal).toHaveBeenCalledWith({ fecha: '2026-09-20', idsTours: [1, 5] });
    expect(component.toursDelDia.map((tour) => [tour.Id_Tour, tour.totalPasajeros, tour.totalReservas, tour.estado])).toEqual([
      [2, 7, 4, 'Generado'],
      [5, 9, 5, 'Generado'],
      [9, 0, 0, 'Pendiente'],
    ]);
    expect(component.toursDelDia[1].NombreTour).toBe('Medellín Y Guatapé');
    expect((component.toursDelDia[1] as any).idsTours).toEqual([1, 5]);
    expect(component.busesPrivados).toEqual(privateBuses);
    expect(component.transfersDia).toEqual(transfers);
  });

  it('cambia el resumen operativo cuando cambia la fecha y conserva el acceso al editor', () => {
    programacionService.obtenerResumenDashboard.and.returnValues(
      of([{ Id_Tour: 2, Nombre_Tour: 'Santa Fe', NombreTour: 'Santa Fe', NumeroPasajeros: 4, totalReservas: 2 }]),
      of([{ Id_Tour: 2, Nombre_Tour: 'Santa Fe', NombreTour: 'Santa Fe', NumeroPasajeros: 8, totalReservas: 3 }]),
    );
    programacionService.obtenerListadoFinal.and.returnValue(of({ exists: false, buses: [], reservasSinAsignar: [] }));
    programacionService.resumenPrivadosDia.and.returnValue(of({ totalReservas: 0, totalBuses: 0, totalPax: 0, privados: [] }));
    const emptyTransfers: TransfersProgramacionResponse = {
      fecha: '2026-09-20', totalTransfers: 0, totalPasajeros: 0, totalServicios: 0,
      totalPendientes: 0, servicios: [], transfers: [],
    };
    programacionService.obtenerTransfersDia.and.returnValue(of(emptyTransfers));

    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.fechaSeleccionada = '2026-09-20';
    component.cargarToursDelDia();
    expect(component.toursDelDia[0].totalPasajeros).toBe(4);

    component.onFechaOperacionSelected('2026-09-21');
    expect(programacionService.obtenerResumenDashboard.calls.allArgs()).toEqual([
      ['2026-09-20'], ['2026-09-21'],
    ]);
    expect(component.toursDelDia[0].totalPasajeros).toBe(8);
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: jasmine.any(Object),
      queryParams: { fecha: '2026-09-21' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    jasmine.clock().install();
    try {
      grantedPermissions.add('PROGRAMACION.CREAR');
      spyOn((component as any).cdr, 'detectChanges');
      component.openTourFromDashboard({
        Id_Tour: 2, NombreTour: 'Santa Fe', estado: 'Pendiente', planGenerado: null,
      });
      jasmine.clock().tick(0);
      expect(router.navigate).toHaveBeenCalledWith(
        ['/Programacion/Editor', '2026-09-21', '2'],
        { queryParams: undefined },
      );
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('renderiza inmediatamente el mensaje al comenzar a generar en modo zoneless', () => {
    const response$ = new Subject<any>();
    programacionService.generarPlanLogistico.and.returnValue(response$);
    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.modoVista = 'editor';
    const tour: TourProgramacion = {
      Id_Tour: 2,
      NombreTour: 'Guatapé',
      estado: 'Pendiente',
      planGenerado: null,
      totalPasajeros: 8,
    };

    (component as any).generarPlanDesdeCero(tour);

    expect(component.isPageLoading).toBeTrue();
    expect(component.editorLoadingMode).toBe('generating');
    expect(fixture.nativeElement.textContent).toContain(
      'Generando los listados y optimizando los recorridos'
    );
  });

  it('conserva parada operativa y tour de forma independiente según sus coordenadas', () => {
    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;
    component.tourSeleccionado = {
      Id_Tour: 2,
      NombreTour: 'Guatapé',
      estado: 'Generado',
      planGenerado: null,
    };

    component.destinoTourActual = {
      horaSalidaBase: '6:00 AM',
      primeraParadaOperativa: { lat: 6.2076963, lng: -75.282431, nombre: 'Restaurante Porto Madero' },
      tour: { lat: 6.234311, lng: -75.161725, nombre: 'Guatapé' },
    };
    expect((component as any).getTourMapDestination()).toEqual({
      horaSalidaBase: '6:00 AM',
      primeraParadaOperativa: { lat: 6.2076963, lng: -75.282431, nombre: 'Restaurante Porto Madero' },
      tour: { lat: 6.234311, lng: -75.161725, nombre: 'Guatapé' },
    });

    component.destinoTourActual = {
      primeraParadaOperativa: { lat: 6.2076963, lng: -75.282431, nombre: 'Restaurante Porto Madero' },
      tour: null,
    };
    expect((component as any).getTourMapDestination().tour).toBeNull();

    component.destinoTourActual = {
      primeraParadaOperativa: null,
      tour: { lat: 6.234311, lng: -75.161725, nombre: 'Guatapé' },
    };
    const soloTour = (component as any).getTourMapDestination();
    expect(soloTour.primeraParadaOperativa).toBeNull();
    expect(soloTour.tour?.nombre).toBe('Guatapé');

    component.destinoTourActual = { primeraParadaOperativa: null, tour: null };
    expect((component as any).getTourMapDestination()).toBeNull();
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

  it('solo habilita las exportaciones cuando tiene lectura y exportación', () => {
    const fixture = TestBed.createComponent(Listado);
    const component = fixture.componentInstance;

    expect(component.canExportProgramacion).toBeTrue();

    grantedPermissions = new Set(['PROGRAMACION.LEER']);
    expect(component.canExportProgramacion).toBeFalse();

    grantedPermissions = new Set(['PROGRAMACION.EXPORTAR']);
    expect(component.canExportProgramacion).toBeFalse();

    grantedPermissions = new Set(['PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR']);
    expect(component.canExportProgramacion).toBeFalse();
  });

  it('no inicia exportaciones desde el dashboard sin el permiso conjunto', () => {
    const component = TestBed.createComponent(Listado).componentInstance;
    component.transfersDia = {
      fecha: '2026-08-15',
      totalTransfers: 1,
      totalPasajeros: 1,
      totalServicios: 1,
      totalPendientes: 0,
      servicios: [],
      transfers: [],
    };
    component.tourSeleccionado = {
      Id_Tour: 9,
      NombreTour: 'Tour',
      estado: 'Generado',
      planGenerado: null,
    };
    component.planSeleccionado = { buses: [], reservasSinAsignar: [] } as any;

    grantedPermissions = new Set(['PROGRAMACION.LEER']);
    component.exportarTransfersDia();
    component.descargarListadoBus(0);
    component.descargarTodosLosListados();

    expect(programacionService.exportarTransfersDia).not.toHaveBeenCalled();
    expect(programacionService.exportarListadoBus).not.toHaveBeenCalled();
    expect(programacionService.exportarListadosZip).not.toHaveBeenCalled();
  });

});
