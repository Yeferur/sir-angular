import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';

import { SegurosService } from '../../services/Seguros/seguros.service';
import { Tours } from '../../services/Tours/tours';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { ConfirmacionService, EstadoConfirmacion, JornadaConfirmacion } from '../../services/confirmacion.service';
import { PermisosService } from '../../services/Permisos/permisos.service';

@Component({
    selector: 'app-seguros',
    standalone: true,
    imports: [CommonModule, FormsModule, DatepickerComponent],
    templateUrl: './seguros.html',
    styleUrl: './seguros.css'
})
export class SegurosComponent implements OnInit {
    private segurosService = inject(SegurosService);
    private toursService   = inject(Tours);
    private alerts         = inject(SirAlertService);
    private cdr            = inject(ChangeDetectorRef);
    private confirmacionService = inject(ConfirmacionService);
    private permisosService = inject(PermisosService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    // Filters
    fecha: string = '';
    idTour: string = '';

    // Data
    tours: any[]  = [];
    buses: any[]  = [];

    // State
    hasSearched   = false;
    isSearching   = false;
    isExporting   = false;
    estadoConfirmacion: EstadoConfirmacion | null = null;

    private restoreSearchFromUrl = false;

    // Dirty & saving tracking per bus
    private dirtyBuses  = new Set<number>();
    private savingBuses = new Set<number>();

    // ── Lifecycle ───────────────────────────────────────────────────────────
    ngOnInit(): void {
        const hoy = new Date();
        hoy.setDate(hoy.getDate() - 1);
        this.fecha = hoy.toISOString().split('T')[0];
        this.restoreSearchFromUrl = this.restoreFiltersFromQuery();
        this.loadTours();
    }

    // ── Tours ───────────────────────────────────────────────────────────────
    loadTours(): void {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.tours = data || [];
                if (this.restoreSearchFromUrl) {
                    this.restoreSearchFromUrl = false;
                    this.buscar();
                }
                this.cdr.detectChanges();
            },
            error: (err: any) => console.error('Error cargando tours', err)
        });
    }

    // ── Search ──────────────────────────────────────────────────────────────
    buscar(): void {
        if (!this.fecha || !this.idTour) return;

        this.hasSearched  = true;
        this.isSearching  = true;
        this.buses        = [];
        this.dirtyBuses.clear();
        this.syncFiltersToUrl(true);
        this.cdr.detectChanges();

        forkJoin({
            buses: this.segurosService.listarSeguros({ Fecha: this.fecha, Id_Tour: this.idTour }),
            estado: this.confirmacionService.getEstado(this.fecha, this.idTour).pipe(
                catchError(() => of(null)),
            ),
        }).pipe(
            finalize(() => {
                this.isSearching = false;
                this.cdr.detectChanges();
            }),
        ).subscribe({
            next: ({ buses, estado }) => {
                this.buses = buses || [];
                this.estadoConfirmacion = estado;
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error buscando seguros', err);
                this.alerts.errorToast('Error', 'No se pudo cargar la información de seguros.');
                this.cdr.detectChanges();
            }
        });
    }

    get jornadasPorConfirmar(): JornadaConfirmacion[] {
        if (!this.buses.length) return [];
        return this.estadoConfirmacion?.jornadas?.filter((jornada) => jornada.Requiere_Confirmacion) || [];
    }

    get canOpenConfirmation(): boolean {
        return this.permisosService.tienePermiso('CONTROL_VIAJE.LEER');
    }

    irAConfirmacion(): void {
        if (!this.canOpenConfirmation || !this.fecha || !this.idTour) return;
        void this.router.navigate(['/Reservas/Confirmacion'], {
            queryParams: {
                fechaTour: this.fecha,
                tour: this.idTour,
                buscar: 1,
                origen: 'seguros',
            },
        });
    }

    // ── Dirty tracking ──────────────────────────────────────────────────────
    markDirty(idBusProg: number): void {
        this.dirtyBuses.add(idBusProg);
    }

    isDirty(idBusProg: number): boolean {
        return this.dirtyBuses.has(idBusProg);
    }

    isSavingBus(idBusProg: number): boolean {
        return this.savingBuses.has(idBusProg);
    }

    // ── Save bus personal ───────────────────────────────────────────────────
    guardarBus(bus: any): void {
        const id = bus.Id_Bus_Prog;
        if (this.savingBuses.has(id)) return;

        this.savingBuses.add(id);
        this.cdr.detectChanges();

        this.segurosService.actualizarPersonalBus(id, {
            Conductor:     bus.Conductor     || null,
            DNI_Conductor: bus.DNI_Conductor || null,
            DNI_Guia:      bus.DNI_Guia      || null
        }).subscribe({
            next: () => {
                this.dirtyBuses.delete(id);
                this.savingBuses.delete(id);
                this.alerts.successToast('Guardado', `Bus ${bus.Orden_Bus} actualizado correctamente.`);
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error guardando bus', err);
                this.savingBuses.delete(id);
                this.alerts.errorToast('Error', 'No se pudo guardar. Intenta de nuevo.');
                this.cdr.detectChanges();
            }
        });
    }

    // ── Export ──────────────────────────────────────────────────────────────
    descargarExcel(): void {
        if (this.isExporting) return;

        if (this.dirtyBuses.size > 0) {
            this.alerts.confirm(
                '¿Descargar sin guardar?',
                'Hay buses con cambios sin guardar. El Excel se generará con los datos actuales en la base de datos, no con los cambios locales. ¿Continuar?',
                () => this.triggerExport(),
                undefined,
                { confirmText: 'Descargar igual', cancelText: 'Cancelar', type: 'warning' }
            );
            return;
        }

        this.triggerExport();
    }

    private triggerExport(): void {
        this.isExporting = true;
        this.cdr.detectChanges();

        const tourNombre = this.tours.find(t => String(t.Id_Tour) === String(this.idTour))?.Nombre_Tour || '';

        this.segurosService.exportarExcel(
            { Fecha: this.fecha, Id_Tour: this.idTour },
            tourNombre
        );

        // La descarga es síncrona desde el service (blob), damos un delay corto
        setTimeout(() => {
            this.isExporting = false;
            this.cdr.detectChanges();
        }, 1500);
    }

    // ── Computed ────────────────────────────────────────────────────────────
    get totalPasajeros(): number {
        return this.buses.reduce((acc, b) => acc + (b.pasajeros?.length ?? 0), 0);
    }

    get totalAsegurados(): number {
        // pasajeros + 1 guía + 1 conductor por cada bus
        return this.totalPasajeros + (this.buses.length * 2);
    }

    get busesConConductor(): number {
        return this.buses.filter(b => !!b.Conductor).length;
    }

    private restoreFiltersFromQuery(): boolean {
        const params = this.route.snapshot.queryParamMap;
        const fecha = String(params.get('fechaTour') || '').trim();
        const tour = Number(params.get('tour'));
        const hasValidFecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
        const hasValidTour = Number.isInteger(tour) && tour > 0;
        if (hasValidFecha) this.fecha = fecha;
        if (hasValidTour) this.idTour = String(tour);
        return params.get('buscar') === '1' && hasValidFecha && hasValidTour;
    }

    private syncFiltersToUrl(searchApplied: boolean): void {
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
                fechaTour: this.fecha || null,
                tour: this.idTour || null,
                buscar: searchApplied ? 1 : null,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }
}
