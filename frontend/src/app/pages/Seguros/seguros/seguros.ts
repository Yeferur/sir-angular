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
    loading: boolean = false;

    ngOnInit() {
        this.cargarTours();
        this.buscar();
    }

    cargarTours() {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.tours = data;
                this.cdr.detectChanges();
            },
            error: (err: any) => console.error('Error cargando tours', err)
        });
    }

    buscar() {
        this.loading = true;
        const filtros = {
            Fecha: this.fecha,
            Id_Tour: this.idTour
        };

        this.segurosService.listarSeguros(filtros).subscribe({
            next: (data: any[]) => {
                this.seguros = data;
                this.loading = false;
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error buscando seguros', err);
                this.loading = false;
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
