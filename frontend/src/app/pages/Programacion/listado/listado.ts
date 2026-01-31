import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { Sugerencia, TourProgramacion, Bus, Reserva } from '../../../interfaces/Programacion/reservas';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

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
  private cdr = inject(ChangeDetectorRef);
  private navbar = inject(DynamicIslandGlobalService);

  fechaSeleccionada: string = new Date().toISOString().split('T')[0];
  toursDelDia: TourProgramacion[] = [];
  cargando = false;
  modoVista: 'dashboard' | 'editor' = 'dashboard';

  tourSeleccionado: TourProgramacion | null = null;
  planSeleccionado: Sugerencia | null = null;

  readonly CAPACIDADES_BUSES = [18, 23, 25, 27, 38, 39, 40, 41, 43].sort((a, b) => a - b);

  isDragging = false;
  newBusDropData: Reserva[] = [];

  activeBusIndex = 0;
  activeStops: ViewStop[] = [];

  // guarda el orden de paradas por bus (solo UI)
  private stopOrderByBus = new Map<number, string[]>();

  ngOnInit(): void {
    this.cargarToursDelDia();
  }

  get activeBus(): Bus | null {
    if (!this.planSeleccionado?.buses?.length) return null;
    return this.planSeleccionado.buses[this.activeBusIndex] ?? this.planSeleccionado.buses[0] ?? null;
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
    this.cargando = true;
    this.toursDelDia = [];
    this.programacionService.getTours().subscribe({
      next: (tours) => {
        this.toursDelDia = tours.map(t => ({ ...t, estado: 'Pendiente' }));
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error al cargar tours', err);
        this.cargando = false;
      }
    });
  }

  generarPlan(tour: TourProgramacion): void {
    this.navbar.alert.set({
      title: 'Generando plan...',
      message: 'Por favor espera un momento.',
      loading: true,
      autoClose: false
    });

    this.tourSeleccionado = tour;

    this.programacionService.generarPlanLogistico(this.fechaSeleccionada, tour.Id_Tour).subscribe({
      next: (plan) => {
        tour.planGenerado = plan;
        tour.estado = 'Generado';
        tour.totalPasajeros = plan.analisis.totalPasajeros;
        tour.totalReservas = plan.analisis.totalReservas;

        this.navbar.alert.set(null);

        this.planSeleccionado = JSON.parse(JSON.stringify(plan.sugerencias[0]));
        this.modoVista = 'editor';

        this.activeBusIndex = 0;
        this.stopOrderByBus.clear();
        this.rebuildActiveStops();

        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(`Error al generar plan para ${tour.NombreTour}`, err);
        this.cargando = false;
      }
    });
  }

  volverAlDashboard(): void {
    this.modoVista = 'dashboard';
    this.planSeleccionado = null;
    this.tourSeleccionado = null;
    this.activeBusIndex = 0;
    this.activeStops = [];
    this.stopOrderByBus.clear();
  }

  selectBus(i: number): void {
    if (!this.planSeleccionado) return;
    if (i < 0 || i >= this.planSeleccionado.buses.length) return;
    this.activeBusIndex = i;
    this.rebuildActiveStops();
    this.cdr.markForCheck();
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

    this.cdr.markForCheck();
  }

  // Mover reservas entre buses (principal)
  dropReserva(event: CdkDragDrop<Reserva[]>): void {
    if (!this.planSeleccionado) return;

    this.isDragging = false;

    const reserva = event.previousContainer.data[event.previousIndex];
    if (!reserva) return;

    // Crear nuevo bus
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
      this.activeBusIndex = Math.min(this.activeBusIndex, this.planSeleccionado.buses.length - 1);
      if (this.activeBusIndex < 0) this.activeBusIndex = 0;

      this.rebuildActiveStops();
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

    this.activeBusIndex = Math.min(this.activeBusIndex, this.planSeleccionado.buses.length - 1);
    if (this.activeBusIndex < 0) this.activeBusIndex = 0;

    this.rebuildActiveStops();
    this.cdr.markForCheck();
  }

  verMapa(bus: any): void {
    this.navbar.puntos.set(bus.reservas);
  }

  guardarListadoFinal(): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;

    const placas = this.planSeleccionado.buses.map(b => b.id);
    if (placas.some(p => !p || p.trim() === '')) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Las placas de los buses no pueden estar vacías.', autoClose: true, autoCloseTime: 2000 });
      return;
    }

    const placasUnicas = new Set(placas);
    if (placasUnicas.size !== placas.length) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Las placas de los buses deben ser únicas.', autoClose: true, autoCloseTime: 2000 });
      return;
    }

    const payload = {
      fecha: this.fechaSeleccionada,
      idTour: this.tourSeleccionado.Id_Tour,
      buses: this.planSeleccionado.buses
    };

    this.cargando = true;
    this.programacionService.guardarListadoFinal(payload).subscribe({
      next: () => {
        this.cargando = false;
        this.navbar.alert.set({ type: 'success', title: 'Listado guardado', message: 'El listado ha sido guardado exitosamente.' });
        this.volverAlDashboard();
      },
      error: (err) => {
        this.cargando = false;
        console.error('Error al guardar', err);
        this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Ha ocurrido un error al guardar el listado.' });
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
