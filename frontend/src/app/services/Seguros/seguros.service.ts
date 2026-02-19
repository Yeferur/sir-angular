import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class SegurosService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/seguros`;

    listarSeguros(filtros: any): Observable<any[]> {
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
                    a.download = `Seguros${datePart}${tourPart}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                },
                error: (err) => console.error('Error al descargar Excel', err)
            });
    }
}
