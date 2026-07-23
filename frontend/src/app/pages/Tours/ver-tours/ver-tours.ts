import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { Tour, Tours } from '../../../services/Tours/tours';
import { Router } from '@angular/router';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { UiStateService } from '../../../services/ui-state.service';
import { LoadingStateComponent } from '../../../shared/loading-state/loading-state';

@Component({
    selector: 'app-ver-tours',
    standalone: true,
    imports: [FormsModule, LoadingStateComponent],
    templateUrl: './ver-tours.html',
    styleUrls: ['./ver-tours.css']
})
export class VerToursComponent implements OnInit {
    private toursService     = inject(Tours);
    private uiState          = inject(UiStateService);
    private router           = inject(Router);
    private permisosService  = inject(PermisosService);
    private alerts           = inject(SirAlertService);

    tours     = signal<Tour[]>([]);
    isLoading = signal(true);
    busqueda  = signal('');

    private refreshEffect = effect(() => {
        const entity = this.uiState.needsRefresh();
        if (entity === 'tours') {
            this.loadTours();
            this.uiState.needsRefresh.set('');
        }
    });

    toursFiltrados = computed(() => {
        const q = this.busqueda().toLowerCase().trim();
        if (!q) return this.tours();
        return this.tours().filter(t =>
            t.Nombre_Tour?.toLowerCase().includes(q) ||
            t.Abreviacion?.toLowerCase().includes(q)
        );
    });

    get canDeleteTour(): boolean { return this.permisosService.tienePermiso('TOURS.ELIMINAR'); }
    get canCreateTour(): boolean { return this.permisosService.tienePermiso('TOURS.CREAR'); }
    get canUpdateTour(): boolean { return this.permisosService.tienePermiso('TOURS.ACTUALIZAR'); }

    ngOnInit(): void {
        this.loadTours();
    }

    loadTours() {
        this.isLoading.set(true);
        this.toursService.getTours().pipe(
            finalize(() => this.isLoading.set(false))
        ).subscribe({
            next: (data) => queueMicrotask(() => this.tours.set(data || [])),
            error: (err) => this.alerts.showAlert({
                type: 'error',
                title: 'Error al cargar tours',
                message: err?.error?.message || 'Ha ocurrido un error inesperado.',
                autoClose: true,
            })
        });
    }

    formatValor(v: number | null | undefined): string {
        if (v === null || v === undefined) return '—';
        return '$' + Number(v).toLocaleString('es-CO');
    }

    showNumber(v: any): string {
        return (v === null || v === undefined) ? '—' : String(v);
    }

    tourComisiones(tour: Tour): Array<{ Id_Canal: number; Nombre_Canal?: string; Valor: number }> {
        if (Array.isArray(tour.Comisiones)) return tour.Comisiones;
        if (Array.isArray(tour.comisiones)) return tour.comisiones;
        console.log(`comisiones no encontradas para el tour ${tour.Id_Tour}:`, tour);
        return [];
    }

    crearTour() {
        if (!this.canCreateTour) {
            this.alerts.errorToast('Acceso denegado', 'No tienes permiso para crear tours.');
            return;
        }
        this.router.navigate(['/Tours/NuevoTour']);
    }

    editarTour(tour: Tour) {
        this.router.navigate([`/Tours/Editar/${tour.Id_Tour}`]);
    }

    eliminarTour(tour: Tour) {
        this.alerts.confirm(
            '¿Eliminar tour?',
            `¿Estás seguro de que deseas eliminar el tour "${tour.Nombre_Tour}"? Esta acción no se puede deshacer.`,
            () => this.confirmarEliminacion(tour),
            undefined,
            { confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'warning' }
        );
    }

    private confirmarEliminacion(tour: Tour) {
        this.toursService.deleteTour(tour.Id_Tour!).subscribe({
            next: () => {
                this.alerts.showAlert({
                    type: 'success',
                    title: 'Tour eliminado',
                    message: `El tour "${tour.Nombre_Tour}" ha sido eliminado exitosamente.`,
                    autoClose: true
                });
                this.loadTours();
            },
            error: (err) => this.alerts.showAlert({
                type: 'error',
                title: 'Error al eliminar',
                message: err?.error?.message || 'No se pudo eliminar el tour.',
                autoClose: false
            })
        });
    }
}
