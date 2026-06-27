import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class SegurosService {
    private http   = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/seguros`;

    /* GET /seguros?Fecha=&Id_Tour=
       Devuelve array de buses con sus pasajeros confirmados */
    listarSeguros(filtros: { Fecha: string; Id_Tour: string }): Observable<any[]> {
        const params = new HttpParams()
            .set('Fecha',   filtros.Fecha)
            .set('Id_Tour', filtros.Id_Tour);

        return this.http.get<any>(this.apiUrl, { params }).pipe(
            map((res: any) => res?.data ?? res ?? [])
        );
    }

    /* PATCH /seguros/buses/:id */
    actualizarPersonalBus(
        idBusProg: number,
        campos: { Conductor?: string | null; DNI_Conductor?: string | null; DNI_Guia?: string | null }
    ): Observable<any> {
        return this.http.patch(`${this.apiUrl}/buses/${idBusProg}`, campos);
    }

    /* GET /seguros/exportar  → descarga blob */
    exportarExcel(filtros: { Fecha: string; Id_Tour: string }, nombreTour?: string): void {
        const params = new HttpParams()
            .set('Fecha',   filtros.Fecha)
            .set('Id_Tour', filtros.Id_Tour);

        this.http.get(`${this.apiUrl}/exportar`, { params, responseType: 'blob' })
            .subscribe({
                next: (blob) => {
                    const url = window.URL.createObjectURL(blob);
                    const a   = document.createElement('a');
                    a.href    = url;
                    const tour = nombreTour ? `_${nombreTour}` : '';
                    a.download = `Seguros_${filtros.Fecha}${tour}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                },
                error: (err) => console.error('Error al descargar Excel de seguros', err)
            });
    }
}