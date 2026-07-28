import { Component, ElementRef, HostListener, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TransferService } from '../../../services/Transfers/transfers';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { UiStateService } from '../../../services/ui-state.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { finalize, Subscription } from 'rxjs';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { toUserErrorMessage } from '../../../shared/errors/user-error-message';

@Component({
  selector: 'app-ver-transfers',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, DatepickerComponent, LoadingStateComponent],
  templateUrl: './ver-transfers.html',
  styleUrls: ['../../listado-reservas-transfers.css']
})
export class VerTransfersComponent implements OnInit, OnDestroy {
  private uiState = inject(UiStateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private transferService = inject(TransferService);
  private permisosService = inject(PermisosService);
  private alerts = inject(SirAlertService);
  private drawer = inject(SirDrawerService);
  private hostElement = inject(ElementRef<HTMLElement>);
  private searchRequest?: Subscription;
  private restoreSearchFromUrl = false;

  readonly estadoOptions = ['Confirmado', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Completado', 'Cancelado'];

  resultsServicios = signal<any[]>([]);
  transfers = signal<any[]>([]);
  readonly pageSize = 25;
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  isLoading = signal(true);
  isSearching = signal(false);
  loadError = signal('');
  searchError = signal('');
  hasSearched = signal(false);
  advancedFiltersVisible = signal(false);

  dropdownOpenEstado = signal(false);
  dropdownOpenServicio = signal(false);

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
    const entity = this.uiState.needsRefresh();
    if (entity === 'transfers') {
      if (this.hasSearched()) {
        this.buscarTransfers(false);
      }
      this.uiState.needsRefresh.set('');
    }
  });

  ngOnInit(): void {
    this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
    this.loadInitialData();
  }

  ngOnDestroy(): void {
    this.searchRequest?.unsubscribe();
  }

  get canDeleteTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.ELIMINAR');
  }

  get canCreateTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.CREAR');
  }

  get canUpdateTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.ACTUALIZAR');
  }

  canCancelTransfer(transfer: any): boolean {
    const estado = String(transfer?.Estado ?? transfer?.Estado_Transfer ?? '').toLowerCase();
    return !!transfer?.Id_Transfer && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  loadInitialData() {
    this.isLoading.set(true);
    this.loadError.set('');
    this.transferService.getServicios().pipe(
      finalize(() => {
        this.isLoading.set(false);
        this.runRestoredSearch();
      })
    ).subscribe({
      next: (s) => this.resultsServicios.set(s || []),
      error: (error) => {
        this.resultsServicios.set([]);
        this.loadError.set(this.getApiErrorMessage(error, 'Revisa tu conexión e inténtalo nuevamente.'));
      }
    });
  }

  crearTransfer() {
    if (!this.canCreateTransfer) {
      this.alerts.errorToast('Acceso denegado', 'No tienes permiso para crear transfers.');
      return;
    }
    this.router.navigate(
      ['/Transfers/NuevoTransfer'],
      { queryParams: this.buildFilterQueryParams(this.hasSearched()) }
    );
  }

  editarTransfer(Id_Transfer: string | number) {
    this.router.navigate(
      ['/Transfers/EditarTransfer', Id_Transfer],
      { queryParams: this.buildFilterQueryParams(this.hasSearched()) }
    );
  }

  confirmCancelarTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id || !this.canCancelTransfer(transfer)) return;

    this.alerts.showConfirm(
      'Cancelar transfer',
      `¿Deseas cancelar el transfer #${transfer?.Codigo_Transfer || id}? La información se conservará para consulta futura.`,
      [
        { text: 'Mantener', style: 'secondary', onClick: () => this.alerts.closeModal() },
        {
          text: 'Cancelar transfer',
          style: 'primary',
          onClick: () => {
            this.alerts.closeModal();
            this.cancelTransfer(transfer);
          }
        }
      ],
      { type: 'warning' }
    );
  }

  confirmEliminarTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id || !this.canDeleteTransfer) return;

    this.alerts.confirmDelete(
      'Eliminar transfer',
      `¿Deseas eliminar el transfer #${transfer?.Codigo_Transfer || id}? Esta acción eliminará el registro de forma permanente.`,
      () => this.deleteTransfer(transfer),
      undefined,
      { confirmText: 'Eliminar', cancelText: 'Cancelar' }
    );
  }

  private cancelTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id) return;

    this.transferService.cancelarTransfer(id).subscribe({
      next: () => {
        this.transfers.update((items) =>
          items.map((item) =>
            String(item?.Id_Transfer) === String(id)
              ? { ...item, Estado: 'Cancelado', Estado_Transfer: 'Cancelado' }
              : item
          )
        );
        this.alerts.successToast('Transfer cancelado', `El transfer #${transfer?.Codigo_Transfer || id} quedó en estado Cancelado.`);
      },
      error: (error) => {
        this.alerts.showAlert({
          type: 'error',
          title: 'No se pudo cancelar',
          message: this.getApiErrorMessage(error, 'No fue posible cancelar el transfer.'),
          autoClose: false
        });
      }
    });
  }

  private deleteTransfer(transfer: any): void {
    const id = transfer?.Id_Transfer;
    if (!id) return;

    this.transferService.deleteTransfer(id).subscribe({
      next: () => {
        if (String(this.uiState.transferId() || '') === String(id)) {
          this.uiState.transferId.set(null);
        }
        this.buscarTransfers(false);
        this.alerts.successToast('Transfer eliminado', `El transfer #${transfer?.Codigo_Transfer || id} fue eliminado correctamente.`);
      },
      error: (error) => {
        this.alerts.showAlert({
          type: 'error',
          title: 'No se pudo eliminar',
          message: this.getApiErrorMessage(error, 'No fue posible eliminar el transfer.'),
          autoClose: false
        });
      }
    });
  }

  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update(p => ({ ...p, [key]: value }));
    this.page.set(1);
    this.syncFiltersToUrl();
  }

  onMainSearchInput(val: string) {
    const v = (val || '').trim();
    this.updateFilter('Nombre_Titular', v);
  }

  clearMainSearch(): void {
    this.updateFilter('Nombre_Titular', '');
  }

  private restoreFiltersFromQuery(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const requestedPage = Number(params.get('pagina') || 1);
    const toValues = (value: string | null): string[] => String(value || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);

    this.filters.set({
      Fecha_Transfer: String(params.get('fechaTransfer') || ''),
      Fecha_Registro: String(params.get('fechaRegistro') || ''),
      Id_Servicio: toValues(params.get('servicios')),
      Id_Rango: String(params.get('rango') || ''),
      Id_Transfer: String(params.get('transfer') || ''),
      Nombre_Titular: String(params.get('q') || ''),
      Telefono_Titular: String(params.get('telefono') || ''),
      DNI: String(params.get('documento') || ''),
      Punto_Salida: String(params.get('salida') || ''),
      Punto_Destino: String(params.get('destino') || ''),
      Estado: toValues(params.get('estado')),
      Empty: params.get('vacios') === '1',
    });

    this.page.set(Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    return params.get('buscar') === '1';
  }

  private buildFilterQueryParams(searchApplied: boolean): Record<string, string | number | null> {
    const filter = this.filters();
    return {
      fechaTransfer: filter.Fecha_Transfer || null,
      fechaRegistro: filter.Fecha_Registro || null,
      servicios: filter.Id_Servicio.length ? filter.Id_Servicio.join('|') : null,
      estado: filter.Estado.length ? filter.Estado.join('|') : null,
      rango: filter.Id_Rango || null,
      transfer: filter.Id_Transfer || null,
      q: filter.Nombre_Titular.trim() || null,
      telefono: filter.Telefono_Titular.trim() || null,
      documento: filter.DNI.trim() || null,
      salida: filter.Punto_Salida.trim() || null,
      destino: filter.Punto_Destino.trim() || null,
      vacios: filter.Empty ? 1 : null,
      pagina: this.page() > 1 ? this.page() : null,
      buscar: searchApplied ? 1 : null,
    };
  }

  private syncFiltersToUrl(searchApplied = this.hasSearched()): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.buildFilterQueryParams(searchApplied),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private runRestoredSearch(): void {
    if (!this.restoreSearchFromUrl) return;
    this.restoreSearchFromUrl = false;
    this.buscarTransfers(false);
  }

  // --- Dropdown management ---

  toggleDropdown(name: 'estado' | 'servicio') {
    this.dropdownOpenEstado.set(name === 'estado' ? !this.dropdownOpenEstado() : false);
    this.dropdownOpenServicio.set(name === 'servicio' ? !this.dropdownOpenServicio() : false);
  }

  toggleAdvancedFilters(): void {
    const shouldOpen = !this.advancedFiltersVisible();
    this.closeFilterDropdowns();
    this.advancedFiltersVisible.set(shouldOpen);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const clickedOwnMultiFilter =
      this.hostElement.nativeElement.contains(target) && !!target.closest('.multi-filter');
    if (!clickedOwnMultiFilter) this.closeFilterDropdowns();
  }

  @HostListener('document:keydown.escape')
  onFilterEscape(): void {
    this.closeFilterDropdowns();
  }

  private closeFilterDropdowns(): void {
    this.dropdownOpenEstado.set(false);
    this.dropdownOpenServicio.set(false);
  }

  private closeAdvancedFilters(): void {
    this.advancedFiltersVisible.set(false);
    this.closeFilterDropdowns();
  }

  isSelected(filterKey: 'Estado' | 'Id_Servicio', value: any): boolean {
    const selectedValues = this.filters()[filterKey] as any[];
    if (!selectedValues?.length) return false;
    if (filterKey === 'Id_Servicio') {
      return selectedValues.some((selected) => String(selected) === String(value));
    }
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
    const selected = filterKey === 'Id_Servicio'
      ? current?.some((item) => String(item) === String(value))
      : current?.includes?.(value);
    const updated = selected
      ? current.filter((item) => filterKey === 'Id_Servicio'
        ? String(item) !== String(value)
        : item !== value)
      : [...(current || []), value];
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
  }

  clearFechaRegistro(): void {
    this.updateFilter('Fecha_Registro', '');
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
    if (f.Nombre_Titular?.trim()) api.q = f.Nombre_Titular.trim();
    if (f.Telefono_Titular?.trim()) api.Telefono_Titular = f.Telefono_Titular.trim();
    if (f.DNI?.trim()) api.DNI = f.DNI.trim();
    if (f.Punto_Salida?.trim()) api.Punto_Salida = f.Punto_Salida.trim();
    if (f.Punto_Destino?.trim()) api.Punto_Destino = f.Punto_Destino.trim();
    return api;
  }

  buscarTransfers(resetPage = true) {
    const filtros = this.buildApiFilters();
    if (Object.keys(filtros).length === 0) {
      this.alerts.showAlert({ type: 'info', title: 'Sin filtros', message: 'Aplica al menos un filtro para buscar.', autoClose: true, autoCloseTime: 2500 });
      return;
    }
    if (resetPage) this.page.set(1);
    const paginatedFilters = {
      ...filtros,
      page: this.page(),
      limit: this.pageSize,
    };
    this.searchRequest?.unsubscribe();
    this.hasSearched.set(true);
    this.isSearching.set(true);
    this.searchError.set('');
    this.syncFiltersToUrl(true);
    this.closeAdvancedFilters();
    this.searchRequest = this.transferService.getTransfers(paginatedFilters).pipe(
      finalize(() => this.isSearching.set(false))
    ).subscribe({
      next: (result) => {
        const total = Math.max(0, Number(result?.total || 0));
        const normalizedPage = Math.max(1, Number(result?.page || this.page()) || 1);
        this.transfers.set(Array.isArray(result?.data) ? result.data : []);
        this.total.set(total);
        this.page.set(normalizedPage);
        this.totalPages.set(Math.max(1, Number(result?.totalPages || Math.ceil(total / this.pageSize)) || 1));
        this.syncFiltersToUrl(true);
      },
      error: (error) => {
        this.searchError.set(this.getApiErrorMessage(error, 'No fue posible consultar los transfers.'));
      }
    });
  }

  prevPage(): void {
    if (this.page() <= 1 || this.isSearching()) return;
    this.page.update((value) => value - 1);
    this.buscarTransfers(false);
  }

  nextPage(): void {
    if (this.page() >= this.totalPages() || this.isSearching()) return;
    this.page.update((value) => value + 1);
    this.buscarTransfers(false);
  }

  resultsRangeLabel(): string {
    if (!this.total()) return '0 transfers';
    const first = (this.page() - 1) * this.pageSize + 1;
    const last = Math.min(this.total(), first + this.transfers().length - 1);
    return `${first}–${last} de ${this.total()} transfers`;
  }

  verTransfer(Id_Transfer: string) {
    this.uiState.transferId.set(Id_Transfer);
    this.drawer.openTransfer(Id_Transfer);
  }

  private getApiErrorMessage(error: any, fallback = 'No fue posible completar la operación.'): string {
    return toUserErrorMessage(error, fallback);
  }

  getEstadoBadgeClass(estado: string | null | undefined): string {
    const normalized = String(estado || '').trim().toLowerCase();
    if (['confirmado', 'confirmada', 'activo', 'activa'].includes(normalized)) return 'badge--success';
    if (['cancelado', 'cancelada'].includes(normalized)) return 'badge--danger';
    if (['pendiente', 'pendiente de datos', 'pendiente de pago'].includes(normalized)) return 'badge--pending';
    if (['completado', 'completada'].includes(normalized)) return 'badge--info';
    return 'badge--grupal';
  }
}
