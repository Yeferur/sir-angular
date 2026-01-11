import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject, effect, Injector, signal } from '@angular/core';
import { PermisoDirective } from '../../shared/directives/permiso.directive';
import { FlatpickrInputDirective } from '../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { InicioService, Tour, Transfer } from '../../services/inicio';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { PermisosService } from '../../services/Permisos/permisos.service';

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
  isLoading = false;

  // permiso para editar aforo
  canEditarAforo = signal(false);

  fecha: string = new Date().toISOString().split('T')[0];

  tours: Tour[] = [];
  transfers: Transfer[] = [];

  combinedTour: Tour | null = null;
  combinedDetails: Tour[] = [];

  // evita recargas duplicadas
  private loading = false;

  constructor() {
    // ✅ Aforo en tiempo real: actualiza estado local (NO HTTP)
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (!aforo) return;

      const id = Number(aforo.Id_Tour);
      const nuevo = Number(aforo.NuevoCupo);

      // actualiza tours
      const t = this.tours.find(x => x.Id_Tour === id);
      if (t) t.cupos = nuevo;

      // actualiza combinado (si es el 5)
      if (this.combinedTour && id === 5) {
        this.combinedTour.cupos = nuevo;
      }

      // si estaba editando ese tour, refresca input
      if (this.editando[id]) {
        this.nuevoCupo[id] = String(nuevo);
      }

      // zoneless friendly
      this.cdr.markForCheck();
    }, { injector: this.injector });

    // ✅ Reservas en tiempo real: aquí sí conviene recargar (porque afectan contadores)
    // Pero hazlo "deferred" para evitar NG0100 si llega durante render.
    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (!reserva) return;

      if (reserva.Fecha_Tour === this.fecha) {
        queueMicrotask(() => this.loadData());
      }
    }, { injector: this.injector });
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
    // ✅ SSR guard ANTES DE TODO
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const cal: HTMLElement = inst?.calendarContainer;
    if (!cal) return;

    cal.classList.add('sir-flatpickr');

    // util: clamp día al máximo del mes
    const clampDay = (y: number, m: number, d: number) => {
      const last = new Date(y, m + 1, 0).getDate(); // último día del mes
      return Math.min(Math.max(d, 1), last);
    };

    // --- Inyectar select en el header estable (flatpickr-month) ---
    let yearDiv: HTMLDivElement | null = null;
    let yearSelect: HTMLSelectElement | null = null;

    const ensureYearSelect = () => {
      // contenedor header
      const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
      if (!monthWrap) return null;

      // elimina el input numérico (cuando exista)
      const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
      if (numWrap) { try { numWrap.remove(); } catch (e) { /* ignore */ } }

      // preferimos insertar dentro del pill .flatpickr-current-month
      const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
      const container = curMonth ?? monthWrap;

      // evita duplicados
      yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
      if (yearSelect) return yearSelect;

      // elimina cualquier wrapper previo para mantener DOM limpio
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

      // siempre mueve la vista
      if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

      // solo setea si ya había selección
      if (inst.selectedDates?.length) {
        inst.setDate(newDate, true); // true => triggerChange para reactive forms
      }
    };

    // init
    buildYears(inst.currentYear ?? new Date().getFullYear());
    syncSelectValue();

    // listeners
    const sel0 = ensureYearSelect();
    sel0?.addEventListener('change', onChange);

    // hook sin pisar otros callbacks
    const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
      const prev = inst.config[key];
      const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
      inst.config[key] = [...arr, fn];
    };

    // ✅ cuando cambias mes/año, flatpickr puede re-renderizar header → reinyecta/sincroniza
    wrap('onMonthChange', () => syncSelectValue());
    wrap('onYearChange', () => syncSelectValue());

    // cleanup
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

    this.inicioService.getDatosInicio(this.fecha).subscribe({
      next: (data) => {
        this.tours = data.tours;
        this.transfers = data.transfers;

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

        // ✅ NO detectChanges() en zoneless
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      },
      complete: () => {
        this.loading = false;
      }
    });
  }

  getCardColor(pasajeros: number, cupos: number): string {
    const safeCupos = cupos > 0 ? cupos : 1;
    const usage = (pasajeros / safeCupos) * 100;
    if (usage < 30) return 'green';
    if (usage < 60) return 'blue';
    if (usage < 90) return 'yellow';
    return 'red';
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
    // seguridad: verificar permiso antes de intentar guardar
    if (!this.canEditarAforo()) {
      this.global.alert.set({ type: 'error', title: 'Sin permiso', message: 'No tiene permisos para editar aforos.' , autoClose: true});
      return;
    }

    const cupo = this.nuevoCupo[tour.Id_Tour];
    if (!cupo || isNaN(+cupo)) {
      this.global.alert.set({
        type: 'error',
        title: 'Dato inválido',
        message: 'Debes ingresar un número válido de cupos.',
        autoClose: true,
      });
      return;
    }

    this.global.alert.set({
      type: 'warning',
      title: 'Confirmación',
      message: `¿Deseas actualizar el aforo de ${tour.Nombre_Tour} a ${cupo} cupos para la fecha ${this.fecha}?`,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.global.alert.set(null),
        },
        {
          text: 'Guardar',
          style: 'primary',
          onClick: () => {
            this.global.alert.set({
              title: 'Guardando aforo...',
              message: 'Por favor espera un momento.',
              loading: true,
              autoClose: false
            });

            this.inicioService.guardarCupo({
              SelectTour: tour.Id_Tour,
              NuevoCupo: Number(cupo),
              Fecha: this.fecha
            }).subscribe({
              next: (res) => {
                this.editando[tour.Id_Tour] = false;

                this.global.alert.set({
                  type: 'success',
                  title: '¡Listo!',
                  message: res.message || 'Aforo actualizado exitosamente.',
                  autoClose: true,
                  autoCloseTime: 3000,
                });

                // ✅ No es obligatorio recargar aquí; el WS lo actualizará.
                // Si quieres recargar para asegurar consistencia de pasajeros/privados:
                queueMicrotask(() => this.loadData());

                this.cdr.markForCheck();
              },
              error: (err) => {
                this.global.alert.set({
                  type: 'error',
                  title: 'Error',
                  message: err?.error?.error || 'No se pudo actualizar el aforo.',
                  autoClose: true,
                });
                this.cdr.markForCheck();
              }
            });
          },
        },
      ],
    });
  }
}
