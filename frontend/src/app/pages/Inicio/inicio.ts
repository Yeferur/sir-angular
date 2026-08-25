import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injector,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';

import { PermisoDirective } from '../../shared/directives/permiso.directive';
import { CountUpDirective } from './count-up.directive';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { InicioService, Tour, Transfer, TransfersSummary } from '../../services/inicio';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

type DrawerMode = 'edit' | 'privados';
type DateAnimDirection = 'next' | 'prev';

const FLASH_DURATION_MS = 1100;

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, FormsModule, PermisoDirective, CountUpDirective, DatepickerComponent, LoadingStateComponent],
  templateUrl: './inicio.html',
  styleUrls: ['./inicio.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Inicio implements OnInit, OnDestroy {
  private readonly inicioService = inject(InicioService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alerts = inject(SirAlertService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  isLoading = true;
  isUpdatingDate = false;
  hasLoaded = false;
  loadError: string | null = null;
  loadedFecha: string | null = null;

  private savingAforo = false;
  private loadRequestId = 0;
  private activeLoad?: Subscription;
  private drawerClearTimer?: ReturnType<typeof setTimeout>;
  private previousBodyOverflow = '';
  private previousFocus: HTMLElement | null = null;

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

    effect(() => {
      const transfer = this.inicioService.transferActualizado();
      if (!transfer) return;

      const eventDate = String(
        transfer.Fecha_Transfer || transfer.FechaTransfer || transfer.Fecha || '',
      );
      if (eventDate && eventDate !== this.fecha) return;

      queueMicrotask(() => this.loadData({ silent: true }));
    }, { injector: this.injector });
  }

  ngOnInit(): void {
    const routeDate = this.normalizeYmd(this.route.snapshot.queryParamMap.get('fecha'));
    if (routeDate) this.fecha = routeDate;
    this.syncDateToUrl();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.activeLoad?.unsubscribe();
    this.flashTimers.forEach((timer) => clearTimeout(timer));
    this.flashTimers.clear();
    if (this.flashLinkedTimer) clearTimeout(this.flashLinkedTimer);
    if (this.drawerClearTimer) clearTimeout(this.drawerClearTimer);
    this.restoreDrawerPageState();
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

  isTodaySelected(): boolean {
    return this.fecha === this.getTodayIso();
  }

  private goToDate(iso: string): void {
    if (!iso || iso === this.fecha) return;

    this.dateAnimDirection = iso > this.fecha ? 'next' : 'prev';
    this.dateAnimKey++;
    this.fecha = iso;
    this.syncDateToUrl();
    this.loadData();
  }

  private syncDateToUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { fecha: this.fecha },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  loadData(options: { silent?: boolean } = {}): void {
    const requestId = ++this.loadRequestId;
    const requestDate = this.fecha;
    const isInitialLoad = !this.hasLoaded;
    const previousById = new Map(this.tours.map((tour) => [tour.Id_Tour, tour]));

    this.activeLoad?.unsubscribe();
    this.loadError = null;

    if (isInitialLoad) {
      this.isLoading = true;
    } else if (!options.silent) {
      this.isUpdatingDate = true;
    }
    this.cdr.markForCheck();

    this.activeLoad = this.inicioService.getDatosInicio(requestDate, Boolean(options.silent)).pipe(
      finalize(() => {
        if (requestId !== this.loadRequestId) return;
        this.isLoading = false;
        this.isUpdatingDate = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (data) => {
        if (requestId !== this.loadRequestId) return;
        const newTours = data.tours ?? [];

        if (options.silent && !isInitialLoad) {
          this.detectRealtimeChanges(previousById, newTours);
        }

        this.tours = newTours;
        this.transfers = Array.isArray(data.transfers) ? data.transfers as Transfer[] : [];
        this.transfersSummary = this.normalizeTransfers(data.transfers);
        this.hasLoaded = true;
        this.loadedFecha = requestDate;
        this.loadError = null;
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (requestId !== this.loadRequestId) return;
        this.loadError = this.extractLoadError(error);
        if (this.hasLoaded && !options.silent) {
          this.alerts.errorToast('No se pudo actualizar Inicio', this.loadError);
        }
        this.cdr.markForCheck();
      },
    });
  }

  retryLoad(): void {
    this.loadData();
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

  irAReservas(tours: Tour | Tour[], tipoReserva: '' | 'Grupal' | 'Privada' = ''): void {
    const tourIds = (Array.isArray(tours) ? tours : [tours])
      .map((tour) => Number(tour?.Id_Tour))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!tourIds.length) return;

    void this.router.navigate(['/Reservas/VerReservas'], {
      queryParams: {
        fechaTour: this.fecha,
        tours: tourIds.join(','),
        tipoReserva: tipoReserva || null,
        buscar: 1,
      },
    });
  }

  irATransfers(): void {
    void this.router.navigate(['/Transfers/VerTransfers'], {
      queryParams: {
        fechaTransfer: this.fecha,
        buscar: 1,
      },
    });
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

  getLinkedPrivatePax(): number {
    return this.getLinkedTours().reduce(
      (total, tour) => total + Number(tour.NumeroPasajerosPrivados || 0),
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
    this.prepareDrawerOpen();
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
    this.prepareDrawerOpen();
    this.drawerTour = tour;
    this.drawerMode = 'privados';
    this.drawerOpen = true;
    this.cdr.markForCheck();
  }

  cerrarDrawer(): void {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    if (this.drawerClearTimer) clearTimeout(this.drawerClearTimer);
    const closeDelay = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
    this.drawerClearTimer = setTimeout(() => {
      this.drawerTour = null;
      this.drawerClearTimer = undefined;
      this.cdr.markForCheck();
    }, closeDelay);
    this.restoreDrawerPageState();
    this.cdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  onDrawerEscape(): void {
    if (this.drawerOpen) this.cerrarDrawer();
  }

  onDrawerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const panel = event.currentTarget as HTMLElement | null;
    if (!panel?.classList.contains('open')) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private prepareDrawerOpen(): void {
    if (this.drawerClearTimer) {
      clearTimeout(this.drawerClearTimer);
      this.drawerClearTimer = undefined;
    }
    if (!this.drawerOpen && typeof document !== 'undefined') {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.drawer.open')?.focus({ preventScroll: true });
    });
  }

  private restoreDrawerPageState(): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = this.previousBodyOverflow;
    this.previousFocus?.focus({ preventScroll: true });
    this.previousFocus = null;
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

  private normalizeYmd(value: unknown): string | null {
    const safe = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safe);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() + 1 !== month
      || date.getUTCDate() !== day
    ) return null;

    return safe;
  }

  private extractLoadError(error: any): string {
    return String(
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      'No fue posible cargar la información. Comprueba tu conexión e inténtalo nuevamente.',
    );
  }
}
