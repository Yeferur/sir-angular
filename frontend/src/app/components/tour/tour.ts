import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { Tour, Tours } from '../../services/Tours/tours';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { UiStateService } from '../../services/ui-state.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

@Component({
  selector: 'app-tour-detail',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent],
  templateUrl: './tour.html',
  styleUrls: ['./tour.css'],
})
export class TourDetailComponent implements OnChanges {
  @Input({ required: true }) Id_Tour = '';
  @Output() onClose = new EventEmitter<void>();

  private readonly tours = inject(Tours);
  private readonly router = inject(Router);
  private readonly permisos = inject(PermisosService);
  private readonly alerts = inject(SirAlertService);
  private readonly uiState = inject(UiStateService);

  readonly tour = signal<Tour | null>(null);
  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly isDeactivating = signal(false);

  get canUpdate(): boolean {
    return this.permisos.tienePermiso('TOURS.ACTUALIZAR');
  }

  get canDelete(): boolean {
    return this.permisos.tienePermiso('TOURS.ELIMINAR');
  }

  ngOnChanges(): void {
    if (this.Id_Tour) this.loadTour();
  }

  loadTour(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.tours.getTourById(this.Id_Tour).pipe(
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: (tour) => this.tour.set(tour),
      error: (error) => {
        this.loadError.set(error?.error?.message || 'No pudimos cargar la configuración del tour.');
      },
    });
  }

  editTour(): void {
    const id = this.tour()?.Id_Tour;
    if (!id) return;
    this.onClose.emit();
    void this.router.navigate(['/Tours/Editar', id]);
  }

  deactivateTour(): void {
    const currentTour = this.tour();
    if (!currentTour?.Id_Tour || !this.canDelete || this.isDeactivating()) return;

    this.alerts.confirm(
      '¿Desactivar tour?',
      `El tour “${currentTour.Nombre_Tour}” dejará de estar disponible para nuevas operaciones. Su configuración y su histórico se conservarán.`,
      () => this.confirmDeactivation(currentTour),
      undefined,
      { confirmText: 'Desactivar', cancelText: 'Conservar', type: 'warning' }
    );
  }

  private confirmDeactivation(tour: Tour): void {
    const id = Number(tour.Id_Tour);
    this.isDeactivating.set(true);
    this.tours.deleteTour(id).pipe(
      finalize(() => this.isDeactivating.set(false))
    ).subscribe({
      next: () => {
        this.uiState.needsRefresh.set('tours');
        this.onClose.emit();
        this.alerts.successToast('Tour desactivado', 'La información histórica se conservó correctamente.');
      },
      error: (error) => {
        this.alerts.errorToast(
          'No pudimos desactivar el tour',
          error?.error?.message || 'Revisa si el tour tiene programaciones futuras.'
        );
      },
    });
  }

  availabilityLabel(tour: Tour): string {
    const mode = String(tour.Disponibilidad?.Modo || '').toUpperCase();
    return mode.includes('SOLO_TEMPORADAS') ? 'Por temporadas' : 'Todo el año';
  }

  formatDays(days: string[] | undefined): string {
    if (!days?.length) return 'Sin días configurados';
    return days.map((day) => day.charAt(0).toUpperCase() + day.slice(1)).join(', ');
  }

  formatMoney(value: number | undefined, currency = 'COP'): string {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency || 'COP',
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(amount);
  }

  isIncomplete(tour: Tour): boolean {
    const hasPlans = Number(tour.Cantidad_Planes || 0) > 0;
    const hasOperation = Number(tour.Cantidad_Dias_Base || 0) > 0
      || Number(tour.Cantidad_Temporadas || 0) > 0;
    return !hasPlans || !hasOperation;
  }

  formatPrice(value: number | undefined, currency = 'COP'): string {
    return new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: currency === 'COP' ? 0 : 2,
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(Number(value || 0));
  }
}
