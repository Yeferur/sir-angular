import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { GrupoComisionDia, ComisionesService, FiltrosGruposComision, ResultadoGruposComision, TipoEntidadComision } from '../../services/Comisiones/comisiones.service';
import { Reservas, EntidadReportante } from '../../services/Reservas/reservas';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { SirSelectComponent, SirSelectOption, compareSelectValuesAsStrings } from '../../shared/select/select';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { QueryEmptyStateComponent } from '../../shared/query-empty-state/query-empty-state';
import { SirFilterBarComponent } from '../../shared/filter-bar/filter-bar';

type GroupFilterName = 'desde' | 'hasta' | 'entidad' | 'tipo' | 'estado';
interface ActiveFilter { key: GroupFilterName; label: string; }

@Component({
  selector: 'app-comisiones-grupos',
  standalone: true,
  imports: [CommonModule, FormsModule, SirSelectComponent, DatepickerComponent, SirFilterBarComponent, LoadingStateComponent, QueryEmptyStateComponent],
  templateUrl: './comisiones-grupos.html',
  styleUrl: './comisiones-grupos.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesGruposComponent implements OnInit {
  readonly compareSelectValues = compareSelectValuesAsStrings;
  readonly pageSize = 25;
  readonly tipoOptions: SirSelectOption[] = [
    { value: '', label: 'Hoteles y agencias nacionales' },
    { value: 'HOTEL', label: 'Hotel' },
    { value: 'AGENCIA_NACIONAL', label: 'Agencia nacional' },
  ];
  readonly estadoOptions: SirSelectOption[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'PAGADO', label: 'Pagada' },
  ];

  private readonly commissions = inject(ComisionesService);
  private readonly reservations = inject(Reservas);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  today = this.localIso(new Date());
  desde = this.firstOfMonth();
  hasta = this.today;
  entidad = '';
  tipo: TipoEntidadComision | '' = '';
  estado: 'PENDIENTE' | 'PAGADO' | '' = '';
  busqueda = '';
  applied: Omit<FiltrosGruposComision, 'page' | 'limit' | 'unlinkedPage'> = {};
  showFilters = false;
  groups: GrupoComisionDia[] = [];
  unlinked: ResultadoGruposComision['pendientesPorAsociarEntidad']['reservas'] = [];
  groupPagination = { pagina: 1, limite: 25, total: 0, paginas: 0 };
  unlinkedPagination = { pagina: 1, limite: 25, total: 0, paginas: 0 };
  entities: EntidadReportante[] = [];
  loadingEntities = true;
  entityError = '';
  loading = false;
  loaded = false;
  error = '';

  get entityOptions(): SirSelectOption[] {
    return [
      { value: '', label: 'Todas las entidades' },
      ...this.entities.map((entity) => ({ value: String(entity.Id_Entidad_Reportante), label: `${entity.Nombre}${entity.Activo ? '' : ' · Inactiva'}` })),
    ];
  }

  get activeFilters(): ActiveFilter[] {
    const filters: ActiveFilter[] = [];
    if (this.applied.desde) filters.push({ key: 'desde', label: `Desde: ${this.formatDate(this.applied.desde)}` });
    if (this.applied.hasta) filters.push({ key: 'hasta', label: `Hasta: ${this.formatDate(this.applied.hasta)}` });
    if (this.applied.Id_Entidad_Reportante) {
      const entity = this.entities.find((item) => String(item.Id_Entidad_Reportante) === this.applied.Id_Entidad_Reportante);
      filters.push({ key: 'entidad', label: `Entidad: ${entity?.Nombre || `#${this.applied.Id_Entidad_Reportante}`}` });
    }
    if (this.applied.Tipo) filters.push({ key: 'tipo', label: `Tipo: ${this.applied.Tipo === 'HOTEL' ? 'Hotel' : 'Agencia nacional'}` });
    if (this.applied.Estado) filters.push({ key: 'estado', label: `Estado: ${this.applied.Estado === 'PAGADO' ? 'Pagada' : 'Pendiente'}` });
    return filters;
  }

  ngOnInit(): void {
    this.loadEntities();
    this.applyFilters();
  }

  @HostListener('window:comisiones-grupos-actualizados')
  onGroupChanged(): void {
    void this.load(this.groupPagination.pagina, this.unlinkedPagination.pagina);
  }

  private loadEntities(): void {
    forkJoin({
      hotels: this.reservations.getEntidadesReportantes('HOTEL', '', true).pipe(catchError(() => {
        this.entityError = 'No pudimos cargar todas las entidades para el filtro.';
        return of([]);
      })),
      agencies: this.reservations.getEntidadesReportantes('AGENCIA_NACIONAL', '', true).pipe(catchError(() => {
        this.entityError = 'No pudimos cargar todas las entidades para el filtro.';
        return of([]);
      })),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ hotels, agencies }) => {
        this.entities = [...(hotels || []), ...(agencies || [])]
          .filter((entity) => entity.Estado_Validacion !== 'RECHAZADA')
          .sort((a, b) => a.Nombre.localeCompare(b.Nombre, 'es'));
        this.loadingEntities = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.entityError = 'No pudimos cargar el filtro de entidades.';
        this.loadingEntities = false;
        this.cdr.markForCheck();
      },
    });
  }

  applyFilters(page = 1): void {
    if (this.loading) return;
    if (this.desde && this.hasta && this.desde > this.hasta) {
      this.alerts.warningToast('Revisa el período', 'La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    this.applied = {
      desde: this.desde || undefined,
      hasta: this.hasta || undefined,
      Id_Entidad_Reportante: this.entidad || undefined,
      Tipo: this.tipo || undefined,
      Estado: this.estado || undefined,
      q: this.busqueda.trim() || undefined,
    };
    this.showFilters = false;
    void this.load(page, 1);
  }

  removeFilter(key: GroupFilterName): void {
    if (key === 'desde') this.desde = '';
    if (key === 'hasta') this.hasta = '';
    if (key === 'entidad') this.entidad = '';
    if (key === 'tipo') this.tipo = '';
    if (key === 'estado') this.estado = '';
    this.applyFilters();
  }

  private async load(page = this.groupPagination.pagina, unlinkedPage = this.unlinkedPagination.pagina): Promise<void> {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();
    try {
      const result = await firstValueFrom(this.commissions.listarGrupos({
        ...this.applied,
        page,
        limit: this.pageSize,
        unlinkedPage,
      }).pipe(takeUntilDestroyed(this.destroyRef)));
      this.groups = result?.grupos || [];
      this.unlinked = result?.pendientesPorAsociarEntidad?.reservas || [];
      this.groupPagination = result?.paginacion || { pagina: page, limite: this.pageSize, total: 0, paginas: 0 };
      this.unlinkedPagination = result?.pendientesPorAsociarEntidad?.paginacion || { pagina: unlinkedPage, limite: this.pageSize, total: 0, paginas: 0 };
      this.loaded = true;
    } catch (error: any) {
      this.error = error?.error?.message || error?.message || 'No pudimos cargar los grupos de comisión.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  changePage(page: number): void {
    if (page < 1 || page > this.groupPagination.paginas || page === this.groupPagination.pagina) return;
    void this.load(page, 1);
  }

  changeUnlinkedPage(page: number): void {
    if (page < 1 || page > this.unlinkedPagination.paginas || page === this.unlinkedPagination.pagina) return;
    void this.load(this.groupPagination.pagina, page);
  }

  openDetails(group: GrupoComisionDia, startPayment = false): void {
    this.drawer.openComisionesGrupo(group.Id, startPayment, group);
  }

  statusLabel(group: GrupoComisionDia): string {
    if (this.hasPendingAdjustment(group)) return 'Con ajuste pendiente';
    return group.Estado === 'PAGADO' ? 'Pagada' : 'Pendiente';
  }

  hasPendingAdjustment(group: GrupoComisionDia): boolean {
    return Number(group.Cantidad_Reservas_Pendientes) > 0 && Number(group.Tiene_Ajuste_Pendiente) === 1;
  }

  blockReason(group: GrupoComisionDia): string {
    if (group.Motivo_No_Pagable === 'ENTIDAD_PENDIENTE_VALIDACION') return 'La entidad está pendiente de validación.';
    if (group.Motivo_No_Pagable === 'ENTIDAD_NO_VALIDADA') return 'La entidad no está validada.';
    if (group.Motivo_No_Pagable === 'JORNADA_NO_CERRADA') return 'La jornada de Control de viaje no está cerrada.';
    return '';
  }

  typeLabel(type: TipoEntidadComision | null): string {
    return type === 'HOTEL' ? 'Hotel' : type === 'AGENCIA_NACIONAL' ? 'Agencia nacional' : '—';
  }

  formatCOP(value: number | null | undefined): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  formatDate(value: string): string {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  get groupRange(): string {
    return this.range(this.groupPagination);
  }

  get unlinkedRange(): string {
    return this.range(this.unlinkedPagination);
  }

  private range(pagination: { pagina: number; limite: number; total: number }): string {
    if (!pagination.total) return '0 resultados';
    const start = (pagination.pagina - 1) * pagination.limite + 1;
    return `${start}–${Math.min(pagination.pagina * pagination.limite, pagination.total)} de ${pagination.total}`;
  }

  private firstOfMonth(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  }

  private localIso(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
