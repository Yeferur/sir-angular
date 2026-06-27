import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ComisionesService {
    private apiUrl = `${environment.apiUrl}/comisiones`;

    constructor(private http: HttpClient) {}

    listarComisiones(filtros: {
        Fecha?:             string;
        Id_Tour?:           string;
        Id_Canal?:          string;
        Estado?:            string;
        Nombre_Reportante?: string;
    }): Observable<any[]> {
        let params = new HttpParams();
        if (filtros.Fecha)             params = params.set('Fecha',             filtros.Fecha);
        if (filtros.Id_Tour)           params = params.set('Id_Tour',           filtros.Id_Tour);
        if (filtros.Id_Canal)          params = params.set('Id_Canal',          filtros.Id_Canal);
        if (filtros.Estado)            params = params.set('Estado',            filtros.Estado);
        if (filtros.Nombre_Reportante) params = params.set('Nombre_Reportante', filtros.Nombre_Reportante);

        return this.http.get<any>(this.apiUrl, { params }).pipe(
            map(res => res?.data ?? res ?? [])
        );
    }

    /**
     * Actualiza el Estado_Liquidacion de un conjunto de reservas.
     * También persiste Forma_Pago y Cuenta_Bancaria si se suministran,
     * para el caso en que se marque como PAGADO por primera vez.
     *
     * PUT /comisiones/liquidacion/estado
     */
    actualizarLiquidacion(payload: {
        reservas:         string[];
        Estado:           'PENDIENTE' | 'PAGADO';
        Forma_Pago?:      string | null;
        Cuenta_Bancaria?: string | null;
    }): Observable<any> {
        return this.http.put<any>(`${this.apiUrl}/liquidacion/estado`, payload).pipe(
            map(res => res?.data ?? res)
        );
    }

    /**
     * Actualiza SOLO los datos de pago (Forma_Pago / Cuenta_Bancaria)
     * sin tocar el Estado_Liquidacion.
     *
     * PUT /comisiones/liquidacion/pago
     */
    actualizarDatosPago(payload: {
        reservas:         string[];
        Forma_Pago:       string;
        Cuenta_Bancaria:  string | null;
    }): Observable<any> {
        return this.http.put<any>(`${this.apiUrl}/liquidacion/pago`, payload).pipe(
            map(res => res?.data ?? res)
        );
    }

    exportarExcel(filtros: {
        Fecha?:    string;
        Id_Tour?:  string;
        Id_Canal?: string;
        Estado?:   string;
    }): void {
        let params = new HttpParams();
        if (filtros.Fecha)    params = params.set('Fecha',    filtros.Fecha);
        if (filtros.Id_Tour)  params = params.set('Id_Tour',  filtros.Id_Tour);
        if (filtros.Id_Canal) params = params.set('Id_Canal', filtros.Id_Canal);
        if (filtros.Estado)   params = params.set('Estado',   filtros.Estado);

        this.http.get(`${this.apiUrl}/exportar`, { params, responseType: 'blob' }).subscribe({
            next: (blob) => {
                const url  = window.URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = `Comisiones_${filtros.Fecha || 'todas'}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            },
            error: (err) => console.error('Error al descargar Excel', err)
        });
    }
}