import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ComisionesService {

    private apiUrl = `${environment.apiUrl}/comisiones`;

    constructor(private http: HttpClient) { }

    listarComisiones(filtros: any): Observable<any[]> {
        let params = new HttpParams();
        if (filtros.Fecha) params = params.set('Fecha', filtros.Fecha);
        if (filtros.Id_Tour) {
            // If it is an array, we append multiple times or csv? 
            // Standard Angular HttpParams supports array values if we pass array to set or append?
            // `set` replaces. `append` adds.
            // Let's treat it simple. Backend expects 'Id_Tour' with multiple values or one.
            // If frontend sends an array, it should be handled.
            if (Array.isArray(filtros.Id_Tour)) {
                filtros.Id_Tour.forEach((id: any) => {
                    params = params.append('Id_Tour', id);
                });
            } else {
                params = params.set('Id_Tour', filtros.Id_Tour);
            }
        }

        return this.http.get<any[]>(this.apiUrl, { params });
    }

    exportarExcel(filtros: any, nombreTour?: string): void {
        let params = new HttpParams();
        if (filtros.Fecha) params = params.set('Fecha', filtros.Fecha);
        if (filtros.Id_Tour) {
            if (Array.isArray(filtros.Id_Tour)) {
                filtros.Id_Tour.forEach((id: any) => {
                    params = params.append('Id_Tour', id);
                });
            } else {
                params = params.set('Id_Tour', filtros.Id_Tour);
            }
        }

        this.http.get(`${this.apiUrl}/exportar`, { params, responseType: 'blob' })
            .subscribe({
                next: (blob) => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const datePart = filtros.Fecha ? ` ${filtros.Fecha}` : '';
                    const tourPart = nombreTour ? ` ${nombreTour}` : '';
                    a.download = `Comisiones${datePart}${tourPart}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                },
                error: (err) => console.error('Error al descargar Excel', err)
            });
    }
}
