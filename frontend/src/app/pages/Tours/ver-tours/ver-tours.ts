import { Component, OnInit, inject, signal } from '@angular/core';

import { Reservas, Tour } from '../../../services/Reservas/reservas';
import { Tours } from '../../../services/Tours/tours';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { Router } from '@angular/router';

@Component({
    selector: 'app-ver-tours',
    standalone: true,
    imports: [],
    templateUrl: './ver-tours.html',
    styleUrls: ['./ver-tours.css']
})
export class VerToursComponent implements OnInit {
    private reservasService = inject(Reservas);
    private toursService = inject(Tours);
    private navbar = inject(DynamicIslandGlobalService);
    private router = inject(Router);

    tours = signal<Tour[]>([]);
    isLoading = signal(true);

    // filtro simple - por ahora devuelve todos, expón como función para template
    toursFiltrados = () => this.tours();

    ngOnInit(): void {
        this.loadTours();
    }

    loadTours() {
        this.navbar.alert.set({
            title: 'Cargando tours...',
            loading: true,
            autoClose: false
        });
        this.reservasService.getTours().subscribe({
            next: (data) => this.tours.set(data || []),
            error: (err) => {
                this.navbar.alert.set({
                    type: 'error',
                    title: 'Error al cargar tours',
                    message: err?.error?.message || 'Ha ocurrido un error inesperado.',
                    autoClose: true,
                });
            },
            complete: () => { this.isLoading.set(false); this.navbar.alert.set(null); }
        });
    }

    // Helper para mostrar un valor numérico o fallback
    showNumber(v: any) { return (v === null || v === undefined) ? '—' : v; }

    crearTour() {
        this.router.navigate(['/Tours/NuevoTour']);
    }

    editarTour(tour: Tour) {
        this.router.navigate([`/Tours/Editar/${tour.Id_Tour}`]);
    }

    verProgramacion(tour: Tour) {
        this.navbar.alert.set({ type: 'info', title: 'Ver Programación', message: `Abrir programación para ${tour.Nombre_Tour}`, autoClose: true });
    }

    eliminarTour(tour: Tour) {
        this.navbar.alert.set({
            type: 'warning',
            title: '¿Eliminar tour?',
            message: `¿Estás seguro de que deseas eliminar el tour "${tour.Nombre_Tour}"? Esta acción no se puede deshacer.`,
            autoClose: false,
            buttons: [
                { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert.set(null) },
                {
                    text: 'Eliminar',
                    style: 'primary',
                    onClick: () => {
                        this.navbar.alert.set(null);
                        this.confirmarEliminacion(tour);
                    }
                }
            ]
        });
    }

    private confirmarEliminacion(tour: Tour) {
        this.toursService.deleteTour(tour.Id_Tour!).subscribe({
            next: () => {
                this.navbar.alert.set({
                    type: 'success',
                    title: 'Tour eliminado',
                    message: `El tour "${tour.Nombre_Tour}" ha sido eliminado exitosamente.`,
                    autoClose: true
                });
                // Recargar la lista de tours
                this.loadTours();
            },
            error: (err) => {
                this.navbar.alert.set({
                    type: 'error',
                    title: 'Error al eliminar',
                    message: err?.error?.error || 'No se pudo eliminar el tour.',
                    autoClose: false,
                    buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert.set(null) }]
                });
            }
        });
    }
}
