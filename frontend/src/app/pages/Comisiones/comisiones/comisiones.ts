import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComisionesService } from '../../../services/Comisiones/comisiones.service';
import { Tours } from '../../../services/Tours/tours';

@Component({
    selector: 'app-comisiones',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './comisiones.html',
    styleUrls: ['./comisiones.css']
})
export class ComisionesComponent implements OnInit {

    comisionesService = inject(ComisionesService);
    toursService = inject(Tours);
    cdr = inject(ChangeDetectorRef);

    // Filters
    fecha: string = new Date().toISOString().split('T')[0];
    idTour: string = '';

    // Data
    tours: any[] = [];
    comisiones: any[] = [];
    isPageLoading: boolean = false;
    isSearching: boolean = false;
    hasSearched: boolean = false;

    ngOnInit() {
        this.cargarTours();
    }

    cargarTours() {
        this.isPageLoading = true;
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.tours = data;
                this.cdr.detectChanges();
            },
            error: (err: any) => console.error('Error cargando tours', err),
            complete: () => {
                this.isPageLoading = false;
                this.cdr.detectChanges();
            }
        });
    }

    buscar() {
        this.hasSearched = true;
        this.isSearching = true;
        const filtros = {
            Fecha: this.fecha,
            Id_Tour: this.idTour
        };

        this.comisionesService.listarComisiones(filtros).subscribe({
            next: (data: any[]) => {
                this.comisiones = data;
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error buscando comisiones', err);
                this.comisiones = [];
                this.cdr.detectChanges();
            },
            complete: () => {
                this.isSearching = false;
                this.cdr.detectChanges();
            }
        });
    }

    descargarExcel() {
        // Uses the same filters
        const filtros = {
            Fecha: this.fecha,
            Id_Tour: this.idTour
        };
        this.comisionesService.exportarExcel(filtros);
    }
}
