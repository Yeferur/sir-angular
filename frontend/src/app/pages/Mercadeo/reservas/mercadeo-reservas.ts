import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, firstValueFrom } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirMultiSelectComponent, SirMultiSelectOption } from '../../../shared/multi-select/multi-select';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { MercadeoFilters, MercadeoOrigenOperacion, MercadeoOrigenPage, MercadeoService, MercadeoUsuario } from '../../../services/Mercadeo/mercadeo.service';

type AppliedFilter = 'registro' | 'canal' | 'creadores' | 'estado' | 'servicio';
const serviceOptions: SirSelectOption[] = [
  { value: 'TODOS', label: 'Todos' }, { value: 'RESERVA', label: 'Reservas' }, { value: 'TRANSFER', label: 'Transfers' },
];
const stateOptions: SirSelectOption[] = [
  { value: '', label: 'Todos los estados' }, { value: 'Pendiente', label: 'Pendiente' },
  { value: 'Pendiente de datos', label: 'Pendiente de datos' }, { value: 'Pendiente de pago', label: 'Pendiente de pago' },
  { value: 'Confirmada', label: 'Confirmada' }, { value: 'Confirmado', label: 'Confirmado' },
  { value: 'Completada', label: 'Completada' }, { value: 'Completado', label: 'Completado' },
  { value: 'Cancelada', label: 'Cancelada' }, { value: 'Cancelado', label: 'Cancelado' },
  { value: 'Activo', label: 'Activo (legado)' }, { value: 'Activa', label: 'Activa (legado)' },
];
function bogotaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function defaultFilters(): MercadeoFilters {
  const today = bogotaToday();
  return { fechaRegistroDesde: shiftDate(today, -29), fechaRegistroHasta: today, fechaTour: '',
    codigoReserva: '', categoria: '', tipo: 'TODOS', estado: '', idEntidadReportante: '', creadorIds: [] };
}

@Component({
  selector: 'app-mercadeo-reservas',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, SirDateRangePickerComponent, SirFilterBarComponent,
    SirFilterPanelComponent, QueryEmptyStateComponent, SirSelectComponent, SirMultiSelectComponent, LoadingStateComponent],
  templateUrl: './mercadeo-reservas.html',
  styleUrls: ['../../listado-reservas-transfers.css', './mercadeo-reservas.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MercadeoReservasComponent implements OnInit {
  private readonly api = inject(MercadeoService);
  private readonly permissions = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private lastRouteState = '';

  readonly filters = signal<MercadeoFilters>(defaultFilters());
  readonly appliedFilters = signal<MercadeoFilters>(defaultFilters());
  readonly serviceOptions = serviceOptions;
  readonly stateOptions = stateOptions;
  readonly result = signal<MercadeoOrigenPage | null>(null);
  readonly loading = signal(false);
  readonly loadingCategories = signal(true);
  readonly exporting = signal(false);
  readonly hasSearched = signal(false);
  readonly filtersOpen = signal(false);
  readonly error = signal('');
  readonly categoryError = signal('');
  readonly userError = signal('');
  readonly categorias = signal<{ Id_Canal: number; Nombre_Canal: string }[]>([]);
  readonly categoryOptions = signal<SirSelectOption[]>([{ value: '', label: 'Todos los canales' }]);
  readonly usuarios = signal<MercadeoUsuario[]>([]);
  readonly creatorOptions = computed<SirMultiSelectOption[]>(() => this.usuarios().map(user => ({
    value: String(user.Id_Usuario),
    label: (user.Nombres_Apellidos || ('Usuario #' + user.Id_Usuario)) + (Number(user.Activo) ? '' : ' · Inactivo'),
  })));
  readonly canExport = this.permissions.tienePermiso('MERCADEO.EXPORTAR');
  readonly pageSize = 25;
  readonly registrationRange = computed<SirDateRange>(() => ({
    start: this.filters().fechaRegistroDesde || null, end: this.filters().fechaRegistroHasta || null,
  }));
  readonly registrationRangeError = computed(() => this.validateRange(this.filters().fechaRegistroDesde, this.filters().fechaRegistroHasta));
  readonly filterCount = computed(() => {
    const f = this.filters();
    return Number(!!f.categoria) + Number(!!f.creadorIds.length) + Number(!!f.estado);
  });
  readonly hasAppliedFilters = computed(() => {
    const f = this.appliedFilters();
    return !!(f.fechaRegistroDesde || f.fechaRegistroHasta || f.categoria || f.creadorIds.length || f.estado || (f.tipo || 'TODOS') !== 'TODOS');
  });

  ngOnInit(): void {
    this.api.getCategorias().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rows => {
        const categories = Array.isArray(rows) ? rows : [];
        this.categorias.set(categories);
        this.categoryOptions.set([{ value: '', label: 'Todos los canales' }, ...categories.map(row => ({ value: String(row.Id_Canal), label: row.Nombre_Canal }))]);
        this.loadingCategories.set(false);
      },
      error: () => { this.categoryError.set('No se pudieron cargar los canales.'); this.loadingCategories.set(false); },
    });
    this.api.getUsuarios().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: users => this.usuarios.set(Array.isArray(users) ? users : []),
      error: () => this.userError.set('No se pudieron cargar los usuarios.'),
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const defaults = defaultFilters();
      const rawType = String(params.get('tipo') || params.get('tipoOperacion') || params.get('modo') || 'TODOS').toLocaleUpperCase('es-CO');
      const tipo: MercadeoFilters['tipo'] = ['TRANSFER', 'TRANSFERS'].includes(rawType) ? 'TRANSFER'
        : ['RESERVA', 'RESERVAS'].includes(rawType) ? 'RESERVA' : 'TODOS';
      const noPeriod = params.get('periodo') === '0';
      const filters: MercadeoFilters = {
        ...defaults, tipo,
        fechaRegistroDesde: noPeriod ? '' : (params.get('fechaRegistroDesde') || defaults.fechaRegistroDesde),
        fechaRegistroHasta: noPeriod ? '' : (params.get('fechaRegistroHasta') || defaults.fechaRegistroHasta),
        categoria: params.get('categoria') || '', estado: params.get('estado') || '',
        creadorIds: (params.get('creadorIds') || '').split(',').map(value => value.trim()).filter(Boolean),
      };
      const pageValue = Number(params.get('page') || 1);
      const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
      const consulted = params.get('consultar') === '1';
      const stateKey = JSON.stringify({ filters, page, consulted });
      if (stateKey === this.lastRouteState) return;
      this.lastRouteState = stateKey;
      this.filters.set(filters);
      this.appliedFilters.set(filters);
      this.hasSearched.set(consulted);
      if (consulted) this.fetch(filters, page);
      else { this.result.set(null); this.error.set(''); }
    });
  }

  setFilter<K extends keyof MercadeoFilters>(key: K, value: string | null): void {
    this.filters.update(current => ({ ...current, [key]: value || '' }));
  }
  setCreatorFilter(value: unknown): void {
    const ids = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    this.filters.update(current => ({ ...current, creadorIds: ids }));
  }
  setRegistrationRange(range: SirDateRange): void {
    this.filters.update(current => ({ ...current, fechaRegistroDesde: range.start || '', fechaRegistroHasta: range.end || '' }));
  }

  search(): void {
    if (this.loading() || this.registrationRangeError()) return;
    const next = { ...this.filters(), tipo: this.filters().tipo || 'TODOS', creadorIds: [...this.filters().creadorIds] };
    this.filters.set(next);
    this.appliedFilters.set(next);
    this.hasSearched.set(true);
    this.writeUrl(next, 1);
    this.fetch(next, 1);
  }
  private writeUrl(filters: MercadeoFilters, page: number): void {
    const signature = JSON.stringify({ filters, page, consulted: true });
    this.lastRouteState = signature;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tipo: filters.tipo || 'TODOS', estado: filters.estado || null,
        fechaRegistroDesde: filters.fechaRegistroDesde || null, fechaRegistroHasta: filters.fechaRegistroHasta || null,
        periodo: !filters.fechaRegistroDesde && !filters.fechaRegistroHasta ? '0' : null,
        categoria: filters.categoria || null, creadorIds: filters.creadorIds.length ? filters.creadorIds.join(',') : null,
        page: page > 1 ? String(page) : null, consultar: '1',
      },
      queryParamsHandling: 'merge',
    });
  }
  private fetch(filters: MercadeoFilters, page: number): void {
    this.loading.set(true); this.error.set('');
    this.api.buscarOrigen(filters, page, this.pageSize).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: result => this.result.set(result),
      error: error => this.error.set(error?.error?.message || 'No se pudo consultar el origen de reservas.'),
    });
  }
  retrySearch(): void { this.fetch(this.appliedFilters(), this.result()?.page || 1); }
  changePage(page: number): void {
    const result = this.result();
    if (!result || page < 1 || page > result.totalPages || page === result.page || this.loading()) return;
    this.writeUrl(this.appliedFilters(), page);
    this.fetch(this.appliedFilters(), page);
  }
  removeAppliedFilter(key: AppliedFilter): void {
    if (this.loading()) return;
    const next = { ...this.appliedFilters(), creadorIds: [...this.appliedFilters().creadorIds] };
    switch (key) {
      case 'registro': next.fechaRegistroDesde = ''; next.fechaRegistroHasta = ''; break;
      case 'canal': next.categoria = ''; break;
      case 'creadores': next.creadorIds = []; break;
      case 'estado': next.estado = ''; break;
      case 'servicio': next.tipo = 'TODOS'; break;
    }
    this.filters.set(next);
    this.search();
  }
  registrationRangeLabel(): string { return this.formatRange(this.appliedFilters().fechaRegistroDesde, this.appliedFilters().fechaRegistroHasta); }
  categoryLabel(value: string): string { return this.categorias().find(category => String(category.Id_Canal) === value)?.Nombre_Canal || value; }
  creatorLabel(): string {
    const selected = new Set(this.appliedFilters().creadorIds);
    const names = this.usuarios().filter(user => selected.has(String(user.Id_Usuario))).map(user => user.Nombres_Apellidos || ('Usuario #' + user.Id_Usuario));
    return names.length > 2 ? names.length + ' usuarios' : names.join(', ') || selected.size + ' usuarios';
  }
  serviceLabel(): string { return serviceOptions.find(option => option.value === (this.appliedFilters().tipo || 'TODOS'))?.label || 'Todos'; }
  stateLabel(): string { return stateOptions.find(option => option.value === this.appliedFilters().estado)?.label || this.appliedFilters().estado || ''; }
  operationCode(item: MercadeoOrigenOperacion): string {
    return item.tipo === 'TRANSFER' ? 'TRS' + String(item.id_transfer).padStart(5, '0') : item.id_reserva || item.id_operacion;
  }
  resultCountLabel(data: MercadeoOrigenPage): string {
    return data.totalOperaciones.toLocaleString('es-CO') + ' ' + (data.totalOperaciones === 1 ? 'operación' : 'operaciones');
  }
  async exportDetail(): Promise<void> {
    if (!this.canExport || this.exporting() || !this.result()?.totalOperaciones) return;
    this.exporting.set(true);
    try {
      const blob = await firstValueFrom(this.api.exportarOrigen(this.appliedFilters()));
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'mercadeo-origen-detalle.xlsx'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) { this.error.set(error?.error?.message || 'No se pudo exportar el detalle.'); }
    finally { this.exporting.set(false); }
  }
  private validateRange(start: string, end: string): string {
    if (!start && !end) return '';
    if (!start || !end) return 'Selecciona un período completo.';
    if (start > end) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 30) return 'El rango máximo es de 31 días calendario.';
    return '';
  }
  private formatDate(value: string): string {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
  }
  private formatRange(start: string, end: string): string {
    if (start && end) return this.formatDate(start) + ' – ' + this.formatDate(end);
    return start ? 'Desde ' + this.formatDate(start) : end ? 'Hasta ' + this.formatDate(end) : '';
  }
}