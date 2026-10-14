import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';
import { Historial, HistorialFilterOptions, HistorialFilters, HistorialService } from '../../services/Historial/historial.service';
import { SirDateRange, SirDateRangePickerComponent } from '../../shared/date-range-picker/date-range-picker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { SirAlertService } from '../../services/Alertas/alert.service';

interface HistorialFilterState {
  period: SirDateRange | null;
  periodExplicit: boolean;
  referencia: string;
  usuarios: number[];
  actividad: string[];
  modulos: string[];
}

const emptyOptions: HistorialFilterOptions = { usuarios: [], acciones: [], actividades: [], modulos: [] };

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function cloneFilters(filters: HistorialFilterState): HistorialFilterState {
  return { period: filters.period ? { ...filters.period } : null, periodExplicit: filters.periodExplicit, referencia: filters.referencia,
    usuarios: [...filters.usuarios], actividad: [...filters.actividad], modulos: [...filters.modulos] };
}

function normalizeReference(value: string): string { return String(value || '').trim().toUpperCase(); }
function isValidReference(value: string): boolean { return /^(?:[A-Z]{2,4}|TRS)\d{5}$/.test(value); }

@Component({
  selector: 'app-ver-historial',
  standalone: true,
  imports: [CommonModule, SirDateRangePickerComponent, LoadingStateComponent],
  templateUrl: './ver-historial.html',
  styleUrls: ['../listado-reservas-transfers.css', './ver-historial.css'],
})
export class VerHistorialComponent implements OnInit, OnDestroy {
  private readonly historialService = inject(HistorialService);
  private readonly alerts = inject(SirAlertService);
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly subscriptions = new Subscription();
  private requestId = 0;
  private pendingOwnNavigation = false;
  private optionsLoaded = false;
  private pendingQueryParams: import('@angular/router').ParamMap | null = null;

  readonly draftFilters = signal<HistorialFilterState>({ period: null, periodExplicit: false, referencia: '', usuarios: [], actividad: [], modulos: [] });
  readonly appliedFilters = signal<HistorialFilterState>({ period: null, periodExplicit: false, referencia: '', usuarios: [], actividad: [], modulos: [] });
  readonly filterOptions = signal<HistorialFilterOptions>(emptyOptions);
  readonly historialList = signal<Historial[]>([]);
  readonly totalRecords = signal(0);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly isInitialLoading = signal(false);
  readonly isTableRefreshing = signal(false);
  readonly isOptionsLoading = signal(false);
  readonly errorMessage = signal('');
  readonly referenceInputError = signal('');
  readonly hasQueried = signal(false);
  readonly advancedFiltersVisible = signal(false);
  readonly openFilterDropdown = signal<'usuarios' | 'actividad' | 'modulos' | null>(null);
  readonly expandedId = signal<number | null>(null);
  readonly pageSize = 10;

  readonly appliedGroupCount = computed(() => {
    const applied = this.appliedFilters();
    return Number(applied.periodExplicit) + Number(applied.usuarios.length > 0) + Number(applied.actividad.length > 0) + Number(applied.modulos.length > 0);
  });
  readonly hasMultipleAppliedGroups = computed(() => this.appliedGroupCount() >= 2);
  readonly summaryText = computed(() => {
    const total = this.totalRecords();
    return `${total} ${total === 1 ? 'registro' : 'registros'}`;
  });

  ngOnInit(): void {
    this.isOptionsLoading.set(true);
    this.subscriptions.add(this.historialService.getFilterOptions().pipe(finalize(() => this.isOptionsLoading.set(false)))
      .subscribe({
        next: (options) => this.finishOptionsLoad(options || emptyOptions),
        error: () => this.finishOptionsLoad(emptyOptions),
      }));
    this.subscriptions.add(this.route.queryParamMap.subscribe((params) => {
      if (this.optionsLoaded) this.restoreFromQuery(params);
      else this.pendingQueryParams = params;
    }));
  }

  private finishOptionsLoad(options: HistorialFilterOptions): void {
    this.filterOptions.set(options);
    this.optionsLoaded = true;
    if (this.pendingQueryParams) {
      this.restoreFromQuery(this.pendingQueryParams);
      this.pendingQueryParams = null;
    }
  }

  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }

  toggleAdvancedFilters(): void {
    const shouldOpen = !this.advancedFiltersVisible();
    this.closeFilterDropdowns();
    this.advancedFiltersVisible.set(shouldOpen);
  }

  toggleDropdown(group: 'usuarios' | 'actividad' | 'modulos'): void {
    this.openFilterDropdown.update((current) => current === group ? null : group);
  }

  @HostListener('document:pointerdown', ['$event'])
  onFilterPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickedOwnMultiFilter = this.hostElement.nativeElement.contains(target) && !!target.closest('.multi-filter');
    if (!clickedOwnMultiFilter) this.closeFilterDropdowns();
  }

  @HostListener('document:keydown.escape')
  onFilterEscape(): void { this.closeFilterDropdowns(); }

  private closeFilterDropdowns(): void { this.openFilterDropdown.set(null); }

  multiFilterLabel(group: 'usuarios' | 'actividad' | 'modulos'): string {
    const values = this.draftFilters()[group];
    if (!values.length) return 'Todos';
    return values.length === 1 ? '1 seleccionado' : `${values.length} seleccionados`;
  }

  setDraftUsers(values: number[] | null): void {
    this.draftFilters.update((current) => ({ ...current, usuarios: Array.isArray(values) ? [...values] : [] }));
  }
  onReferenceInput(value: string): void {
    this.referenceInputError.set('');
    this.draftFilters.update((current) => ({ ...current, referencia: normalizeReference(value) }));
  }
  setDraftActivity(values: string[] | null): void {
    this.draftFilters.update((current) => ({ ...current, actividad: Array.isArray(values) ? [...values] : [] }));
  }
  setDraftModules(values: string[] | null): void {
    this.draftFilters.update((current) => ({ ...current, modulos: Array.isArray(values) ? [...values] : [] }));
  }

  onPeriodChange(period: SirDateRange): void {
    const start = isCalendarDate(period?.start) ? period.start : null;
    const end = isCalendarDate(period?.end) ? period.end : null;
    const nextPeriod = start && end && start <= end ? { start, end } : null;
    this.draftFilters.update((current) => ({ ...current, period: nextPeriod, periodExplicit: !!nextPeriod }));
  }

  toggleUser(id: number, checked: boolean): void {
    this.draftFilters.update((current) => ({ ...current, usuarios: this.toggleValue(current.usuarios, id, checked) }));
  }
  toggleActivity(value: string, checked: boolean): void {
    this.draftFilters.update((current) => ({ ...current, actividad: this.toggleValue(current.actividad, value, checked) }));
  }
  toggleModule(value: string, checked: boolean): void {
    this.draftFilters.update((current) => ({ ...current, modulos: this.toggleValue(current.modulos, value, checked) }));
  }

  private toggleValue<T extends string | number>(values: T[], value: T, checked: boolean): T[] {
    return checked ? (values.includes(value) ? values : [...values, value]) : values.filter((item) => item !== value);
  }

  buscar(): void {
    const applied = cloneFilters(this.draftFilters());
    applied.referencia = normalizeReference(applied.referencia);
    if (applied.referencia && !isValidReference(applied.referencia)) {
      this.referenceInputError.set('Escribe un código válido, por ejemplo TG82673 o TRC76739.');
      return;
    }
    this.referenceInputError.set('');
    const periodStart = applied.period?.start || null;
    const periodEnd = applied.period?.end || null;
    const hasValidPeriod = applied.periodExplicit && isCalendarDate(periodStart) && isCalendarDate(periodEnd) && periodStart <= periodEnd;
    if (!applied.referencia && !hasValidPeriod) {
      this.alerts.showModal({ type: 'info', title: 'Sin filtros',
        message: 'Debes ingresar un código o seleccionar un período para buscar.' });
      return;
    }
    if (applied.period && applied.period.start && applied.period.end && applied.period.start > applied.period.end) {
      [applied.period.start, applied.period.end] = [applied.period.end, applied.period.start];
    }
    this.appliedFilters.set(applied);
    this.currentPage.set(1);
    this.syncUrlAndLoad();
  }

  removeAppliedFilter(group: 'period' | 'usuarios' | 'actividad' | 'modulos'): void {
    const applied = cloneFilters(this.appliedFilters());
    const draft = cloneFilters(this.draftFilters());
    if (group === 'period') {
      applied.period = null; applied.periodExplicit = false;
      draft.period = null; draft.periodExplicit = false;
    } else {
      applied[group] = []; draft[group] = [];
    }
    this.appliedFilters.set(applied);
    this.draftFilters.set(draft);
    this.currentPage.set(1);
    this.syncUrlAndLoad();
  }

  limpiarFiltros(): void {
    const applied: HistorialFilterState = { ...cloneFilters(this.appliedFilters()), period: null, periodExplicit: false,
      usuarios: [], actividad: [], modulos: [] };
    this.appliedFilters.set(applied);
    this.draftFilters.set(cloneFilters(applied));
    this.currentPage.set(1);
    this.syncUrlAndLoad();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.syncUrlAndLoad();
  }
  nextPage(): void { this.goToPage(this.currentPage() + 1); }
  previousPage(): void { this.goToPage(this.currentPage() - 1); }

  hasDetails(record: Historial): boolean { return (record.Detalles?.length ?? 0) > 0; }

  toggleRow(record: Historial): void {
    if (!this.hasDetails(record)) return;
    this.expandedId.update((current) => current === record.Id_Historial ? null : record.Id_Historial);
  }

  onRowClick(event: MouseEvent, record: Historial): void {
    if (!this.hasDetails(record)) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, select, textarea, summary, [contenteditable="true"], [data-row-interactive]')) return;
    this.toggleRow(record);
  }

  onRowKeydown(event: KeyboardEvent, record: Historial): void {
    if (!this.hasDetails(record) || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleRow(record);
    }
  }

  exportarHistorial(): void {
    if (this.totalRecords() === 0 || this.isTableRefreshing()) return;
    const filters = this.toServiceFilters(this.appliedFilters(), 1);
    this.historialService.exportarHistorial(filters).subscribe({
      next: (blob) => this.historialService.descargarExcel(blob),
      error: () => this.errorMessage.set('No se pudo exportar el historial. Intenta nuevamente.'),
    });
  }

  selectedUserLabel(id: number): string { return this.filterOptions().usuarios.find((option) => option.id === id)?.label || `Usuario #${id}`; }
  selectedActionLabel(value: string): string { return this.filterOptions().acciones.find((option) => option.value === value)?.label || value; }
  selectedActivityLabel(value: string): string { return this.filterOptions().actividades.find((option) => option.value === value)?.label || value; }
  selectedModuleLabel(value: string): string { return this.filterOptions().modulos.find((option) => option.value === value)?.label || value; }

  groupSummary(group: 'usuarios' | 'actividad' | 'modulos', applied = false): string {
    const values = (applied ? this.appliedFilters() : this.draftFilters())[group];
    if (!values.length) return group === 'usuarios' ? 'Todos los usuarios' : group === 'actividad' ? 'Todos los tipos' : 'Todos los módulos';
    const labels = group === 'usuarios'
      ? (values as number[]).map((id) => this.selectedUserLabel(id))
      : (values as string[]).map((value) => group === 'actividad' ? this.selectedActivityLabel(value) : this.selectedModuleLabel(value));
    return labels.length === 1 ? labels[0] : `${labels.length} seleccionados`;
  }

  pillLabel(group: 'period' | 'usuarios' | 'actividad' | 'modulos'): string {
    if (group === 'period') {
      const { start, end } = this.appliedFilters().period || { start: '', end: '' };
      const format = (value: string) => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
      return `Período: ${format(start)}${start === end ? '' : ` – ${format(end)}`}`;
    }
    const applied = this.appliedFilters()[group];
    const labels = group === 'usuarios'
      ? (applied as number[]).map((id) => this.selectedUserLabel(id))
      : (applied as string[]).map((value) => group === 'actividad' ? this.selectedActivityLabel(value) : this.selectedModuleLabel(value));
    const groupLabel = group === 'usuarios' ? 'Usuario' : group === 'actividad' ? 'Actividad' : 'Módulo';
    return `${groupLabel}: ${labels.join(', ')}`;
  }

  hasApplied(group: 'period' | 'usuarios' | 'actividad' | 'modulos'): boolean {
    const applied = this.appliedFilters();
    return group === 'period' ? applied.periodExplicit : applied[group].length > 0;
  }
  isDraftSelected(group: 'usuarios' | 'actividad' | 'modulos', value: number | string): boolean {
    return (this.draftFilters()[group] as Array<number | string>).includes(value);
  }

  actionClass(action: string): string {
    const value = String(action || '').toUpperCase();
    if (/^(CREAR|CREATE|DUPLICAR)_?/.test(value)) return 'create';
    if (/^(ACTUALIZAR|UPDATE|CAMBIAR|UPSERT|GUARDAR|PUBLICAR|VALIDAR|ASOCIAR|REORDENAR)_?/.test(value)) return 'update';
    if (/^(ELIMINAR|DELETE|CANCELAR|DESACTIVAR|RETIRAR|DESASOCIAR)_?/.test(value)) return 'delete';
    if (/^(EXPORTAR|EXPORT)_?/.test(value)) return 'export';
    if (/^(LOGIN)$/.test(value)) return 'login';
    if (/^(LOGOUT|FORCE_LOGOUT)/.test(value)) return 'logout';
    if (/^PASSWORD_/.test(value)) return 'password';
    return 'neutral';
  }

  detailColumnLabel(column: string): string {
    const labels: Record<string, string> = {
      Estado: 'Estado', Canal: 'Canal', Id_Tour: 'Tour', Fecha_Tour: 'Fecha del tour',
      Id_Punto: 'Punto de encuentro', Nombre_Punto: 'Punto de encuentro', Cupo: 'Cupo',
      Tipo: 'Tipo', TipoServicio: 'Tipo de servicio', Forma_Pago: 'Forma de pago',
      Nombres_Apellidos: 'Nombre', Activo: 'Estado', Hora_Salida: 'Hora de salida',
      Fecha_Aforo: 'Fecha de aforo', Id_Programacion: 'Programación',
    };
    return labels[column] || column.replace(/_/g, ' ');
  }

  isSingleDay(): boolean {
    const { start, end } = this.appliedFilters().period || { start: null, end: null };
    return !!start && start === end;
  }

  formatTimestamp(value: string): string {
    const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
    if (local) {
      // MySQL DATETIME is a wall-clock value; preserve it as recorded instead of parsing it in the browser's timezone.
      const instant = new Date(Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] || 0)));
      return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }).format(instant);
    }
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value || '—';
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
    }).format(instant);
  }

  private toServiceFilters(filters: HistorialFilterState, page: number): HistorialFilters {
    const referencia = normalizeReference(filters.referencia);
    const period = filters.periodExplicit ? filters.period : null;
    return {
      usuarios: [...filters.usuarios], actividad: [...filters.actividad], modulos: [...filters.modulos],
      referencia: referencia || undefined,
      fechaInicio: period?.start || undefined,
      fechaFin: period?.end || undefined,
      page, limit: this.pageSize,
    };
  }

  private syncUrlAndLoad(): void {
    const filters = this.appliedFilters();
    const queryParams: Record<string, unknown> = {
      desde: filters.periodExplicit ? filters.period?.start : null,
      hasta: filters.periodExplicit ? filters.period?.end : null,
      referencia: filters.referencia || null,
      usuarios: filters.usuarios.length ? filters.usuarios : null,
      actividad: filters.actividad.length ? filters.actividad : null,
      acciones: null,
      modulos: filters.modulos.length ? filters.modulos : null,
      page: this.currentPage() > 1 ? this.currentPage() : null,
      search: null,
      usuario: null,
      tipoAccion: null,
      tablaAfectada: null,
      fechaInicio: null,
      fechaFin: null,
    };
    this.pendingOwnNavigation = true;
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' }).then(() => {
      if (this.pendingOwnNavigation) {
        this.pendingOwnNavigation = false;
        if (this.canQuery(this.appliedFilters())) this.loadHistorial();
        else this.prepareForQuery();
      }
    }).catch(() => {
      this.pendingOwnNavigation = false;
      if (this.canQuery(this.appliedFilters())) this.loadHistorial();
      else this.prepareForQuery();
    });
  }

  private restoreActivity(params: import('@angular/router').ParamMap): string[] {
    const values = params.getAll('actividad').flatMap((value) => value.split(',')).filter(Boolean);
    const available = new Set(this.filterOptions().actividades.map((option) => option.value));
    if (values.length) return [...new Set(values.filter((value) => available.has(value)))];
    // URLs anteriores guardaban acciones técnicas; el catálogo del servidor las traduce.
    const legacy = [...params.getAll('acciones'), ...params.getAll('tipoAccion')]
      .flatMap((value) => value.split(',')).filter(Boolean);
    return [...new Set(legacy.map((value) =>
      this.filterOptions().acciones.find((option) => option.value === value)?.actividad || 'otros'))]
      .filter((value) => available.has(value));
  }

  private restoreFromQuery(params: import('@angular/router').ParamMap): void {
    if (this.pendingOwnNavigation) this.pendingOwnNavigation = false;
    const from = params.get('desde');
    const to = params.get('hasta');
    const periodExplicit = isCalendarDate(from) && isCalendarDate(to);
    const restored: HistorialFilterState = {
      period: periodExplicit ? { start: from!, end: to! } : null, periodExplicit, referencia: normalizeReference(params.get('referencia') || ''),
      usuarios: params.getAll('usuarios').flatMap((value) => value.split(',')).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
      actividad: this.restoreActivity(params),
      modulos: params.getAll('modulos').flatMap((value) => value.split(',')).filter(Boolean),
    };
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
    this.appliedFilters.set(cloneFilters(restored));
    this.draftFilters.set(cloneFilters(restored));
    this.currentPage.set(page);
    if (this.canQuery(restored)) this.loadHistorial();
    else this.prepareForQuery();
  }

  private canQuery(filters: HistorialFilterState): boolean {
    return !!normalizeReference(filters.referencia) || !!(filters.periodExplicit && filters.period?.start && filters.period?.end);
  }

  private prepareForQuery(): void {
    this.hasQueried.set(false);
    this.isInitialLoading.set(false);
    this.isTableRefreshing.set(false);
    this.historialList.set([]);
    this.totalRecords.set(0);
    this.totalPages.set(1);
    this.errorMessage.set('');
  }

  private loadHistorial(): void {
    const thisRequest = ++this.requestId;
    const initial = !this.hasQueried();
    this.hasQueried.set(true);
    this.isInitialLoading.set(initial);
    this.isTableRefreshing.set(!initial);
    this.errorMessage.set('');
    const filters = this.toServiceFilters(this.appliedFilters(), this.currentPage());
    this.subscriptions.add(this.historialService.getHistorial(filters).pipe(finalize(() => {
      if (thisRequest === this.requestId) {
        this.isInitialLoading.set(false);
        this.isTableRefreshing.set(false);
      }
    })).subscribe({
      next: (response) => {
        if (thisRequest !== this.requestId) return;
        this.historialList.set(response.data || []);
        this.totalRecords.set(response.total || 0);
        this.totalPages.set(Math.max(1, response.totalPages || Math.ceil((response.total || 0) / this.pageSize)));
        if (this.currentPage() > this.totalPages()) {
          this.currentPage.set(this.totalPages());
          this.syncUrlAndLoad();
          return;
        }
        this.expandedId.set(null);
      },
      error: () => {
        if (thisRequest !== this.requestId) return;
        this.errorMessage.set('No se pudo cargar el historial. Intenta nuevamente.');
        this.historialList.set([]);
        this.totalRecords.set(0);
      },
    }));
  }
}
