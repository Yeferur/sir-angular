import { Component, inject, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { InicioService } from '../../../services/inicio';
import { Sugerencia, TourProgramacion, Bus, Reserva, DestinoTourProgramacion } from '../../../interfaces/Programacion/reservas';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, switchMap, of, finalize, Subscription } from 'rxjs';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { SirAlertService, type AlertButton, type SirModalAlert } from '../../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { ProgramacionDashboardComponent } from './programacion-dashboard';
import { ProgramacionEditorComponent } from './programacion-editor';
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
  modoVista: 'dashboard' | 'editor' | 'privados' = 'dashboard';

  tourSeleccionado: TourProgramacion | null = null;
  planSeleccionado: Sugerencia | null = null;
  listadoDirty = false;
  listadoPersistido = false;
  listadoOrigen: 'nuevo' | 'db' | null = null;
  routingFallback = false;
  qualitySummary: ProgramacionQualitySummary | null = null;

  readonly CAPACIDADES_BUSES = [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b);

  isDragging = false;

  reservasSinAsignar: Reserva[] = [];
  busesPrivados: any[] = [];  // buses para reservas privadas del día
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

  ngOnInit(): void {
    this.cargarToursDelDia();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.editorSubscription?.unsubscribe();
  }

  hasUnsavedChanges(): boolean {
    return this.listadoDirty && !this.isSaving;
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

  cargarToursDelDia(): void {
    const requestSequence = ++this.loadSequence;
    this.loadSubscription?.unsubscribe();
    this.loadError = '';
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
      this.cargarToursDelDia();
    });
  }

  private resetEditorState(): void {
    this.planSeleccionado = null;
    this.tourSeleccionado = null;
    this.activeBusIndex = 0;
    this.activeStops = [];
    this.stopOrderByBus.clear();
    this.listadoDirty = false;
    this.listadoPersistido = false;
    this.listadoOrigen = null;
    this.busesPrivados = [];
    this.destinoTourActual = null;
    this.routingFallback = false;
    this.qualitySummary = null;
    this.editorLoadingMode = null;
  }

  markDirty(): void {
    this.listadoDirty = true;
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
            this.guardarListadoFinal();
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

  generarPlan(tour: TourProgramacion): void {
    const isGenerated = tour.estado === 'Generado' || tour.estado === 'Confirmado';
    if (!isGenerated && !this.canCreateProgramacion) {
      this.navbar.warningToast('Acción no permitida', 'No tienes permiso para generar programación.');
      return;
    }

    this.isPageLoading = true;
    this.editorLoadingMode = tour.estado === 'Generado' ? 'saved' : 'generating';

    this.tourSeleccionado = tour;

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
          this.abrirVistaListadoGuardado(
            tour,
            sugerencia,
            data.reservasSinAsignar || [],
            data.privados || [],
            data.destinoTour || null
          );
          return;
        }

        this.generarPlanDesdeCero(tour);
      },
      error: (err) => {
        console.error('Error al consultar listados', err);
        this.isPageLoading = false;
        this.generarPlanDesdeCero(tour);
      }
    });
  }

  abrirVistaPrivados(): void {
    if (this.totalReservasPrivadas === 0) return;
    this.confirmarPerdidaCambios(() => {
      const privadosActuales = Array.isArray(this.busesPrivados)
        ? JSON.parse(JSON.stringify(this.busesPrivados))
        : [];
      this.resetEditorState();
      this.busesPrivados = privadosActuales;
      this.modoVista = 'privados';
      this.listadoOrigen = privadosActuales.length > 0 ? 'db' : 'nuevo';
      this.cdr.markForCheck();
    });
  }

  volverAlDashboard(): void {
    this.confirmarPerdidaCambios(() => {
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

  // Drop lists: destinos (buses) + new-bus + active-bus como fuente
  get connectedDropLists(): string[] {
    if (!this.planSeleccionado) return [];
    const ids = this.planSeleccionado.buses.map((_, i) => `busdrop-${i}`);
    ids.push('new-bus');
    ids.push('active-bus');
    return ids;
  }

  onDragStarted(): void {
    this.isDragging = true;
    this.cdr.markForCheck();
  }

  onDragEnded(): void {
    this.isDragging = false;
    this.cdr.markForCheck();
  }

  // Reordenar paradas: actualiza el array real para que mapa, guardado y Excel vean el mismo orden.
  dropStop(event: CdkDragDrop<ViewStop[]>): void {
    if (event.previousContainer !== event.container) return;

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

  // Mover reservas entre buses (principal)
  dropReserva(event: CdkDragDrop<Reserva[]>): void {
    if (!this.planSeleccionado) return;

    this.isDragging = false;

    const reserva = event.previousContainer.data[event.previousIndex];
    if (!reserva) return;

    if (event.previousContainer === event.container) {
      this.cdr.markForCheck();
      return;
    }

    if (event.container.id === 'new-bus') {
      const moved = event.previousContainer.data.splice(event.previousIndex, 1)[0];
      if (!moved) return;

      this.crearNuevoBus(moved);
      this.activeBusIndex = this.planSeleccionado.buses.length - 1;
      this.rebuildActiveStops();
      this.syncAfterPlanMutation({ updateMap: true });
      this.cdr.markForCheck();
      return;
    }

    // Identifica bus destino por id del contenedor
    const destinoBus = this.findBusByContainerId(event.container.id);
    if (!destinoBus) return;

    const nuevaCarga = (destinoBus.ocupados || 0) + (reserva.NumeroPasajeros || 0);
    const mejorCapacidad = bestBusCapacity(nuevaCarga, this.CAPACIDADES_BUSES);

    if (!mejorCapacidad) {
      this.navbar.showAlert({
        type: 'error',
        title: 'Capacidad insuficiente',
        message: 'No existe un bus con capacidad suficiente.',
        autoClose: true,
        autoCloseTime: 2500
      });
      return;
    }

    destinoBus.capacidad = mejorCapacidad;

    const moved = event.previousContainer.data.splice(event.previousIndex, 1)[0];
    if (!moved) return;

    event.container.data.splice(event.currentIndex, 0, moved);

    this.syncAfterPlanMutation({ updateMap: true });
    this.cdr.markForCheck();
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

  guardarListadoFinal(): void {
    if (!this.canUpdateProgramacion) {
      this.navbar.warningToast('Acción no permitida', 'No tienes permiso para guardar el listado.');
      return;
    }

    if (!this.planSeleccionado || !this.tourSeleccionado) return;

    if (this.reservasSinAsignar.length > 0) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'Hay reservas sin asignar',
        message: 'Asigna todas las reservas pendientes a un bus antes de guardar el listado.',
      });
      return;
    }

    this.planSeleccionado.buses = this.planSeleccionado.buses.map((b, i) => {
      const placa = (b.id || '').trim();
      return {
        ...b,
        id: placa.length ? placa : `Bus ${i + 1}`,
        guia: b.guia ? String(b.guia).trim() : ''
      };
    });

    const placas = this.planSeleccionado.buses.map(b => b.id);
    const placasUnicas = new Set(placas);
    if (placasUnicas.size !== placas.length) {
      this.navbar.showAlert({ type: 'error', title: 'Error', message: 'Las placas de los buses deben ser únicas.', autoClose: true, autoCloseTime: 2000 });
      return;
    }

    const busesOrdenados = this.planSeleccionado.buses.map((bus) => ({
      ...bus,
      reservas: bus.reservas || []
    }));

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
        this.modoVista = 'dashboard';
        this.cargarToursDelDia();
      },
      error: (err) => {
        console.error('Error al guardar', err);
        this.navbar.showAlert({
          type: 'error',
          title: 'No pudimos guardar el listado',
          message: 'Tus cambios siguen en pantalla. Revisa la conexión e inténtalo nuevamente.',
        });
      }
    });
  }

  descargarListadoBus(index: number): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;
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

  descargarReservaPrivadaExcel(grupo: any): void {
    if (!grupo?.Id_Reserva || !Array.isArray(grupo?.buses) || grupo.buses.length === 0) return;

    const payload = {
      fecha: this.fechaSeleccionada,
      idReserva: grupo.Id_Reserva,
      idTour: Number(grupo.buses[0]?.Id_Tour || 0) || undefined,
      nombreTour: grupo.Nombre_Tour || 'Privado',
      nombreReportante: grupo.Nombre_Reportante || '',
      buses: grupo.buses.map((bus: any, index: number) => ({
        id: bus.id || `Bus ${index + 1}`,
        guia: bus.guia || '',
        ocupados: Number(bus.ocupados || 0),
        capacidad: Number(bus.capacidad || 0),
        indice: Number(bus.indice || index + 1),
        totalBuses: Number(bus.totalBuses || grupo.buses.length || 1),
      })),
    };

    this.programacionService.exportarReservaPrivada(payload).subscribe({
      next: (blob) => {
        const reserva = String(grupo.Id_Reserva).replace(/\s+/g, '_');
        const nombre = String(grupo.Nombre_Tour || 'Privado').replace(/\s+/g, '_');
        const filename = `${this.fechaSeleccionada}_${nombre}_${reserva}.xlsx`;
        this.downloadBlob(blob, filename);
      },
      error: (err) => {
        console.error('Error al exportar reserva privada', err);
        this.navbar.showAlert({ type: 'error', title: 'Error', message: 'No se pudo exportar la reserva privada.' });
      }
    });
  }

  descargarTodosLosPrivadosExcel(): void {
    if (!this.gruposPrivados.length) return;
    this.gruposPrivados.forEach((grupo, index) => {
      window.setTimeout(() => this.descargarReservaPrivadaExcel(grupo), index * 250);
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

  private generarPlanDesdeCero(tour: TourProgramacion): void {
    this.isPageLoading = true;
    this.editorLoadingMode = 'generating';

    this.editorSubscription?.unsubscribe();
    this.editorSubscription = this.programacionService.generarPlanLogistico(
      this.fechaSeleccionada,
      ((tour as any).idsTours || tour.Id_Tour) as any
    ).subscribe({
      next: (plan: any) => {
        this.routingFallback = plan?.fuenteDistancias === 'haversine-local';
        const esFormatoNuevo = Array.isArray(plan) || Array.isArray(plan?.buses);
        this.listadoPersistido = false;
        this.listadoDirty = true;
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

        this.isPageLoading = false;
        this.editorLoadingMode = null;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(`Error al generar plan para ${tour.NombreTour}`, err);
        this.isPageLoading = false;
        this.editorLoadingMode = null;
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

    this.cdr.markForCheck();
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
    reservasSinAsignar: Reserva[],
    privados: any[] = [],
    destinoTour: DestinoTourProgramacion | null = null
  ): void {
    const snapshot = JSON.parse(JSON.stringify(sugerencia)) as Sugerencia;
    const pendientes = JSON.parse(JSON.stringify(reservasSinAsignar || [])) as Reserva[];
    const privadosSnapshot = JSON.parse(JSON.stringify(privados || []));
    const destinoSnapshot = destinoTour ? { ...destinoTour } : null;

    this.drawerService.openProgramacionListado({
      tourName: tour.NombreTour,
      operationDate: this.fechaSeleccionada,
      buses: snapshot.buses,
      unassigned: pendientes,
      canEdit: this.canUpdateProgramacion,
      onEdit: () => {
        this.aplicarPlan(tour, snapshot, pendientes, privadosSnapshot, destinoSnapshot);
      },
      onRegenerate: () => {
        this.tourSeleccionado = tour;
        this.generarPlanDesdeCero(tour);
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
      const best = bestBusCapacity(needed, this.CAPACIDADES_BUSES);
      if (best && best !== bus.capacidad) bus.capacidad = best;
    });
  }

  private findBusByContainerId(containerId: string): Bus | undefined {
    const m = containerId.match(/^busdrop-(\d+)$/);
    if (!m) return undefined;
    const idx = Number(m[1]);
    return this.planSeleccionado?.buses[idx];
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

  private getTourMapDestination(): { lat: number; lng: number; nombre?: string } | null {
    const lat = this.parseCoordinate(this.destinoTourActual?.lat);
    const lng = this.parseCoordinate(this.destinoTourActual?.lng);

    if (lat === null || lng === null) return null;

    return {
      lat,
      lng,
      nombre: this.destinoTourActual?.nombre || this.tourSeleccionado?.NombreTour || 'Destino del tour'
    };
  }

  private parseCoordinate(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    const parsed = Number(value.replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

}
