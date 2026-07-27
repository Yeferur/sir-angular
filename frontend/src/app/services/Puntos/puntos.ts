import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Punto {
  Id_Punto?: number;
  IdPunto?: number;
  NombrePunto?: string; // camelCase used in front
  Nombre_Punto?: string; // snake_case from DB
  ruta?: string;
  posicion?: number;
  Latitud?: string | number;
  Longitud?: string | number;
  Sector?: string;
  Direccion?: string;
  Posicion?: number;
  Activo?: number | boolean;
  EsProtegido?: boolean;
  Id_Punto_Anterior?: number | null;
  horarios?: { Id_Tour?: number; HoraSalida?: string; NombreTour?: string }[];
  // client-only UI flags
  _deleting?: boolean;
  _operatividad?: EstadoOperatividadPunto;
}

export interface EstadoOperatividadPunto {
  Id_Punto: number;
  estado: 'OPERATIVO' | 'NO_OPERATIVO' | 'SIN_COORDENADAS' | 'NO_VERIFICADO';
  distanciaViaMetros?: number;
  mensaje: string;
}

export interface OrdenPuntoItem {
  id_punto: number;
  posicion: number;
}

@Injectable({
  providedIn: 'root'
})
export class puntosService {
  constructor(private http: HttpClient) { }
  private baseUrl = environment.apiUrl; // ej. 'http://localhost:4000/api'

  // Fetch paginated points. Returns the normalized page selected by the server.
  getPuntos(page = 1, limit = 10, q = '', ruta = '') {
    const params: any = { page: String(page), limit: String(limit) };
    if (q.trim()) params.q = q.trim();
    if (ruta.trim()) params.ruta = ruta.trim();
    return this.http.get<{ data: Punto[]; total: number; page?: number; limit?: number }>(
      `${this.baseUrl}/puntos`,
      { params }
    );
  }

  exportarExcel(q = '', ruta = ''): Observable<Blob> {
    const params: any = {};
    if (q.trim()) params.q = q.trim();
    if (ruta.trim()) params.ruta = ruta.trim();
    return this.http.get(`${this.baseUrl}/puntos/exportar`, { params, responseType: 'blob' });
  }


  buscarPuntos(term: string): Observable<any[]> {
    const params = new HttpParams().set('query', term);
    return this.http.get<any[]>(`${this.baseUrl}/puntos/query`, { params });
  }

  getRutasPuntos(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/puntos/rutas`);
  }

  getPuntosPorRuta(ruta: string): Observable<Punto[]> {
    return this.http.get<Punto[]>(`${this.baseUrl}/puntos/rutas/${encodeURIComponent(ruta)}`);
  }

  updateOrdenPuntosPorRuta(ruta: string, orden: OrdenPuntoItem[]): Observable<any> {
    return this.http.put(`${this.baseUrl}/puntos/rutas/${encodeURIComponent(ruta)}/orden`, { orden });
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

  getOperatividadPuntosPorRuta(ruta: string): Observable<EstadoOperatividadPunto[]> {
    return this.http.get<EstadoOperatividadPunto[]>(
      `${this.baseUrl}/puntos/rutas/${encodeURIComponent(ruta)}/operatividad`
    );
  }

  validarCoordenadas(Latitud: number, Longitud: number): Observable<{
    valida: boolean;
    distanciaViaMetros: number;
    coordenadasAjustadas: [number, number];
  }> {
    return this.http.post<any>(`${this.baseUrl}/puntos/validar-coordenadas`, { Latitud, Longitud });
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
