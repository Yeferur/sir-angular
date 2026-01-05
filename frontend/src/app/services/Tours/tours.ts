import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Tour {
  Id_Tour?: number;
  Nombre_Tour: string;
  Abreviacion?: string;
  Comision_Hotel?: number;
  Comision_Agencia?: number;
  Comision_Freelance?: number;
  Cupo_Base?: number;
  Latitud?: number;
  Longitud?: number;
  Id_Tour_Origen?: number; // Tour del cual copiar horarios
}

export interface PreciosMap {
  [key: string]: number;
}

@Injectable({
  providedIn: 'root'
})
export class Tours {
  private apiUrl = environment.apiUrl; // Ajusta si tu endpoint es diferente

  constructor(private http: HttpClient) {}

  getTours(): Observable<Tour[]> {
    return this.http.get<Tour[]>(`${this.apiUrl}/tours`);
  }

  getTourById(id: number | string): Observable<Tour> {
    return this.http.get<Tour>(`${this.apiUrl}/tours/${id}`);
  }

  crearTour(tour: Tour): Observable<any> {
    return this.http.post(`${this.apiUrl}/tours`, tour);
  }

  updateTour(id: number | string, tour: Partial<Tour>): Observable<any> {
    return this.http.put(`${this.apiUrl}/tours/${id}`, tour);
  }

  deleteTour(id: number | string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/tours/${id}`);
  }
  
  getPrecios(params: { Id_Tour: number; Id_Plan?: number | null; Id_Moneda?: number | null }): Observable<any> {
    let httpParams = new HttpParams();
    if (params.Id_Plan != null) httpParams = httpParams.set('Id_Plan', String(params.Id_Plan));
    if (params.Id_Moneda != null) httpParams = httpParams.set('Id_Moneda', String(params.Id_Moneda));
    return this.http.get(`${this.apiUrl}/tours/${params.Id_Tour}/precios`, { params: httpParams });
  }
  
  updatePrecios(Id_Tour: number | string, payload: { Id_Plan?: number | null; Id_Moneda?: number | null; precios: PreciosMap }): Observable<any> {
    return this.http.put(`${this.apiUrl}/tours/${Id_Tour}/precios`, payload);
  }
}
