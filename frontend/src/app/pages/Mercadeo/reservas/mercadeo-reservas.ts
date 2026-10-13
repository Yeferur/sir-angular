import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { DatepickerComponent } from '../../../shared/datepicker/datepicker';
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
  imports: [CommonModule, DatePipe, FormsModule, DatepickerComponent, SirSelectComponent, LoadingStateComponent],
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
    if (this.loading()) return;
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
