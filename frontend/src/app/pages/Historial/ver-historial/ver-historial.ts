import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { HistorialService, Historial, HistorialFilters } from '../../../services/Historial/historial.service';

@Component({
  selector: 'app-ver-historial',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, FlatpickrInputDirective],
  templateUrl: './ver-historial.html',
  styleUrls: ['./ver-historial.css']
})
export class VerHistorialComponent implements OnInit {
  private historialService = inject(HistorialService);
  private globalService = inject(DynamicIslandGlobalService);

  // Datos del historial
  historialList = signal<Historial[]>([]);
  isLoading = signal(false);
  totalRecords = signal(0);

  // Paginación
  currentPage = signal(1);
  pageSize = signal(10);
  totalPages = signal(1);

  // Filtros
  filters = signal({
    Usuario: '',
    Tipo_Accion: '',
    Tabla_Afectada: '',
    FechaInicio: '',
    FechaFin: '',
    searchText: ''
  });

  advancedFiltersVisible = signal(false);

  // Opciones para dropdowns
  tiposAccion = signal<string[]>([
    'CREATE',
    'READ',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'EXPORT',
    'IMPORT'
  ]);

  tablasAfectadas = signal<string[]>([
    'usuarios',
    'tours',
    'reservas',
    'transfers',
    'puntos',
    'programacion',
    'aforos'
  ]);

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

  ngOnInit() {
    this.cargarHistorial();
  }

  cargarHistorial() {
    this.isLoading.set(true);

    const filtersData: HistorialFilters = {
      usuario: this.filters().Usuario,
      tipoAccion: this.filters().Tipo_Accion,
      tablaAfectada: this.filters().Tabla_Afectada,
      fechaInicio: this.filters().FechaInicio,
      fechaFin: this.filters().FechaFin,
      search: this.filters().searchText,
      page: this.currentPage(),
      limit: this.pageSize()
    };

    this.historialService.getHistorial(filtersData).subscribe({
      next: (response) => {
        this.historialList.set(response.data || []);
        this.totalRecords.set(response.total || 0);
        this.totalPages.set(Math.ceil(this.totalRecords() / this.pageSize()));
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error al cargar historial:', error);
        this.globalService.alert.set({
          type: 'error',
          title: 'Error',
          message: 'No se pudo cargar el historial'
        });
        this.isLoading.set(false);
      }
    });
  }

  updateFilter(key: string, value: any) {
    const currentFilters = { ...this.filters() };
    currentFilters[key as keyof typeof currentFilters] = value;
    this.filters.set(currentFilters);
    this.currentPage.set(1);
  }

  buscar() {
    this.currentPage.set(1);
    this.cargarHistorial();
  }

  limpiarFiltros() {
    this.filters.set({
      Usuario: '',
      Tipo_Accion: '',
      Tabla_Afectada: '',
      FechaInicio: '',
      FechaFin: '',
      searchText: ''
    });
    this.currentPage.set(1);
    this.cargarHistorial();
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.cargarHistorial();
    }
  }

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  previousPage() {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  exportarHistorial() {
    const filtersData: HistorialFilters = {
      usuario: this.filters().Usuario,
      tipoAccion: this.filters().Tipo_Accion,
      tablaAfectada: this.filters().Tabla_Afectada,
      fechaInicio: this.filters().FechaInicio,
      fechaFin: this.filters().FechaFin
    };

    this.historialService.exportarHistorial(filtersData).subscribe({
      next: (blob) => {
        this.historialService.descargarCSV(blob);
      },
      error: (error) => {
        console.error('Error al exportar:', error);
        this.globalService.alert.set({
          type: 'error',
          title: 'Error',
          message: 'No se pudo exportar el historial'
        });
      }
    });
  }

  getAccionColor(accion: string): string {
    const colors: { [key: string]: string } = {
      CREATE: '#28a745',
      READ: '#17a2b8',
      UPDATE: '#ffc107',
      DELETE: '#dc3545',
      LOGIN: '#007bff',
      LOGOUT: '#6c757d',
      EXPORT: '#20c997',
      IMPORT: '#6610f2'
    };
    return colors[accion] || '#6c757d';
  }

  getAccionLabel(accion: string): string {
    const labels: { [key: string]: string } = {
      CREATE: 'Crear',
      READ: 'Leer',
      UPDATE: 'Actualizar',
      DELETE: 'Eliminar',
      LOGIN: 'Iniciar Sesión',
      LOGOUT: 'Cerrar Sesión',
      EXPORT: 'Exportar',
      IMPORT: 'Importar'
    };
    return labels[accion] || accion;
  }
}
