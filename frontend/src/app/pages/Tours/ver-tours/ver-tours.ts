import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { Tour, Tours } from '../../../services/Tours/tours';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { UiStateService } from '../../../services/ui-state.service';
import { SirDrawerService } from '../../../services/Drawer/drawer.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

@Component({
  selector: 'app-ver-tours',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingStateComponent],
  templateUrl: './ver-tours.html',
  styleUrls: ['../../listado-reservas-transfers.css', './ver-tours.css'],
})
export class VerToursComponent implements OnInit {
  private readonly toursService = inject(Tours);
  private readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly permisosService = inject(PermisosService);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);

  readonly tours = signal<Tour[]>([]);
  readonly isLoading = signal(true);
  readonly isRefreshing = signal(false);
  readonly loadError = signal('');
  readonly busqueda = signal('');
  readonly deactivatingId = signal<number | null>(null);

  private readonly refreshEffect = effect(() => {
    if (this.uiState.needsRefresh() === 'tours') {
      this.loadTours();
      this.uiState.needsRefresh.set('');
    }
  });

  readonly toursFiltrados = computed(() => {
    const query = this.busqueda().toLocaleLowerCase('es').trim();
    if (!query) return this.tours();
    return this.tours().filter((tour) =>
      tour.Nombre_Tour?.toLocaleLowerCase('es').includes(query)
      || tour.Abreviacion?.toLocaleLowerCase('es').includes(query)
    );
  });

  get canDeleteTour(): boolean {
    return this.permisosService.tienePermiso('TOURS.ELIMINAR');
  }

  get canCreateTour(): boolean {
    return this.permisosService.tienePermiso('TOURS.CREAR');
  }

  get canUpdateTour(): boolean {
    return this.permisosService.tienePermiso('TOURS.ACTUALIZAR');
  }

  ngOnInit(): void {
    this.loadTours();
  }

  loadTours(): void {
    const hasPreviousResults = this.tours().length > 0;
    this.loadError.set('');
    this.isLoading.set(!hasPreviousResults);
    this.isRefreshing.set(hasPreviousResults);

    this.toursService.getTours().pipe(
      finalize(() => {
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      })
    ).subscribe({
      next: (data) => this.tours.set(data || []),
      error: (error) => {
        this.loadError.set(error?.error?.message || 'No pudimos cargar los tours. Intenta nuevamente.');
      },
    });
  }

  crearTour(): void {
    if (!this.canCreateTour) return;
    void this.router.navigate(['/Tours/NuevoTour']);
  }

  verTour(tour: Tour): void {
    if (!tour.Id_Tour) return;
    this.drawer.openTour(String(tour.Id_Tour));
  }

  editarTour(tour: Tour): void {
    if (!tour.Id_Tour || !this.canUpdateTour) return;
    void this.router.navigate(['/Tours/Editar', tour.Id_Tour]);
  }

  clearSearch(): void {
    this.busqueda.set('');
  }

  configurationStatus(tour: Tour): 'ready' | 'incomplete' {
    const hasPlans = Number(tour.Cantidad_Planes || 0) > 0;
    const hasOperation = Number(tour.Cantidad_Dias_Base || 0) > 0
      || Number(tour.Cantidad_Temporadas || 0) > 0;
    return hasPlans && hasOperation ? 'ready' : 'incomplete';
  }

  operationLabel(tour: Tour): string {
    const baseDays = Number(tour.Cantidad_Dias_Base || 0);
    const seasons = Number(tour.Cantidad_Temporadas || 0);
    const parts: string[] = [];

    if (baseDays > 0) parts.push(`${baseDays} ${baseDays === 1 ? 'día disponible' : 'días disponibles'}`);
    if (seasons > 0) parts.push(`${seasons} temporada${seasons === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'Sin programación';
  }

  planCountLabel(tour: Tour): string {
    const count = Number(tour.Cantidad_Planes || 0);
    return `${count} ${count === 1 ? 'plan' : 'planes'}`;
  }

  desactivarTour(tour: Tour): void {
    if (!tour.Id_Tour || !this.canDeleteTour) return;
    this.alerts.confirm(
      '¿Desactivar tour?',
      `El tour “${tour.Nombre_Tour}” dejará de aparecer para nuevas operaciones. Su configuración y su histórico se conservarán.`,
      () => this.confirmarDesactivacion(tour),
      undefined,
      { confirmText: 'Desactivar', cancelText: 'Conservar', type: 'warning' }
    );
  }

  private confirmarDesactivacion(tour: Tour): void {
    const id = Number(tour.Id_Tour);
    this.deactivatingId.set(id);
    this.toursService.deleteTour(id).pipe(
      finalize(() => this.deactivatingId.set(null))
    ).subscribe({
      next: () => {
        this.tours.update((current) => current.filter((item) => item.Id_Tour !== id));
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
}
