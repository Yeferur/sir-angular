import { ChangeDetectorRef, Component, OnInit, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { finalize, forkJoin, firstValueFrom } from 'rxjs';
// Importa tus servicios
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-ver-reservas',
  standalone: true,
  imports: [CommonModule, DatePipe, FlatpickrInputDirective],
  templateUrl: './ver-reservas.html',
  styleUrls: ['./ver-reservas.css']
})
export class VerReservasComponent implements OnInit {
  readonly estadoOptions = ['Confirmada', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Completada', 'Cancelada'];
  mainInputFocused = signal(false);
private settingFromAutocomplete = false;

  onMainInputFocus() {
    this.mainInputFocused.set(true);
    if (this.puntoSugerencias().length > 0) this.puntoAutocompleteVisible.set(true);
  }

  onMainInputBlur() {
    setTimeout(() => {
      this.mainInputFocused.set(false);
      this.puntoAutocompleteVisible.set(false);
    }, 120);
  }
  puntoSugerencias = signal<any[]>([]);
  puntoAutocompleteVisible = signal(false);

  async onPuntoAutocomplete(ev: Event) {
    const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
    if (term.length < 2) {
      this.puntoSugerencias.set([]);
      this.puntoAutocompleteVisible.set(false);
      return;
    }
    try {
      const results = await firstValueFrom(this.reservasService.buscarPuntos(term));
      this.puntoSugerencias.set(results || []);
      // Solo mostrar si el input tiene focus
      this.puntoAutocompleteVisible.set((results && results.length > 0 && this.mainInputFocused()));
    } catch {
      this.puntoSugerencias.set([]);
      this.puntoAutocompleteVisible.set(false);
    }
  }

  puntoSeleccionado: any = null;
seleccionarPuntoAutocomplete(p: any) {
  this.settingFromAutocomplete = true;

  this.puntoSeleccionado = p;

  this.updateFilter('NombreApellido', p.NombrePunto);

  // ✅ filtro avanzado
  this.updateFilter('Punto', p.NombrePunto);

  // opcional: al seleccionar punto, limpia DNI / IdReserva (para no mezclar)
  this.updateFilter('IdPas', '');
  this.updateFilter('Id_Reserva', '');

  this.puntoAutocompleteVisible.set(false);
  this.puntoSugerencias.set([]);

  // liberar en el siguiente tick para que no pegue con el input event
  setTimeout(() => (this.settingFromAutocomplete = false), 0);
}


  onMainSearchInput(val: string) {
  const v = (val || '').trim();

  if (!this.settingFromAutocomplete) {
    if (this.puntoSeleccionado && this.puntoSeleccionado.NombrePunto !== v) {
      this.puntoSeleccionado = null;
      this.updateFilter('Punto', '');
    }
  }

  this.updateFilter('NombreApellido', v);

  if (/^\d{6,}$/.test(v)) {
    this.updateFilter('IdPas', v);
  } else {
    this.updateFilter('IdPas', '');
  }

  if (/^RSV\d+/i.test(v)) {
    this.updateFilter('Id_Reserva', v);
  } else {
    this.updateFilter('Id_Reserva', '');
  }

  if (!this.puntoSeleccionado) {
    this.onPuntoAutocomplete({ target: { value: v } } as any);
  }
}


  getSelectedToursText(): string {
    const ids = this.filters().tour;
    if (!ids?.length) return '';
    return ids
      .map(id => {
        const t = this.resultsTours().find(tour => tour.Id_Tour == id);
        return t ? t.Nombre_Tour : id;
      })
      .join(', ');
  }

  getSelectedCategoriasText(): string {
    const ids = this.filters().CategoriaReserva;
    if (!ids?.length) return '';
    return ids
      .map(id => {
        const c = this.resultsCategoria().find(canal => canal.Id_Canal == id);
        return c ? c.Nombre_Canal : id;
      })
      .join(', ');
  }

  private navbar = inject(DynamicIslandGlobalService);
  private router = inject(Router);
  private reservasService = inject(Reservas);
  private cdr = inject(ChangeDetectorRef);

  resultsTours = signal<any[]>([]);
  resultsCategoria = signal<any[]>([]);
  reservas = signal<any[]>([]);
  isLoading = signal(true);
  isSearching = signal(false);
  hasSearched = signal(false);
  filtersApplied = signal(false);

  advancedFiltersVisible = signal(false);

  dropdownOpenCategoria = signal(false);
  dropdownOpenTour = signal(false);
  dropdownOpenEstado = signal(false);

  @ViewChild('fechaReservaFp') fechaReservaFp?: FlatpickrInputDirective;
  @ViewChild('fechaRegistroFp') fechaRegistroFp?: FlatpickrInputDirective;

  filters = signal({
    FechaReserva: '',
    FechaRegistro: '',
    CategoriaReserva: [] as number[],
    tour: [] as number[],
    Id_Reserva: '',
    NombreApellido: '',
    IdPas: '',
    Punto: '',
    Estado: [] as string[],
    Empty: false,
  });

  private readonly refreshEffect = effect(() => {
    const entity = this.navbar.needsRefresh();
    if (entity === 'reservas') {
      this.listar();
    }
  });

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

  ngOnInit(): void {
    this.loadInitialData();
  }

  listar() {
    if (this.filtersApplied()) {
      this.buscarReservas();
    }
  }

  crearReserva() {
    this.router.navigate(['/Reservas/NuevaReserva']);
  }

  clearFechaReserva(): void {
    this.updateFilter('FechaReserva', '');
    this.fechaReservaFp?.instance?.clear();
    this.cdr.markForCheck();
  }

  clearFechaRegistro(): void {
    this.updateFilter('FechaRegistro', '');
    this.fechaRegistroFp?.instance?.clear();
    this.cdr.markForCheck();
  }

  loadInitialData() {
    this.isLoading.set(true);
    forkJoin({
      tours: this.reservasService.getTours(),
      categorias: this.reservasService.getCanales(),
    }).pipe(
      finalize(() => {
        this.isLoading.set(false);
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: ({ tours, categorias }) => {
        this.resultsTours.set(tours || []);
        this.resultsCategoria.set(categorias || []);
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error al cargar catálogos:', error);
        this.resultsTours.set([]);
        this.resultsCategoria.set([]);
        this.cdr.markForCheck();
      }
    });
  }

  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update((prev) => ({ ...prev, [key]: value }));
  }

  toggleDropdown(name: 'tour' | 'categoria' | 'estado') {
    this.dropdownOpenTour.set(name === 'tour' ? !this.dropdownOpenTour() : false);
    this.dropdownOpenCategoria.set(name === 'categoria' ? !this.dropdownOpenCategoria() : false);
    this.dropdownOpenEstado.set(name === 'estado' ? !this.dropdownOpenEstado() : false);
  }

  isSelected(filterKey: 'CategoriaReserva' | 'tour' | 'Estado', value: any): boolean {
    const selectedValues = this.filters()[filterKey] as any[];
    if (!selectedValues?.length) return false;

    if (filterKey === 'CategoriaReserva' || filterKey === 'tour') {
      return selectedValues.includes(typeof value === 'string' ? Number(value) : value);
    }

    return selectedValues.includes(String(value));
  }

  clearMultiFilter(filterKey: 'CategoriaReserva' | 'tour' | 'Estado'): void {
    this.updateFilter(filterKey, []);
  }

  getMultiFilterLabel(filterKey: 'CategoriaReserva' | 'tour' | 'Estado'): string {
    const selectedCount = (this.filters()[filterKey] as any[])?.length || 0;
    if (selectedCount === 0) return 'Todos';
    if (selectedCount === 1) return '1 seleccionado';
    return `${selectedCount} seleccionados`;
  }

  toggleSelection(value: any, filterKey: 'CategoriaReserva' | 'tour' | 'Estado') {
    // Si value es "", limpiar completamente el filtro (equivalente a seleccionar "Todos")
    if (value === '') {
      this.updateFilter(filterKey, []);
      return;
    }

    // Validar que value no sea null o undefined
    if (value === null || value === undefined) {
      return;
    }

    // Convertir a number para CategoriaReserva y tour, mantener string para Estado
    let normalizedValue = value;
    if ((filterKey === 'CategoriaReserva' || filterKey === 'tour') && typeof value === 'string') {
      normalizedValue = Number(value);
    }

    const current = this.filters()[filterKey] as any[];
    const updated = current.includes(normalizedValue)
      ? current.filter((v) => v !== normalizedValue)
      : [...current, normalizedValue];
    this.updateFilter(filterKey, updated);
  }

  activeFilterCount(): number {
    const f = this.filters();
    let count = 0;

    if (f.FechaReserva) count++;
    if (f.FechaRegistro) count++;
    if (f.CategoriaReserva?.length) count++;
    if (f.tour?.length) count++;
    if (f.Estado?.length) count++;

    return count;
  }

  private buildApiFilters() {
    const f = this.filters();
    const api: any = {};

    if (f.FechaReserva) api.Fecha_Tour = f.FechaReserva;     // o FechaReserva según tu backend
    if (f.FechaRegistro) api.FechaRegistro = f.FechaRegistro;

    // TOUR
    if (f.tour?.length) api.Id_Tour = f.tour;

    // CATEGORIA (canal)
    if (f.CategoriaReserva?.length) api.Id_Canal = f.CategoriaReserva;

    // ESTADO
    if (f.Estado?.length) api.Estado = f.Estado;

    // BÚSQUEDA PRINCIPAL
    if (f.NombreApellido?.trim()) api.q = f.NombreApellido.trim(); // o Nombre_Reportante, según tu API

    // ID RESERVA
    if (f.Id_Reserva?.trim()) api.Id_Reserva = f.Id_Reserva.trim();

    // PASAPORTE/DNI
    if (f.IdPas?.trim()) api.DNI = f.IdPas.trim(); // o IdPas si así lo dejaste en backend

    // PUNTO
    if (f.Punto?.trim()) api.Punto = f.Punto.trim(); // o Id_Punto

    if (f.Empty) api.Empty = true;

    return api;
  }

  private toISO(v: string): string {
    // si te llega "2025-12-15" lo devuelve igual; si te llega "12/15/25" también lo arregla
    const d = new Date(v);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  buscarReservas() {
    const filtros = this.buildApiFilters();
    // Si el filtro es por punto, solo buscar si el punto fue seleccionado del autocompletar
    if (filtros.Punto && !this.puntoSeleccionado) {
      this.navbar.alert.set({
        type: 'info',
        title: 'Selecciona un punto',
        message: 'Debes seleccionar un punto de encuentro del autocompletar.',
        autoClose: true,
        autoCloseTime: 3000
      });
      this.reservas.set([]);
      return;
    }
    // Si no hay ningún filtro relevante, no buscar
    if (Object.keys(filtros).length === 0 ||
      (!filtros.Punto && !filtros.q && !filtros.Id_Reserva && !filtros.DNI && !filtros.Fecha_Tour && !filtros.Estado && !filtros.Id_Tour && !filtros.Id_Canal)) {
      this.navbar.alert.set({
        type: 'info',
        title: 'Sin filtros',
        message: 'Debes aplicar al menos un filtro para buscar.',
        autoClose: true,
        autoCloseTime: 3000
      });
      this.reservas.set([]);
      return;
    }
    this.hasSearched.set(true);
    this.isSearching.set(true);
    this.filtersApplied.set(true);
    this.advancedFiltersVisible.set(false); // Oculta el panel de filtros al buscar
    this.cdr.markForCheck();
    this.reservasService.getReservas(filtros).pipe(
      finalize(() => {
        this.isSearching.set(false);
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (data) => {
        this.reservas.set(data);
        this.cdr.markForCheck();
        if (data.length === 0) {
          this.navbar.alert.set({
            type: 'info',
            title: 'Sin resultados',
            message: 'No se encontraron reservas con los filtros actuales.',
            autoClose: true,
            autoCloseTime: 3000
          });
        } else {
          this.navbar.successToast('Reservas encontradas', `Se encontraron ${data.length} reservas.`);
        }
      },
      error: (error) => {
        this.navbar.alert.set({
          type: 'error',
          title: 'Error en la búsqueda',
          message: error.message,
          autoClose: false
        });
        this.reservas.set([]);
        this.cdr.markForCheck();
      }
    });
  }

  verReserva(Id_Reserva: string) {
    this.navbar.Id_Reserva.set(Id_Reserva);
  }
}
