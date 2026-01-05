import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProgramacionService {
  private apiUrl = environment.apiUrl; // Cambia por tu URL real

  constructor(private http: HttpClient) {}

  obtenerListado(fecha: string, idTour: number): Observable<any> {
    const params = new HttpParams()
      .set('fecha', fecha)
      .set('tour', idTour.toString());
       const url = `${this.apiUrl}/listado-buses`;

    return this.http.get<any>(url, { params });
  }
  generarListadoDesdeCombinacion(fecha: string, idTour: number, combinacion: any): Observable<any> {
 const params = new HttpParams()
      .set('fecha', fecha)
      .set('tour', idTour.toString())
      .set('combinacion', JSON.stringify(combinacion));
       const url = `${this.apiUrl}/listado-buses/manual`;

    return this.http.get<any>(url, { params });
}


  guardarProgramacion(listado: any) {
  return this.http.post('/api/listados/update', listado);
}

}
