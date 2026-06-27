import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  Injector,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { PermisoDirective } from '../../shared/directives/permiso.directive';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { InicioService, Tour, Transfer, TransfersSummary } from '../../services/inicio';
import { SirAlertService } from '../../services/Alertas/alert.service';

type DrawerMode = 'edit' | 'privados';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, FormsModule, PermisoDirective, DatepickerComponent],
  templateUrl: './inicio.html',
  styleUrls: ['./inicio.css'],
})
export class Inicio implements OnInit {
  private readonly inicioService = inject(InicioService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alerts = inject(SirAlertService);
  private readonly injector = inject(Injector);

  isLoading = true;
  isUpdatingDate = false;

  private loading = false;
  private savingAforo = false;

  fecha: string = this.getTodayIso();

  tours: Tour[] = [];
  transfers: Transfer[] = [];
  transfersSummary: TransfersSummary = {
    total: 0,
    hotelAeropuerto: 0,
    aeropuertoHotel: 0,
    otros: 0,
  };

  skeletonCards = [0, 1, 2, 3, 4, 5, 6, 7];

  drawerOpen = false;
  drawerMode: DrawerMode = 'edit';
  drawerTour: Tour | null = null;
  nuevoCupoDrawer = 0;

  private readonly LINKED_IDS = [1, 5];
  private readonly CUPO_SOURCE = 5;

  constructor() {
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (!aforo) return;

      const id = Number(aforo.Id_Tour);
      const nuevo = Number(aforo.NuevoCupo);

      this.tours.forEach((tour) => {
        if (
          tour.Id_Tour === id ||
          (this.LINKED_IDS.includes(id) && this.LINKED_IDS.includes(tour.Id_Tour))
        ) {
          tour.cupos = nuevo;
        }
      });

      this.cdr.markForCheck();
    }, { injector: this.injector });

    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (!reserva || reserva.Fecha_Tour !== this.fecha) return;

      queueMicrotask(() => this.loadData());
    }, { injector: this.injector });
  }

  ngOnInit(): void {
    this.loadData();
  }

  onFechaChange(iso: string | null): void {
    if (!iso || iso === this.fecha) return;

    this.fecha = iso;
    this.loadData();
  }

  irDiaAnterior(): void {
    this.fecha = this.shiftDate(this.fecha, -1);
    this.loadData();
  }

  irDiaSiguiente(): void {
    this.fecha = this.shiftDate(this.fecha, 1);
    this.loadData();
  }

  irHoy(): void {
    const hoy = this.getTodayIso();
    if (hoy === this.fecha) return;

    this.fecha = hoy;
    this.loadData();
  }

  loadData(): void {
    if (this.loading) return;

    this.loading = true;
    const isInitialLoad = this.tours.length === 0;

    if (isInitialLoad) {
      this.isLoading = true;
    } else {
      this.isUpdatingDate = true;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    this.inicioService.getDatosInicio(this.fecha).pipe(
      finalize(() => {
        this.loading = false;
        this.isLoading = false;
        this.isUpdatingDate = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (data) => {
        this.tours = data.tours ?? [];
        this.transfers = Array.isArray(data.transfers) ? data.transfers as Transfer[] : [];
        this.transfersSummary = this.normalizeTransfers(data.transfers);
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  isLinked(tour: Tour): boolean {
    return this.LINKED_IDS.includes(tour.Id_Tour);
  }

  hasPrivados(tour: Tour): boolean {
    return Array.isArray(tour.privados) && tour.privados.length > 0;
  }

  getLinkedTours(): Tour[] {
    return this.LINKED_IDS
      .map((id) => this.tours.find((tour) => tour.Id_Tour === id))
      .filter((tour): tour is Tour => Boolean(tour));
  }

  getLinkedTourNames(): string {
    return this.getLinkedTours()
      .map((tour) => tour.Nombre_Tour)
      .join(' Y ');
  }

  hasAnyLinkedPrivados(): boolean {
    return this.getLinkedTours().some((tour) => this.hasPrivados(tour));
  }

  getTotalPrivadosPax(tour: Tour): number {
    return (tour.privados ?? []).reduce(
      (total, reserva) => total + Number(reserva.NumeroPasajeros || 0),
      0,
    );
  }

  getCupoCompartido(): number {
    return Number(
      this.tours.find((tour) => tour.Id_Tour === this.CUPO_SOURCE)?.cupos ?? 0,
    );
  }

  getCuposParaMeta(tour: Tour): number {
    return this.isLinked(tour) ? this.getCupoCompartido() : Number(tour.cupos || 0);
  }

  getAvailableSeats(tour: Tour): number {
    return Math.max(this.getCuposParaMeta(tour) - Number(tour.NumeroPasajeros || 0), 0);
  }

  getOccupancyPct(tour: Tour): number {
    const cupos = this.getCuposParaMeta(tour);
    if (!cupos) return 0;

    return Math.min((Number(tour.NumeroPasajeros || 0) / cupos) * 100, 100);
  }

  getProgressWidth(pct: number): string {
    return `${Math.max(0, Math.min(pct, 100))}%`;
  }

  getCardColor(tour: Tour): string {
    return this.getColorFromPct(this.getOccupancyPct(tour));
  }

  getAvailabilityTone(tour: Tour): string {
    return this.getAvailabilityToneFromValues(
      this.getAvailableSeats(tour),
      this.getOccupancyPct(tour),
    );
  }

  getLinkedTotalPax(): number {
    return this.getLinkedTours().reduce(
      (total, tour) => total + Number(tour.NumeroPasajeros || 0),
      0,
    );
  }

  getLinkedAvailableSeats(): number {
    return Math.max(this.getCupoCompartido() - this.getLinkedTotalPax(), 0);
  }

  getLinkedOccupancyPct(): number {
    const cupo = this.getCupoCompartido();
    if (!cupo) return 0;

    return Math.min((this.getLinkedTotalPax() / cupo) * 100, 100);
  }

  getLinkedCardColor(): string {
    return this.getColorFromPct(this.getLinkedOccupancyPct());
  }

  getLinkedAvailabilityTone(): string {
    return this.getAvailabilityToneFromValues(
      this.getLinkedAvailableSeats(),
      this.getLinkedOccupancyPct(),
    );
  }

  abrirDrawerEdicion(tour: Tour): void {
    this.drawerTour = tour;
    this.drawerMode = 'edit';
    this.nuevoCupoDrawer = this.getCuposParaMeta(tour);
    this.drawerOpen = true;
    this.cdr.markForCheck();
  }

  abrirDrawerEdicionCompartido(): void {
    const sourceTour = this.tours.find((tour) => tour.Id_Tour === this.CUPO_SOURCE);

    if (!sourceTour) {
      this.alerts.errorToast('No disponible', 'No se encontró el tour que administra el cupo compartido.');
      return;
    }

    this.abrirDrawerEdicion(sourceTour);
  }

  abrirDrawerPrivados(tour: Tour): void {
    this.drawerTour = tour;
    this.drawerMode = 'privados';
    this.drawerOpen = true;
    this.cdr.markForCheck();
  }

  cerrarDrawer(): void {
    this.drawerOpen = false;
    this.drawerTour = null;
    this.cdr.markForCheck();
  }

  getDrawerTitle(): string {
    if (!this.drawerTour) return '';

    return this.isLinked(this.drawerTour)
      ? 'Cupo compartido'
      : this.drawerTour.Nombre_Tour;
  }

  getDrawerCapacity(): number {
    if (!this.drawerTour) return 0;

    return this.isLinked(this.drawerTour)
      ? this.getCupoCompartido()
      : this.getCuposParaMeta(this.drawerTour);
  }

  getDrawerAssignedPax(): number {
    if (!this.drawerTour) return 0;

    return this.isLinked(this.drawerTour)
      ? this.getLinkedTotalPax()
      : Number(this.drawerTour.NumeroPasajeros || 0);
  }

  getDrawerAvailableSeats(): number {
    if (!this.drawerTour) return 0;

    return this.isLinked(this.drawerTour)
      ? this.getLinkedAvailableSeats()
      : this.getAvailableSeats(this.drawerTour);
  }

  getDrawerOccupancyPct(): number {
    if (!this.drawerTour) return 0;

    return this.isLinked(this.drawerTour)
      ? this.getLinkedOccupancyPct()
      : this.getOccupancyPct(this.drawerTour);
  }

  getDrawerCardColor(): string {
    return this.getColorFromPct(this.getDrawerOccupancyPct());
  }

  getDrawerAvailabilityTone(): string {
    return this.getAvailabilityToneFromValues(
      this.getDrawerAvailableSeats(),
      this.getDrawerOccupancyPct(),
    );
  }

  guardarAforo(): void {
    if (!this.drawerTour) return;

    const cupo = Number(this.nuevoCupoDrawer);
    const isSharedCapacity = this.isLinked(this.drawerTour);
    const targetTourId = isSharedCapacity ? this.CUPO_SOURCE : this.drawerTour.Id_Tour;
    const nombre = isSharedCapacity
      ? this.getLinkedTourNames()
      : this.drawerTour.Nombre_Tour;

    if (!Number.isFinite(cupo) || cupo < 0) {
      this.alerts.errorToast('Dato inválido', 'Debes ingresar un número válido de cupos.');
      return;
    }

    if (cupo < this.getDrawerAssignedPax()) {
      this.alerts.smartError(
        'Cupo insuficiente',
        `No puedes asignar ${cupo} cupos porque ya hay ${this.getDrawerAssignedPax()} pasajeros asignados.`,
      );
      return;
    }

    this.alerts.confirm(
      'Confirmar cambio de aforo',
      `¿Actualizar ${nombre} a ${cupo} cupos para el ${this.fecha}?`,
      () => this.ejecutarGuardadoAforo(targetTourId, cupo),
      undefined,
      {
        confirmText: 'Guardar',
        cancelText: 'Cancelar',
        type: 'warning',
      },
    );
  }

  private ejecutarGuardadoAforo(tourId: number, cupo: number): void {
    if (this.savingAforo) return;

    this.savingAforo = true;
    this.alerts.showLoading('Guardando aforo...', 'Por favor espera un momento.');

    this.inicioService.guardarCupo({
      SelectTour: tourId,
      NuevoCupo: cupo,
      Fecha: this.fecha,
    }).pipe(
      finalize(() => {
        this.savingAforo = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (res) => {
        this.cerrarDrawer();
        this.alerts.closeModal();

        const message = (res as { message?: string })?.message ?? 'Aforo actualizado exitosamente.';
        this.alerts.successToast('Listo', message);

        queueMicrotask(() => this.loadData());
      },
      error: (err) => {
        this.alerts.closeModal();

        const message =
          err?.error?.error ||
          err?.error?.message ||
          err?.message ||
          'No se pudo actualizar el aforo.';

        this.alerts.smartError('Error', message);
      },
    });
  }

  private getColorFromPct(pct: number): string {
    if (pct < 50) return 'c-green';
    if (pct < 80) return 'c-yellow';
    return 'c-red';
  }

  private getAvailabilityToneFromValues(available: number, occupancyPct: number): string {
    // Mismo criterio que la barra para consistencia visual
    if (available <= 0 || occupancyPct >= 100) return 'c-red';
    if (occupancyPct >= 80) return 'c-red';
    if (occupancyPct >= 50) return 'c-yellow';
    return 'c-green';
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

  private normalizeTransfers(raw: unknown): TransfersSummary {
    if (!raw) {
      return { total: 0, hotelAeropuerto: 0, aeropuertoHotel: 0, otros: 0 };
    }

    if (!Array.isArray(raw)) {
      const value = raw as Record<string, unknown>;
      const hotelAeropuerto = Number(value['hotelAeropuerto'] || value['hotel_aeropuerto'] || 0);
      const aeropuertoHotel = Number(value['aeropuertoHotel'] || value['aeropuerto_hotel'] || 0);
      const otros = Number(value['otros'] || value['otro'] || 0);

      return {
        total: Number(value['total'] || hotelAeropuerto + aeropuertoHotel + otros),
        hotelAeropuerto,
        aeropuertoHotel,
        otros,
      };
    }

    let hotelAeropuerto = 0;
    let aeropuertoHotel = 0;
    let otros = 0;

    for (const item of raw as Array<Record<string, unknown>>) {
      const label = String(item['tipo'] || item['Tipo_Transfer'] || item['nombre'] || '').toLowerCase();
      const cantidad = Number(item['cantidad'] || item['total'] || item['Total'] || 0);

      const hotelAntesDeAeropuerto =
        label.includes('hotel') &&
        label.includes('aeropuerto') &&
        label.indexOf('hotel') < label.indexOf('aeropuerto');

      const aeropuertoAntesDeHotel =
        label.includes('aeropuerto') &&
        label.includes('hotel') &&
        label.indexOf('aeropuerto') < label.indexOf('hotel');

      if (hotelAntesDeAeropuerto) {
        hotelAeropuerto += cantidad;
      } else if (aeropuertoAntesDeHotel) {
        aeropuertoHotel += cantidad;
      } else {
        otros += cantidad;
      }
    }

    return {
      total: hotelAeropuerto + aeropuertoHotel + otros,
      hotelAeropuerto,
      aeropuertoHotel,
      otros,
    };
  }
}