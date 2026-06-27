import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SegurosService } from '../../services/Seguros/seguros.service';
import { Tours } from '../../services/Tours/tours';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { SirAlertService } from '../../services/Alertas/alert.service';

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

    // Dirty & saving tracking per bus
    private dirtyBuses  = new Set<number>();
    private savingBuses = new Set<number>();

    // ── Lifecycle ───────────────────────────────────────────────────────────
    ngOnInit(): void {
        const hoy = new Date();
        hoy.setDate(hoy.getDate() - 1);
        this.fecha = hoy.toISOString().split('T')[0];
        this.loadTours();
    }

    // ── Tours ───────────────────────────────────────────────────────────────
    loadTours(): void {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.tours = data || [];
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
        this.cdr.detectChanges();

        this.segurosService.listarSeguros({ Fecha: this.fecha, Id_Tour: this.idTour }).subscribe({
            next: (data: any[]) => {
                this.buses = data || [];
                this.isSearching = false;
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error buscando seguros', err);
                this.alerts.errorToast('Error', 'No se pudo cargar la información de seguros.');
                this.isSearching = false;
                this.cdr.detectChanges();
            }
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
}
