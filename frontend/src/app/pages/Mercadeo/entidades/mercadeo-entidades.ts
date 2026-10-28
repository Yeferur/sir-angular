import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirSearchInputComponent } from '../../../shared/search-input/search-input';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { DrawerCloseButtonComponent } from '../../../shared/drawer-close-button/drawer-close-button';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { Reservas, Punto } from '../../../services/Reservas/reservas';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { MercadeoOrigenOperacion, MercadeoOrigenPage, MercadeoService } from '../../../services/Mercadeo/mercadeo.service';
import { ActividadEntidad, DetalleEntidad, EntidadesReportantesService, FiltrosEntidades,
  PaginaEntidades, TipoEntidad, ValidacionEntidad } from '../../../services/Mercadeo/entidades-reportantes.service';
import { sirToday } from '../../../shared/utils/sir-datetime';

interface ContactoReportanteAgrupado {
  key: string;
  Nombre: string;
  Telefono: string | null;
  Reservas: number;
  Ultimo_Reporte: string | null;
}

const typeOptions: SirSelectOption[] = [
  { value: '', label: 'Todos' }, { value: 'HOTEL', label: 'Hotel' },
  { value: 'AGENCIA_NACIONAL', label: 'Agencia nacional' },
  { value: 'AGENCIA_INTERNACIONAL', label: 'Agencia internacional' },
];
const statusOptions: SirSelectOption[] = [
  { value: '', label: 'Todos' }, { value: 'ACTIVA', label: 'Activa' },
  { value: 'PENDIENTE_VALIDACION', label: 'Pendiente de validación' }, { value: 'INACTIVA', label: 'Inactiva' },
];
function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function initialFilters(): FiltrosEntidades {
  return { desde: '', hasta: '',
    tipo: '', validacion: '', estado: '', actividad: '', buscar: '', diasSinReportarMin: '' };
}

@Component({
  selector: 'app-mercadeo-entidades', standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, SirDateRangePickerComponent, SirSearchInputComponent,
    QueryEmptyStateComponent, LoadingStateComponent, SirSelectComponent, DrawerCloseButtonComponent],
  templateUrl: './mercadeo-entidades.html', styleUrls: ['../../listado-reservas-transfers.css', './mercadeo-entidades.css'],
})
export class MercadeoEntidadesComponent implements OnInit {
  private readonly api = inject(EntidadesReportantesService);
  private readonly reservas = inject(Reservas);
  private readonly permissions = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly mercadeo = inject(MercadeoService);
  private readonly drawer = inject(SirDrawerService);
  private previousFocus: HTMLElement | null = null;
  private suggestionTimer?: ReturnType<typeof setTimeout>;
  private suggestionRun = 0;
  private lastUrlState = '';
  readonly typeOptions = typeOptions;
  readonly createTypeOptions = typeOptions.filter(option => !!option.value);
  readonly statusOptions = statusOptions;
  readonly filters = signal<FiltrosEntidades>(initialFilters());
  readonly appliedFilters = signal<FiltrosEntidades>(initialFilters());
  readonly dateRange = computed<SirDateRange>(() => ({ start: this.filters().desde, end: this.filters().hasta }));
  readonly result = signal<PaginaEntidades | null>(null);
  readonly selected = signal<DetalleEntidad | null>(null);
  readonly selectedActivity = signal<ActividadEntidad | null>(null);
  readonly consolidatedContacts = computed<ContactoReportanteAgrupado[]>(() => {
    const groups = new Map<string, ContactoReportanteAgrupado>();
    (this.selected()?.contacts ?? []).forEach((contact, index) => {
      const phone = (contact.Telefono ?? '').trim();
      const phoneKey = phone.replace(/\D/g, '') || phone.toLocaleLowerCase('es');
      const key = phoneKey ? `telefono:${phoneKey}` : `sin-telefono:${index}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { key, Nombre: contact.Nombre, Telefono: phone || null,
          Reservas: Number(contact.Reservas) || 0, Ultimo_Reporte: contact.Ultimo_Reporte || null });
        return;
      }
      existing.Reservas += Number(contact.Reservas) || 0;
      const nextReport = contact.Ultimo_Reporte || null;
      if (nextReport && (!existing.Ultimo_Reporte || Date.parse(nextReport) > Date.parse(existing.Ultimo_Reporte))) {
        existing.Nombre = contact.Nombre;
        existing.Telefono = phone || null;
        existing.Ultimo_Reporte = nextReport;
      }
    });
    return [...groups.values()].sort((a, b) => b.Reservas - a.Reservas
      || String(b.Ultimo_Reporte || '').localeCompare(String(a.Ultimo_Reporte || '')));
  });
  readonly topReportedContacts = computed(() => this.consolidatedContacts().slice(0, 5));
  readonly additionalContactCount = computed(() => Math.max(0, this.consolidatedContacts().length - 5));
  readonly operations = signal<MercadeoOrigenPage | null>(null);
  readonly operationsLoading = signal(false);
  readonly operationsError = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly validationNotice = signal('');
  readonly detailError = signal('');
  readonly detailNotice = signal('');
  readonly filterOpen = signal(false);
  readonly editing = signal(false);
  readonly rowEditingId = signal<number | null>(null);
  readonly creating = signal(false);
  readonly rejecting = signal(false);
  readonly pointMatches = signal<Punto[]>([]);
  readonly pointPickerOpen = signal(false);
  readonly entitySuggestions = signal<ActividadEntidad[]>([]);
  readonly suggesting = signal(false);
  readonly canCreate = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.CREAR');
  readonly canEdit = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.ACTUALIZAR');
  readonly canValidate = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.VALIDAR');
  readonly canManagePointRelations = this.canValidate && this.permissions.tienePermiso('ENTIDADES_REPORTANTES.LEER');
  readonly canExport = this.permissions.tienePermiso('MERCADEO.EXPORTAR')
    && this.permissions.tienePermiso('ENTIDADES_REPORTANTES.LEER');
  readonly canReadReservations = this.permissions.tienePermiso('RESERVAS.LEER');
  readonly canReadTransfers = this.permissions.tienePermiso('TRANSFERS.LEER');
  name = '';
  rowEditName = '';
  rowEditType: TipoEntidad = 'HOTEL';
  rejectionReason = '';
  type: TipoEntidad = 'HOTEL';
  pointSearch = '';
  get exactDuplicate(): ActividadEntidad | null {
    return this.entitySuggestions().find(entity =>
      entity.Tipo === this.type && this.normalize(entity.Nombre) === this.normalize(this.name)) || null;
  }
  readonly filterCount = computed(() => Number(!!this.filters().tipo) + Number(!!this.filters().estado)
    + Number(!!this.filters().desde && !!this.filters().hasta));
  readonly emptyStateTitle = computed(() => {
    const current = this.appliedFilters();
    if (current.estado && (current.buscar.trim() || current.tipo)) return 'Sin entidades que coincidan';
    if (current.estado) return 'Sin entidades con este estado';
    if (current.buscar.trim() && current.tipo) return 'Sin entidades que coincidan';
    if (current.buscar.trim()) return 'Sin entidades con ese nombre';
    if (current.tipo) return 'Sin entidades de este tipo';
    return 'Sin entidades registradas';
  });
  readonly emptyStateDescription = computed(() => {
    const current = this.appliedFilters();
    if (current.estado && (current.buscar.trim() || current.tipo))
      return 'No hay entidades que coincidan con el estado y los demás filtros aplicados.';
    if (current.estado) return 'No hay entidades con el estado seleccionado.';
    if (current.buscar.trim() || current.tipo) return 'Prueba otros criterios o crea una nueva entidad.';
    return 'Aún no hay hoteles o agencias reportantes registrados para consultar.';
  });
  readonly showEmptyCreate = computed(() => this.canCreate && !this.appliedFilters().estado);
  readonly dateError = computed(() => {
    const f = this.filters();
    if (!f.desde && !f.hasta) return '';
    if (!f.desde || !f.hasta) return 'Selecciona un período completo.';
    if (f.desde > f.hasta) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(f.hasta) - Date.parse(f.desde)) / 86400000 > 30)
      return 'El rango máximo es de 31 días calendario.';
    return '';
  });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      const defaults = initialFilters();
      const requestedValidation = params.get('validacion') || '';
      const requestedStatus = params.get('estado') || '';
      const hasNewFilterState = params.get('filtrosVersion') === '2';
      const status = (['PENDIENTE_VALIDACION', 'INACTIVA'].includes(requestedStatus)
        || (requestedStatus === 'ACTIVA' && hasNewFilterState)) ? requestedStatus
        : requestedValidation === 'PENDIENTE_VALIDACION' ? 'PENDIENTE_VALIDACION'
          : requestedValidation === 'VALIDADA' ? 'ACTIVA' : '';
      const filters: FiltrosEntidades = {
        ...defaults,
        desde: params.get('periodo') === '0' ? '' : (params.get('desde') || defaults.desde),
        hasta: params.get('periodo') === '0' ? '' : (params.get('hasta') || defaults.hasta),
        tipo: params.get('tipo') || '',
        validacion: '', estado: status, actividad: '', diasSinReportarMin: '',
        buscar: params.get('buscar') || '',
        ordenarPor: params.get('ordenarPor') || undefined,
        orden: params.get('orden') === 'DESC' ? 'DESC' : 'ASC',
      };
      this.filters.set(filters);
      this.appliedFilters.set(filters);
      const pageValue = Number(params.get('page') || 1);
      const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
      const urlState = JSON.stringify({ filters, page });
      if (urlState === this.lastUrlState) return;
      this.lastUrlState = urlState;
      void this.search(page, false);
    });
  }
  setFilter(key: keyof FiltrosEntidades, value: string): void {
    this.filters.update(current => ({ ...current, [key]: value || '' }));
  }
  setDaysFilter(value: number | string | null): void {
    this.setFilter('diasSinReportarMin', value === null || value === '' ? '' : String(value));
  }
  setRange(range: SirDateRange): void {
    this.filters.update(current => ({ ...current, desde: range.start || '', hasta: range.end || '' }));
  }
  removeAppliedFilter(key: 'buscar' | 'tipo' | 'estado' | 'periodo'): void {
    const next = { ...this.appliedFilters() };
    if (key === 'buscar') next.buscar = '';
    if (key === 'tipo') next.tipo = '';
    if (key === 'estado') next.estado = '';
    if (key === 'periodo') { next.desde = ''; next.hasta = ''; }
    this.filters.set(next);
    void this.search();
  }
  periodLabel(): string {
    const f = this.appliedFilters();
    const format = (value: string) => {
      if (!value) return '';
      const [year, month, day] = value.split('-').map(Number);
      return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'America/Bogota' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
    };
    return f.desde && f.hasta ? format(f.desde) + ' – ' + format(f.hasta) : f.desde ? 'Desde ' + format(f.desde) : f.hasta ? 'Hasta ' + format(f.hasta) : '';
  }
  hasSelectedPeriod(): boolean {
    const applied = this.appliedFilters();
    return !!applied.desde && !!applied.hasta;
  }
  lastReportLabel(value: string | null): string {
    if (!value) return 'Nunca';
    const dateValue = value.slice(0, 10);
    const [year, month, day] = dateValue.split('-').map(Number);
    const reportDate = new Date(Date.UTC(year, month - 1, day, 12));
    if (!year || !month || !day || Number.isNaN(reportDate.getTime())) return 'Nunca';
    const exact = new Intl.DateTimeFormat('es-CO', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(reportDate).replace(/\./g, '');
    const today = sirToday();
    const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
    const difference = Math.round((Date.UTC(todayYear, todayMonth - 1, todayDay)
      - Date.UTC(year, month - 1, day)) / 86400000);
    const relative = difference === 0 ? 'hoy'
      : difference > 0 ? `hace ${difference} ${difference === 1 ? 'día' : 'días'}`
        : `dentro de ${Math.abs(difference)} ${Math.abs(difference) === 1 ? 'día' : 'días'}`;
    return `${exact} · ${relative}`;
  }
  async search(page = 1, syncUrl = true): Promise<void> {
    if (this.loading() || this.dateError()) return;
    if (this.rowEditingId() !== null) this.cancelRowEdit();
    const applied = { ...this.filters() };
    this.appliedFilters.set(applied);
    if (syncUrl) this.writeUrl(applied, page);
    this.filterOpen.set(false);
    this.loading.set(true); this.error.set('');
    try { this.result.set(await firstValueFrom(this.api.activity(applied, page))); }
    catch (e: any) { this.error.set(e?.error?.message || 'No se pudo consultar la actividad.'); }
    finally { this.loading.set(false); }
  }
  private writeUrl(filters: FiltrosEntidades, page: number): void {
    this.lastUrlState = JSON.stringify({ filters, page });
    void this.router.navigate([], { relativeTo: this.route, queryParams: {
      tipo: filters.tipo || null, validacion: null, estado: filters.estado || null,
      filtrosVersion: '2',
      actividad: null, diasSinReportarMin: null,
      buscar: filters.buscar || null, desde: filters.desde || null, hasta: filters.hasta || null,
      periodo: !filters.desde && !filters.hasta ? '0' : null,
      ordenarPor: filters.ordenarPor || null, orden: filters.ordenarPor ? filters.orden || 'ASC' : null,
      page: page > 1 ? String(page) : null,
    }, queryParamsHandling: 'merge' });
  }
  setSort(column: string): void {
    const current = this.filters();
    const order = current.ordenarPor === column && current.orden === 'ASC' ? 'DESC' : 'ASC';
    this.filters.update(value => ({ ...value, ordenarPor: column, orden: order }));
    void this.search(1);
  }
  sortLabel(column: string): string {
    if (this.filters().ordenarPor !== column) return 'Ordenar';
    return this.filters().orden === 'DESC' ? 'Orden descendente' : 'Orden ascendente';
  }
  openFromRowKey(event: Event, item: ActividadEntidad): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    void this.open(item);
  }
  async open(item: ActividadEntidad): Promise<void> {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.selectedActivity.set(item);
    this.detailError.set(''); this.detailNotice.set(''); this.selected.set(null); this.editing.set(false);
    this.rejecting.set(false); this.rejectionReason = '';
    this.operations.set(null); this.operationsError.set('');
    try {
      this.selected.set(await firstValueFrom(this.api.detail(item.Id_Entidad_Reportante, this.appliedFilters())));
      await this.loadOperations(item.Id_Entidad_Reportante, 1);
    }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo cargar el detalle.'); }
  }
  private async loadOperations(entityId: number, page: number): Promise<void> {
    const period = this.appliedFilters();
    this.operationsLoading.set(true); this.operationsError.set('');
    try {
      this.operations.set(await firstValueFrom(this.mercadeo.buscarOrigen({
        fechaRegistroDesde: period.desde, fechaRegistroHasta: period.hasta, fechaTour: '', codigoReserva: '',
        categoria: '', tipo: 'TODOS', estado: '', idEntidadReportante: String(entityId), creadorIds: [],
      }, page, 10)));
    } catch (e: any) { this.operationsError.set(e?.error?.message || 'No se pudieron cargar las operaciones.'); }
    finally { this.operationsLoading.set(false); }
  }
  changeOperationsPage(page: number): void {
    const entityId = this.selected()?.entity.Id_Entidad_Reportante;
    const data = this.operations();
    if (!entityId || !data || page < 1 || page > data.totalPages || this.operationsLoading()) return;
    void this.loadOperations(entityId, page);
  }
  openOperation(item: MercadeoOrigenOperacion): void {
    if (item.tipo === 'RESERVA' && this.canReadReservations && item.id_reserva) this.drawer.openReserva(item.id_reserva);
    if (item.tipo === 'TRANSFER' && this.canReadTransfers && item.id_transfer) this.drawer.openTransfer(String(item.id_transfer));
  }
  viewOperations(): void {
    const entityId = this.selected()?.entity.Id_Entidad_Reportante;
    if (!entityId) return;
    const period = this.appliedFilters();
    this.close();
    void this.router.navigate(['/Mercadeo/Reservas'], { queryParams: {
      idEntidadReportante: String(entityId),
      ...(period.desde && period.hasta ? {
        fechaRegistroDesde: period.desde,
        fechaRegistroHasta: period.hasta,
      } : {}),
    } });
  }
  operationLabel(item: MercadeoOrigenOperacion): string {
    return item.tipo === 'TRANSFER' ? 'TRS' + String(item.id_transfer).padStart(5, '0') : item.id_reserva || item.id_operacion;
  }
  close(): void {
    const globalCreateDrawerOpen = this.drawer.drawer()?.type === 'entity-create';
    this.selected.set(null); this.selectedActivity.set(null); this.creating.set(false); this.editing.set(false);
    this.operations.set(null); this.operationsError.set('');
    this.rejecting.set(false); this.rejectionReason = ''; this.detailNotice.set(''); this.pointMatches.set([]);
    this.pointPickerOpen.set(false);
    this.entitySuggestions.set([]);
    clearTimeout(this.suggestionTimer); this.suggestionRun++;
    if (globalCreateDrawerOpen) this.drawer.close();
    else if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  }
  @HostListener('window:keydown.escape') onEscape(): void { this.close(); }
  startCreate(): void {
    this.close(); this.previousFocus = null;
    this.name = ''; this.type = 'HOTEL'; this.detailError.set(''); this.creating.set(true);
    this.drawer.openEntityCreate({ controller: this });
  }
  openSuggestedEntity(entity: ActividadEntidad): void {
    this.drawer.close(true);
    this.creating.set(false);
    void this.open(entity);
  }
  onCreateNameChange(value: string): void {
    this.name = value;
    this.queueSuggestions();
  }
  onCreateTypeChange(value: TipoEntidad): void {
    this.type = value;
    this.queueSuggestions();
  }
  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  private queueSuggestions(): void {
    clearTimeout(this.suggestionTimer);
    const term = this.name.trim();
    if (term.length < 2) {
      this.entitySuggestions.set([]); this.suggesting.set(false);
      return;
    }
    const run = ++this.suggestionRun;
    this.suggestionTimer = setTimeout(async () => {
      this.suggesting.set(true);
      try {
        const entities = await firstValueFrom(this.api.search(this.type, term));
        if (run !== this.suggestionRun) return;
        this.entitySuggestions.set(entities.slice(0, 5));
      } catch {
        if (run === this.suggestionRun) this.detailError.set('No se pudieron cargar las sugerencias. Puedes escribir el nombre manualmente.');
      } finally { if (run === this.suggestionRun) this.suggesting.set(false); }
    }, 250);
  }
  startEdit(): void {
    const entity = this.selected()?.entity; if (!entity) return;
    this.name = entity.Nombre; this.type = entity.Tipo; this.editing.set(true);
  }
  startRowEdit(item: ActividadEntidad): void {
    if (!this.canEdit || this.saving() || this.loading()) return;
    this.rowEditingId.set(item.Id_Entidad_Reportante);
    this.rowEditName = item.Nombre;
    this.rowEditType = item.Tipo;
    this.error.set('');
  }
  cancelRowEdit(): void {
    this.rowEditingId.set(null);
    this.rowEditName = '';
    this.rowEditType = 'HOTEL';
  }
  async saveRowEdit(item: ActividadEntidad): Promise<void> {
    if (!this.canEdit || this.saving() || this.loading() || this.rowEditingId() !== item.Id_Entidad_Reportante
      || !this.rowEditName.trim()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.update(item.Id_Entidad_Reportante, {
        Nombre: this.rowEditName.trim(), Tipo: this.rowEditType,
      }));
      this.cancelRowEdit();
      await this.search(this.result()?.page || 1);
    } catch (e: any) {
      this.error.set(e?.error?.message || 'No se pudo actualizar la entidad.');
    } finally { this.saving.set(false); }
  }
  async toggleRowActive(item: ActividadEntidad): Promise<void> {
    if (!this.canEdit || this.saving() || this.loading()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.update(item.Id_Entidad_Reportante, { Activo: item.Activo ? 0 : 1 }));
      await this.search(this.result()?.page || 1);
    } catch (e: any) {
      this.error.set(e?.error?.message || 'No se pudo cambiar el estado de la entidad.');
    } finally { this.saving.set(false); }
  }
  async save(): Promise<void> {
    if (!this.name.trim() || this.saving() || (this.creating() && this.exactDuplicate)) return;
    this.saving.set(true); this.detailError.set('');
    try {
      if (this.creating()) {
        const detail = await firstValueFrom(this.api.create(this.type, this.name));
        this.drawer.close(true);
        this.creating.set(false); this.selected.set(detail);
        await this.search();
      } else if (this.selected()) {
        const id = this.selected()!.entity.Id_Entidad_Reportante;
        await firstValueFrom(this.api.update(id, { Nombre: this.name, Tipo: this.type }));
        this.editing.set(false); await this.search(); await this.refreshDetail(id);
      }
    } catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo guardar la entidad.'); }
    finally { this.saving.set(false); }
  }
  async setActive(active: boolean): Promise<void> {
    const id = this.selected()?.entity.Id_Entidad_Reportante; if (!id || this.saving()) return;
    this.saving.set(true);
    try { await firstValueFrom(this.api.update(id, { Activo: active ? 1 : 0 }));
      await this.refreshDetail(id); await this.search(this.result()?.page || 1); }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo cambiar el estado.'); }
    finally { this.saving.set(false); }
  }
  async validate(state: ValidacionEntidad): Promise<void> {
    const id = this.selected()?.entity.Id_Entidad_Reportante; if (!id || this.saving()) return;
    const reason = state === 'RECHAZADA' ? this.rejectionReason.trim() : '';
    if (state === 'RECHAZADA' && reason.length > 200) {
      this.detailError.set('El motivo de rechazo puede tener hasta 200 caracteres.');
      return;
    }
    this.saving.set(true);
    this.detailError.set(''); this.detailNotice.set('');
    try {
      const result = await firstValueFrom(this.api.validate(id, state, reason));
      this.rejecting.set(false); this.rejectionReason = '';
      this.detailNotice.set(result?.warning || '');
      if (state === 'RECHAZADA') {
        this.selected.set(null);
        this.validationNotice.set('Entidad rechazada. Las operaciones afectadas están pendientes de datos.');
        await this.search(this.result()?.page || 1);
        return;
      }
      if (this.canValidate && !this.permissions.tienePermiso('ENTIDADES_REPORTANTES.LEER')) {
        this.selected.set(null);
        this.validationNotice.set(result?.warning || 'Entidad validada.');
        await this.search(this.result()?.page || 1);
        return;
      }
      await this.refreshDetail(id); await this.search(this.result()?.page || 1);
    }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo actualizar la validación.'); }
    finally { this.saving.set(false); }
  }
  beginReject(): void {
    if (!this.canValidate || this.saving()) return;
    this.detailError.set(''); this.detailNotice.set(''); this.rejectionReason = ''; this.rejecting.set(true);
  }
  cancelReject(): void { this.rejecting.set(false); this.rejectionReason = ''; this.detailError.set(''); }
  async searchPoints(): Promise<void> {
    if (this.pointSearch.trim().length < 2) { this.pointMatches.set([]); return; }
    try { this.pointMatches.set(await firstValueFrom(this.reservas.buscarPuntos(this.pointSearch))); }
    catch { this.detailError.set('No se pudieron buscar puntos.'); }
  }
  async setPoint(pointId: number, associated: boolean): Promise<void> {
    const id = this.selected()?.entity.Id_Entidad_Reportante; if (!id || this.saving()) return;
    this.saving.set(true);
    try { await firstValueFrom(this.api.point(id, pointId, associated));
      await this.refreshDetail(id); this.pointMatches.set([]); this.pointSearch = ''; }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo actualizar el punto.'); }
    finally { this.saving.set(false); }
  }
  private async refreshDetail(id: number): Promise<void> {
    this.selected.set(await firstValueFrom(this.api.detail(id, this.appliedFilters())));
  }
  async export(): Promise<void> {
    if (this.dateError() || this.exporting() || !this.result()?.items.length) return;
    this.exporting.set(true);
    try {
      const blob = await firstValueFrom(this.api.export(this.filters()));
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'entidades-reportantes.xlsx'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { this.error.set(e?.error?.message || 'No se pudo exportar el Excel.'); }
    finally { this.exporting.set(false); }
  }
  typeLabel(type: TipoEntidad): string {
    return { HOTEL: 'Hotel', AGENCIA_NACIONAL: 'Agencia nacional',
      AGENCIA_INTERNACIONAL: 'Agencia internacional' }[type];
  }
  validationLabel(state: ValidacionEntidad): string {
    return { PENDIENTE_VALIDACION: 'Pendiente', VALIDADA: 'Validada', RECHAZADA: 'Rechazada' }[state];
  }
  statusLabel(state: string): string {
    return this.statusOptions.find(option => option.value === state)?.label || state;
  }
  one(value: number): boolean { return Number(value) === 1; }
  activitySummary(item: ActividadEntidad): string {
    const parts: string[] = [];
    if (item.Reservas) parts.push(`${item.Reservas} ${this.one(item.Reservas) ? 'reserva' : 'reservas'}`);
    if (item.Transfers) parts.push(`${item.Transfers} ${this.one(item.Transfers) ? 'transfer' : 'transfers'}`);
    if (item.Pasajeros) parts.push(`${item.Pasajeros} ${this.one(item.Pasajeros) ? 'pasajero' : 'pasajeros'}`);
    return parts.length ? parts.join(' · ') : 'Sin actividad';
  }
}
