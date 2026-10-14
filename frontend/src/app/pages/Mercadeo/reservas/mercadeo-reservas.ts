import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
import { SirDateRange, SirDateRangePickerComponent } from '../../../shared/date-range-picker/date-range-picker';
import { SirSearchInputComponent } from '../../../shared/search-input/search-input';
import { SirFilterBarComponent } from '../../../shared/filter-bar/filter-bar';
import { SirFilterPanelComponent } from '../../../shared/filter-panel/filter-panel';
import { QueryEmptyStateComponent } from '../../../shared/query-empty-state/query-empty-state';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';
import { SirSelectComponent, SirSelectOption } from '../../../shared/select/select';
import { MercadeoFilters, MercadeoPage, MercadeoService } from '../../../services/Mercadeo/mercadeo.service';

const EMPTY_FILTERS: MercadeoFilters = {
  fechaRegistroDesde: '', fechaRegistroHasta: '', fechaTour: '', codigoReserva: '',
  categoria: '', nombrePasajero: '', documento: '',
};

@Component({
  selector: 'app-mercadeo-reservas',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, DatepickerComponent, SirDateRangePickerComponent,
    SirSearchInputComponent, SirFilterBarComponent, SirFilterPanelComponent, QueryEmptyStateComponent,
    SirSelectComponent, LoadingStateComponent],
  templateUrl: './mercadeo-reservas.html',
  styleUrl: './mercadeo-reservas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MercadeoReservasComponent implements OnInit {
  private readonly api = inject(MercadeoService);

  readonly filters = signal<MercadeoFilters>({ ...EMPTY_FILTERS });
  readonly categorias = signal<{ Id_Canal: number; Nombre_Canal: string }[]>([]);
  readonly categoryOptions = signal<SirSelectOption[]>([{ value: '', label: 'Todas las categorías' }]);
  readonly result = signal<MercadeoPage | null>(null);
  readonly loading = signal(false);
  readonly loadingCategories = signal(true);
  readonly error = signal('');
  readonly categoryError = signal('');
  readonly pageSize = 25;
  readonly filtersOpen = signal(false);
  readonly filterCount = computed(() => ['fechaTour', 'categoria', 'nombrePasajero', 'documento']
    .filter(key => !!this.filters()[key as keyof MercadeoFilters]).length);
  readonly hasChangedFilters = computed(() => Object.keys(EMPTY_FILTERS)
    .some(key => !!this.filters()[key as keyof MercadeoFilters]));

  readonly registrationRange = computed<SirDateRange>(() => ({
    start: this.filters().fechaRegistroDesde || null, end: this.filters().fechaRegistroHasta || null,
  }));
  setRegistrationRange(range: SirDateRange): void {
    this.filters.update(filters => ({ ...filters, fechaRegistroDesde: range.start || '',
      fechaRegistroHasta: range.end || '' }));
  }
  get rangeError(): string {
    const f = this.filters();
    if (!f.fechaRegistroDesde && !f.fechaRegistroHasta) return '';
    if (!f.fechaRegistroDesde || !f.fechaRegistroHasta) return 'Selecciona un rango completo.';
    if (f.fechaRegistroDesde > f.fechaRegistroHasta) return 'La fecha inicial debe ser anterior a la final.';
    if ((Date.parse(f.fechaRegistroHasta) - Date.parse(f.fechaRegistroDesde)) / 86400000 > 30)
      return 'El rango máximo es de 31 días calendario.';
    return '';
  }

  ngOnInit(): void {
    this.api.getCategorias().subscribe({
      next: (rows) => {
        const categories = Array.isArray(rows) ? rows : [];
        this.categorias.set(categories);
        this.categoryOptions.set([
          { value: '', label: 'Todas las categorías' },
          ...categories.map((row) => ({ value: String(row.Id_Canal), label: row.Nombre_Canal })),
        ]);
        this.loadingCategories.set(false);
      },
      error: () => {
        this.categoryError.set('No se pudieron cargar las categorías. Puedes reintentar la consulta más tarde.');
        this.loadingCategories.set(false);
      },
    });
  }

  setFilter<K extends keyof MercadeoFilters>(key: K, value: string | null): void {
    this.filters.update((filters) => ({ ...filters, [key]: value || '' }));
  }

  search(page = 1): void {
    if (this.loading() || this.rangeError) return;
    this.loading.set(true);
    this.error.set('');
    this.api.buscar(this.filters(), page, this.pageSize).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (response) => this.result.set(response),
      error: (error) => this.error.set(error?.error?.message || 'No fue posible consultar las reservas.'),
    });
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
    this.result.set(null);
    this.error.set('');
  }

  changePage(page: number): void {
    if (page < 1 || page > (this.result()?.totalPages || 1)) return;
    this.search(page);
  }

  pageNumbers(): number[] {
    const total = this.result()?.totalPages || 1;
    const current = this.result()?.page || 1;
    const start = Math.max(1, Math.min(current - 2, total - 4));
    return Array.from({ length: Math.min(5, total) }, (_, index) => start + index);
  }
}
