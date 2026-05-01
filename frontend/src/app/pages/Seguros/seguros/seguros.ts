import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SegurosService } from '../../../services/Seguros/seguros.service';
import { Tours } from '../../../services/Tours/tours';

@Component({
    selector: 'app-seguros',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './seguros.html',
    styleUrls: ['./seguros.css']
})
export class SegurosComponent implements OnInit {

    segurosService = inject(SegurosService);
    toursService = inject(Tours);
    cdr = inject(ChangeDetectorRef);

    // Filters
    fecha: string = new Date().toISOString().split('T')[0];
    idTour: string = '';

    // Data
    tours: any[] = [];
    seguros: any[] = [];
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

        this.segurosService.listarSeguros(filtros).subscribe({
            next: (data: any[]) => {
                this.seguros = data;
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error buscando seguros', err);
                this.seguros = [];
                this.cdr.detectChanges();
            },
            complete: () => {
                this.isSearching = false;
                this.cdr.detectChanges();
            }
        });
    }

    descargarExcel() {
        const filtros = {
            Fecha: this.fecha,
            Id_Tour: this.idTour
        };
        this.segurosService.exportarExcel(filtros);
    }
}
