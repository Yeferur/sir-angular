import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  Injector,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { PermisoDirective } from '../../shared/directives/permiso.directive';
import { CountUpDirective } from './count-up.directive';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { InicioService, Tour, Transfer, TransfersSummary } from '../../services/inicio';
import { SirAlertService } from '../../services/Alertas/alert.service';

type DrawerMode = 'edit' | 'privados';
type DateAnimDirection = 'next' | 'prev';

const FLASH_DURATION_MS = 1100;

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, FormsModule, PermisoDirective, CountUpDirective, DatepickerComponent],
  templateUrl: './inicio.html',
  styleUrls: ['./inicio.css'],
})
export class Inicio implements OnInit, OnDestroy {
  private readonly inicioService = inject(InicioService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alerts = inject(SirAlertService);
  private readonly injector = inject(Injector);

  isLoading = true;
  isUpdatingDate = false;

  private loading = false;
  private savingAforo = false;

  fecha: string = this.getTomorrowIso();

  // Slide de fecha: dirección + key que fuerza recrear el nodo y así re-disparar la animación CSS
  dateAnimDirection: DateAnimDirection = 'next';
  dateAnimKey = 0;

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

  // Flash de cambio en tiempo real
  flashIds = new Set<number>();
  flashLinked = false;
  private flashTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private flashLinkedTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly LINKED_IDS = [1, 5];
  private readonly CUPO_SOURCE = 5;

  constructor() {
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (!aforo) return;

      const id = Number(aforo.Id_Tour);
      const nuevo = Number(aforo.NuevoCupo);
      let touchedLinked = false;

      this.tours.forEach((tour) => {
        const isDirectMatch = tour.Id_Tour === id;
        const isLinkedMatch = this.LINKED_IDS.includes(id) && this.LINKED_IDS.includes(tour.Id_Tour);

        if ((isDirectMatch || isLinkedMatch) && tour.cupos !== nuevo) {
          tour.cupos = nuevo;

          if (this.isLinked(tour)) {
            touchedLinked = true;
          } else {
            this.flashTour(tour.Id_Tour);
          }
        }
      });

      if (touchedLinked) this.flashLinkedCard();

      this.cdr.markForCheck();
    }, { injector: this.injector });

    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (!reserva || reserva.Fecha_Tour !== this.fecha) return;

      queueMicrotask(() => this.loadData({ silent: true }));
    }, { injector: this.injector });
  }

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.flashTimers.forEach((timer) => clearTimeout(timer));
    this.flashTimers.clear();
    if (this.flashLinkedTimer) clearTimeout(this.flashLinkedTimer);
  }

  onFechaChange(iso: string | null): void {
    if (!iso) return;
    this.goToDate(iso);
  }

  irDiaAnterior(): void {
    this.goToDate(this.shiftDate(this.fecha, -1));
  }

  irDiaSiguiente(): void {
    this.goToDate(this.shiftDate(this.fecha, 1));
  }

  irHoy(): void {
    this.goToDate(this.getTodayIso());
  }

  irManana(): void {
    this.goToDate(this.getTomorrowIso());
  }

  isTomorrowSelected(): boolean {
    return this.fecha === this.getTomorrowIso();
  }

  private goToDate(iso: string): void {
    if (!iso || iso === this.fecha) return;

    this.dateAnimDirection = iso > this.fecha ? 'next' : 'prev';
    this.dateAnimKey++;
    this.fecha = iso;
    this.loadData();
  }

  loadData(options: { silent?: boolean } = {}): void {
    if (this.loading) return;

    this.loading = true;
    const isInitialLoad = this.tours.length === 0;
    const previousById = new Map(this.tours.map((tour) => [tour.Id_Tour, tour]));

    if (isInitialLoad) {
      this.isLoading = true;
    } else if (!options.silent) {
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
        const newTours = data.tours ?? [];

        if (options.silent && !isInitialLoad) {
          this.detectRealtimeChanges(previousById, newTours);
        }

        this.tours = newTours;
        this.transfers = Array.isArray(data.transfers) ? data.transfers as Transfer[] : [];
        this.transfersSummary = this.normalizeTransfers(data.transfers);
        this.cdr.markForCheck();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  private detectRealtimeChanges(previousById: Map<number, Tour>, newTours: Tour[]): void {
    let touchedLinked = false;

    for (const tour of newTours) {
      const prev = previousById.get(tour.Id_Tour);
      if (!prev) continue;

      const changed =
        Number(prev.NumeroPasajeros || 0) !== Number(tour.NumeroPasajeros || 0) ||
        Number(prev.cupos || 0) !== Number(tour.cupos || 0);

      if (!changed) continue;

      if (this.isLinked(tour)) {
        touchedLinked = true;
      } else {
        this.flashTour(tour.Id_Tour);
      }
    }

    if (touchedLinked) this.flashLinkedCard();
  }

  private flashTour(id: number): void {
    this.flashIds.add(id);
    this.cdr.markForCheck();

    const existing = this.flashTimers.get(id);
    if (existing) clearTimeout(existing);

    this.flashTimers.set(id, setTimeout(() => {
      this.flashIds.delete(id);
      this.flashTimers.delete(id);
      this.cdr.markForCheck();
    }, FLASH_DURATION_MS));
  }

  private flashLinkedCard(): void {
    this.flashLinked = true;
    this.cdr.markForCheck();

    if (this.flashLinkedTimer) clearTimeout(this.flashLinkedTimer);

    this.flashLinkedTimer = setTimeout(() => {
      this.flashLinked = false;
      this.cdr.markForCheck();
    }, FLASH_DURATION_MS);
  }

  isFlashing(tour: Tour): boolean {
    return this.flashIds.has(tour.Id_Tour);
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

  getTomorrowIso(): string {
    return this.shiftDate(this.getTodayIso(), 1);
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
      const label = String(
        item['Servicio'] ||
        item['tipo'] ||
        item['Tipo_Transfer'] ||
        item['nombre'] ||
        item['Nombre'] ||
        '',
      ).toLowerCase().trim();
      const cantidad = Number(
        item['totalTransfers'] ||
        item['cantidad'] ||
        item['total'] ||
        item['Total'] ||
        0,
      );

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