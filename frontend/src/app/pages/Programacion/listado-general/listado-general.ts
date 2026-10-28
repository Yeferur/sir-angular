import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ProgramacionDashboardService, TransfersProgramacionResponse } from '../../../services/Programacion/programacion';
import {
  ListadoGeneralFilters, ListadoGeneralOptions, ListadoGeneralReportType, ListadoGeneralResult, ListadoGeneralService,
} from '../../../services/Programacion/listado-general.service';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirMultiSelectComponent, SirMultiSelectOption } from '../../../shared/multi-select/multi-select';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';

type ExportFormat = 'tradicional' | 'nuevo' | 'masivo';
type ActiveFilterTokenKey = 'reportType' | 'tourDate' | 'tourRange' | 'tours' | 'routes' | 'states' | 'channels';
interface ActiveFilterToken { key: ActiveFilterTokenKey; label: string; }

const EMPTY_FILTERS: ListadoGeneralFilters = {
  fechaTour: '', fechaTourDesde: '', fechaTourHasta: '',
  tours: [], rutas: [], estados: [], canales: [],
};

@Component({
  selector: 'app-listado-general',
  standalone: true,
  imports: [
    CommonModule, DatePipe, FormsModule, DatepickerComponent, SirDateRangePickerComponent,
    SirFilterBarComponent, SirFilterPanelComponent, SirSelectComponent, SirMultiSelectComponent,
    LoadingStateComponent, QueryEmptyStateComponent,
  ],
  templateUrl: './listado-general.html',
  styleUrls: ['../../listado-reservas-transfers.css', './listado-general.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListadoGeneralComponent {
  private readonly api = inject(ListadoGeneralService);
  private readonly programacion = inject(ProgramacionDashboardService);
  private readonly alerts = inject(SirAlertService);
  private readonly permissions = inject(PermisosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters = signal<ListadoGeneralFilters>({ ...EMPTY_FILTERS });
  readonly appliedFilters = signal<ListadoGeneralFilters | null>(null);
  readonly appliedFormat = signal<ExportFormat | null>(null);
  readonly appliedReportType = signal<ListadoGeneralReportType | null>(null);
  readonly options = signal<ListadoGeneralOptions | null>(null);
  readonly result = signal<ListadoGeneralResult | null>(null);
  readonly transfersResult = signal<TransfersProgramacionResponse | null>(null);
  readonly loadingOptions = signal(true);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly filtersOpen = signal(false);
  readonly error = signal('');
  readonly optionsError = signal('');
  readonly searchAttempted = signal(false);
  readonly selectedFormat = signal<ExportFormat>('nuevo');
  readonly selectedReportType = signal<ListadoGeneralReportType>('reservas_grupales');

  readonly tourRange = computed<SirDateRange>(() => ({
    start: this.filters().fechaTourDesde || null,
    end: this.filters().fechaTourHasta || null,
  }));
  readonly isMasivo = computed(() => this.selectedFormat() === 'masivo');
  readonly isTransfers = computed(() => this.selectedReportType() === 'transfers');
  readonly tourOptions = computed<SirMultiSelectOption<number>[]>(() => (this.options()?.tours || []).map(tour => ({
    value: Number(tour.Id_Tour),
    label: `${tour.Nombre_Tour}${Number(tour.Activo) === 0 ? ' (inactivo)' : ''}`,
  })));
  readonly routeOptions = computed<SirMultiSelectOption<string>[]>(() => (this.options()?.rutas || []).map(route => ({
    value: route.Ruta,
    label: route.Ruta,
  })));
  readonly channelOptions = computed<SirMultiSelectOption<number>[]>(() => (this.options()?.canales || []).map(channel => ({
    value: Number(channel.Id_Canal),
    label: channel.Nombre_Canal,
  })));
  readonly statusOptions = computed<SirMultiSelectOption<string>[]>(() => (this.options()?.estados || []).map(state => ({
    value: state.value,
    label: state.label,
  })));
  readonly formatOptions: SirSelectOption[] = [
    { value: 'tradicional', label: 'Formato tradicional' },
    { value: 'nuevo', label: 'Nuevo formato' },
    { value: 'masivo', label: 'Formato masivo' },
  ];
  readonly reportTypeOptions: SirSelectOption[] = [
    { value: 'reservas_grupales', label: 'Reservas grupales' },
    { value: 'reservas_privadas', label: 'Reservas privadas' },
    { value: 'reservas_grupales_privadas', label: 'Reservas grupales y privadas' },
    { value: 'transfers', label: 'Transfers' },
  ];
  readonly filterCount = computed(() => {
    const filters = this.filters();
    const reportTypeCount = Number(this.selectedReportType() !== 'reservas_grupales');
    if (this.isTransfers()) return reportTypeCount + Number(Boolean(filters.fechaTour));
    return reportTypeCount + Number(Boolean(filters.fechaTour || filters.fechaTourDesde || filters.fechaTourHasta))
      + Number(filters.tours.length > 0) + Number(filters.rutas.length > 0)
      + Number(filters.estados.length > 0) + Number(filters.canales.length > 0);
  });
  readonly activeFilterTokens = computed<ActiveFilterToken[]>(() => {
    const filters = this.filters();
    const tokens: ActiveFilterToken[] = [];
    if (this.selectedReportType() !== 'reservas_grupales') {
      tokens.push({ key: 'reportType', label: `Tipo: ${this.reportTypeOptions.find(option => option.value === this.selectedReportType())?.label || 'Reservas'}` });
    }
    if (this.isTransfers() && filters.fechaTour) {
      tokens.push({ key: 'tourDate', label: `Fecha del transfer: ${this.shortDate(filters.fechaTour)}` });
    } else if (this.isMasivo() && (filters.fechaTourDesde || filters.fechaTourHasta)) {
      tokens.push({ key: 'tourRange', label: `Período: ${this.shortDate(filters.fechaTourDesde) || '…'} – ${this.shortDate(filters.fechaTourHasta) || '…'}` });
    } else if (filters.fechaTour) {
      tokens.push({ key: 'tourDate', label: `Fecha del tour: ${this.shortDate(filters.fechaTour)}` });
    }
    if (filters.tours.length) tokens.push({ key: 'tours', label: `Tours: ${this.selectedNames(filters.tours, this.tourOptions(), 'tours')}` });
    if (filters.rutas.length) tokens.push({ key: 'routes', label: `Rutas: ${this.selectedNames(filters.rutas, this.routeOptions(), 'rutas')}` });
    if (filters.estados.length) tokens.push({ key: 'states', label: `Estados: ${this.selectedNames(filters.estados, this.statusOptions(), 'estados')}` });
    if (filters.canales.length) tokens.push({ key: 'channels', label: `Canales: ${this.selectedNames(filters.canales, this.channelOptions(), 'canales')}` });
    return tokens;
  });
  readonly canSearch = computed(() => !this.loadingOptions() && !this.loading());
  readonly resultsStale = computed(() => {
    const applied = this.appliedFilters();
    return !!applied && (this.appliedFormat() !== this.selectedFormat()
      || this.appliedReportType() !== this.selectedReportType()
      || JSON.stringify(applied) !== JSON.stringify(this.cleanFilters(this.filters())));
  });

  constructor() { this.cargarOpciones(); }

  get tourRangeError(): string {
    if (this.isTransfers()) {
      return this.filters().fechaTour ? '' : 'Selecciona la fecha del transfer para consultar o exportar.';
    }
    const { fechaTourDesde: from, fechaTourHasta: to, fechaTour } = this.filters();
    if (this.isMasivo()) {
      if (fechaTour) return 'El formato Masivo requiere un rango de fecha del tour.';
      if (!from || !to) return 'Selecciona las dos fechas del tour para el formato Masivo.';
      if (from > to) return 'La fecha inicial del tour debe ser anterior a la final.';
      return '';
    }
    if (from || to) return 'El rango de fecha del tour solo se usa en el formato Masivo.';
    return '';
  }

  get visibleValidationError(): string {
    return this.searchAttempted() ? this.tourRangeError : '';
  }

  onExactTourDate(value: string | Date | null): void {
    this.searchAttempted.set(false);
    this.update({ fechaTour: this.toIsoDate(value), fechaTourDesde: '', fechaTourHasta: '' });
  }

  onTourRangeChange(range: SirDateRange): void {
    this.searchAttempted.set(false);
    this.update({ fechaTour: '', fechaTourDesde: range.start || '', fechaTourHasta: range.end || '' });
  }

  onReportTypeChange(value: unknown): void {
    const reportType = this.reportTypeOptions.some(option => option.value === value)
      ? value as ListadoGeneralReportType : 'reservas_grupales';
    this.selectedReportType.set(reportType);
    this.searchAttempted.set(false);
    this.error.set('');
    if (reportType === 'transfers') {
      if (this.isMasivo()) this.update({ fechaTour: '', fechaTourDesde: '', fechaTourHasta: '' });
      else this.update({ fechaTourDesde: '', fechaTourHasta: '' });
    } else if (this.isMasivo()) {
      this.update({ fechaTour: '', fechaTourDesde: '', fechaTourHasta: '' });
    } else {
      this.update({ fechaTourDesde: '', fechaTourHasta: '' });
    }
  }

  onFormatChange(value: unknown): void {
    const format = value === 'nuevo' || value === 'masivo' ? value : 'tradicional';
    this.selectedFormat.set(format);
    this.searchAttempted.set(false);
    this.update(format === 'masivo'
      ? { fechaTour: '' }
      : { fechaTourDesde: '', fechaTourHasta: '' });
  }

  setMultiFilter(field: 'tours' | 'rutas' | 'estados' | 'canales', value: unknown): void {
    this.searchAttempted.set(false);
    this.update({ [field]: Array.isArray(value) ? value : [] } as Partial<ListadoGeneralFilters>);
  }

  toggleFilters(): void { this.filtersOpen.update(value => !value); }

  removeFilterToken(key: ActiveFilterTokenKey): void {
    if (this.loading() || this.loadingOptions() || this.exporting()) return;
    switch (key) {
      case 'reportType': this.onReportTypeChange('reservas_grupales'); break;
      case 'tourDate': this.onExactTourDate(null); break;
      case 'tourRange': this.onTourRangeChange({ start: null, end: null }); break;
      case 'tours': this.setMultiFilter('tours', []); break;
      case 'routes': this.setMultiFilter('rutas', []); break;
      case 'states': this.setMultiFilter('estados', []); break;
      case 'channels': this.setMultiFilter('canales', []); break;
    }
    this.search();
  }

  search(): void {
    this.searchAttempted.set(true);
    this.error.set('');
    if (!this.canSearch() || this.tourRangeError) return;
    this.loading.set(true);
    const request = this.cleanFilters(this.filters());
    const format = this.selectedFormat();
    const reportType = this.selectedReportType();
    if (reportType === 'transfers') {
      this.programacion.obtenerTransfersDia(request.fechaTour).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: response => {
          this.result.set(null);
          this.transfersResult.set(response);
          this.appliedFilters.set(request);
          this.appliedFormat.set(format);
          this.appliedReportType.set(reportType);
          this.loading.set(false);
        },
        error: error => this.handleSearchError(error),
      });
      return;
    }
    this.api.consultar(request, format, reportType).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.transfersResult.set(null);
        this.result.set(result);
        this.appliedFilters.set(request);
        this.appliedFormat.set(format);
        this.appliedReportType.set(reportType);
        this.loading.set(false);
      },
      error: error => this.handleSearchError(error),
    });
  }

  exportar(): void {
    const filters = this.appliedFilters();
    const format = this.appliedFormat();
    if (this.exporting() || !filters || !format || this.resultsStale()) return;
    if (this.appliedReportType() === 'transfers') {
      if (!this.transfersResult()?.totalTransfers) return;
      this.exporting.set(true);
      this.programacion.exportarTransfersDia(filters.fechaTour).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: blob => {
          this.downloadBlob(blob, `${filters.fechaTour}_transfers.xlsx`);
          this.alerts.successToast('Archivo generado', `${this.transfersResult()?.totalTransfers || 0} transfers listos para descargar.`);
          this.exporting.set(false);
        },
        error: error => {
          this.alerts.errorToast('No se pudo descargar', error?.error?.message || error?.message || 'Intenta nuevamente.');
          this.exporting.set(false);
        },
      });
      return;
    }
    const reportType = this.appliedReportType();
    if (!this.result()?.totalReservas || !reportType || reportType === 'transfers' || this.tourRangeError) return;
    this.exporting.set(true);
    this.error.set('');
    this.api.exportar(filters, format, reportType).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        const blob = response.body;
        if (!blob) {
          this.alerts.errorToast('No se pudo descargar', 'El servidor no entregó un archivo.');
          this.exporting.set(false);
          return;
        }
        const fileName = this.fileName(response.headers.get('Content-Disposition'));
        this.alerts.successToast('Archivo generado', `${this.result()?.totalReservas || 0} reservas listas en formato ${this.formatLabel(format)}.`);
        this.downloadBlob(blob, fileName);
        this.exporting.set(false);
      },
      error: error => {
        this.alerts.errorToast('No se pudo descargar', error?.error?.message || error?.message || 'Intenta nuevamente.');
        this.exporting.set(false);
      },
    });
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
    this.selectedReportType.set('reservas_grupales');
    this.selectedFormat.set('nuevo');
    this.appliedFilters.set(null);
    this.appliedFormat.set(null);
    this.appliedReportType.set(null);
    this.result.set(null);
    this.transfersResult.set(null);
    this.searchAttempted.set(false);
    this.error.set('');
  }

  retryOptions(): void { this.cargarOpciones(); }
  formatLabel(format = this.selectedFormat()): string {
    return this.formatOptions.find(option => option.value === format)?.label.toLowerCase() || 'Excel';
  }
  reportTypeLabel(reportType = this.appliedReportType()): string {
    return this.reportTypeOptions.find(option => option.value === reportType)?.label || 'Reservas';
  }

  private shortDate(value: string): string {
    if (!value) return '';
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return value;
    return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day))).replace(/\.$/, '');
  }

  private selectedNames<T extends string | number>(values: T[], options: Array<{ value: T; label: string }>, plural: string): string {
    const names = values.map(value => options.find(option => option.value === value)?.label || String(value));
    return names.length > 2 ? `${names.length} ${plural}` : names.join(', ');
  }
  canExport(): boolean {
    return this.permissions.tienePermiso('PROGRAMACION.LEER')
      && this.permissions.tienePermiso('PROGRAMACION.EXPORTAR');
  }

  private cargarOpciones(): void {
    this.loadingOptions.set(true);
    this.optionsError.set('');
    this.api.obtenerOpciones().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: options => {
        this.options.set(options);
        this.loadingOptions.set(false);
      },
      error: error => {
        this.optionsError.set(error?.error?.message || error?.message || 'No se pudieron cargar los filtros.');
        this.loadingOptions.set(false);
      },
    });
  }

  private update(partial: Partial<ListadoGeneralFilters>): void {
    this.filters.update(current => ({ ...current, ...partial }));
  }

  private handleSearchError(error: any): void {
    this.error.set(error?.error?.message || error?.message || 'No se pudo consultar el listado general.');
    this.loading.set(false);
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  private cleanFilters(filters: ListadoGeneralFilters): ListadoGeneralFilters {
    return {
      ...filters,
      tours: [...filters.tours], rutas: [...filters.rutas], estados: [...filters.estados], canales: [...filters.canales],
    };
  }

  private toIsoDate(value: string | Date | null): string {
    if (!value) return '';
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value).slice(0, 10);
  }

  private fileName(contentDisposition: string | null): string {
    const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
    return match?.[1] || 'Listado_General.xlsx';
  }
}
