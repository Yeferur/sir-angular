import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, finalize, firstValueFrom, of, Subject, switchMap } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirMultiSelectComponent, SirMultiSelectOption } from '../../../shared/multi-select/multi-select';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { MercadeoFiltrosService, EMPTY_MERCADEO_FILTERS } from '../../../services/Mercadeo/mercadeo-filtros.service';
import {
  MercadeoEntidadReportante, MercadeoFilters, MercadeoOrigenOperacion, MercadeoOrigenPage,
  MercadeoService, MercadeoUsuario,
} from '../../../services/Mercadeo/mercadeo.service';

type AppliedFilter = 'registro' | 'fechaTour' | 'canal' | 'entidad' | 'creadores' | 'tipo' | 'estado';
const typeOptions: SirSelectOption[] = [
  { value: 'TODOS', label: 'Reservas y transfers' },
  { value: 'RESERVA', label: 'Reservas' },
  { value: 'TRANSFER', label: 'Transfers' },
];
const stateOptions: SirSelectOption[] = [
  { value: '', label: 'Todos los estados' },
  { value: 'Pendiente', label: 'Pendiente' },
  { value: 'Pendiente de datos', label: 'Pendiente de datos' },
  { value: 'Pendiente de pago', label: 'Pendiente de pago' },
  { value: 'Confirmada', label: 'Confirmada' },
  { value: 'Confirmado', label: 'Confirmado' },
  { value: 'Completada', label: 'Completada' },
  { value: 'Completado', label: 'Completado' },
  { value: 'Cancelada', label: 'Cancelada' },
  { value: 'Cancelado', label: 'Cancelado' },
  { value: 'Activo', label: 'Activo (legado)' },
  { value: 'Activa', label: 'Activa (legado)' },
];

@Component({
  selector: 'app-mercadeo-reservas',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, DatepickerComponent, SirDateRangePickerComponent,
    SirFilterBarComponent, SirFilterPanelComponent, QueryEmptyStateComponent, SirSelectComponent,
    SirMultiSelectComponent, LoadingStateComponent],
  templateUrl: './mercadeo-reservas.html',
  styleUrls: ['../../listado-reservas-transfers.css', './mercadeo-reservas.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MercadeoReservasComponent implements OnInit {
  private readonly api = inject(MercadeoService);
  private readonly store = inject(MercadeoFiltrosService);
  private readonly permissions = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly entitySearchTerms = new Subject<string>();
  private lastUrlSignature = '';
  private lastUrlConsulted = false;
  private lastPage = 1;

  readonly filters = this.store.draft;
  readonly appliedFilters = this.store.applied;
  readonly typeOptions = typeOptions;
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
    label: `${user.Nombres_Apellidos || `Usuario #${user.Id_Usuario}`}${Number(user.Activo) ? '' : ' · Inactivo'}`,
  })));
  readonly entityOptions = signal<MercadeoEntidadReportante[]>([]);
  readonly entityLoading = signal(false);
  readonly entityError = signal('');
  readonly entityAutocompleteOpen = signal(false);
  readonly entityQuery = signal('');
  readonly entityInputValue = computed(() => this.store.draftEntityName() || this.entityQuery());
  readonly canExport = this.permissions.tienePermiso('MERCADEO.EXPORTAR');
  readonly pageSize = 25;
  readonly registrationRange = computed<SirDateRange>(() => ({
    start: this.filters().fechaRegistroDesde || null,
    end: this.filters().fechaRegistroHasta || null,
  }));
  readonly registrationRangeError = computed(() => this.validateRange(
    this.filters().fechaRegistroDesde, this.filters().fechaRegistroHasta));
  readonly filterCount = computed(() => {
    const f = this.appliedFilters();
    return Number(!!(f.fechaRegistroDesde || f.fechaRegistroHasta)) + Number(!!f.fechaTour)
      + Number(!!f.categoria) + Number(!!f.idEntidadReportante) + Number(!!f.creadorIds.length)
      + Number((f.tipo || 'TODOS') !== 'TODOS') + Number(!!f.estado);
  });
  readonly hasAppliedFilters = computed(() => this.filterCount() > 0);

  ngOnInit(): void {
    this.api.getCategorias().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rows => {
        const categories = Array.isArray(rows) ? rows : [];
        this.categorias.set(categories);
        this.categoryOptions.set([{ value: '', label: 'Todos los canales' },
          ...categories.map(row => ({ value: String(row.Id_Canal), label: row.Nombre_Canal }))]);
        this.loadingCategories.set(false);
      },
      error: () => { this.categoryError.set('No se pudieron cargar los canales.'); this.loadingCategories.set(false); },
    });
    this.api.getUsuarios().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: users => this.usuarios.set(Array.isArray(users) ? users : []),
      error: () => this.userError.set('No se pudieron cargar los usuarios.'),
    });
    this.entitySearchTerms.pipe(
      debounceTime(220), distinctUntilChanged(),
      switchMap(term => {
        const normalized = term.trim();
        if (normalized.length < 2) { this.entityLoading.set(false); return of([] as MercadeoEntidadReportante[]); }
        this.entityLoading.set(true); this.entityError.set('');
        return this.api.buscarEntidadesReportantes(normalized).pipe(
          catchError(() => { this.entityError.set('No se pudieron cargar las entidades.'); return of([] as MercadeoEntidadReportante[]); }),
          finalize(() => this.entityLoading.set(false)),
        );
      }), takeUntilDestroyed(this.destroyRef),
    ).subscribe(items => this.entityOptions.set(items));

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const type = String(params.get('tipo') || params.get('tipoOperacion') || 'TODOS').toLocaleUpperCase('es-CO');
      const filters: MercadeoFilters = {
        ...EMPTY_MERCADEO_FILTERS,
        tipo: ['TRANSFER', 'TRANSFERS'].includes(type) ? 'TRANSFER'
          : ['RESERVA', 'RESERVAS'].includes(type) ? 'RESERVA' : 'TODOS',
        fechaRegistroDesde: params.get('fechaRegistroDesde') || '',
        fechaRegistroHasta: params.get('fechaRegistroHasta') || '',
        fechaTour: params.get('fechaTour') || '',
        categoria: params.get('categoria') || '',
        idEntidadReportante: params.get('idEntidadReportante') || '',
        creadorIds: (params.get('creadorIds') || '').split(',').map(value => value.trim()).filter(Boolean),
      };
      const entityName = params.get('entidadNombre') || '';
      const pageValue = Number(params.get('page') || 1);
      const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
      const signature = this.store.signature(filters, entityName, page);
      const consulted = params.get('consultar') === '1';
      if (signature === this.lastUrlSignature && consulted === this.lastUrlConsulted) return;
      this.lastUrlSignature = signature;
      this.lastUrlConsulted = consulted;
      const currentApplied = this.store.signature(this.appliedFilters(), this.store.appliedEntityName(), 1);
      const incomingApplied = this.store.signature(filters, entityName, 1);
      if (currentApplied !== incomingApplied) {
        this.store.restore(params);
        this.entityQuery.set('');
        this.entityOptions.set([]);
      }
      this.hasSearched.set(consulted);
      if (consulted) this.fetch(filters, page);
      else { this.result.set(null); this.error.set(''); }
    });
  }

  setFilter<K extends keyof MercadeoFilters>(key: K, value: string | null): void {
    const next = { ...this.filters(), [key]: value || '' } as MercadeoFilters;
    this.store.setDraft(next);
  }

  setCreatorFilter(value: unknown): void {
    const ids = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    this.store.setDraft({ ...this.filters(), creadorIds: ids });
  }

  setRegistrationRange(range: SirDateRange): void {
    this.store.setDraft({ ...this.filters(), fechaRegistroDesde: range.start || '', fechaRegistroHasta: range.end || '' });
  }

  onEntityInput(value: string): void {
    const selectedName = this.store.draftEntityName();
    if (selectedName && value === selectedName) return;
    this.entityQuery.set(value);
    this.store.setDraft({ ...this.filters(), idEntidadReportante: '' }, '');
    this.entityAutocompleteOpen.set(value.trim().length >= 2);
    this.entitySearchTerms.next(value);
  }

  openEntitySuggestions(): void {
    if (this.entityInputValue().trim().length >= 2) this.entityAutocompleteOpen.set(true);
  }
  closeEntitySuggestions(): void { this.entityAutocompleteOpen.set(false); }

  selectEntity(entity: MercadeoEntidadReportante): void {
    this.store.setDraft({ ...this.filters(), idEntidadReportante: String(entity.Id_Entidad_Reportante) }, entity.Nombre);
    this.entityQuery.set(''); this.entityOptions.set([]); this.entityAutocompleteOpen.set(false);
    this.entityError.set(''); this.entitySearchTerms.next('');
  }

  clearEntity(): void {
    this.store.setDraft({ ...this.filters(), idEntidadReportante: '' }, '');
    this.entityQuery.set(''); this.entityOptions.set([]); this.entityAutocompleteOpen.set(false);
    this.entityError.set(''); this.entitySearchTerms.next('');
  }

  search(): void {
    if (this.loading() || this.registrationRangeError()) return;
    this.applyAndSearch(this.filters(), 1, this.store.draftEntityName());
  }

  private applyAndSearch(filters: MercadeoFilters, page: number, entityName: string): void {
    const copy = { ...filters, tipo: filters.tipo || 'TODOS', creadorIds: [...filters.creadorIds] };
    this.store.setDraft(copy, entityName);
    this.store.apply(copy, entityName);
    this.entityAutocompleteOpen.set(false);
    this.hasSearched.set(true);
    this.lastPage = page;
    const signature = this.store.signature(copy, entityName, page);
    this.lastUrlSignature = signature;
    this.lastUrlConsulted = true;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...this.store.queryParams(copy, entityName, page), vista: 'origen', consultar: '1' },
      queryParamsHandling: 'merge',
    });
    this.fetch(copy, page);
  }

  private fetch(filters: MercadeoFilters, page: number): void {
    this.loading.set(true); this.error.set('');
    this.api.buscarOrigen(filters, page, this.pageSize).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: result => { this.result.set(result); this.lastPage = result.page; },
      error: error => this.error.set(error?.error?.message || 'No se pudo consultar el origen de reservas.'),
    });
  }

  retrySearch(): void { this.fetch(this.appliedFilters(), this.lastPage); }

  changePage(page: number): void {
    const result = this.result();
    if (!result || page < 1 || page > result.totalPages || page === result.page || this.loading()) return;
    this.applyAndSearch(this.appliedFilters(), page, this.store.appliedEntityName());
  }

  removeAppliedFilter(key: AppliedFilter): void {
    if (this.loading()) return;
    const next: MercadeoFilters = { ...this.appliedFilters(), creadorIds: [...this.appliedFilters().creadorIds] };
    let entityName = this.store.appliedEntityName();
    switch (key) {
      case 'registro': next.fechaRegistroDesde = ''; next.fechaRegistroHasta = ''; break;
      case 'fechaTour': next.fechaTour = ''; break;
      case 'canal': next.categoria = ''; break;
      case 'entidad': next.idEntidadReportante = ''; entityName = ''; break;
      case 'creadores': next.creadorIds = []; break;
      case 'tipo': next.tipo = 'TODOS'; break;
      case 'estado': next.estado = ''; break;
    }
    this.entityQuery.set('');
    this.applyAndSearch(next, 1, entityName);
  }

  registrationRangeLabel(): string {
    return this.formatRange(this.appliedFilters().fechaRegistroDesde, this.appliedFilters().fechaRegistroHasta);
  }
  tourDateLabel(): string { return this.formatDate(this.appliedFilters().fechaTour); }
  appliedEntityLabel(): string {
    return this.store.appliedEntityName() || `Entidad #${this.appliedFilters().idEntidadReportante}`;
  }
  categoryLabel(value: string): string {
    return this.categorias().find(category => String(category.Id_Canal) === value)?.Nombre_Canal || value;
  }
  creatorLabel(): string {
    const selected = new Set(this.appliedFilters().creadorIds);
    const names = this.usuarios().filter(user => selected.has(String(user.Id_Usuario)))
      .map(user => user.Nombres_Apellidos || `Usuario #${user.Id_Usuario}`);
    return names.length > 2 ? `${names.length} usuarios` : names.join(', ') || `${selected.size} usuarios`;
  }
  typeLabel(type = this.appliedFilters().tipo || 'TODOS'): string {
    return type === 'RESERVA' ? 'Reservas' : type === 'TRANSFER' ? 'Transfers' : 'Reservas y transfers';
  }
  stateLabel(state = this.appliedFilters().estado || ''): string {
    return stateOptions.find(option => option.value === state)?.label || state;
  }
  operationCode(item: MercadeoOrigenOperacion): string {
    return item.tipo === 'TRANSFER' ? `TRS${String(item.id_transfer).padStart(5, '0')}` : item.id_reserva || item.id_operacion;
  }
  resultCountLabel(data: MercadeoOrigenPage): string {
    return `${data.totalOperaciones.toLocaleString('es-CO')} ${data.totalOperaciones === 1 ? 'operación' : 'operaciones'}`;
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
    if (!start || !end) return 'Selecciona un rango completo de creación.';
    if (start > end) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 30) return 'El rango máximo es de 31 días calendario.';
    return '';
  }
  private formatDate(value: string): string {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, day));
  }
  private formatRange(start: string, end: string): string {
    if (start && end) return `${this.formatDate(start)} – ${this.formatDate(end)}`;
    return start ? `Desde ${this.formatDate(start)}` : end ? `Hasta ${this.formatDate(end)}` : '';
  }
}
