import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { InicioService } from '../../../services/inicio';
import { Sugerencia, TourProgramacion, Bus, Reserva } from '../../../interfaces/Programacion/reservas';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { forkJoin, switchMap, of, finalize } from 'rxjs';

type ViewStop = {
  key: string;
  NombrePunto: string;
  reservas: Reserva[];
  totalPax: number;
};

@Component({
  selector: 'app-programacion-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, FlatpickrInputDirective],
  templateUrl: './listado.html',
  styleUrls: ['./listado.css']
})
export class Listado implements OnInit {
  private programacionService = inject(ProgramacionDashboardService);
  private inicioService = inject(InicioService);
  private cdr = inject(ChangeDetectorRef);
  private navbar = inject(DynamicIslandGlobalService);

  fechaSeleccionada: string = new Date().toISOString().split('T')[0];
  toursDelDia: TourProgramacion[] = [];
  isPageLoading = true;
  isUpdatingDate = false;
  modoVista: 'dashboard' | 'editor' = 'dashboard';

  tourSeleccionado: TourProgramacion | null = null;
  planSeleccionado: Sugerencia | null = null;

  readonly CAPACIDADES_BUSES = [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b);

  isDragging = false;
  newBusDropData: Reserva[] = [];

  reservasSinAsignar: Reserva[] = [];

  activeBusIndex = 0;
  activeStops: ViewStop[] = [];

  // guarda el orden de paradas por bus (solo UI)
  private stopOrderByBus = new Map<number, string[]>();

  ngOnInit(): void {
    this.cargarToursDelDia();
  }




  get totalPaxUnassigned(): number {
    return (this.reservasSinAsignar || []).reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);
  }

  fpOptionsFecha: Partial<FlatpickrOptions> = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],
    altInputClass: 'form-input flatpickr-input flatpickr-alt',
    onReady: (_sel, _str, inst: any) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const cal: HTMLElement = inst?.calendarContainer;
      if (!cal) return;
      cal.classList.add('sir-flatpickr');
    }
  };

  cargarToursDelDia(): void {
    const isInitialLoad = this.toursDelDia.length === 0;

    if (isInitialLoad) {
      this.isPageLoading = true;
    } else {
      this.isUpdatingDate = true;
    }

    // Obtener tours
    this.programacionService.getTours().pipe(
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
        return forkJoin({
          tours: of(tours), // Mantener referencia a tours  
          datosDelDia: this.inicioService.getDatosInicio(this.fechaSeleccionada),
          listados: tours.length > 0 ? forkJoin(listadoObservables) : of({})
        });
      }),
      finalize(() => {
        this.isPageLoading = false;
        this.isUpdatingDate = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (result: any) => {
        const tours = result.tours;
        const datosDelDia = result.datosDelDia;
        const listados = result.listados || {};

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
        console.error('Error al cargar tours del día', err);
        this.toursDelDia = [];
        this.cdr.markForCheck();
      }
    });
  }

  generarPlan(tour: TourProgramacion): void {
    this.isPageLoading = true;

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

    this.programacionService.obtenerListadoFinal(payload).subscribe({
      next: (data) => {
        if (data?.exists) {
          const sugerencia = this.construirSugerenciaDesdeListado(data);
          this.aplicarPlan(tour, sugerencia, data.reservasSinAsignar || []);
          this.mostrarAlertaReservasSinAsignar(tour, data.reservasSinAsignar || []);
          this.isPageLoading = false;
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

  volverAlDashboard(): void {
    this.modoVista = 'dashboard';
    this.planSeleccionado = null;
    this.reservasSinAsignar = [];
    this.tourSeleccionado = null;
    this.activeBusIndex = 0;
    this.activeStops = [];
    this.stopOrderByBus.clear();
  }

  selectBus(i: number): void {
    if (!this.planSeleccionado) return;
    // Allow -1 for unassigned
    if (i !== -1 && (i < 0 || i >= this.planSeleccionado.buses.length)) return;
    this.activeBusIndex = i;
    this.rebuildActiveStops();
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
    this.cdr.markForCheck();
  }

  nextBus(): void {
    if (!this.planSeleccionado?.buses?.length) return;
    this.activeBusIndex = (this.activeBusIndex + 1) % this.planSeleccionado.buses.length;
    this.rebuildActiveStops();
    this.cdr.markForCheck();
  }

  // Drop lists: destinos (buses) + new-bus + active-bus como fuente
  get connectedDropLists(): string[] {
    if (!this.planSeleccionado) return [];
    const ids = this.planSeleccionado.buses.map((_, i) => `busdrop-${i}`);
    ids.push('new-bus');
    ids.push('active-bus');
    ids.push('unassigned-bus');
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

  // Reordenar paradas (solo UI)
  dropStop(event: CdkDragDrop<ViewStop[]>): void {
    if (event.previousContainer !== event.container) return;

    moveItemInArray(this.activeStops, event.previousIndex, event.currentIndex);

    const order = this.activeStops.map(s => s.NombrePunto);
    this.stopOrderByBus.set(this.activeBusIndex, order);

    if (this.navbar.puntos()) {
      const reservasReordenadas = this.activeStops.flatMap(stop => stop.reservas);
      this.navbar.puntos.set(reservasReordenadas);
    }

    this.cdr.markForCheck();
  }

  // Mover reservas entre buses (principal)
  dropReserva(event: CdkDragDrop<Reserva[]>): void {
    if (!this.planSeleccionado) return;

    this.isDragging = false;

    const reserva = event.previousContainer.data[event.previousIndex];
    if (!reserva) return;

    // Crear nuevo bus
    if (event.container.id === 'unassigned-bus') {
      transferArrayItem(
        event.previousContainer.data,
        this.reservasSinAsignar,
        event.previousIndex,
        event.currentIndex
      );
      this.recalcularOcupacion();
      this.removerBusesVacios();
      // Si el bus activo era el unassigned, reconstruir
      if (this.activeBusIndex === -1) this.rebuildActiveStops();
      // Si el bus origen se vació y se borró, ajustar index
      if (this.activeBusIndex >= this.planSeleccionado.buses.length) {
        this.activeBusIndex = this.planSeleccionado.buses.length - 1;
      }
      this.cdr.markForCheck();
      return;
    }

    if (event.container.id === 'new-bus') {
      transferArrayItem(
        event.previousContainer.data,
        this.newBusDropData,
        event.previousIndex,
        0
      );

      this.crearNuevoBus(reserva);
      this.newBusDropData.length = 0;

      this.recalcularOcupacion();
      this.removerBusesVacios();

      // si removimos buses y el index cambió, lo ajustamos
      // si removimos buses y el index cambió, lo ajustamos
      // FIX: allow -1
      if (this.activeBusIndex !== -1) {
        this.activeBusIndex = Math.min(this.activeBusIndex, this.planSeleccionado.buses.length - 1);
        if (this.activeBusIndex < 0) this.activeBusIndex = 0;
      }

      this.rebuildActiveStops();
      if (this.activeBus && this.navbar.puntos()) {
        const reservasActualizadas = this.activeStops.flatMap(stop => stop.reservas);
        this.navbar.puntos.set(reservasActualizadas);
      }
      this.cdr.markForCheck();
      return;
    }

    // Si sueltan en el mismo contenedor, no reordenamos (sorting disabled en active-bus)
    if (event.previousContainer === event.container) {
      this.cdr.markForCheck();
      return;
    }

    // Identifica bus destino por id del contenedor
    const destinoBus = this.findBusByContainerId(event.container.id);
    if (!destinoBus) return;

    const nuevaCarga = (destinoBus.ocupados || 0) + (reserva.NumeroPasajeros || 0);
    const mejorCapacidad = this.findBestCapacityForPassengers(nuevaCarga);

    if (!mejorCapacidad) {
      this.navbar.alert.set({
        type: 'error',
        title: 'Capacidad insuficiente',
        message: 'No existe un bus con capacidad suficiente.',
        autoClose: true,
        autoCloseTime: 2500
      });
      return;
    }

    destinoBus.capacidad = mejorCapacidad;

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );

    this.recalcularOcupacion();
    this.removerBusesVacios();

    this.removerBusesVacios();

    if (this.activeBusIndex !== -1) {
      this.activeBusIndex = Math.min(this.activeBusIndex, this.planSeleccionado.buses.length - 1);
      if (this.activeBusIndex < 0) this.activeBusIndex = 0;
    }

    this.rebuildActiveStops();
    if (this.activeBus && this.navbar.puntos()) {
      const reservasActualizadas = this.activeStops.flatMap(stop => stop.reservas);
      this.navbar.puntos.set(reservasActualizadas);
    }
    this.cdr.markForCheck();
  }

  verMapa(bus: any, busIndex?: number): void {
    const reservas = Array.isArray(bus?.reservas) ? bus.reservas : [];
    const order = typeof busIndex === 'number' ? this.stopOrderByBus.get(busIndex) : undefined;
    const reservasOrdenadas = this.groupStops(reservas, order).flatMap(stop => stop.reservas);
    this.navbar.puntos.set(reservasOrdenadas);
  }

  guardarListadoFinal(): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;

    this.planSeleccionado.buses = this.planSeleccionado.buses.map((b, i) => {
      const placa = (b.id || '').trim();
      return {
        ...b,
        id: placa.length ? placa : `Bus ${i + 1}`
      };
    });

    const placas = this.planSeleccionado.buses.map(b => b.id);
    const placasUnicas = new Set(placas);
    if (placasUnicas.size !== placas.length) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Las placas de los buses deben ser únicas.', autoClose: true, autoCloseTime: 2000 });
      return;
    }

    const busesOrdenados = this.planSeleccionado.buses.map((bus, idx) => ({
      ...bus,
      reservas: this.ordenarReservasPorParadas(bus.reservas || [], idx)
    }));

    const payload: any = {
      fecha: this.fechaSeleccionada,
      buses: busesOrdenados
    };

    if ((this.tourSeleccionado as any).idsTours) {
      payload.idsTours = (this.tourSeleccionado as any).idsTours;
    } else {
      payload.idTour = this.tourSeleccionado.Id_Tour;
    }

    this.isPageLoading = true;
    this.programacionService.guardarListadoFinal(payload).subscribe({
      next: () => {
        this.isPageLoading = false;
        this.navbar.alert.set({ type: 'success', title: 'Listado guardado', message: 'El listado ha sido guardado exitosamente.', autoClose: true, autoCloseTime: 2000 });
        this.volverAlDashboard();
      },
      error: (err) => {
        this.isPageLoading = false;
        console.error('Error al guardar', err);
        this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Ha ocurrido un error al guardar el listado.', autoClose: true, autoCloseTime: 4000 });
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
        this.navbar.alert.set({ type: 'error', title: 'Error', message: 'No se pudo exportar el listado del bus.' });
      }
    });
  }

  descargarTodosLosListados(): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;
    this.planSeleccionado.buses.forEach((_, i) => this.descargarListadoBus(i));
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

    const payloadGen: any = { fecha: this.fechaSeleccionada };
    if ((tour as any).idsTours) {
      payloadGen.idsTours = (tour as any).idsTours;
    } else {
      payloadGen.idTour = tour.Id_Tour;
    }

    this.programacionService.generarPlanLogistico(this.fechaSeleccionada, ((tour as any).idsTours || tour.Id_Tour) as any).subscribe({
      next: (plan: any) => {
        const esFormatoNuevo = Array.isArray(plan);

        if (esFormatoNuevo) {
          const sugerencia = this.construirSugerenciaDesdeListado({ buses: plan, reservasSinAsignar: [] });
          const totalPasajeros = sugerencia.buses.reduce((sum, b) => sum + (b.ocupados || 0), 0);
          const totalReservas = sugerencia.buses.reduce((sum, b) => sum + (b.reservas?.length || 0), 0);

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
          tour.estado = 'Generado';
          tour.totalPasajeros = totalPasajeros;
          tour.totalReservas = totalReservas;

          this.reservasSinAsignar = [];
          this.planSeleccionado = JSON.parse(JSON.stringify(sugerencia));
          this.modoVista = 'editor';
        } else {
          tour.planGenerado = plan;
          tour.estado = 'Generado';
          tour.totalPasajeros = plan?.analisis?.totalPasajeros || 0;
          tour.totalReservas = plan?.analisis?.totalReservas || 0;

          this.reservasSinAsignar = [];
          this.planSeleccionado = JSON.parse(JSON.stringify(plan?.sugerencias?.[0] || { buses: [] }));
          this.modoVista = 'editor';
        }

        this.activeBusIndex = 0;
        this.stopOrderByBus.clear();
        this.rebuildActiveStops();

        this.isPageLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(`Error al generar plan para ${tour.NombreTour}`, err);
        this.isPageLoading = false;
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

  private aplicarPlan(tour: TourProgramacion, sugerencia: Sugerencia, reservasSinAsignar: Reserva[]): void {
    tour.estado = 'Generado';

    const totalPasajeros = sugerencia.buses.reduce((sum, b) => sum + (b.ocupados || 0), 0)
      + reservasSinAsignar.reduce((sum, r) => sum + (r.NumeroPasajeros || 0), 0);
    const totalReservas = sugerencia.buses.reduce((sum, b) => sum + (b.reservas?.length || 0), 0)
      + reservasSinAsignar.length;

    tour.totalPasajeros = totalPasajeros;
    tour.totalReservas = totalReservas;

    this.planSeleccionado = JSON.parse(JSON.stringify(sugerencia));
    this.reservasSinAsignar = reservasSinAsignar || [];
    this.modoVista = 'editor';

    this.activeBusIndex = 0;
    this.stopOrderByBus.clear();
    this.rebuildActiveStops();

    this.cdr.markForCheck();
  }

  private mostrarAlertaReservasSinAsignar(tour: TourProgramacion, reservas: Reserva[]): void {
    if (!reservas?.length) return;

    this.navbar.alert.set({
      type: 'warning',
      title: 'Reservas sin asignar',
      message: `Se encontraron ${reservas.length} reservas nuevas sin asignar.`,
      autoClose: false,
      buttons: [
        {
          text: 'Regenerar listado',
          style: 'primary',
          onClick: () => {
            this.navbar.alert.set(null);
            this.generarPlanDesdeCero(tour);
          }
        },
        {
          text: 'Mantener listado',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        }
      ]
    });
  }

  crearNuevoBus(reserva: Reserva): void {
    if (!this.planSeleccionado) return;

    const capacidad = this.findBestCapacityForPassengers(reserva.NumeroPasajeros) || this.CAPACIDADES_BUSES[0];
    const nuevoBus: Bus = {
      id: '',
      capacidad,
      ocupados: reserva.NumeroPasajeros,
      reservas: [reserva],
      recorridoKm: 0
    };

    this.planSeleccionado.buses.push(nuevoBus);
  }

  removerBusesVacios(): void {
    if (!this.planSeleccionado) return;
    this.planSeleccionado.buses = this.planSeleccionado.buses.filter(bus => bus.reservas && bus.reservas.length > 0);

    // resetea orden si cambian índices por filtrado
    this.stopOrderByBus.clear();
  }

  recalcularOcupacion(): void {
    this.planSeleccionado?.buses.forEach(bus => {
      bus.ocupados = bus.reservas.reduce((sum, r) => sum + r.NumeroPasajeros, 0);
      const needed = bus.ocupados || 0;
      const best = this.findBestCapacityForPassengers(needed);
      if (best && best !== bus.capacidad) bus.capacidad = best;
    });
  }

  private findBestCapacityForPassengers(pasajeros: number): number | null {
    if (!pasajeros || pasajeros <= 0) return this.CAPACIDADES_BUSES[0] ?? null;
    for (const c of this.CAPACIDADES_BUSES) {
      if (c >= pasajeros) return c;
    }
    return null;
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

    const rank = new Map(order.map((nombre, i) => [nombre, i]));
    return [...reservas]
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const ra = rank.get(a.r?.NombrePunto || '');
        const rb = rank.get(b.r?.NombrePunto || '');
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
    this.activeStops = this.groupStops(bus.reservas, order);

    if (!order) {
      this.stopOrderByBus.set(this.activeBusIndex, this.activeStops.map(s => s.NombrePunto));
    }
  }

  private groupStops(reservas: Reserva[], preferredOrder?: string[]): ViewStop[] {
    const map = new Map<string, ViewStop>();
    const appearanceOrder: string[] = [];

    for (const r of reservas) {
      const nombre = r.NombrePunto || 'Sin punto';

      if (!map.has(nombre)) {
        map.set(nombre, {
          key: `stop-${nombre}`,
          NombrePunto: nombre,
          reservas: [],
          totalPax: 0
        });
        appearanceOrder.push(nombre);
      }

      const stop = map.get(nombre)!;
      stop.reservas.push(r);
      stop.totalPax += r.NumeroPasajeros || 0;
    }

    const stops = Array.from(map.values());

    // Si el usuario ya reordenó paradas, respetar ese orden
    if (preferredOrder?.length) {
      const rank = new Map(preferredOrder.map((n, i) => [n, i]));
      stops.sort((a, b) =>
        (rank.get(a.NombrePunto) ?? 999) - (rank.get(b.NombrePunto) ?? 999)
      );
      return stops;
    }

    // ⬇️ ORDEN ORIGINAL (primera aparición)
    stops.sort(
      (a, b) =>
        appearanceOrder.indexOf(a.NombrePunto) -
        appearanceOrder.indexOf(b.NombrePunto)
    );

    return stops;
  }

}
