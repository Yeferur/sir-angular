import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SeguroTemporalListado, SegurosService } from '../../services/Seguros/seguros.service';
import { Tour, Tours } from '../../services/Tours/tours';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { QueryEmptyStateComponent } from '../../shared/query-empty-state/query-empty-state';
import { SirSelectComponent, SirSelectOption, compareSelectValuesAsStrings } from '../../shared/select/select';

@Component({
  selector: 'app-seguros-temporal',
  standalone: true,
  imports: [CommonModule, FormsModule, DatepickerComponent, SirSelectComponent, LoadingStateComponent, QueryEmptyStateComponent],
  templateUrl: './seguros-temporal.html',
  styleUrls: ['./seguros.css', './seguros-temporal.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegurosTemporalComponent implements OnInit {
  readonly compareSelectValues = compareSelectValuesAsStrings;

  private readonly segurosService = inject(SegurosService);
  private readonly toursService = inject(Tours);
  private readonly alerts = inject(SirAlertService);
  private readonly permisos = inject(PermisosService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  tours: Tour[] = [];
  fecha = this.isoLocal(this.addDays(new Date(), -1));
  readonly fechaMaxima = this.isoLocal(new Date());
  idTour = '';
  catalogLoading = true;
  catalogError = '';
  hasSearched = false;
  isSearching = false;
  isExporting = false;
  searchError = '';
  result: SeguroTemporalListado | null = null;
  private restoreSearchFromUrl = false;
  private tourOptionsCache?: { source: readonly Tour[]; options: SirSelectOption[] };

  get tourSelectOptions(): SirSelectOption[] {
    if (this.tourOptionsCache?.source !== this.tours) {
      this.tourOptionsCache = {
        source: this.tours,
        options: [
          { value: '', label: 'Seleccionar tour', disabled: true },
          ...this.tours.map(tour => ({ value: String(tour.Id_Tour), label: String(tour.Nombre_Tour) })),
        ],
      };
    }
    return this.tourOptionsCache.options;
  }

  get canOpenConfirmation(): boolean { return this.permisos.tienePermiso('CONTROL_VIAJE.LEER'); }
  get totalReservas(): number { return new Set((this.result?.pasajeros || []).map(item => item.Id_Reserva)).size; }
  get nombreTour(): string {
    return this.result?.Nombre_Tour
      || this.tours.find(tour => String(tour.Id_Tour) === this.idTour)?.Nombre_Tour
      || 'Tour seleccionado';
  }

  ngOnInit(): void {
    this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
    this.loadTours();
  }

  loadTours(): void {
    this.catalogLoading = true;
    this.catalogError = '';
    this.toursService.getTours().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: tours => {
        this.tours = tours || [];
        this.catalogLoading = false;
        if (this.restoreSearchFromUrl) {
          this.restoreSearchFromUrl = false;
          this.buscar(false);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.catalogLoading = false;
        this.catalogError = 'No pudimos cargar los tours disponibles.';
        this.cdr.markForCheck();
      },
    });
  }

  actualizarFecha(value: string | Date | null): void {
    this.fecha = this.toIsoDate(value);
    this.marcarFiltrosSinAplicar();
  }

  actualizarTour(value: string): void {
    this.idTour = String(value || '');
    this.marcarFiltrosSinAplicar();
  }

  buscar(preserveResults = true): void {
    if (!this.fecha || !this.idTour || this.isSearching) return;
    this.hasSearched = true;
    this.isSearching = true;
    this.searchError = '';
    if (!preserveResults) this.result = null;
    this.syncFiltersToUrl(true);
    this.segurosService.listarSegurosTemporales({ Fecha: this.fecha, Id_Tour: this.idTour })
      .pipe(finalize(() => {
        this.isSearching = false;
        this.cdr.markForCheck();
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.result = result;
          this.searchError = '';
          this.cdr.markForCheck();
        },
        error: error => {
          this.result = null;
          this.searchError = error?.error?.message || error?.message || 'No pudimos consultar los pasajeros confirmados.';
          this.cdr.markForCheck();
        },
      });
  }

  descargarExcel(): void {
    if (!this.result?.totalPasajeros || this.result.pasajerosSinDocumento || this.isExporting) return;
    this.isExporting = true;
    this.segurosService.exportarSegurosTemporales({ Fecha: this.fecha, Id_Tour: this.idTour })
      .pipe(finalize(() => {
        this.isExporting = false;
        this.cdr.markForCheck();
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          this.downloadBlob(blob, `Seguros_${this.fecha}_${this.nombreTourArchivo()}.xlsx`);
          this.alerts.successToast('Archivo generado', `${this.result?.totalPasajeros || 0} pasajeros confirmados incluidos.`);
        },
        error: error => this.alerts.errorToast(
          'No se pudo descargar',
          error?.error?.message || error?.message || 'Revisa los datos de los pasajeros e inténtalo nuevamente.',
        ),
      });
  }

  irAConfirmacion(): void {
    if (!this.canOpenConfirmation || !this.fecha || !this.idTour) return;
    void this.router.navigate(['/Reservas/Confirmacion'], {
      queryParams: { fechaTour: this.fecha, tour: this.idTour, buscar: 1, origen: 'seguros' },
    });
  }

  private marcarFiltrosSinAplicar(): void {
    if (!this.hasSearched) return;
    this.hasSearched = false;
    this.result = null;
    this.searchError = '';
    this.syncFiltersToUrl(false);
  }

  private restoreFiltersFromQuery(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const fecha = String(params.get('fechaTour') || '').trim();
    const tour = Number(params.get('tour'));
    const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
    const tourValido = Number.isInteger(tour) && tour > 0;
    if (fechaValida) this.fecha = fecha;
    if (tourValido) this.idTour = String(tour);
    return params.get('buscar') === '1' && fechaValida && tourValido;
  }

  private syncFiltersToUrl(search: boolean): void {
    const queryParams: Record<string, string | null> = {
      fechaTour: this.fecha || null,
      tour: this.idTour || null,
      buscar: search ? '1' : null,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private nombreTourArchivo(): string {
    return this.nombreTour.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Tour';
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

  private toIsoDate(value: string | Date | null): string {
    if (!value) return '';
    if (value instanceof Date) return this.isoLocal(value);
    return String(value).slice(0, 10);
  }

  private isoLocal(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private addDays(date: Date, amount: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  }
}
