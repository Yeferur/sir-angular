import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Punto {
  Id_Punto?: number;
  IdPunto?: number;
  NombrePunto?: string; // camelCase used in front
  Nombre_Punto?: string; // snake_case from DB
  Latitud?: string | number;
  Longitud?: string | number;
  Sector?: string;
  Direccion?: string;
  Posicion?: number;
  horarios?: { Id_Tour?: number; HoraSalida?: string; NombreTour?: string }[];
  // client-only UI flags
  _deleting?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class puntosService {
  constructor(private http: HttpClient) { }
  private baseUrl = environment.apiUrl; // ej. 'http://localhost:4000/api'

  // Fetch paginated points. Returns an object with data and total count.
getPuntos(page = 1, limit = 10, q = '') {
  const params: any = { page: String(page), limit: String(limit) };
  if (q.trim()) params.q = q.trim();
  return this.http.get<{ data: Punto[]; total: number }>(`${this.baseUrl}/puntos`, { params });
}


  buscarPuntos(term: string): Observable<any[]> {
    const params = new HttpParams().set('query', term);
    return this.http.get<any[]>(`${this.baseUrl}/puntos/query`, { params });
  }

  buscarPuntosPorDireccion(direccion: string): Observable<any[]> {
    const params = new HttpParams().set('direccion', direccion);
    return this.http.get<any[]>(`${this.baseUrl}/puntos/direccion`, { params });
  }

  obtenerDatosPuntoTour(idPunto: number, idTour: number): Observable<{ HoraSalida: string }> {
  // Ajuste: el endpoint en el backend es '/puntos/horario'
  const params = new HttpParams()
    .set('Id_Punto', idPunto.toString())
    .set('Id_Tour', idTour.toString());
  return this.http.get<{ HoraSalida: string }>(
    `${this.baseUrl}/puntos/horario`,
    { params }
  );
}

  getHorariosPunto(idPunto: number): Observable<{ Id_Tour: number; HoraSalida: string }[]> {
    const params = new HttpParams().set('Id_Punto', idPunto.toString());
    return this.http.get<{ Id_Tour: number; HoraSalida: string }[]>(`${this.baseUrl}/puntos/horarios`, { params });
  }

  crearPunto(punto: Punto): Observable<any> {
    return this.http.post(`${this.baseUrl}/puntos`, punto);
  }

  getPunto(id: number): Observable<Punto> {
    return this.http.get<Punto>(`${this.baseUrl}/puntos/${id}`);
  }

  updatePunto(id: number, punto: Punto): Observable<any> {
    return this.http.put(`${this.baseUrl}/puntos/${id}`, punto);
  }

  deletePunto(id: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/puntos/${id}`);
  }



}