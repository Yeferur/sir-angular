import { CommonModule, DatePipe } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirSearchInputComponent } from '../../../shared/search-input/search-input';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { Reservas, Punto } from '../../../services/Reservas/reservas';
import { ActividadEntidad, DetalleEntidad, EntidadesReportantesService, FiltrosEntidades,
  PaginaEntidades, TipoEntidad, ValidacionEntidad } from '../../../services/Mercadeo/entidades-reportantes.service';

const typeOptions: SirSelectOption[] = [
  { value: '', label: 'Todos los tipos' }, { value: 'HOTEL', label: 'Hoteles' },
  { value: 'AGENCIA_NACIONAL', label: 'Agencias nacionales' },
  { value: 'AGENCIA_INTERNACIONAL', label: 'Agencias internacionales' },
];
const validationOptions: SirSelectOption[] = [
  { value: '', label: 'Toda validación' }, { value: 'PENDIENTE_VALIDACION', label: 'Pendiente de validación' },
  { value: 'VALIDADA', label: 'Validada' }, { value: 'RECHAZADA', label: 'Rechazada' },
];
const statusOptions: SirSelectOption[] = [
  { value: '', label: 'Todos los estados' }, { value: 'ACTIVA', label: 'Activas' },
  { value: 'INACTIVA', label: 'Inactivas' },
];
const activityOptions: SirSelectOption[] = [
  { value: '', label: 'Toda actividad' }, { value: 'CON_RESERVAS', label: 'Con reservas' },
  { value: 'SIN_RESERVAS', label: 'Sin reservas' },
];
function bogotaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(date);
}
function initialFilters(): FiltrosEntidades {
  return { desde: bogotaDate(new Date(Date.now() - 30 * 86400000)), hasta: bogotaDate(new Date()),
    tipo: '', validacion: '', estado: '', actividad: '', buscar: '' };
}

@Component({
  selector: 'app-mercadeo-entidades', standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, A11yModule, SirDateRangePickerComponent, SirSearchInputComponent,
    SirFilterBarComponent, SirFilterPanelComponent, QueryEmptyStateComponent, LoadingStateComponent, SirSelectComponent],
  templateUrl: './mercadeo-entidades.html', styleUrl: './mercadeo-entidades.css',
})
export class MercadeoEntidadesComponent implements OnInit {
  private readonly api = inject(EntidadesReportantesService);
  private readonly reservas = inject(Reservas);
  private readonly permissions = inject(PermisosService);
  private previousFocus: HTMLElement | null = null;
  private suggestionTimer?: ReturnType<typeof setTimeout>;
  private suggestionRun = 0;
  private pointSuggestionDismissed = false;
  readonly typeOptions = typeOptions;
  readonly validationOptions = validationOptions;
  readonly statusOptions = statusOptions;
  readonly activityOptions = activityOptions;
  readonly filters = signal<FiltrosEntidades>(initialFilters());
  readonly dateRange = computed<SirDateRange>(() => ({ start: this.filters().desde, end: this.filters().hasta }));
  readonly result = signal<PaginaEntidades | null>(null);
  readonly selected = signal<DetalleEntidad | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly exporting = signal(false);
  readonly error = signal('');
  readonly detailError = signal('');
  readonly filterOpen = signal(false);
  readonly editing = signal(false);
  readonly creating = signal(false);
  readonly pointMatches = signal<Punto[]>([]);
  readonly pointPickerOpen = signal(false);
  readonly entitySuggestions = signal<ActividadEntidad[]>([]);
  readonly createPointSuggestions = signal<Punto[]>([]);
  readonly selectedCreatePoint = signal<Punto | null>(null);
  readonly associateCreatePoint = signal(false);
  readonly suggesting = signal(false);
  readonly canCreate = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.CREAR');
  readonly canEdit = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.ACTUALIZAR');
  readonly canValidate = this.permissions.tienePermiso('ENTIDADES_REPORTANTES.VALIDAR');
  name = '';
  type: TipoEntidad = 'HOTEL';
  pointSearch = '';
  get exactDuplicate(): ActividadEntidad | null {
    return this.entitySuggestions().find(entity =>
      entity.Tipo === this.type && this.normalize(entity.Nombre) === this.normalize(this.name)) || null;
  }
  readonly filterCount = computed(() => ['tipo', 'validacion', 'estado', 'actividad']
    .filter(key => !!this.filters()[key as keyof FiltrosEntidades]).length);
  readonly dateError = computed(() => {
    const f = this.filters();
    if (!f.desde || !f.hasta) return 'Selecciona un rango completo.';
    if (f.desde > f.hasta) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(f.hasta) - Date.parse(f.desde)) / 86400000 > 30)
      return 'El rango máximo es de 31 días calendario.';
    return '';
  });

  ngOnInit(): void { this.search(); }
  setFilter(key: keyof FiltrosEntidades, value: string): void {
    this.filters.update(current => ({ ...current, [key]: value || '' }));
  }
  setRange(range: SirDateRange): void {
    this.filters.update(current => ({ ...current, desde: range.start || '', hasta: range.end || '' }));
  }
  async search(page = 1): Promise<void> {
    if (this.loading() || this.dateError()) return;
    this.loading.set(true); this.error.set('');
    try { this.result.set(await firstValueFrom(this.api.activity(this.filters(), page))); }
    catch (e: any) { this.error.set(e?.error?.message || 'No se pudo consultar la actividad.'); }
    finally { this.loading.set(false); }
  }
  clear(): void { this.filters.set(initialFilters()); this.search(); }
  readonly hasChangedFilters = computed(() => {
    const current = this.filters(); const initial = initialFilters();
    return Object.keys(initial).some(key => current[key as keyof FiltrosEntidades] !== initial[key as keyof FiltrosEntidades]);
  });
  async open(item: ActividadEntidad): Promise<void> {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.detailError.set(''); this.selected.set(null); this.editing.set(false);
    try { this.selected.set(await firstValueFrom(this.api.detail(item.Id_Entidad_Reportante, this.filters()))); }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo cargar el detalle.'); }
  }
  close(): void {
    this.selected.set(null); this.creating.set(false); this.editing.set(false); this.pointMatches.set([]);
    this.pointPickerOpen.set(false); this.pointSuggestionDismissed = false;
    this.entitySuggestions.set([]); this.createPointSuggestions.set([]);
    this.selectedCreatePoint.set(null); this.associateCreatePoint.set(false);
    clearTimeout(this.suggestionTimer); this.suggestionRun++;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  }
  @HostListener('window:keydown.escape') onEscape(): void { this.close(); }
  startCreate(): void {
    this.close(); this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.name = ''; this.type = 'HOTEL'; this.detailError.set(''); this.creating.set(true);
  }
  onCreateNameChange(value: string): void {
    this.name = value;
    this.pointSuggestionDismissed = false;
    this.queueSuggestions();
  }
  onCreateTypeChange(value: TipoEntidad): void {
    this.type = value;
    if (value !== 'HOTEL') { this.selectedCreatePoint.set(null); this.associateCreatePoint.set(false); }
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
      this.entitySuggestions.set([]); this.createPointSuggestions.set([]); this.suggesting.set(false);
      return;
    }
    const run = ++this.suggestionRun;
    this.suggestionTimer = setTimeout(async () => {
      this.suggesting.set(true);
      try {
        const [entities, points] = await Promise.all([
          firstValueFrom(this.api.activity({ ...initialFilters(), desde: '', hasta: '', buscar: term }, 1)),
          this.type === 'HOTEL' && !this.pointSuggestionDismissed
            ? firstValueFrom(this.reservas.buscarPuntos(term)) : Promise.resolve([]),
        ]);
        if (run !== this.suggestionRun) return;
        this.entitySuggestions.set(entities.items.slice(0, 5));
        this.createPointSuggestions.set(points.slice(0, 6));
      } catch {
        if (run === this.suggestionRun) this.detailError.set('No se pudieron cargar las sugerencias. Puedes escribir el nombre manualmente.');
      } finally { if (run === this.suggestionRun) this.suggesting.set(false); }
    }, 250);
  }
  usePoint(point: Punto): void {
    this.pointSuggestionDismissed = true;
    this.createPointSuggestions.set([]);
    this.selectedCreatePoint.set(point); this.associateCreatePoint.set(false);
    this.name = point.NombrePunto.toLocaleLowerCase('es').replace(/(^|\s)\S/g, letter => letter.toLocaleUpperCase('es'));
    this.queueSuggestions();
  }
  startEdit(): void {
    const entity = this.selected()?.entity; if (!entity) return;
    this.name = entity.Nombre; this.type = entity.Tipo; this.editing.set(true);
  }
  async save(): Promise<void> {
    if (!this.name.trim() || this.saving() || (this.creating() && this.exactDuplicate)) return;
    this.saving.set(true); this.detailError.set('');
    try {
      if (this.creating()) {
        const detail = await firstValueFrom(this.api.create(this.type, this.name));
        this.creating.set(false); this.selected.set(detail);
        const point = this.selectedCreatePoint();
        if (point && this.associateCreatePoint()) {
          try {
            await firstValueFrom(this.api.point(detail.entity.Id_Entidad_Reportante, point.Id_Punto, true));
            await this.refreshDetail(detail.entity.Id_Entidad_Reportante);
          } catch (e: any) {
            this.detailError.set(e?.error?.message || 'La entidad se creó, pero no se pudo asociar el punto. Puedes asociarlo desde el detalle.');
          }
        }
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
    this.saving.set(true);
    try { await firstValueFrom(this.api.validate(id, state));
      await this.refreshDetail(id); await this.search(this.result()?.page || 1); }
    catch (e: any) { this.detailError.set(e?.error?.message || 'No se pudo actualizar la validación.'); }
    finally { this.saving.set(false); }
  }
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
    this.selected.set(await firstValueFrom(this.api.detail(id, this.filters())));
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
  one(value: number): boolean { return Number(value) === 1; }
}
