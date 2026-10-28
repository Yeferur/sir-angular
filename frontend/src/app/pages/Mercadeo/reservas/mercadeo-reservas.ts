import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, firstValueFrom } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirAutocompletePanelPositionDirective } from '../../../shared/autocomplete/autocomplete-panel-position.directive';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ActividadEntidad, EntidadesReportantesService } from '../../../services/Mercadeo/entidades-reportantes.service';
import { MercadeoFilters, MercadeoOrigenOperacion, MercadeoOrigenPage, MercadeoService, MercadeoUsuario } from '../../../services/Mercadeo/mercadeo.service';

type AppliedFilter = 'entidad' | 'canal' | 'creadores' | 'tipo' | 'periodo';
const serviceOptions: SirSelectOption[] = [
  { value: 'TODOS', label: 'Todos' }, { value: 'RESERVA', label: 'Reservas' }, { value: 'TRANSFER', label: 'Transfers' },
];
function defaultFilters(): MercadeoFilters {
  return { fechaRegistroDesde: '', fechaRegistroHasta: '', fechaTour: '',
    codigoReserva: '', categoria: '', tipo: 'TODOS', estado: '', idEntidadReportante: '', creadorIds: [] };
}

@Component({
  selector: 'app-mercadeo-reservas',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, SirDateRangePickerComponent, QueryEmptyStateComponent,
    SirSelectComponent, LoadingStateComponent, SirAutocompletePanelPositionDirective],
  templateUrl: './mercadeo-reservas.html',
  styleUrls: ['../../listado-reservas-transfers.css', './mercadeo-reservas.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MercadeoReservasComponent implements OnInit {
  private readonly api = inject(MercadeoService);
  private readonly entitiesApi = inject(EntidadesReportantesService);
  private readonly permissions = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private lastRouteState = '';
  private entitySuggestionTimer?: ReturnType<typeof setTimeout>;
  private entitySearchRun = 0;

  readonly filters = signal<MercadeoFilters>(defaultFilters());
  readonly appliedFilters = signal<MercadeoFilters>(defaultFilters());
  readonly serviceOptions = serviceOptions;
  readonly result = signal<MercadeoOrigenPage | null>(null);
  readonly loading = signal(false);
  readonly loadingCategories = signal(true);
  readonly exporting = signal(false);
  readonly hasSearched = signal(false);
  readonly filtersOpen = signal(false);
  readonly entitySearch = signal('');
  readonly entitySuggestions = signal<ActividadEntidad[]>([]);
  readonly selectedEntity = signal<ActividadEntidad | null>(null);
  readonly entitySearchError = signal('');
  readonly error = signal('');
  readonly categoryError = signal('');
  readonly userError = signal('');
  readonly categorias = signal<{ Id_Canal: number; Nombre_Canal: string }[]>([]);
  readonly categoryOptions = signal<SirSelectOption[]>([{ value: '', label: 'Todos los canales' }]);
  readonly usuarios = signal<MercadeoUsuario[]>([]);
  readonly creatorOptions = computed<SirSelectOption[]>(() => this.usuarios().map(user => ({
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
    return Number(!!f.idEntidadReportante) + Number((f.tipo || 'TODOS') !== 'TODOS')
      + Number(!!f.categoria) + Number(!!f.creadorIds.length)
      + Number(!!f.fechaRegistroDesde && !!f.fechaRegistroHasta);
  });
  readonly hasAppliedFilters = computed(() => {
    const f = this.appliedFilters();
    return !!(f.idEntidadReportante || f.categoria || f.creadorIds.length || (f.tipo || 'TODOS') !== 'TODOS'
      || (f.fechaRegistroDesde && f.fechaRegistroHasta));
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
      next: users => { this.usuarios.set(Array.isArray(users) ? users : []); this.userError.set(''); },
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
        idEntidadReportante: params.get('idEntidadReportante') || '',
        fechaRegistroDesde: noPeriod ? '' : (params.get('fechaRegistroDesde') || defaults.fechaRegistroDesde),
        fechaRegistroHasta: noPeriod ? '' : (params.get('fechaRegistroHasta') || defaults.fechaRegistroHasta),
        categoria: params.get('categoria') || '', estado: '',
        creadorIds: (params.get('creadorIds') || '').split(',').map(value => value.trim()).filter(Boolean),
      };
      const pageValue = Number(params.get('page') || 1);
      const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
      const consulted = params.get('consultar') === '1' || !!filters.idEntidadReportante;
      const stateKey = JSON.stringify({ filters, page, consulted });
      if (stateKey === this.lastRouteState) return;
      this.lastRouteState = stateKey;
      this.filters.set(filters);
      this.appliedFilters.set(filters);
      this.selectedEntity.set(null);
      this.entitySuggestions.set([]);
      this.entitySearch.set(filters.idEntidadReportante ? 'Entidad #' + filters.idEntidadReportante : '');
      if (filters.idEntidadReportante) this.loadSelectedEntity(filters.idEntidadReportante);
      this.hasSearched.set(consulted);
      if (consulted) this.fetch(filters, page);
      else { this.result.set(null); this.error.set(''); }
    });
  }

  setFilter<K extends keyof MercadeoFilters>(key: K, value: string | null): void {
    this.filters.update(current => ({ ...current, [key]: value || '' }));
  }
  onEntitySearch(value: string): void {
    const run = ++this.entitySearchRun;
    this.entitySearch.set(value);
    this.entitySuggestions.set([]);
    this.selectedEntity.set(null);
    this.entitySearchError.set('');
    this.filters.update(current => ({ ...current, idEntidadReportante: '' }));
    if (this.entitySuggestionTimer) clearTimeout(this.entitySuggestionTimer);
    const term = value.trim();
    if (term.length < 2) return;
    this.entitySuggestionTimer = setTimeout(() => {
      this.entitiesApi.search('', term).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: rows => { if (run === this.entitySearchRun) this.entitySuggestions.set(Array.isArray(rows) ? rows : []); },
        error: () => { if (run === this.entitySearchRun) this.entitySearchError.set('No se pudieron buscar las entidades.'); },
      });
    }, 180);
  }
  selectEntity(entity: ActividadEntidad): void {
    this.selectedEntity.set(entity);
    this.entitySearch.set(entity.Nombre);
    this.entitySuggestions.set([]);
    this.filters.update(current => ({ ...current, idEntidadReportante: String(entity.Id_Entidad_Reportante) }));
  }
  private loadSelectedEntity(id: string): void {
    this.entitiesApi.detail(Number(id), { desde: '', hasta: '', tipo: '', validacion: '', estado: '', actividad: '', buscar: '' })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: detail => {
          if (this.filters().idEntidadReportante !== id) return;
          this.selectedEntity.set({ ...detail.entity, Reservas: 0, Transfers: 0, Operaciones: 0, Pasajeros: 0,
            Primera_Reserva: null, Ultima_Reserva: null, Dias_Sin_Reportar: null, Primera_Actividad: null,
            Ultima_Actividad: null, Ultimo_Reporte: null, Contacto_Reciente: null });
          this.entitySearch.set(detail.entity.Nombre);
        },
      });
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
    if (this.entitySearch().trim() && !this.filters().idEntidadReportante) {
      this.entitySearchError.set('Selecciona una entidad de la lista.');
      return;
    }
    this.entitySearchError.set('');
    const next = { ...this.filters(), tipo: this.filters().tipo || 'TODOS', creadorIds: [...this.filters().creadorIds] };
    this.filters.set(next);
    this.appliedFilters.set(next);
    this.hasSearched.set(true);
    this.filtersOpen.set(false);
    this.writeUrl(next, 1);
    this.fetch(next, 1);
  }
  private writeUrl(filters: MercadeoFilters, page: number): void {
    const signature = JSON.stringify({ filters, page, consulted: true });
    this.lastRouteState = signature;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tipo: filters.tipo || 'TODOS', estado: null,
        fechaRegistroDesde: filters.fechaRegistroDesde || null, fechaRegistroHasta: filters.fechaRegistroHasta || null,
        periodo: !filters.fechaRegistroDesde && !filters.fechaRegistroHasta ? '0' : null,
        categoria: filters.categoria || null, creadorIds: filters.creadorIds.length ? filters.creadorIds.join(',') : null,
        idEntidadReportante: filters.idEntidadReportante || null,
        page: page > 1 ? String(page) : null, consultar: '1',
      },
      queryParamsHandling: 'merge',
    });
  }
  private fetch(filters: MercadeoFilters, page: number): void {
    this.loading.set(true); this.error.set('');
    this.api.buscarOrigen(filters, page, this.pageSize).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: result => this.result.set(result),
      error: error => this.error.set(error?.error?.message || 'No se pudo consultar el origen de operaciones.'),
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
      case 'entidad': next.idEntidadReportante = ''; this.entitySearch.set(''); this.selectedEntity.set(null); break;
      case 'canal': next.categoria = ''; break;
      case 'creadores': next.creadorIds = []; break;
      case 'tipo': next.tipo = 'TODOS'; break;
      case 'periodo': next.fechaRegistroDesde = ''; next.fechaRegistroHasta = ''; break;
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
  entityLabel(): string { return this.selectedEntity()?.Nombre || 'Entidad #' + this.appliedFilters().idEntidadReportante; }
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
