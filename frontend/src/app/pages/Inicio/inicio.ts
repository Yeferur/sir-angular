import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject, effect, Injector, signal } from '@angular/core';
import { PermisoDirective } from '../../shared/directives/permiso.directive';
import { FlatpickrInputDirective } from '../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { InicioService, Tour, Transfer, TransfersSummary } from '../../services/inicio';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, PermisoDirective, FlatpickrInputDirective],
  templateUrl: './inicio.html',
  styleUrls: ['./inicio.css'],
})
export class Inicio implements OnInit {
  private inicioService = inject(InicioService);
  private cdr = inject(ChangeDetectorRef);
  private global = inject(DynamicIslandGlobalService);
  private permisosService = inject(PermisosService);
  private injector = inject(Injector);

  editando: { [key: number]: boolean } = {};
  nuevoCupo: { [key: number]: string } = {};
  mostrarDetallesCombinada = false;
  isLoading = true;
  isUpdatingDate = false;

  canEditarAforo = signal(false);

  fecha: string = (() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  })();

  tours: Tour[] = [];
  transfers: Transfer[] = [];
  transfersSummary: TransfersSummary = {
    total: 0,
    hotelAeropuerto: 0,
    aeropuertoHotel: 0,
    otros: 0
  };

  combinedTour: Tour | null = null;
  combinedDetails: Tour[] = [];
  skeletonCards = [0, 1, 2, 3, 4, 5, 6, 7];

  private loading = false;

  constructor() {
    // Aforo en tiempo real: actualiza estado local sin disparar HTTP.
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (!aforo) return;

      const id = Number(aforo.Id_Tour);
      const nuevo = Number(aforo.NuevoCupo);

      const t = this.tours.find(x => x.Id_Tour === id);
      if (t) t.cupos = nuevo;

      if (this.combinedTour && id === 5) {
        this.combinedTour.cupos = nuevo;
      }

      if (this.editando[id]) {
        this.nuevoCupo[id] = String(nuevo);
      }

      this.cdr.markForCheck();
    }, { injector: this.injector });

    // Reservas en tiempo real: recarga datos para recalcular contadores.
    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (!reserva) return;

      if (reserva.Fecha_Tour === this.fecha) {
        queueMicrotask(() => this.loadData());
      }
    }, { injector: this.injector });

    // TODO: Integrar evento WebSocket de transfers para refrescar Inicio cuando se cree, edite o elimine un transfer de la fecha visible.
  }

  ngOnInit(): void {
    // establecer permiso inicial y suscribirse a cambios
    const posibles = ['INICIO.ACTUALIZAR_AFORO'];
    this.canEditarAforo.set(this.permisosService.tieneAlgunPermiso(posibles));
    this.permisosService.permisos$.subscribe(() => {
      this.canEditarAforo.set(this.permisosService.tieneAlgunPermiso(posibles));
    });
    this.loadData();
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
      // SSR guard
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      const cal: HTMLElement = inst?.calendarContainer;
      if (!cal) return;

      cal.classList.add('sir-flatpickr');

      const clampDay = (y: number, m: number, d: number) => {
        const last = new Date(y, m + 1, 0).getDate(); // último día del mes
        return Math.min(Math.max(d, 1), last);
      };

      let yearDiv: HTMLDivElement | null = null;
      let yearSelect: HTMLSelectElement | null = null;

      const ensureYearSelect = () => {
        const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
        if (!monthWrap) return null;

        const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
        if (numWrap) { try { numWrap.remove(); } catch (e) { /* ignore */ } }

        const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
        const container = curMonth ?? monthWrap;

        yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
        if (yearSelect) return yearSelect;

        const oldDiv = monthWrap.querySelector('.sir-year-div') as HTMLElement | null;
        if (oldDiv) { try { oldDiv.remove(); } catch { /* ignore */ } }

        yearSelect = document.createElement('select');
        yearSelect.className = 'sir-year-select';
        yearSelect.setAttribute('aria-label', 'Seleccionar año');

        try { container.appendChild(yearSelect); } catch { monthWrap.appendChild(yearSelect); }
        return yearSelect;
      };

      const buildYears = (centerYear: number) => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const start = centerYear - 20;
        const end = centerYear + 20;

        sel.innerHTML = '';
        for (let y = end; y >= start; y--) {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          sel.appendChild(opt);
        }
        sel.value = String(centerYear);
      };

      const syncSelectValue = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = inst.currentYear ?? new Date().getFullYear();
        const exists = !!sel.querySelector(`option[value="${y}"]`);
        if (!exists) buildYears(y);
        sel.value = String(y);
      };

      const getSafeDay = () => {
        const d: Date | undefined = inst.selectedDates?.[0];
        return d ? d.getDate() : 1;
      };

      const onChange = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = Number(sel.value);
        const m = typeof inst.currentMonth === 'number' ? inst.currentMonth : new Date().getMonth();
        const day = clampDay(y, m, getSafeDay());

        const newDate = new Date(y, m, day);

        if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

        if (inst.selectedDates?.length) {
          inst.setDate(newDate, true); // true => triggerChange para reactive forms
        }
      };

      buildYears(inst.currentYear ?? new Date().getFullYear());
      syncSelectValue();

      const sel0 = ensureYearSelect();
      sel0?.addEventListener('change', onChange);

      const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
        const prev = inst.config[key];
        const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
        inst.config[key] = [...arr, fn];
      };

      wrap('onMonthChange', () => syncSelectValue());
      wrap('onYearChange', () => syncSelectValue());

      const prevOnDestroy = inst.config.onDestroy;
      const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
      inst.config.onDestroy = [
        ...destroyArr,
        () => sel0?.removeEventListener('change', onChange)
      ];
    }
  };

  onFechaChange(event: Event) {
    this.fecha = (event.target as HTMLInputElement).value;
    this.loadData();
  }

  loadData() {
    if (this.loading) return;
    this.loading = true;
    const isInitialLoad = this.tours.length === 0 && !this.combinedTour;

    if (isInitialLoad) {
      this.isLoading = true;
    } else {
      this.isUpdatingDate = true;
    }

    this.inicioService.getDatosInicio(this.fecha).pipe(
      finalize(() => {
        this.loading = false;
        this.isLoading = false;
        this.isUpdatingDate = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (data) => {
        this.tours = data.tours;
        this.transfers = Array.isArray(data.transfers) ? data.transfers : [];
        this.transfersSummary = this.normalizeTransfers(data.transfers);

        const tour1 = data.tours.find((t) => t.Id_Tour === 1);
        const tour5 = data.tours.find((t) => t.Id_Tour === 5);

        if (tour1 && tour5) {
          this.combinedTour = {
            Id_Tour: tour5.Id_Tour,
            Nombre_Tour: `${tour1.Nombre_Tour} Y ${tour5.Nombre_Tour}`,
            NumeroPasajeros: (tour1.NumeroPasajeros || 0) + (tour5.NumeroPasajeros || 0),
            cupos: Number(tour5.cupos) || 0,
            totalPrivados: (tour1.totalPrivados || 0) + (tour5.totalPrivados || 0),
            privados: [],
          };
          this.combinedDetails = [tour1, tour5];
        } else {
          this.combinedTour = null;
          this.combinedDetails = [];
        }

        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      }
    });
  }

  private normalizeTransfers(raw: any): TransfersSummary {
    if (!raw) {
      return { total: 0, hotelAeropuerto: 0, aeropuertoHotel: 0, otros: 0 };
    }

    if (!Array.isArray(raw)) {
      const hotelAeropuerto = Number(raw.hotelAeropuerto || raw.hotel_aeropuerto || 0);
      const aeropuertoHotel = Number(raw.aeropuertoHotel || raw.aeropuerto_hotel || 0);
      const otros = Number(raw.otros || raw.otro || 0);
      const total = Number(raw.total || raw.totalTransfers || hotelAeropuerto + aeropuertoHotel + otros || 0);

      return {
        total,
        hotelAeropuerto,
        aeropuertoHotel,
        otros,
      };
    }

    let hotelAeropuerto = 0;
    let aeropuertoHotel = 0;
    let otros = 0;

    for (const item of raw) {
      const label = String(item.tipo || item.Tipo_Transfer || item.Servicio || item.nombre || item.Nombre || '').toLowerCase();
      const cantidad = Number(item.cantidad || item.totalTransfers || item.total || item.Total || 0);

      if (label.includes('hotel') && label.includes('aeropuerto') && label.indexOf('hotel') < label.indexOf('aeropuerto')) {
        hotelAeropuerto += cantidad;
      } else if (label.includes('aeropuerto') && label.includes('hotel') && label.indexOf('aeropuerto') < label.indexOf('hotel')) {
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

  getCardColor(pasajeros: number, cupos: number): string {
    const safeCupos = cupos > 0 ? cupos : 1;
    const usage = (pasajeros / safeCupos) * 100;
    if (usage < 30) return 'green';
    if (usage < 60) return 'blue';
    if (usage < 90) return 'yellow';
    return 'red';
  }

  getCupoInputId(tourId: number): string {
    return `cupo-${tourId}`;
  }

  trackByTourId(index: number, tour: any): number {
    return tour.Id_Tour;
  }

  get toursConPrivados(): Tour[] {
    return this.tours.filter(t => t.privados && t.privados.length > 0);
  }

  alternarDetallesCombinada() {
    this.mostrarDetallesCombinada = !this.mostrarDetallesCombinada;
    this.editando[5] = false;
  }

  activarEdicion(id: number) {
    this.editando[id] = true;

    const tour =
      id === 5 && this.combinedTour
        ? this.combinedTour
        : this.tours.find((t) => t.Id_Tour === id);

    this.nuevoCupo[id] = tour?.cupos?.toString() || '';
    this.cdr.markForCheck();
  }

  guardarAforo(tour: Tour) {
    if (!this.canEditarAforo()) {
      this.global.showAlert({ type: 'error', title: 'Sin permiso', message: 'No tiene permisos para editar aforos.', autoClose: true });
      return;
    }

    const cupo = this.nuevoCupo[tour.Id_Tour];
    if (!cupo || isNaN(+cupo)) {
      this.global.showAlert({
        type: 'error',
        title: 'Dato inválido',
        message: 'Debes ingresar un número válido de cupos.',
        autoClose: true,
      });
      return;
    }

    this.global.showConfirm(
      'Confirmación',
      `¿Deseas actualizar el aforo de ${tour.Nombre_Tour} a ${cupo} cupos para la fecha ${this.fecha}?`,
      [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.global.clearOverlay(),
        },
        {
          text: 'Guardar',
          style: 'primary',
          onClick: () => {
            this.global.showLoading('Guardando aforo...', 'Por favor espera un momento.');

            this.inicioService.guardarCupo({
              SelectTour: tour.Id_Tour,
              NuevoCupo: Number(cupo),
              Fecha: this.fecha
            }).subscribe({
              next: (res) => {
                this.editando[tour.Id_Tour] = false;

                const successMessage =
                  (typeof res === 'object' && res !== null && 'message' in res
                    ? (res as { message?: string }).message
                    : undefined) || 'Aforo actualizado exitosamente.';

                this.global.showAlert({
                  type: 'success',
                  title: '¡Listo!',
                  message: successMessage,
                  autoClose: true,
                  autoCloseTime: 3000,
                });

                // El WS también actualiza estado, pero se recarga para asegurar consistencia.
                queueMicrotask(() => this.loadData());

                this.cdr.markForCheck();
              },
              error: (err) => {
                const backendError =
                  err?.error?.error ||
                  err?.error?.message ||
                  err?.message ||
                  'No se pudo actualizar el aforo.';

                this.global.showAlert({
                  type: 'error',
                  title: 'Error',
                  message: backendError,
                  autoClose: true,
                });
                this.cdr.markForCheck();
              }
            });
          },
        },
      ],
      { type: 'warning' }
    );
  }
}
