import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Historial {
  Id_Historial?: number;
  Id_Usuario?: number;
  Usuario_Nombre?: string;
  Tipo_Accion?: string;
  Descripcion?: string;
  Tabla_Afectada?: string;
  Id_Registro?: number;
  Fecha_Accion?: string;
  IP_Address?: string;
  User_Agent?: string;
}

export interface HistorialResponse {
  data: Historial[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HistorialFilters {
  usuario?: string;
  tipoAccion?: string;
  tablaAfectada?: string;
  fechaInicio?: string;
  fechaFin?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable({
  providedIn: 'root'
})
export class HistorialService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/historial`;

  /**
   * Obtener historial con filtros y paginación
   */
  getHistorial(filters: HistorialFilters): Observable<HistorialResponse> {
    let params = new HttpParams();

    if (filters.usuario) params = params.set('usuario', filters.usuario);
    if (filters.tipoAccion) params = params.set('tipoAccion', filters.tipoAccion);
    if (filters.tablaAfectada) params = params.set('tablaAfectada', filters.tablaAfectada);
    if (filters.fechaInicio) params = params.set('fechaInicio', filters.fechaInicio);
    if (filters.fechaFin) params = params.set('fechaFin', filters.fechaFin);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());

    return this.http.get<HistorialResponse>(this.apiUrl, { params });
  }

  /**
   * Exportar historial a CSV
   */
  exportarHistorial(filters: HistorialFilters): Observable<Blob> {
    let params = new HttpParams();

    if (filters.usuario) params = params.set('usuario', filters.usuario);
    if (filters.tipoAccion) params = params.set('tipoAccion', filters.tipoAccion);
    if (filters.tablaAfectada) params = params.set('tablaAfectada', filters.tablaAfectada);
    if (filters.fechaInicio) params = params.set('fechaInicio', filters.fechaInicio);
    if (filters.fechaFin) params = params.set('fechaFin', filters.fechaFin);

    return this.http.get(`${this.apiUrl}/export`, {
      params,
      responseType: 'blob'
    });
  }

  /**
   * Descargar archivo CSV
   */
  descargarCSV(blob: Blob, nombreArchivo: string = `historial-${new Date().toISOString().split('T')[0]}.csv`): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
