import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ConfirmacionService {
    private apiUrl = `${environment.apiUrl}/confirmacion`;

    constructor(private http: HttpClient) { }

    getPasajeros(idTour: number, fecha: string): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/pasajeros`, {
            params: { Id_Tour: idTour.toString(), Fecha: fecha }
        });
    }

    saveConfirmacion(pasajeros: any[]): Observable<any> {
        return this.http.put(`${this.apiUrl}/update`, { pasajeros });
    }
}
