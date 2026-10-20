import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  catchError, debounceTime, distinctUntilChanged, finalize, map, of, Observable, Subject, switchMap,
} from 'rxjs';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirMultiSelectComponent, SirMultiSelectOption } from '../../../shared/multi-select/multi-select';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import {
  MercadeoEntidadReportante, MercadeoFilters, MercadeoPage, MercadeoService, MercadeoUsuario,
  MercadeoTransfersPage,
} from '../../../services/Mercadeo/mercadeo.service';

const EMPTY_FILTERS: MercadeoFilters = {
  fechaRegistroDesde: '', fechaRegistroHasta: '', fechaTour: '', codigoReserva: '', categoria: '',
  idEntidadReportante: '', creadorIds: [],
};

type SecondaryFilter = 'registro' | 'fechaTour' | 'canal' | 'entidad' | 'creadores';
interface MercadeoSearchRequest {
  filters: MercadeoFilters;
  entity: MercadeoEntidadReportante | null;
  page: number;
  mode: 'reservas' | 'transfers';
}

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly entitySearchTerms = new Subject<string>();
  private lastSearch: MercadeoSearchRequest | null = null;

  readonly mode = signal<'reservas' | 'transfers'>('reservas');
  readonly filters = signal<MercadeoFilters>({ ...EMPTY_FILTERS, creadorIds: [] });
  readonly appliedFilters = signal<MercadeoFilters>({ ...EMPTY_FILTERS, creadorIds: [] });
  readonly categorias = signal<{ Id_Canal: number; Nombre_Canal: string }[]>([]);
  readonly usuarios = signal<MercadeoUsuario[]>([]);
  readonly categoryOptions = signal<SirSelectOption[]>([{ value: '', label: 'Todos los canales' }]);
  readonly creatorOptions = computed<SirMultiSelectOption[]>(() => this.usuarios().map((user) => ({
    value: String(user.Id_Usuario),
    label: `${user.Nombres_Apellidos || `Usuario #${user.Id_Usuario}`}${Number(user.Activo) ? '' : ' · Inactivo'}`,
  })));
  readonly result = signal<MercadeoPage | null>(null);
  readonly transfersResult = signal<MercadeoTransfersPage | null>(null);
  readonly loading = signal(false);
  readonly loadingCategories = signal(true);
  readonly error = signal('');
  readonly categoryError = signal('');
  readonly userError = signal('');
  readonly pageSize = 25;
  readonly filtersOpen = signal(false);
  readonly entityOptions = signal<MercadeoEntidadReportante[]>([]);
  readonly entityLoading = signal(false);
  readonly entityError = signal('');
  readonly entityAutocompleteOpen = signal(false);
  readonly draftEntity = signal<MercadeoEntidadReportante | null>(null);
  readonly appliedEntity = signal<MercadeoEntidadReportante | null>(null);
  readonly entityQuery = signal('');
  readonly entityInputValue = computed(() => this.draftEntity()?.Nombre || this.entityQuery());
  readonly filterCount = computed(() => this.countSecondaryFilters(this.appliedFilters()));
  readonly hasAppliedFilters = computed(() => this.filterCount() > 0);
  readonly registrationRange = computed<SirDateRange>(() => ({
    start: this.filters().fechaRegistroDesde || null,
    end: this.filters().fechaRegistroHasta || null,
  }));
  ngOnInit(): void {
    this.api.getCategorias().subscribe({
      next: (rows) => {
        const categories = Array.isArray(rows) ? rows : [];
        this.categorias.set(categories);
        this.categoryOptions.set([
          { value: '', label: 'Todos los canales' },
          ...categories.map((row) => ({ value: String(row.Id_Canal), label: row.Nombre_Canal })),
        ]);
        this.loadingCategories.set(false);
      },
      error: () => {
        this.categoryError.set('No se pudieron cargar los canales. Puedes reintentar la consulta más tarde.');
        this.loadingCategories.set(false);
      },
    });

    this.api.getUsuarios().subscribe({
      next: (users) => this.usuarios.set(Array.isArray(users) ? users : []),
      error: () => this.userError.set('No se pudieron cargar los usuarios para filtrar.'),
    });

    this.entitySearchTerms.pipe(
      debounceTime(220),
      distinctUntilChanged(),
      switchMap((term) => {
        const normalizedTerm = term.trim();
        if (normalizedTerm.length < 2) {
          this.entityLoading.set(false);
          return of([] as MercadeoEntidadReportante[]);
        }
        this.entityLoading.set(true);
        this.entityError.set('');
        return this.api.buscarEntidadesReportantes(normalizedTerm).pipe(
          catchError(() => {
            this.entityError.set('No se pudieron cargar las entidades. Puedes buscar por nombre al aplicar el filtro.');
            return of([] as MercadeoEntidadReportante[]);
          }),
          finalize(() => this.entityLoading.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((entities) => this.entityOptions.set(entities));
  }

  setMode(mode: 'reservas' | 'transfers'): void {
    if (this.mode() === mode || this.loading()) return;
    this.mode.set(mode);
    this.result.set(null);
    this.transfersResult.set(null);
    this.appliedFilters.set({ ...EMPTY_FILTERS });
    this.appliedEntity.set(null);
    this.error.set('');
    this.lastSearch = null;
  }

  get registrationRangeError(): string {
    return this.validateRange(this.filters().fechaRegistroDesde, this.filters().fechaRegistroHasta, 'de creación');
  }

  get rangeError(): string { return this.registrationRangeError; }

  setRegistrationRange(range: SirDateRange): void {
    this.filters.update((filters) => ({ ...filters,
      fechaRegistroDesde: range.start || '', fechaRegistroHasta: range.end || '' }));
  }

  setFilter<K extends keyof MercadeoFilters>(key: K, value: string | null): void {
    this.filters.update((filters) => ({ ...filters, [key]: value || '' }));
  }

  setCreatorFilter(value: unknown): void {
    const ids = Array.isArray(value) ? value.map((id) => String(id)).filter(Boolean) : [];
    this.filters.update((filters) => ({ ...filters, creadorIds: ids }));
  }

  onEntityInput(value: string): void {
    const selected = this.draftEntity();
    if (selected && value === selected.Nombre) return;
    this.draftEntity.set(null);
    this.entityQuery.set(value);
    this.filters.update((filters) => ({ ...filters, idEntidadReportante: '' }));
    this.entityAutocompleteOpen.set(value.trim().length >= 2);
    this.entityError.set('');
    this.entitySearchTerms.next(value);
  }

  openEntitySuggestions(): void {
    if (!this.draftEntity() && this.entityInputValue().trim().length >= 2) this.entityAutocompleteOpen.set(true);
  }

  closeEntitySuggestions(): void { this.entityAutocompleteOpen.set(false); }

  selectEntity(entity: MercadeoEntidadReportante): void {
    this.draftEntity.set(entity);
    this.entityQuery.set(entity.Nombre);
    this.filters.update((filters) => ({ ...filters,
      idEntidadReportante: String(entity.Id_Entidad_Reportante) }));
    this.entityOptions.set([]);
    this.entityAutocompleteOpen.set(false);
    this.entityError.set('');
    this.entitySearchTerms.next('');
  }

  clearEntity(): void {
    this.draftEntity.set(null);
    this.entityQuery.set('');
    this.filters.update((filters) => ({ ...filters, idEntidadReportante: '' }));
    this.entityOptions.set([]);
    this.entityAutocompleteOpen.set(false);
    this.entityError.set('');
    this.entitySearchTerms.next('');
  }

  search(page = 1, filters: MercadeoFilters = this.filters(), entity: MercadeoEntidadReportante | null = this.draftEntity()): void {
    if (this.loading() || this.rangeError) return;
    const request: MercadeoSearchRequest = {
      filters: { ...filters, creadorIds: [...(filters.creadorIds || [])] }, entity, page, mode: this.mode(),
    };
    this.lastSearch = request;
    this.entityAutocompleteOpen.set(false);
    this.loading.set(true);
    this.error.set('');
    const source: Observable<MercadeoPage | MercadeoTransfersPage> = request.mode === 'reservas'
      ? this.api.buscar(request.filters, request.page, this.pageSize)
      : this.api.buscarTransfers(request.filters, request.page, this.pageSize);
    source.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => {
        if (request.mode === 'reservas') {
          this.result.set(response as MercadeoPage);
          this.transfersResult.set(null);
        } else {
          this.transfersResult.set(response as MercadeoTransfersPage);
          this.result.set(null);
        }
        this.appliedFilters.set({ ...request.filters, creadorIds: [...request.filters.creadorIds] });
        this.appliedEntity.set(request.entity);
      },
      error: (error) => this.error.set(error?.error?.message ||
        `No fue posible consultar ${request.mode === 'reservas' ? 'las reservas' : 'los transfers'}.`),
    });
  }

  retrySearch(): void {
    if (!this.lastSearch) return;
    const { filters, entity, page, mode } = this.lastSearch;
    if (this.mode() !== mode) this.mode.set(mode);
    this.search(page, filters, entity);
  }

  clearSecondaryFilters(): void {
    const filters: MercadeoFilters = {
      ...this.filters(),
      fechaRegistroDesde: '',
      fechaRegistroHasta: '',
      fechaTour: '',
      categoria: '',
      idEntidadReportante: '',
      creadorIds: [],
    };
    this.filters.set(filters);
    this.draftEntity.set(null);
    this.entityQuery.set('');
    this.entityOptions.set([]);
    this.entityAutocompleteOpen.set(false);
    this.entitySearchTerms.next('');
    this.filtersOpen.set(false);
    this.search(1, filters, null);
  }

  removeAppliedFilter(group: SecondaryFilter): void {
    if (this.loading()) return;
    const draft = this.filters();
    const next = { ...this.appliedFilters() };
    switch (group) {
      case 'registro': next.fechaRegistroDesde = ''; next.fechaRegistroHasta = ''; break;
      case 'fechaTour': next.fechaTour = ''; break;
      case 'canal': next.categoria = ''; break;
      case 'entidad': next.idEntidadReportante = ''; break;
      case 'creadores': next.creadorIds = []; break;
    }
    this.filters.set({ ...next, creadorIds: [...next.creadorIds], codigoReserva: draft.codigoReserva,
      fechaTour: group === 'fechaTour' ? '' : draft.fechaTour });
    const selectedEntity = group === 'entidad' ? null : this.appliedEntity();
    this.draftEntity.set(selectedEntity);
    this.entityQuery.set(selectedEntity?.Nombre || '');
    this.entityOptions.set([]);
    this.entityAutocompleteOpen.set(false);
    this.filtersOpen.set(false);
    this.search(1, this.filters(), selectedEntity);
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS, creadorIds: [] });
    this.appliedFilters.set({ ...EMPTY_FILTERS, creadorIds: [] });
    this.draftEntity.set(null);
    this.appliedEntity.set(null);
    this.entityQuery.set('');
    this.entityOptions.set([]);
    this.entityAutocompleteOpen.set(false);
    this.error.set('');
    this.result.set(null);
    this.transfersResult.set(null);
  }

  changePage(page: number): void {
    const result = this.mode() === 'reservas' ? this.result() : this.transfersResult();
    if (!result || page < 1 || page > result.totalPages || page === result.page) return;
    this.search(page, this.appliedFilters(), this.appliedEntity());
  }

  categoryLabel(value: string): string {
    return this.categorias().find((category) => String(category.Id_Canal) === value)?.Nombre_Canal || value;
  }

  appliedEntityLabel(): string {
    return this.appliedEntity()?.Nombre || '';
  }

  creatorLabel(): string {
    const selected = new Set(this.appliedFilters().creadorIds);
    const names = this.usuarios().filter((user) => selected.has(String(user.Id_Usuario)))
      .map((user) => user.Nombres_Apellidos || `Usuario #${user.Id_Usuario}`);
    if (!names.length) return `${selected.size} usuario${selected.size === 1 ? '' : 's'}`;
    return names.length > 2 ? `${names.length} usuarios` : names.join(', ');
  }

  registrationRangeLabel(): string {
    const filters = this.appliedFilters();
    return this.formatRange(filters.fechaRegistroDesde, filters.fechaRegistroHasta);
  }

  tourDateLabel(): string {
    const value = this.appliedFilters().fechaTour;
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, day));
  }

  private countSecondaryFilters(filters: MercadeoFilters): number {
    return Number(!!(filters.fechaRegistroDesde || filters.fechaRegistroHasta))
      + Number(!!filters.fechaTour)
      + Number(!!filters.categoria)
      + Number(!!filters.idEntidadReportante)
      + Number(!!filters.creadorIds?.length);
  }

  private validateRange(start: string, end: string, description: string): string {
    if (!start && !end) return '';
    if (!start || !end) return `Selecciona un rango completo ${description}.`;
    if (start > end) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 30) return 'El rango máximo es de 31 días calendario.';
    return '';
  }

  private formatRange(start: string, end: string): string {
    const format = (value: string) => {
      const [year, month, day] = value.split('-').map(Number);
      return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(year, month - 1, day));
    };
    if (start && end) return `${format(start)} – ${format(end)}`;
    return start ? `Desde ${format(start)}` : `Hasta ${format(end)}`;
  }
}
