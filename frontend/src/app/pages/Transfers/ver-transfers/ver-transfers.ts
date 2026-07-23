import { Component, ElementRef, HostListener, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  private transferService = inject(TransferService);
  private permisosService = inject(PermisosService);
  private alerts = inject(SirAlertService);
  private drawer = inject(SirDrawerService);
  private hostElement = inject(ElementRef<HTMLElement>);
  private searchRequest?: Subscription;

  readonly estadoOptions = ['Confirmado', 'Pendiente', 'Pendiente de datos', 'Pendiente de pago', 'Completado', 'Cancelado'];

  resultsServicios = signal<any[]>([]);
  transfers = signal<any[]>([]);
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
        this.buscarTransfers();
      }
      this.uiState.needsRefresh.set('');
    }
  });

  ngOnInit(): void {
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
      finalize(() => this.isLoading.set(false))
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
    this.router.navigate(['/Transfers/NuevoTransfer']);
  }

  editarTransfer(Id_Transfer: string | number) {
    this.router.navigate(['/Transfers/EditarTransfer', Id_Transfer]);
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
        this.transfers.update((items) => items.filter((item) => String(item?.Id_Transfer) !== String(id)));
        if (String(this.uiState.transferId() || '') === String(id)) {
          this.uiState.transferId.set(null);
        }
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
  }

  onMainSearchInput(val: string) {
    const v = (val || '').trim();
    this.updateFilter('Nombre_Titular', v);
  }

  clearMainSearch(): void {
    this.updateFilter('Nombre_Titular', '');
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

  buscarTransfers() {
    const filtros = this.buildApiFilters();
    if (Object.keys(filtros).length === 0) {
      this.alerts.showAlert({ type: 'info', title: 'Sin filtros', message: 'Aplica al menos un filtro para buscar.', autoClose: true, autoCloseTime: 2500 });
      return;
    }
    this.searchRequest?.unsubscribe();
    this.hasSearched.set(true);
    this.isSearching.set(true);
    this.searchError.set('');
    this.closeAdvancedFilters();
    this.searchRequest = this.transferService.getTransfers(filtros).pipe(
      finalize(() => this.isSearching.set(false))
    ).subscribe({
      next: (data) => this.transfers.set(data || []),
      error: (error) => {
        this.searchError.set(this.getApiErrorMessage(error, 'No fue posible consultar los transfers.'));
      }
    });
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
