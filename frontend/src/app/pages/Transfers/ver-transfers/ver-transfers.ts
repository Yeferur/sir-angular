import { Component, OnInit, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { TransferService } from '../../../services/Transfers/transfers';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { PermisosService } from '../../../services/Permisos/permisos.service';

@Component({
  selector: 'app-ver-transfers',
  standalone: true,
  imports: [CommonModule, DatePipe, FlatpickrInputDirective],
  templateUrl: './ver-transfers.html',
  styleUrls: ['./ver-transfers.css']
})
export class VerTransfersComponent implements OnInit {
  private navbar = inject(DynamicIslandGlobalService);
  private router = inject(Router);
  private transferService = inject(TransferService);
  private permisosService = inject(PermisosService);

  readonly estadoOptions = ['Confirmado', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Completado', 'Cancelado'];

  resultsServicios = signal<any[]>([]);
  transfers = signal<any[]>([]);
  isPageLoading = signal(false);
  isSearching = signal(false);
  hasSearched = signal(false);
  advancedFiltersVisible = signal(false);

  dropdownOpenEstado = signal(false);
  dropdownOpenServicio = signal(false);

  @ViewChild('fechaTransferFp') fechaTransferFp?: FlatpickrInputDirective;
  @ViewChild('fechaRegistroFp') fechaRegistroFp?: FlatpickrInputDirective;

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

  private readonly refreshEffect = effect(() => {
    const entity = this.navbar.needsRefresh();
    if (entity === 'transfers') {
      if (this.hasSearched()) {
        this.buscarTransfers();
      }
      this.navbar.needsRefresh.set('');
    }
  });

  ngOnInit(): void {
    this.loadInitialData();
  }

  get canDeleteTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.ELIMINAR');
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
    this.isPageLoading.set(true);
    this.transferService.getServicios().subscribe({
      next: (s) => this.resultsServicios.set(s || []),
      error: () => this.resultsServicios.set([]),
      complete: () => this.isPageLoading.set(false)
    });
  }

  crearTransfer() {
    this.router.navigate(['/Transfers/NuevoTransfer']);
  }

  editarTransfer(Id_Transfer: string | number) {
    this.router.navigate(['/Transfers/EditarTransfer', Id_Transfer]);
  }

  confirmEliminarTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id || !this.canDeleteTransfer) return;

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar transfer',
      message: `¿Deseas eliminar el transfer #${transfer?.Codigo_Transfer || id}? Esta acción eliminará el registro de forma permanente.`,
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        },
        {
          text: 'Eliminar',
          style: 'delete',
          onClick: () => {
            this.navbar.alert.set(null);
            this.deleteTransfer(transfer);
          }
        }
      ]
    });
  }

  private deleteTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id) return;

    this.transferService.deleteTransfer(id).subscribe({
      next: () => {
        this.transfers.update((items) => items.filter((item) => String(item?.Id_Transfer) !== String(id)));
        if (String(this.navbar.Id_Transfer() || '') === String(id)) {
          this.navbar.Id_Transfer.set(null);
        }
        this.navbar.successToast('Transfer eliminado', `El transfer #${transfer?.Codigo_Transfer || id} fue eliminado correctamente.`);
      },
      error: (err) => {
        this.navbar.alert.set({
          type: 'error',
          title: 'No se pudo eliminar',
          message: err?.error?.message || err?.error?.error || err?.message || 'No fue posible eliminar el transfer.',
          autoClose: false,
          buttons: [
            {
              text: 'Cerrar',
              style: 'secondary',
              onClick: () => this.navbar.alert.set(null)
            }
          ]
        });
      }
    });
  }

  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update(p => ({ ...p, [key]: value }));
  }

  onMainSearchInput(val: string) {
    const v = (val || '').trim();
    this.updateFilter('Nombre_Titular', v);

    // Reset specific filters first
    this.updateFilter('DNI', '');
    this.updateFilter('Id_Transfer', '');
    this.updateFilter('Telefono_Titular', '');

    if (/^\d{6,}$/.test(v)) {
      // 6+ digits → DNI
      this.updateFilter('DNI', v);
    } else if (/^(TRS|TRC|TR)-?\d+/i.test(v)) {
      const idNum = v.replace(/^(TRS|TRC|TR)-?/i, '');
      this.updateFilter('Id_Transfer', idNum);
    } else if (/^\+?\d[\d\s\-]{6,}$/.test(v)) {
      // Phone-like pattern → Telefono_Titular
      this.updateFilter('Telefono_Titular', v);
    }
  }

  // --- Dropdown management ---

  toggleDropdown(name: 'estado' | 'servicio') {
    this.dropdownOpenEstado.set(name === 'estado' ? !this.dropdownOpenEstado() : false);
    this.dropdownOpenServicio.set(name === 'servicio' ? !this.dropdownOpenServicio() : false);
  }

  isSelected(filterKey: 'Estado' | 'Id_Servicio', value: any): boolean {
    const selectedValues = this.filters()[filterKey] as any[];
    if (!selectedValues?.length) return false;
    return selectedValues.includes(value);
  }

  clearMultiFilter(filterKey: 'Estado' | 'Id_Servicio'): void {
    this.updateFilter(filterKey, []);
    if (filterKey === 'Estado') this.dropdownOpenEstado.set(false);
    if (filterKey === 'Id_Servicio') this.dropdownOpenServicio.set(false);
  }

  getMultiFilterLabel(filterKey: 'Estado' | 'Id_Servicio'): string {
    const selectedCount = (this.filters()[filterKey] as any[])?.length || 0;
    if (selectedCount === 0) return 'Todos';
    if (selectedCount === 1) return '1 seleccionado';
    return `${selectedCount} seleccionados`;
  }

  toggleSelection(value: any, filterKey: 'Id_Servicio' | 'Estado' | 'Id_Rango') {
    if (value === '' || value === null || value === undefined) {
      this.updateFilter(filterKey as any, []);
      return;
    }
    const current = this.filters()[filterKey] as any[];
    const updated = current?.includes ? (current.includes(value) ? current.filter(v => v !== value) : [...current, value]) : [value];
    this.updateFilter(filterKey as any, updated);
  }

  activeFilterCount(): number {
    const f = this.filters();
    let count = 0;
    if (f.Fecha_Transfer) count++;
    if (f.Fecha_Registro) count++;
    if (f.Estado?.length) count++;
    if (f.Id_Servicio?.length) count++;
    return count;
  }

  getSelectedServiciosText(): string {
    const ids = this.filters().Id_Servicio;
    if (!ids?.length) return '';
    return ids
      .map(id => {
        const s = this.resultsServicios().find(srv => (srv.Id_Servicio ?? srv.id) == id);
        return s ? s.Servicio : id;
      })
      .join(', ');
  }

  clearFechaTransfer(): void {
    this.updateFilter('Fecha_Transfer', '');
    this.fechaTransferFp?.instance?.clear();
  }

  clearFechaRegistro(): void {
    this.updateFilter('Fecha_Registro', '');
    this.fechaRegistroFp?.instance?.clear();
  }

  private buildApiFilters() {
    const f = this.filters();
    const api: any = {};
    if (f.Fecha_Transfer) api.Fecha_Transfer = f.Fecha_Transfer;
    // Fecha_Registro: not supported by backend query
    if (f.Id_Servicio?.length) api.Id_Servicio = f.Id_Servicio;
    if (f.Id_Rango) api.Id_Rango = f.Id_Rango;
    if (f.Estado?.length) api.Estado = f.Estado;
    if (f.Id_Transfer) api.Id_Transfer = f.Id_Transfer;
    if (f.Nombre_Titular?.trim()) api.Nombre_Titular = f.Nombre_Titular.trim();
    if (f.Telefono_Titular?.trim()) api.Telefono_Titular = f.Telefono_Titular.trim();
    if (f.DNI?.trim()) api.DNI = f.DNI.trim();
    if (f.Punto_Salida?.trim()) api.Punto_Salida = f.Punto_Salida.trim();
    if (f.Punto_Destino?.trim()) api.Punto_Destino = f.Punto_Destino.trim();
    return api;
  }

  buscarTransfers() {
    const filtros = this.buildApiFilters();
    if (Object.keys(filtros).length === 0) {
      this.navbar.alert.set({ type: 'info', title: 'Sin filtros', message: 'Aplica al menos un filtro para buscar.', autoClose: true, autoCloseTime: 2500 });
      this.transfers.set([]);
      return;
    }
    this.hasSearched.set(true);
    this.isSearching.set(true);
    this.advancedFiltersVisible.set(false);
    this.dropdownOpenEstado.set(false);
    this.dropdownOpenServicio.set(false);
    this.transferService.getTransfers(filtros).subscribe({
      next: (data) => { this.transfers.set(data || []); },
      error: (err) => { this.navbar.alert.set({ type: 'error', title: 'Error', message: err?.message || 'Error', autoClose: false }); this.transfers.set([]); },
      complete: () => { this.isSearching.set(false); }
    });
  }

  verTransfer(Id_Transfer: string) {
    this.navbar.Id_Transfer();
    this.navbar.Id_Transfer?.set ? this.navbar.Id_Transfer.set(Id_Transfer) : null;
  }
}
