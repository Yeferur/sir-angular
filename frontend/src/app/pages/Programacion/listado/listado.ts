import { Component, inject, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ProgramacionDashboardService,
  TransfersProgramacionResponse,
} from '../../../services/Programacion/programacion';
import { InicioService } from '../../../services/inicio';
import { Sugerencia, TourProgramacion, Bus, Reserva, DestinoTourProgramacion } from '../../../interfaces/Programacion/reservas';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, switchMap, of, finalize, Subscription } from 'rxjs';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirDrawerService, type DrawerMapDestination } from '../../../services/Drawer/drawer.service';
import { SirAlertService, type AlertButton, type SirModalAlert } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { ProgramacionDashboardComponent } from './programacion-dashboard';
import { ProgramacionEditorComponent } from './programacion-editor';
import { ProgramacionPrivadosComponent } from './programacion-privados';
import { ProgramacionTransfersComponent } from './programacion-transfers';
import { ProgramacionViewStop as ViewStop } from './programacion-view.types';
import {
  bestBusCapacity,
  groupProgramacionStops,
  renumberGenericBuses,
  reservationPointKey,
} from './programacion-editor.utils';

type LegacyButton = { text: string; style: string; onClick: () => void };

interface LegacyNavbarFacade {
  showAlert: (opts: Omit<SirModalAlert, 'id'>) => string;
  showConfirm: (title: string, message: string, buttons: LegacyButton[]) => string;
  warningToast: (title: string, message?: string, durationMs?: number) => string;
  clearOverlay: () => void;
}

interface ProgramacionQualitySummary {
  missingCoordinates: number;
  missingRoute: number;
  affectedReservations: number;
}

interface ProgramacionMoveSnapshot {
  plan: Sugerencia;
  unassigned: Reserva[];
  activeBusIndex: number;
  stopOrderEntries: Array<[number, string[]]>;
  dirty: boolean;
  changedFromBaseline: boolean;
}

@Component({
  selector: 'app-programacion-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatepickerComponent,
    LoadingStateComponent,
    ProgramacionDashboardComponent,
    ProgramacionEditorComponent,
    ProgramacionPrivadosComponent,
    ProgramacionTransfersComponent,
  ],
  templateUrl: './listado.html',
  styleUrls: ['./listado.css']
})
export class Listado implements OnInit, OnDestroy {
  private programacionService = inject(ProgramacionDashboardService);
  private inicioService = inject(InicioService);
  private cdr = inject(ChangeDetectorRef);
  private permisosService = inject(PermisosService);
  private drawerService = inject(SirDrawerService);
  private alerts = inject(SirAlertService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private mapAlertButtons(buttons?: LegacyButton[]): AlertButton[] | undefined {
    if (!buttons?.length) return undefined;
    return buttons.map((button) => ({
      text: button.text,
      style: button.style === 'delete' || button.style === 'danger' ? 'danger' : button.style === 'secondary' ? 'secondary' : 'primary',
      onClick: button.onClick,
    }));
  }

  private navbar: LegacyNavbarFacade = {
    showAlert: (opts) => this.alerts.showAlert({
      ...opts,
      buttons: this.mapAlertButtons(opts.buttons as LegacyButton[] | undefined),
    }),
    showConfirm: (title, message, buttons) =>
      this.alerts.showConfirm(title, message, this.mapAlertButtons(buttons) || []),
    warningToast: (title, message = '', durationMs = 3500) =>
      this.alerts.warningToast(title, message, durationMs),
    clearOverlay: () => this.alerts.closeModal(),
  };

  fechaSeleccionada: string = this.getTodayIso();
  toursDelDia: TourProgramacion[] = [];
  isPageLoading = true;
  isUpdatingDate = false;
  isSaving = false;
  editorLoadingMode: 'saved' | 'generating' | null = null;
  loadError = '';
  modoVista: 'dashboard' | 'editor' | 'privados' | 'transfers' = 'dashboard';

  tourSeleccionado: TourProgramacion | null = null;
  planSeleccionado: Sugerencia | null = null;
  listadoDirty = false;
  listadoPersistido = false;
  listadoOrigen: 'nuevo' | 'db' | null = null;
  routingFallback = false;
  qualitySummary: ProgramacionQualitySummary | null = null;

  readonly CAPACIDADES_BUSES = [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b);

  reservasSinAsignar: Reserva[] = [];
  busesPrivados: any[] = [];  // buses para reservas privadas del día
  privateDirty = false;
  transfersDia: TransfersProgramacionResponse = this.emptyTransfersResponse(this.fechaSeleccionada);
  transfersLoadError = false;
  isExportingTransfers = false;
  destinoTourActual: DestinoTourProgramacion | null = null;

  // Buses privados agrupados por reserva para la vista de privados
  get gruposPrivados(): any[] {
    const map = new Map<string, any>();
    for (const bus of this.busesPrivados) {
      const key = bus.Id_Reserva_Privada;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          Id_Reserva: key,
          Nombre_Reportante: bus.Nombre_Reportante,
          Nombre_Tour: bus.Nombre_Tour,
          totalPax: 0,
          totalBuses: bus.totalBuses,
          buses: []
        });
      }
      const grupo = map.get(key);
      grupo.totalPax += bus.ocupados;
      grupo.buses.push(bus);
    }
    return Array.from(map.values());
  }

  get totalReservasPrivadas(): number {
    return this.gruposPrivados.length;
  }

  get totalBusesPrivados(): number {
    return this.busesPrivados.length;
  }

  get totalPaxPrivados(): number {
    return this.busesPrivados.reduce((s, b) => s + (b.ocupados || 0), 0);
  }

  activeBusIndex = 0;
  activeStops: ViewStop[] = [];

  // Orden transitorio solo para drag/drop de la sesion actual; el array bus.reservas es la fuente de verdad.
  private stopOrderByBus = new Map<number, string[]>();
  private loadSubscription?: Subscription;
  private editorSubscription?: Subscription;
  private loadSequence = 0;
  private lastMoveSnapshot: ProgramacionMoveSnapshot | null = null;
  private lastMoveToastId: string | null = null;
  private initialEditorSnapshot: ProgramacionMoveSnapshot | null = null;
  editorChangedFromBaseline = false;
  private isEditorRoute = false;
  private isPrivateRoute = false;
  private editorRouteKey: string | null = null;
  private forceRegenerateFromRoute = false;
  private editorRouteOpenTimer?: ReturnType<typeof setTimeout>;
  private editorNavigationTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (!this.initializeRouteContext()) return;
    if (this.isPrivateRoute) {
      this.cargarPrivadosDelDia();
      return;
    }
    this.cargarToursDelDia();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.editorSubscription?.unsubscribe();
    if (this.editorRouteOpenTimer) clearTimeout(this.editorRouteOpenTimer);
    if (this.editorNavigationTimer) clearTimeout(this.editorNavigationTimer);
  }

  hasUnsavedChanges(): boolean {
    return (this.listadoDirty || this.privateDirty) && !this.isSaving;
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  get editorStatusText(): string {
    if (this.listadoPersistido && !this.listadoDirty) {
      return 'Listado guardado';
    }

    if (this.listadoOrigen === 'nuevo' && !this.listadoPersistido) {
      return 'Borrador sin guardar';
    }

    if (this.listadoDirty) {
      return 'Cambios sin guardar';
    }

    return '';
  }

  get pageLoadingLabel(): string {
    if (this.editorLoadingMode === 'generating') {
      return 'Generando los listados y optimizando los recorridos…';
    }
    if (this.editorLoadingMode === 'saved') {
      return 'Obteniendo los buses y reservas del listado guardado…';
    }
    return 'Cargando la operación del día…';
  }

  get totalPaxUnassigned(): number {
    return (this.reservasSinAsignar || []).reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);
  }

  get canUpdateProgramacion(): boolean {
    return this.permisosService.tienePermiso('PROGRAMACION.ACTUALIZAR');
  }

  get canCreateProgramacion(): boolean {
    return this.permisosService.tienePermiso('PROGRAMACION.CREAR');
  }

  get canRestoreInitialPlan(): boolean {
    return this.canUpdateProgramacion
      && Boolean(this.initialEditorSnapshot)
      && this.editorChangedFromBaseline;
  }

  private initializeRouteContext(): boolean {
    const routeView = this.route.snapshot.data['programacionView'];
    this.isEditorRoute = routeView === 'editor';
    this.isPrivateRoute = routeView === 'privados';

    if (this.isPrivateRoute) {
      const routeDate = String(this.route.snapshot.paramMap.get('fecha') || '');
      if (!this.isValidIsoDate(routeDate)) {
        void this.navigateToDashboard(true);
        return false;
      }
      this.fechaSeleccionada = routeDate;
      this.modoVista = 'privados';
      return true;
    }

    if (this.isEditorRoute) {
      const routeDate = String(this.route.snapshot.paramMap.get('fecha') || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) {
        this.fechaSeleccionada = routeDate;
      }
      this.editorRouteKey = String(this.route.snapshot.paramMap.get('servicio') || '').trim();
      this.forceRegenerateFromRoute = this.route.snapshot.queryParamMap.get('regenerar') === '1';
      this.modoVista = 'editor';
      this.editorLoadingMode = this.forceRegenerateFromRoute ? 'generating' : 'saved';
      return true;
    }

    const queryDate = String(this.route.snapshot.queryParamMap.get('fecha') || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      this.fechaSeleccionada = queryDate;
    }
    return true;
  }

  private isValidIsoDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  private cargarPrivadosDelDia(): void {
    const requestSequence = ++this.loadSequence;
    this.loadSubscription?.unsubscribe();
    this.loadError = '';
    this.transfersLoadError = false;
    this.isPageLoading = true;

    this.loadSubscription = this.programacionService.resumenPrivadosDia(this.fechaSeleccionada).pipe(
      finalize(() => {
        if (requestSequence !== this.loadSequence) return;
        this.isPageLoading = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        if (requestSequence !== this.loadSequence) return;
        this.busesPrivados = Array.isArray(response?.privados)
          ? JSON.parse(JSON.stringify(response.privados))
          : [];
        this.privateDirty = false;
        this.listadoOrigen = this.busesPrivados.length > 0 ? 'db' : 'nuevo';
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (requestSequence !== this.loadSequence) return;
        console.error('Error al cargar la programación privada', error);
        this.loadError = 'No fue posible consultar las reservas privadas de esta fecha. Revisa la conexión e inténtalo nuevamente.';
        this.cdr.markForCheck();
      },
    });
  }

  retryPageLoad(): void {
    if (this.isPrivateRoute) {
      this.cargarPrivadosDelDia();
      return;
    }
    this.cargarToursDelDia();
  }

  cargarToursDelDia(): void {
    const requestSequence = ++this.loadSequence;
    this.loadSubscription?.unsubscribe();
    this.loadError = '';
    this.transfersLoadError = false;
    const isInitialLoad = this.toursDelDia.length === 0;

    if (isInitialLoad) {
      this.isPageLoading = true;
    } else {
      this.isUpdatingDate = true;
    }

    // Obtener tours
    this.loadSubscription = this.programacionService.getTours().pipe(
      switchMap(tours => {
        // Obtener datos del día y listados para los tours
        const listadoObservables: { [key: number]: any } = {};

        // Detectar si existen 1 y 5 para consultar su listado combinado
        const tiene1 = tours.some(t => t.Id_Tour === 1);
        const tiene5 = tours.some(t => t.Id_Tour === 5);

        tours.forEach(tour => {

          if ((tour.Id_Tour === 1 || tour.Id_Tour === 5) && tiene1 && tiene5) {
            // Consultamos usando el array [1, 5]
            // Solo lo hacemos una vez (e.g. cuando id=5) para no duplicar llamada
            if (tour.Id_Tour === 5) {
              listadoObservables[5] = this.programacionService.obtenerListadoFinal({
                fecha: this.fechaSeleccionada,
                idsTours: [1, 5]
              } as any);
            }

          } else {
            listadoObservables[tour.Id_Tour] = this.programacionService.obtenerListadoFinal({
              fecha: this.fechaSeleccionada,
              idTour: tour.Id_Tour
            });
          }
        });
        // Recolectar todos los Id_Tour para la consulta de privados
        const todosIds = tours.map((t: any) => t.Id_Tour);

        return forkJoin({
          tours: of(tours), // Mantener referencia a tours
          datosDelDia: this.inicioService.getDatosInicio(this.fechaSeleccionada),
          listados: tours.length > 0 ? forkJoin(listadoObservables) : of({}),
          privadosDelDia: this.programacionService.resumenPrivadosDia(this.fechaSeleccionada, todosIds)
            .pipe(catchError(() => of({ totalReservas: 0, totalBuses: 0, totalPax: 0, privados: [] }))),
          transfersDelDia: this.programacionService.obtenerTransfersDia(this.fechaSeleccionada)
            .pipe(catchError((error) => {
              console.error('No fue posible cargar los transfers del día', error);
              this.transfersLoadError = true;
              return of(this.emptyTransfersResponse(this.fechaSeleccionada));
            }))
        });
      }),
      finalize(() => {
        if (requestSequence !== this.loadSequence) return;
        this.isPageLoading = false;
        this.isUpdatingDate = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (result: any) => {
        if (requestSequence !== this.loadSequence) return;
        const tours = result.tours;
        const datosDelDia = result.datosDelDia;
        const listados = result.listados || {};

        // Poblar busesPrivados desde la consulta independiente del dashboard.
        // Esto hace visible la card "Privados del día" sin necesidad de
        // abrir ningún tour grupal primero.
        const resumenPrivados = result.privadosDelDia;
        if (resumenPrivados?.privados?.length) {
          this.busesPrivados = resumenPrivados.privados;
        }
        this.transfersDia = result.transfersDelDia || this.emptyTransfersResponse(this.fechaSeleccionada);

        // Crear mapa de pasajeros y reservas por tour desde datosDelDia
        const pasajerosPorTour = new Map<number, number>();
        const reservasPorTour = new Map<number, number>();

        datosDelDia.tours.forEach((tour: any) => {
          pasajerosPorTour.set(tour.Id_Tour, tour.NumeroPasajeros || 0);
          reservasPorTour.set(tour.Id_Tour, tour.totalReservas || 0);
        });

        // Actualizar tours con estado y datos
        const tiene1 = tours.some((t: any) => t.Id_Tour === 1);
        const tiene5 = tours.some((t: any) => t.Id_Tour === 5);
        let toursProcesados = [];

        if (tiene1 && tiene5) {
          const t1 = tours.find((t: any) => t.Id_Tour === 1);
          const t5 = tours.find((t: any) => t.Id_Tour === 5);

          // Procesar tours que NO son 1 ni 5
          const otrosTours = tours.filter((t: any) => t.Id_Tour !== 1 && t.Id_Tour !== 5);
          toursProcesados = [...otrosTours];

          // Crear Combinado
          const pax1 = pasajerosPorTour.get(1) || 0;
          const pax5 = pasajerosPorTour.get(5) || 0;
          const totalPaxCombinado = pax1 + pax5;

          const res1 = reservasPorTour.get(1) || 0;
          const res5 = reservasPorTour.get(5) || 0;
          const totalResCombinado = res1 + res5;

          // Listado combinado se guardó bajo la key 5 en el observable
          const datosListado = listados[5];
          const existeListado = datosListado?.exists || false;

          let estado: 'Pendiente' | 'Generado' = 'Pendiente';
          if (totalPaxCombinado === 0) estado = 'Pendiente';
          else if (existeListado) estado = 'Generado';

          // Objeto Tour combinado
          const tourCombinado: TourProgramacion & { idsTours?: number[] } = {
            Id_Tour: 5, // Usamos 5 como ID principal para la UI (o un ID ficticio, pero 5 ayuda a mantener compatibilidad)
            NombreTour: `${t1.Nombre_Tour} Y ${t5.Nombre_Tour}`,
            idsTours: [1, 5], // Propiedad extra para identificar que es combinado
            estado,
            planGenerado: null,
            totalPasajeros: totalPaxCombinado,
            totalReservas: totalResCombinado,
            reservasSinAsignar: datosListado?.reservasSinAsignar || []
          };

          if (existeListado && datosListado.buses) {
            const totalReservas = datosListado.buses.reduce((sum: number, b: any) => sum + (b.reservas?.length || 0), 0)
              + (datosListado.reservasSinAsignar || []).length;
            tourCombinado.totalReservas = totalReservas;
          }

          // Agregamos el combinado al inicio o donde corresponda (ordenado por ID usualmente)
          toursProcesados.push(tourCombinado);
          toursProcesados.sort((a, b) => a.Id_Tour - b.Id_Tour);

        } else {
          toursProcesados = tours;
        }

        // Actualizar tours con estado y datos (ahora iteramos sobre toursProcesados)
        this.toursDelDia = toursProcesados.map((tour: any) => {
          // Si es el combinado ya viene procesado
          if (tour.idsTours) return tour;

          const totalPasajeros = pasajerosPorTour.get(tour.Id_Tour) || 0;
          const totalReservas = reservasPorTour.get(tour.Id_Tour) || 0;
          const datosListado = listados[tour.Id_Tour];
          const existeListado = datosListado?.exists || false;

          let estado: 'Pendiente' | 'Generado' | 'Confirmado' | 'Error' = 'Pendiente';

          if (totalPasajeros === 0) {
            estado = 'Pendiente';
          } else if (existeListado) {
            estado = 'Generado';
          }

          const resultado: TourProgramacion = {
            ...tour,
            nombre: tour.Nombre_Tour,
            estado,
            planGenerado: null,
            totalPasajeros: totalPasajeros,
            totalReservas: totalReservas,
            reservasSinAsignar: datosListado?.reservasSinAsignar || []
          };

          if (existeListado && datosListado.buses) {
            const totalReservas = datosListado.buses.reduce((sum: number, b: any) => sum + (b.reservas?.length || 0), 0)
              + (datosListado.reservasSinAsignar || []).length;
            resultado.totalReservas = totalReservas;
          }

          return resultado;
        });

        this.openEditorRouteAfterDashboardLoad(requestSequence, listados);
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (requestSequence !== this.loadSequence) return;
        console.error('Error al cargar tours del día', err);
        this.loadError = 'No fue posible consultar los servicios de esta fecha. Revisa la conexión e inténtalo nuevamente.';
        this.cdr.markForCheck();
      }
    });
  }

  private openEditorRouteAfterDashboardLoad(
    requestSequence: number,
    loadedListings: Record<string | number, any>
  ): void {
    if (!this.isEditorRoute || !this.editorRouteKey) return;

    const tour = this.toursDelDia.find(
      (candidate) => this.getTourRouteKey(candidate) === this.editorRouteKey
    );
    if (!tour) {
      this.alerts.warningToast(
        'Servicio no disponible',
        'No encontramos ese servicio para la fecha indicada.'
      );
      void this.navigateToDashboard(true);
      return;
    }

    if (this.editorRouteOpenTimer) clearTimeout(this.editorRouteOpenTimer);
    this.editorRouteOpenTimer = setTimeout(() => {
      if (requestSequence !== this.loadSequence) return;
      this.editorRouteOpenTimer = undefined;
      const forceRegenerate = this.forceRegenerateFromRoute;
      const loadedListing = loadedListings[tour.Id_Tour];
      this.forceRegenerateFromRoute = false;
      if (forceRegenerate) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { regenerar: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }

      if (forceRegenerate) {
        this.generarPlan(tour, { openInEditor: true, forceRegenerate: true });
        return;
      }

      if (loadedListing?.exists) {
        this.isPageLoading = false;
        this.editorLoadingMode = null;
        this.tourSeleccionado = tour;
        this.aplicarPlan(
          tour,
          this.construirSugerenciaDesdeListado(loadedListing),
          loadedListing.reservasSinAsignar || [],
          loadedListing.privados || [],
          loadedListing.destinoTour || null
        );
        return;
      }

      if (!this.canCreateProgramacion) {
        this.isPageLoading = false;
        this.editorLoadingMode = null;
        this.alerts.warningToast(
          'Acción no permitida',
          'No tienes permiso para generar programación.'
        );
        void this.navigateToDashboard(true);
        return;
      }

      this.tourSeleccionado = tour;
      this.generarPlanDesdeCero(tour);
    });
  }

  private getTourRouteKey(tour: TourProgramacion): string {
    const ids = Array.isArray((tour as any).idsTours)
      ? [...(tour as any).idsTours].map(Number).sort((a, b) => a - b)
      : [Number(tour.Id_Tour)];
    return ids.join('-');
  }

  private navigateToEditor(tour: TourProgramacion, options?: { regenerate?: boolean }): void {
    this.drawerService.close(true);
    this.isPageLoading = true;
    this.editorLoadingMode = options?.regenerate || tour.estado === 'Pendiente'
      ? 'generating'
      : 'saved';
    this.cdr.detectChanges();

    if (this.editorNavigationTimer) clearTimeout(this.editorNavigationTimer);
    this.editorNavigationTimer = setTimeout(() => {
      this.editorNavigationTimer = undefined;
      void this.router.navigate(
        ['/Programacion/Editor', this.fechaSeleccionada, this.getTourRouteKey(tour)],
        {
          queryParams: options?.regenerate ? { regenerar: 1 } : undefined,
        }
      );
    });
  }

  private navigateToDashboard(replaceUrl = false): Promise<boolean> {
    return this.router.navigate(
      ['/Programacion/Listado'],
      {
        queryParams: { fecha: this.fechaSeleccionada },
        replaceUrl,
      }
    );
  }

  onFechaOperacionSelected(iso: string | null): void {
    if (!iso) return;
    this.goToDate(iso);
  }

  irDiaAnterior(): void {
    this.goToDate(this.shiftDate(this.fechaSeleccionada, -1));
  }

  irDiaSiguiente(): void {
    this.goToDate(this.shiftDate(this.fechaSeleccionada, 1));
  }

  irHoy(): void {
    this.goToDate(this.getTodayIso());
  }

  irManana(): void {
    this.goToDate(this.getTomorrowIso());
  }

  isTodaySelected(): boolean {
    return this.fechaSeleccionada === this.getTodayIso();
  }

  isTomorrowSelected(): boolean {
    return this.fechaSeleccionada === this.getTomorrowIso();
  }

  getTomorrowIso(): string {
    return this.shiftDate(this.getTodayIso(), 1);
  }

  private getTodayIso(): string {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }

  private formatOperationDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return value;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(date);
  }

  private shiftDate(isoDate: string, days: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }

  private goToDate(iso: string): void {
    if (!iso || iso === this.fechaSeleccionada) return;

    this.confirmarPerdidaCambios(() => {
      this.fechaSeleccionada = iso;
      this.resetEditorState();
      this.modoVista = 'dashboard';
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { fecha: iso },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      this.cargarToursDelDia();
    });
  }

  private resetEditorState(): void {
    if (this.lastMoveToastId) {
      this.alerts.dismissToast(this.lastMoveToastId);
    }
    this.lastMoveSnapshot = null;
    this.lastMoveToastId = null;
    this.initialEditorSnapshot = null;
    this.editorChangedFromBaseline = false;
    this.planSeleccionado = null;
    this.tourSeleccionado = null;
    this.activeBusIndex = 0;
    this.activeStops = [];
    this.stopOrderByBus.clear();
    this.listadoDirty = false;
    this.listadoPersistido = false;
    this.listadoOrigen = null;
    this.busesPrivados = [];
    this.privateDirty = false;
    this.destinoTourActual = null;
    this.routingFallback = false;
    this.qualitySummary = null;
    this.editorLoadingMode = null;
  }

  markDirty(): void {
    this.listadoDirty = true;
    this.editorChangedFromBaseline = true;
  }

  private confirmarPerdidaCambios(continuar: () => void): void {
    if (!this.listadoDirty) {
      continuar();
      return;
    }

    this.navbar.showConfirm(
      'Cambios sin guardar',
      'Tienes cambios en el listado que aún no han sido guardados. ¿Qué deseas hacer?',
      [
        {
          text: 'Guardar cambios',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            void this.guardarListadoFinal({ skipConfirmation: true });
          }
        },
        {
          text: 'Salir sin guardar',
          style: 'danger',
          onClick: () => {
            this.navbar.clearOverlay();
            this.listadoDirty = false;
            continuar();
          }
        },
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        }
      ]
    );
  }

  openTourFromDashboard(tour: TourProgramacion): void {
    const isGenerated = tour.estado === 'Generado' || tour.estado === 'Confirmado';
    if (isGenerated) {
      this.generarPlan(tour);
      return;
    }

    if (!this.canCreateProgramacion) {
      this.navbar.warningToast('Acción no permitida', 'No tienes permiso para generar programación.');
      return;
    }

    this.navigateToEditor(tour);
  }

  generarPlan(
    tour: TourProgramacion,
    options?: { openInEditor?: boolean; forceRegenerate?: boolean }
  ): void {
    const isGenerated = tour.estado === 'Generado' || tour.estado === 'Confirmado';
    if ((!isGenerated || options?.forceRegenerate) && !this.canCreateProgramacion) {
      this.navbar.warningToast('Acción no permitida', 'No tienes permiso para generar programación.');
      if (this.isEditorRoute) void this.navigateToDashboard(true);
      return;
    }

    const opensSavedListingDrawer = isGenerated
      && !options?.openInEditor
      && !options?.forceRegenerate
      && !this.isEditorRoute;

    // Consultar un listado ya generado no debe reemplazar el dashboard por el
    // loader: las cards permanecen visibles mientras se prepara su drawer.
    if (!opensSavedListingDrawer) {
      this.isPageLoading = true;
      this.editorLoadingMode = options?.forceRegenerate || tour.estado !== 'Generado'
        ? 'generating'
        : 'saved';
    }

    this.tourSeleccionado = tour;

    if (options?.forceRegenerate) {
      this.generarPlanDesdeCero(tour);
      return;
    }

    const payload: any = {
      fecha: this.fechaSeleccionada
    };

    // Chequear si es combinado
    if ((tour as any).idsTours) {
      payload.idsTours = (tour as any).idsTours;
    } else {
      payload.idTour = tour.Id_Tour;
    }

    this.editorSubscription?.unsubscribe();
    this.editorSubscription = this.programacionService.obtenerListadoFinal(payload).subscribe({
      next: (data) => {
        if (data?.exists) {
          const sugerencia = this.construirSugerenciaDesdeListado(data);
          this.isPageLoading = false;
          this.editorLoadingMode = null;
          // En modo zoneless, abrir el drawer marca su host, pero no necesariamente
          // esta vista. Marcamos Programacion antes de abrirlo para que el loader
          // no permanezca renderizado como fondo del listado guardado.
          this.cdr.markForCheck();
          if (options?.openInEditor || this.isEditorRoute) {
            this.aplicarPlan(
              tour,
              sugerencia,
              data.reservasSinAsignar || [],
              data.privados || [],
              data.destinoTour || null
            );
            return;
          }
          this.abrirVistaListadoGuardado(
            tour,
            sugerencia,
            data.reservasSinAsignar || []
          );
          return;
        }

        if (!options?.openInEditor && !this.isEditorRoute) {
          this.isPageLoading = false;
          this.editorLoadingMode = null;
          this.navigateToEditor(tour);
          return;
        }

        this.generarPlanDesdeCero(tour);
      },
      error: (err) => {
        console.error('Error al consultar listados', err);
        this.isPageLoading = false;
        if (!options?.openInEditor && !this.isEditorRoute) {
          this.editorLoadingMode = null;
          this.navigateToEditor(tour);
          return;
        }
        this.generarPlanDesdeCero(tour);
      }
    });
  }

  abrirVistaPrivados(): void {
    if (this.totalReservasPrivadas === 0) return;
    this.confirmarPerdidaCambios(() => {
      this.drawerService.close(true);
      void this.router.navigate(['/Programacion/Privados', this.fechaSeleccionada]);
    });
  }

  abrirVistaTransfers(): void {
    if (this.transfersLoadError || this.transfersDia.totalTransfers === 0) return;
    this.modoVista = 'transfers';
    this.cdr.markForCheck();
  }

  exportarTransfersDia(): void {
    if (this.isExportingTransfers || this.transfersDia.totalTransfers === 0) return;
    this.isExportingTransfers = true;
    this.programacionService.exportarTransfersDia(this.fechaSeleccionada).pipe(
      finalize(() => {
        this.isExportingTransfers = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (blob) => this.downloadBlob(blob, `${this.fechaSeleccionada}_transfers.xlsx`),
      error: (error) => {
        console.error('Error al exportar los transfers del día', error);
        this.alerts.showAlert({
          type: 'error',
          title: 'No pudimos exportar los transfers',
          message: 'La información sigue disponible en pantalla. Inténtalo nuevamente.',
        });
      },
    });
  }

  updatePrivateBuses(buses: any[]): void {
    this.busesPrivados = Array.isArray(buses) ? JSON.parse(JSON.stringify(buses)) : [];
    this.cdr.markForCheck();
  }

  onPrivateDirtyChange(dirty: boolean): void {
    this.privateDirty = dirty;
  }

  volverAlDashboard(): void {
    this.confirmarPerdidaCambios(() => {
      if (this.isEditorRoute || this.isPrivateRoute) {
        this.resetEditorState();
        void this.navigateToDashboard();
        return;
      }

      const privadosActuales = Array.isArray(this.busesPrivados)
        ? JSON.parse(JSON.stringify(this.busesPrivados))
        : [];
      this.resetEditorState();
      this.busesPrivados = privadosActuales;
      this.modoVista = 'dashboard';
      this.cdr.markForCheck();
    });
  }

  selectBus(i: number): void {
    if (!this.planSeleccionado) return;
    // Allow -1 for unassigned
    if (i !== -1 && (i < 0 || i >= this.planSeleccionado.buses.length)) return;
    this.activeBusIndex = i;
    this.rebuildActiveStops();
    this.updateOpenMapForActiveBus();
    this.cdr.markForCheck();
  }

  get activeBus(): Bus | null {
    if (this.activeBusIndex === -1) {
      const reservas = this.reservasSinAsignar || [];
      return {
        id: 'Sin Asignar',
        capacidad: 0,
        ocupados: reservas.reduce((s, r) => s + (r.NumeroPasajeros || 0), 0),
        reservas: reservas,
        recorridoKm: 0
      };
    }
    if (!this.planSeleccionado?.buses) return null;
    return this.planSeleccionado.buses[this.activeBusIndex];
  }

  prevBus(): void {
    if (!this.planSeleccionado?.buses?.length) return;
    this.activeBusIndex = (this.activeBusIndex - 1 + this.planSeleccionado.buses.length) % this.planSeleccionado.buses.length;
    this.rebuildActiveStops();
    this.updateOpenMapForActiveBus();
    this.cdr.markForCheck();
  }

  nextBus(): void {
    if (!this.planSeleccionado?.buses?.length) return;
    this.activeBusIndex = (this.activeBusIndex + 1) % this.planSeleccionado.buses.length;
    this.rebuildActiveStops();
    this.updateOpenMapForActiveBus();
    this.cdr.markForCheck();
  }

  // Reordenar paradas: actualiza el array real para que mapa, guardado y Excel vean el mismo orden.
  dropStop(event: CdkDragDrop<ViewStop[]>): void {
    if (
      event.previousContainer !== event.container
      || event.previousIndex === event.currentIndex
    ) return;

    moveItemInArray(this.activeStops, event.previousIndex, event.currentIndex);

    const order = this.activeStops.map(s => s.key);
    this.stopOrderByBus.set(this.activeBusIndex, order);

    if (this.activeBusIndex !== -1 && this.planSeleccionado?.buses?.[this.activeBusIndex]) {
      // Deduplicar: una reserva multi-punto aparece en varias paradas de activeStops.
      // bus.reservas debe contener cada reserva una sola vez.
      const seen = new Set<number | string>();
      const reservasUnicas: Reserva[] = [];
      for (const stop of this.activeStops) {
        for (const r of stop.reservas) {
          if (!seen.has(r.Id_Reserva)) {
            seen.add(r.Id_Reserva);
            // Quitar el metadato interno antes de guardarlo
            const { __paxEnEstePunto, ...reservaLimpia } = r as any;
            reservasUnicas.push(reservaLimpia);
          }
        }
      }
      this.planSeleccionado.buses[this.activeBusIndex].reservas = reservasUnicas;
    }

    this.syncAfterPlanMutation({ updateMap: true });
    this.cdr.markForCheck();
  }

  moveReservationToDestination(event: {
    reservationId: string | number;
    sourceBusIndex: number;
    targetBusIndex: number | null;
  }): void {
    if (!this.planSeleccionado || event.sourceBusIndex === event.targetBusIndex) return;

    const sourceReservations = event.sourceBusIndex === -1
      ? this.reservasSinAsignar
      : this.planSeleccionado.buses[event.sourceBusIndex]?.reservas;
    if (!sourceReservations) return;

    const sourcePosition = sourceReservations.findIndex(
      (reservation) => String(reservation.Id_Reserva) === String(event.reservationId)
    );
    if (sourcePosition < 0) {
      this.alerts.warningToast(
        'No encontramos la reserva',
        'Actualiza el listado e intenta moverla nuevamente.'
      );
      return;
    }

    const reservation = sourceReservations[sourcePosition];
    const snapshot = this.captureMoveSnapshot();
    let destinationBus: Bus | null = null;

    if (event.targetBusIndex === null) {
      const capacity = bestBusCapacity(
        Number(reservation.NumeroPasajeros || 0),
        this.CAPACIDADES_BUSES
      );
      if (!capacity) {
        this.alerts.errorToast(
          'No podemos crear un bus para esta reserva',
          `La capacidad máxima disponible es de ${Math.max(...this.CAPACIDADES_BUSES)} pasajeros.`
        );
        return;
      }

      sourceReservations.splice(sourcePosition, 1);
      this.crearNuevoBus(reservation);
      destinationBus = this.planSeleccionado.buses[this.planSeleccionado.buses.length - 1] || null;
    } else {
      const targetBus = this.planSeleccionado.buses[event.targetBusIndex];
      if (!targetBus) return;

      const projectedLoad = Number(targetBus.ocupados || 0) + Number(reservation.NumeroPasajeros || 0);
      const projectedCapacity = targetBus.capacidadManual
        ? (projectedLoad <= Number(targetBus.capacidad || 0) ? Number(targetBus.capacidad) : null)
        : bestBusCapacity(projectedLoad, this.CAPACIDADES_BUSES);
      if (!projectedCapacity) {
        this.alerts.errorToast(
          'La reserva no cabe en este bus',
          `La capacidad máxima disponible es de ${Math.max(...this.CAPACIDADES_BUSES)} pasajeros.`
        );
        return;
      }

      sourceReservations.splice(sourcePosition, 1);
      if (!targetBus.capacidadManual) targetBus.capacidad = projectedCapacity;
      targetBus.reservas.push(reservation);
      destinationBus = targetBus;
    }

    this.syncAfterPlanMutation({ updateMap: true });
    const destinationIndex = destinationBus
      ? this.planSeleccionado.buses.indexOf(destinationBus)
      : -1;
    const targetLabel = destinationBus?.id
      || (destinationIndex >= 0 ? `Bus ${destinationIndex + 1}` : 'el nuevo bus');
    this.announceReservationMove(reservation, targetLabel, snapshot);
  }

  private captureMoveSnapshot(): ProgramacionMoveSnapshot {
    return {
      plan: JSON.parse(JSON.stringify(this.planSeleccionado)) as Sugerencia,
      unassigned: JSON.parse(JSON.stringify(this.reservasSinAsignar || [])) as Reserva[],
      activeBusIndex: this.activeBusIndex,
      stopOrderEntries: Array.from(this.stopOrderByBus.entries())
        .map(([index, order]) => [index, [...order]] as [number, string[]]),
      dirty: this.listadoDirty,
      changedFromBaseline: this.editorChangedFromBaseline,
    };
  }

  private announceReservationMove(
    reservation: Reserva,
    targetLabel: string,
    snapshot: ProgramacionMoveSnapshot
  ): void {
    if (this.lastMoveToastId) {
      this.alerts.dismissToast(this.lastMoveToastId);
    }

    this.lastMoveSnapshot = snapshot;
    this.lastMoveToastId = this.alerts.notify({
      type: 'success',
      title: `Reserva #${reservation.Id_Reserva} movida`,
      message: `Ahora está asignada a ${targetLabel}.`,
      durationMs: 7500,
      action: {
        label: 'Deshacer',
        onClick: () => this.undoLastReservationMove(),
      },
    });
  }

  private undoLastReservationMove(): void {
    const snapshot = this.lastMoveSnapshot;
    if (!snapshot) return;

    this.planSeleccionado = JSON.parse(JSON.stringify(snapshot.plan)) as Sugerencia;
    this.reservasSinAsignar = JSON.parse(JSON.stringify(snapshot.unassigned)) as Reserva[];
    this.activeBusIndex = snapshot.activeBusIndex;
    this.stopOrderByBus = new Map(
      snapshot.stopOrderEntries.map(([index, order]) => [index, [...order]])
    );
    this.listadoDirty = snapshot.dirty;
    this.editorChangedFromBaseline = snapshot.changedFromBaseline;
    this.lastMoveSnapshot = null;
    this.lastMoveToastId = null;

    this.rebuildActiveStops();
    this.updateOpenMapForActiveBus();
    this.alerts.infoToast('Movimiento deshecho', 'La distribución anterior fue restaurada.');
    this.cdr.markForCheck();
  }

  requestRestoreInitialPlan(): void {
    if (!this.canRestoreInitialPlan) return;

    const originLabel = this.listadoOrigen === 'nuevo'
      ? 'se generó el listado'
      : 'abriste el editor';

    this.navbar.showConfirm(
      'Restablecer listado',
      `Se descartarán los movimientos, recorridos y datos de buses modificados desde que ${originLabel}.`,
      [
        {
          text: 'Restablecer',
          style: 'danger',
          onClick: () => {
            this.navbar.clearOverlay();
            this.restoreInitialPlan();
          }
        },
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        }
      ]
    );
  }

  private restoreInitialPlan(): void {
    const snapshot = this.initialEditorSnapshot;
    if (!snapshot) return;

    if (this.lastMoveToastId) {
      this.alerts.dismissToast(this.lastMoveToastId);
    }

    this.planSeleccionado = JSON.parse(JSON.stringify(snapshot.plan)) as Sugerencia;
    this.reservasSinAsignar = JSON.parse(JSON.stringify(snapshot.unassigned)) as Reserva[];
    this.activeBusIndex = snapshot.activeBusIndex;
    this.stopOrderByBus = new Map(
      snapshot.stopOrderEntries.map(([index, order]) => [index, [...order]])
    );
    this.listadoDirty = snapshot.dirty;
    this.editorChangedFromBaseline = false;
    this.lastMoveSnapshot = null;
    this.lastMoveToastId = null;
    this.qualitySummary = this.buildQualitySummary(
      this.planSeleccionado.buses || [],
      this.reservasSinAsignar
    );

    this.rebuildActiveStops();
    this.updateOpenMapForActiveBus();
    this.alerts.infoToast(
      'Listado restablecido',
      'Volvimos a la distribución con la que inició esta edición.'
    );
    this.cdr.markForCheck();
  }

  private captureInitialEditorState(): void {
    if (!this.planSeleccionado) {
      this.initialEditorSnapshot = null;
      this.editorChangedFromBaseline = false;
      return;
    }

    this.editorChangedFromBaseline = false;
    this.initialEditorSnapshot = this.captureMoveSnapshot();
  }

  verMapa(bus: any, busIndex?: number): void {
    const reservas = Array.isArray(bus?.reservas) ? bus.reservas : [];
    const idx = typeof busIndex === 'number'
      ? busIndex
      : this.planSeleccionado?.buses ? this.planSeleccionado.buses.indexOf(bus) : -1;
    const order = idx >= 0 ? this.stopOrderByBus.get(idx) : undefined;

    let reservasOrdenadas: Reserva[];
    if (order) {
      // Deduplicar: una reserva multi-punto aparece en varias paradas de groupStops.
      // El mapa solo necesita verla una vez (usará su puntoPrincipal para el pin).
      const seen = new Set<number | string>();
      reservasOrdenadas = groupProgramacionStops(reservas, order)
        .flatMap(stop => stop.reservas)
        .filter(r => {
          if (seen.has(r.Id_Reserva)) return false;
          seen.add(r.Id_Reserva);
          return true;
        });
    } else {
      reservasOrdenadas = reservas;
    }

    this.drawerService.openMapa(reservasOrdenadas, this.getTourMapDestination());
  }

  viewReservation(reservationId: string): void {
    this.drawerService.openReserva(String(reservationId));
  }

  private normalizeBusMetadata(): void {
    if (!this.planSeleccionado) return;

    this.planSeleccionado.buses = this.planSeleccionado.buses.map((bus, index) => {
      const identifier = String(bus.id || '').trim();
      return {
        ...bus,
        id: identifier || `Bus ${index + 1}`,
        guia: String(bus.guia || '').trim(),
        capacidadManual: Boolean(bus.capacidadManual)
      };
    });
  }

  private validateRequiredGuides(busIndexes?: number[]): boolean {
    if (!this.planSeleccionado) return false;

    const indexes = busIndexes
      ?? this.planSeleccionado.buses.map((_, index) => index);
    const missing = indexes.filter((index) => {
      const bus = this.planSeleccionado?.buses[index];
      return Boolean(bus) && !String(bus.guia || '').trim();
    });

    if (!missing.length) return true;

    const busNames = missing.map((index) => {
      const bus = this.planSeleccionado?.buses[index];
      return bus?.id || `Bus ${index + 1}`;
    });
    this.selectBus(missing[0]);
    this.navbar.showAlert({
      type: 'warning',
      title: missing.length === 1 ? 'Falta asignar un guía' : `Faltan guías en ${missing.length} buses`,
      message: `Asigna un guía antes de continuar: ${busNames.join(', ')}.`
    });
    return false;
  }

  private validateUniqueBusIdentifiers(): boolean {
    if (!this.planSeleccionado) return false;

    const identifiers = this.planSeleccionado.buses.map((bus) => String(bus.id || '').trim());
    const normalized = identifiers.map((identifier) => identifier.toLocaleLowerCase('es'));
    const duplicateKeys = Array.from(new Set(
      normalized.filter((identifier) => normalized.indexOf(identifier) !== normalized.lastIndexOf(identifier))
    ));
    const duplicates = duplicateKeys.map((identifier) => identifiers[normalized.indexOf(identifier)]);

    if (!duplicates.length) return true;

    const firstDuplicateIndex = normalized.findIndex(
      (identifier, index) => normalized.indexOf(identifier) !== normalized.lastIndexOf(identifier)
        && index === normalized.lastIndexOf(identifier)
    );
    if (firstDuplicateIndex >= 0) this.selectBus(firstDuplicateIndex);

    this.navbar.showAlert({
      type: 'warning',
      title: duplicates.length === 1 ? 'Identificador repetido' : 'Identificadores repetidos',
      message: `Cada bus debe tener un identificador diferente. Corrige: ${duplicates.join(', ')}.`
    });
    return false;
  }

  private validateBusCapacities(): boolean {
    if (!this.planSeleccionado) return false;
    const invalidIndex = this.planSeleccionado.buses.findIndex((bus) => {
      const capacity = Number(bus.capacidad || 0);
      const occupied = Number(bus.ocupados || 0);
      return !Number.isInteger(capacity) || capacity < 1 || capacity > 200 || capacity < occupied;
    });
    if (invalidIndex < 0) return true;

    const bus = this.planSeleccionado.buses[invalidIndex];
    this.selectBus(invalidIndex);
    this.navbar.showAlert({
      type: 'warning',
      title: 'Capacidad del bus no válida',
      message: `${bus.id || `Bus ${invalidIndex + 1}`} tiene ${bus.ocupados || 0} pasajeros. La capacidad debe ser un número entero entre ${Math.max(1, Number(bus.ocupados || 0))} y 200.`
    });
    return false;
  }

  async guardarListadoFinal(options: { skipConfirmation?: boolean } = {}): Promise<void> {
    if (!this.canUpdateProgramacion) {
      this.navbar.warningToast('Acción no permitida', 'No tienes permiso para guardar el listado.');
      return;
    }

    if (!this.planSeleccionado || !this.tourSeleccionado) return;

    if (this.reservasSinAsignar.length > 0) {
      const pendingReservations = this.reservasSinAsignar.length;
      const pendingPassengers = this.totalPaxUnassigned;
      this.selectBus(-1);
      this.navbar.showAlert({
        type: 'warning',
        title: `${pendingReservations} ${pendingReservations === 1 ? 'reserva está' : 'reservas están'} sin asignar`,
        message: `Ubica ${pendingReservations === 1 ? 'la reserva pendiente' : 'las reservas pendientes'} (${pendingPassengers} pax) en un bus antes de guardar el listado.`,
      });
      return;
    }

    this.normalizeBusMetadata();
    if (!this.validateRequiredGuides()) return;
    if (!this.validateUniqueBusIdentifiers()) return;
    if (!this.validateBusCapacities()) return;

    const busesOrdenados = this.planSeleccionado.buses.map((bus) => ({
      ...bus,
      reservas: bus.reservas || []
    }));

    if (!options.skipConfirmation) {
      const totalReservas = busesOrdenados.reduce(
        (total, bus) => total + (bus.reservas?.length || 0),
        0
      );
      const totalPasajeros = busesOrdenados.reduce(
        (total, bus) => total + Number(bus.ocupados || 0),
        0
      );
      const nombreTour = this.tourSeleccionado.NombreTour || 'el tour seleccionado';
      const destino = this.listadoPersistido
        ? 'Esto reemplazará el listado guardado actualmente.'
        : 'Este será el listado operativo disponible para consulta.';
      const confirmed = await this.alerts.confirmDecision(
        '¿Guardar este listado?',
        `Se guardarán ${busesOrdenados.length} buses, ${totalReservas} reservas y ${totalPasajeros} pasajeros para ${nombreTour}, ${this.formatOperationDate(this.fechaSeleccionada)}. ${destino}`,
        {
          type: 'info',
          confirmText: 'Guardar listado',
          cancelText: 'Seguir revisando',
        }
      );
      if (!confirmed) return;
    }

    if (this.isSaving || !this.planSeleccionado || !this.tourSeleccionado) return;

    const payload: any = {
      fecha: this.fechaSeleccionada,
      buses: busesOrdenados,
      busesPrivados: this.busesPrivados || []
    };

    if ((this.tourSeleccionado as any).idsTours) {
      payload.idsTours = (this.tourSeleccionado as any).idsTours;
    } else {
      payload.idTour = this.tourSeleccionado.Id_Tour;
    }

    this.isSaving = true;
    this.programacionService.guardarListadoFinal(payload).pipe(
      finalize(() => {
        this.isSaving = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.listadoDirty = false;
        this.listadoPersistido = true;
        this.listadoOrigen = 'db';
        this.reservasSinAsignar = [];
        this.resetEditorState();
        if (this.isEditorRoute) {
          void this.navigateToDashboard();
          return;
        }
        this.modoVista = 'dashboard';
        this.cargarToursDelDia();
      },
      error: (err) => {
        console.error('Error al guardar', err);
        const backendMessage = String(err?.error?.message || '').trim();
        const backendDetails = Array.isArray(err?.error?.details)
          ? err.error.details.map((detail: unknown) => String(detail || '').trim()).filter(Boolean).slice(0, 4)
          : [];
        this.navbar.showAlert({
          type: 'error',
          title: 'No pudimos guardar el listado',
          message: backendMessage
            ? `${backendMessage}${backendDetails.length ? ` ${backendDetails.join(' ')}` : ''}`
            : 'Tus cambios siguen en pantalla. Revisa la conexión e inténtalo nuevamente.',
        });
      }
    });
  }

  descargarListadoBus(index: number): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;
    this.normalizeBusMetadata();
    if (!this.validateRequiredGuides([index])) return;

    const bus = this.planSeleccionado.buses[index];
    if (!bus) return;

    const payload = {
      fecha: this.fechaSeleccionada,
      idTour: this.tourSeleccionado.Id_Tour,
      bus,
      nombreTour: this.tourSeleccionado.NombreTour,
    };

    this.programacionService.exportarListadoBus(payload).subscribe({
      next: (blob) => {
        const placa = bus.id && String(bus.id).trim() ? bus.id : `Bus_${index + 1}`;
        const nombre = this.tourSeleccionado?.NombreTour?.replace(/\s+/g, '_') || 'Tour';
        const filename = `${this.fechaSeleccionada}_${nombre}_${placa}.xlsx`;
        this.downloadBlob(blob, filename);
      },
      error: (err) => {
        console.error('Error al exportar listado del bus', err);
        this.navbar.showAlert({ type: 'error', title: 'Error', message: 'No se pudo exportar el listado del bus.' });
      }
    });
  }

  descargarTodosLosListados(): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;
    this.normalizeBusMetadata();
    if (!this.validateRequiredGuides()) return;
    if (!this.validateUniqueBusIdentifiers()) return;

    const payload = {
      fecha: this.fechaSeleccionada,
      idTour: this.tourSeleccionado.Id_Tour,
      buses: this.planSeleccionado.buses,
      nombreTour: this.tourSeleccionado.NombreTour,
    };

    this.programacionService.exportarListadosZip(payload).subscribe({
      next: (blob) => {
        const tour = this.tourSeleccionado?.NombreTour?.replace(/\s+/g, '_') || 'Tour';
        this.downloadBlob(blob, `${this.fechaSeleccionada}_${tour}_listados.zip`);
      },
      error: (err) => {
        console.error('Error al exportar todos los listados', err);
        this.navbar.showAlert({
          type: 'error',
          title: 'No pudimos exportar los listados',
          message: 'Los archivos individuales siguen disponibles desde cada bus.'
        });
      }
    });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private emptyTransfersResponse(fecha: string): TransfersProgramacionResponse {
    return {
      fecha,
      totalTransfers: 0,
      totalPasajeros: 0,
      totalServicios: 0,
      totalPendientes: 0,
      servicios: [],
      transfers: [],
    };
  }

  private generarPlanDesdeCero(tour: TourProgramacion): void {
    this.isPageLoading = true;
    this.editorLoadingMode = 'generating';
    // La aplicación usa detección zoneless. Esta función también puede entrar
    // desde timers y suscripciones, que no garantizan un nuevo render por sí solos.
    this.cdr.detectChanges();

    this.editorSubscription?.unsubscribe();
    this.editorSubscription = this.programacionService.generarPlanLogistico(
      this.fechaSeleccionada,
      ((tour as any).idsTours || tour.Id_Tour) as any
    ).subscribe({
      next: (plan: any) => {
        this.routingFallback = plan?.fuenteDistancias === 'haversine-local';
        const esFormatoNuevo = Array.isArray(plan) || Array.isArray(plan?.buses);
        this.listadoPersistido = false;
        this.listadoDirty = false;
        this.listadoOrigen = 'nuevo';

        if (esFormatoNuevo) {
          const busesGenerados = Array.isArray(plan) ? plan : (plan?.buses || []);
          const reservasSinAsignar = Array.isArray(plan) ? [] : (plan?.reservasSinAsignar || []);
          const destinoTour = Array.isArray(plan) ? null : (plan?.destinoTour || null);
          this.busesPrivados = plan?.privados || [];
          const sugerencia = this.construirSugerenciaDesdeListado({ buses: busesGenerados, reservasSinAsignar });
          const totalPasajeros = sugerencia.buses.reduce((sum, b) => sum + (b.ocupados || 0), 0)
            + reservasSinAsignar.reduce((sum: number, r: Reserva) => sum + (r.NumeroPasajeros || 0), 0);
          const totalReservas = sugerencia.buses.reduce((sum, b) => sum + (b.reservas?.length || 0), 0)
            + reservasSinAsignar.length;

          tour.planGenerado = {
            analisis: {
              fecha: this.fechaSeleccionada,
              idTour: tour.Id_Tour,
              totalPasajeros,
              totalReservas
            },
            sugerencias: [sugerencia],
            mensaje: 'Plan logistico generado correctamente'
          } as any;
          tour.totalPasajeros = totalPasajeros;
          tour.totalReservas = totalReservas;

          this.reservasSinAsignar = reservasSinAsignar;
          this.destinoTourActual = destinoTour;
          this.planSeleccionado = JSON.parse(JSON.stringify(sugerencia));
          renumberGenericBuses(this.planSeleccionado?.buses);
          this.qualitySummary = this.buildQualitySummary(this.planSeleccionado?.buses || [], reservasSinAsignar);
          this.modoVista = 'editor';
        } else {
          tour.planGenerado = plan;
          tour.totalPasajeros = plan?.analisis?.totalPasajeros || 0;
          tour.totalReservas = plan?.analisis?.totalReservas || 0;

          this.reservasSinAsignar = [];
          this.destinoTourActual = plan?.destinoTour || null;
          this.planSeleccionado = JSON.parse(JSON.stringify(plan?.sugerencias?.[0] || { buses: [] }));
          renumberGenericBuses(this.planSeleccionado?.buses);
          this.qualitySummary = this.buildQualitySummary(this.planSeleccionado?.buses || [], []);
          this.modoVista = 'editor';
        }

        this.activeBusIndex = 0;
        this.stopOrderByBus.clear();
        this.rebuildActiveStops();
        this.captureInitialEditorState();
        this.notifyRouteQuality();

        this.isPageLoading = false;
        this.editorLoadingMode = null;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(`Error al generar plan para ${tour.NombreTour}`, err);
        this.isPageLoading = false;
        this.editorLoadingMode = null;
        this.cdr.markForCheck();
        this.navbar.showAlert({
          type: 'error',
          title: 'No pudimos preparar el listado',
          message: 'No se perdió información. Revisa la conexión y vuelve a intentarlo desde el servicio.',
        });
      }
    });
  }

  private construirSugerenciaDesdeListado(data: any): Sugerencia {
    const buses = Array.isArray(data?.buses) ? data.buses : [];
    const combinacion = buses.map((b: Bus) => b.capacidad || 0).sort((a: number, b: number) => a - b);
    const totalCapacidad = buses.reduce((sum: number, b: Bus) => sum + (b.capacidad || 0), 0);
    const totalOcupados = buses.reduce((sum: number, b: Bus) => sum + (b.ocupados || 0), 0);
    const ocupacionPromedio = totalCapacidad ? totalOcupados / totalCapacidad : 0;

    return {
      combinacion,
      buses,
      costoTotalKm: 0,
      ocupacionPromedio,
      totalBuses: buses.length,
      reservasSinAsignar: data?.reservasSinAsignar || []
    };
  }

  private aplicarPlan(tour: TourProgramacion, sugerencia: Sugerencia, reservasSinAsignar: Reserva[], privados: any[] = [], destinoTour: DestinoTourProgramacion | null = null): void {
    this.routingFallback = false;
    this.listadoPersistido = true;
    this.listadoDirty = false;
    this.listadoOrigen = 'db';

    const totalPasajeros = sugerencia.buses.reduce((sum, b) => sum + (b.ocupados || 0), 0)
      + reservasSinAsignar.reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);
    const totalReservas = sugerencia.buses.reduce((sum, b) => sum + (b.reservas?.length || 0), 0)
      + reservasSinAsignar.length;

    tour.totalPasajeros = totalPasajeros;
    tour.totalReservas = totalReservas;

    this.planSeleccionado = JSON.parse(JSON.stringify(sugerencia));
    renumberGenericBuses(this.planSeleccionado?.buses);
    this.reservasSinAsignar = reservasSinAsignar || [];
    this.qualitySummary = this.buildQualitySummary(this.planSeleccionado?.buses || [], this.reservasSinAsignar);
    this.busesPrivados = privados || [];
    this.destinoTourActual = destinoTour;
    this.modoVista = 'editor';

    this.activeBusIndex = 0;
    this.stopOrderByBus.clear();
    this.rebuildActiveStops();
    this.captureInitialEditorState();
    this.notifyRouteQuality();

    this.cdr.markForCheck();
  }

  private notifyRouteQuality(): void {
    const quality = this.qualitySummary;
    if (!this.routingFallback && !quality) return;

    const details: string[] = [];
    if (this.routingFallback) {
      details.push('OSRM no estuvo disponible; se usó distancia directa como respaldo.');
    }
    if (quality?.missingCoordinates) {
      details.push(
        `${quality.missingCoordinates} ${quality.missingCoordinates === 1 ? 'punto no tiene' : 'puntos no tienen'} coordenadas.`
      );
    }
    if (quality?.missingRoute) {
      details.push(
        `${quality.missingRoute} ${quality.missingRoute === 1 ? 'punto no tiene' : 'puntos no tienen'} ruta operativa.`
      );
    }

    const affected = quality?.affectedReservations || 0;
    const title = affected
      ? `${affected} ${affected === 1 ? 'reserva requiere' : 'reservas requieren'} revisar sus puntos`
      : 'Ruta estimada con distancia directa';

    this.alerts.warningToast(title, details.join(' '), 9000);
  }

  private buildQualitySummary(buses: Bus[], unassigned: Reserva[]): ProgramacionQualitySummary | null {
    const reservations = [
      ...buses.flatMap((bus) => bus.reservas || []),
      ...(unassigned || [])
    ];
    const affected = new Set<string>();
    let missingCoordinates = 0;
    let missingRoute = 0;

    for (const reservation of reservations) {
      const points = Array.isArray((reservation as any).puntosReserva) && (reservation as any).puntosReserva.length
        ? (reservation as any).puntosReserva
        : [reservation];

      let reservationMissingCoordinates = false;
      let reservationMissingRoute = false;
      for (const point of points) {
        const lat = this.parseCoordinate(point?.Latitud);
        const lng = this.parseCoordinate(point?.Longitud);
        if (lat === null || lng === null || Math.abs(lat) < 0.0001 || Math.abs(lng) < 0.0001) {
          missingCoordinates += 1;
          reservationMissingCoordinates = true;
        }

        const route = String(point?.ruta ?? point?.Ruta ?? reservation.ruta ?? '').trim().toUpperCase();
        if (!route || route === 'PENDIENTE') {
          missingRoute += 1;
          reservationMissingRoute = true;
        }
      }

      if (reservationMissingCoordinates || reservationMissingRoute) {
        affected.add(String(reservation.Id_Reserva));
      }
    }

    if (!missingCoordinates && !missingRoute) return null;
    return { missingCoordinates, missingRoute, affectedReservations: affected.size };
  }

  private abrirVistaListadoGuardado(
    tour: TourProgramacion,
    sugerencia: Sugerencia,
    reservasSinAsignar: Reserva[]
  ): void {
    const snapshot = JSON.parse(JSON.stringify(sugerencia)) as Sugerencia;
    const pendientes = JSON.parse(JSON.stringify(reservasSinAsignar || [])) as Reserva[];

    this.drawerService.openProgramacionListado({
      tourName: tour.NombreTour,
      operationDate: this.fechaSeleccionada,
      buses: snapshot.buses,
      unassigned: pendientes,
      canEdit: this.canUpdateProgramacion,
      onEdit: () => {
        this.navigateToEditor(tour);
      },
      onRegenerate: () => {
        this.navigateToEditor(tour, { regenerate: true });
      }
    });
  }

  private mostrarAlertaReservasSinAsignar(tour: TourProgramacion, reservas: Reserva[]): void {
    if (!reservas?.length) return;

    this.navbar.showConfirm(
      'Reservas sin asignar',
      `Se encontraron ${reservas.length} reservas nuevas. Puedes regenerar el listado para incluirlas automáticamente o conservarlo y asignarlas manualmente.`,
      [
        {
          text: 'Regenerar listado',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            this.generarPlanDesdeCero(tour);
          }
        },
        {
          text: 'Mantener listado',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        }
      ]
    );
  }

  crearNuevoBus(reserva: Reserva): void {
    if (!this.planSeleccionado) return;

    const capacidad = bestBusCapacity(reserva.NumeroPasajeros, this.CAPACIDADES_BUSES) || this.CAPACIDADES_BUSES[0];
    const nuevoBus: Bus = {
      id: '',
      capacidad,
      capacidadManual: false,
      ocupados: reserva.NumeroPasajeros,
      reservas: [reserva],
      recorridoKm: 0
    };

    this.planSeleccionado.buses.push(nuevoBus);
    renumberGenericBuses(this.planSeleccionado.buses);
    this.markDirty();
  }

  removerBusesVacios(): void {
    if (!this.planSeleccionado) return;
    const busesAnteriores = [...this.planSeleccionado.buses];
    const ordenAnterior = new Map(this.stopOrderByBus);
    const busesFiltrados = this.planSeleccionado.buses.filter(bus => bus.reservas && bus.reservas.length > 0);

    this.planSeleccionado.buses = busesFiltrados;
    renumberGenericBuses(this.planSeleccionado.buses);

    const nuevaMapa = new Map<number, string[]>();
    busesFiltrados.forEach((bus, newIndex) => {
      const oldIndex = busesAnteriores.findIndex(b => b === bus);
      if (oldIndex !== -1 && ordenAnterior.has(oldIndex)) {
        nuevaMapa.set(newIndex, ordenAnterior.get(oldIndex) || []);
      }
    });

    this.stopOrderByBus = nuevaMapa;
  }

  recalcularOcupacion(): void {
    this.planSeleccionado?.buses.forEach(bus => {
      bus.ocupados = bus.reservas.reduce((sum, r) => sum + r.NumeroPasajeros, 0);
      const needed = bus.ocupados || 0;
      if (bus.capacidadManual) return;
      const best = bestBusCapacity(needed, this.CAPACIDADES_BUSES);
      if (best && best !== bus.capacidad) bus.capacidad = best;
    });
  }

  private ordenarReservasPorParadas(reservas: Reserva[], busIndex: number): Reserva[] {
    const order = this.stopOrderByBus.get(busIndex);
    if (!order?.length) return [...reservas];

    const rank = new Map(order.map((key, i) => [key, i]));
    return [...reservas]
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const ra = rank.get(reservationPointKey(a.r));
        const rb = rank.get(reservationPointKey(b.r));
        const oa = ra !== undefined ? ra : Number.MAX_SAFE_INTEGER;
        const ob = rb !== undefined ? rb : Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return a.idx - b.idx;
      })
      .map((x) => x.r);
  }

  private rebuildActiveStops(): void {
    const bus = this.activeBus;
    if (!bus) {
      this.activeStops = [];
      return;
    }

    const order = this.stopOrderByBus.get(this.activeBusIndex);
    this.activeStops = groupProgramacionStops(bus.reservas, order);
  }

  private syncAfterPlanMutation(options?: { updateMap?: boolean }): void {
    this.recalcularOcupacion();
    this.removerBusesVacios();
    this.normalizarActiveBusIndex();
    this.rebuildActiveStops();
    this.markDirty();

    if (options?.updateMap) {
      this.updateOpenMapForActiveBus();
    }

    this.cdr.markForCheck();
  }

  private normalizarActiveBusIndex(): void {
    if (!this.planSeleccionado?.buses?.length) {
      this.activeBusIndex = 0;
      return;
    }

    if (this.activeBusIndex === -1) {
      if (this.reservasSinAsignar.length > 0) return;
      this.activeBusIndex = 0;
    }

    this.activeBusIndex = Math.min(this.activeBusIndex, this.planSeleccionado.buses.length - 1);
    if (this.activeBusIndex < 0) this.activeBusIndex = 0;
  }

  private getReservasOrdenadasDelBusActivo(): Reserva[] {
    if (!this.activeBus) return [];
    if (this.activeBusIndex === -1) return this.reservasSinAsignar || [];
    return this.ordenarReservasPorParadas(this.activeBus.reservas || [], this.activeBusIndex);
  }

  private updateOpenMapForActiveBus(): void {
    if (this.drawerService.drawer()?.type !== 'mapa') return;
    const reservas = this.getReservasOrdenadasDelBusActivo();
    this.drawerService.openMapa(reservas, this.getTourMapDestination());
  }

  private getTourMapDestination(): DrawerMapDestination | null {
    const destino = this.destinoTourActual;
    if (!destino) return null;

    const normalizarPunto = (punto: any, nombreFallback: string) => {
      const lat = this.parseCoordinate(punto?.lat);
      const lng = this.parseCoordinate(punto?.lng);
      return lat === null || lng === null ? null : {
        lat,
        lng,
        nombre: String(punto?.nombre || '').trim() || nombreFallback,
      };
    };

    const paradaExplicita = normalizarPunto(destino.primeraParadaOperativa, 'Primera parada operativa');
    const tour = normalizarPunto(destino.tour, this.tourSeleccionado?.NombreTour || 'Tour');
    // Respuestas antiguas: los campos planos representaban la parada operativa.
    const paradaLegacy = paradaExplicita
      ? null
      : normalizarPunto(destino, destino.nombre || 'Primera parada operativa');
    const primeraParadaOperativa = paradaExplicita || paradaLegacy;

    if (!primeraParadaOperativa && !tour) return null;

    return {
      horaSalidaBase: destino.horaSalidaBase || null,
      primeraParadaOperativa,
      tour,
    };
  }

  private parseCoordinate(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    const parsed = Number(value.replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

}
