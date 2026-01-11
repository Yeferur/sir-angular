import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TransferService } from '../../../services/Transfers/transfers';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-ver-transfers',
  standalone: true,
  imports: [CommonModule, DatePipe, FlatpickrInputDirective],
  templateUrl: './ver-transfers.html',
  styleUrls: ['./ver-transfers.css']
})
export class VerTransfersComponent implements OnInit {
  private navbar = inject(DynamicIslandGlobalService);
  private transferService = inject(TransferService);

  resultsServicios = signal<any[]>([]);
  transfers = signal<any[]>([]);
  isLoading = signal(false);
  isLoadingTransfers = signal(false);
  advancedFiltersVisible = signal(false);

  filters = signal({
    Fecha_Transfer: '',
    Fecha_Registro: '',
    Id_Servicio: [] as any[],
    Id_Rango: '' as any,
    Id_Transfer: '',
    Nombre_Titular: '',
    Telefono_Titular: '',
    DNI: '',
    Punto_Salida: '',
    Punto_Destino: '',
    Estado: [] as string[],
    Empty: false
  });

  ngOnInit(): void {
    this.loadInitialData();
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

  loadInitialData() {
    this.isLoading.set(true);
    this.transferService.getServicios().subscribe({ next: (s) => this.resultsServicios.set(s || []), error: () => {} });
    this.isLoading.set(false);
  }

  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update(p => ({ ...p, [key]: value }));
  }

  onMainSearchInput(val: string) {
    // actualiza filtro de nombre/titular
    this.updateFilter('Nombre_Titular', val || '');
    // si parece un DNI largo
    if (/^\d{6,}$/.test(val)) {
      this.updateFilter('DNI', val);
    } else if (/^TR-?\d+/i.test(val)) {
      this.updateFilter('Id_Transfer', val);
    } else {
      this.updateFilter('DNI', '');
      this.updateFilter('Id_Transfer', '');
    }
  }

  toggleSelection(value: any, filterKey: 'Id_Servicio' | 'Estado' | 'Id_Rango') {
    const current = this.filters()[filterKey] as any[];
    const updated = current?.includes ? (current.includes(value) ? current.filter(v => v !== value) : [...current, value]) : [value];
    this.updateFilter(filterKey as any, updated);
  }

  private buildApiFilters() {
    const f = this.filters();
    const api: any = {};
    if (f.Fecha_Transfer) api.Fecha_Transfer = f.Fecha_Transfer;
    if (f.Fecha_Registro) api.Fecha_Registro = f.Fecha_Registro;
    if (f.Id_Servicio?.length) api.Id_Servicio = f.Id_Servicio;
    if (f.Id_Rango) api.Id_Rango = f.Id_Rango;
    if (f.Estado?.length) api.Estado = f.Estado;
    if (f.Id_Transfer) api.Id_Transfer = f.Id_Transfer;
    if (f.Nombre_Titular?.trim()) api.Nombre_Titular = f.Nombre_Titular.trim();
    if (f.Telefono_Titular?.trim()) api.Telefono_Titular = f.Telefono_Titular.trim();
    if (f.DNI?.trim()) api.DNI = f.DNI.trim();
    if (f.Punto_Salida?.trim()) api.Punto_Salida = f.Punto_Salida.trim();
    if (f.Punto_Destino?.trim()) api.Punto_Destino = f.Punto_Destino.trim();
    if (f.Empty) api.Empty = true;
    return api;
  }

  buscarTransfers() {
    const filtros = this.buildApiFilters();
    if (Object.keys(filtros).length === 0) {
      this.navbar.alert.set({ type: 'info', title: 'Sin filtros', message: 'Aplica al menos un filtro para buscar.', autoClose: true, autoCloseTime: 2500 });
      this.transfers.set([]);
      return;
    }
    this.isLoadingTransfers.set(true);
    this.transferService.getTransfers(filtros).subscribe({
      next: (data) => { this.transfers.set(data || []); },
      error: (err) => { this.navbar.alert.set({ type: 'error', title: 'Error', message: err?.message || 'Error', autoClose: false }); this.transfers.set([]); },
      complete: () => { this.isLoadingTransfers.set(false); }
    });
  }

  verTransfer(Id_Transfer: string) {
    this.navbar.Id_Transfer?.set ? this.navbar.Id_Transfer.set(Id_Transfer) : null;
  }
}
