import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface HistorialDetalle {
  columna: string;
  anterior: string | null;
  nuevo: string | null;
}

export interface Historial {
  Id_Historial: number;
  Id_Usuario: number | null;
  Usuario_Nombre: string;
  Actor_Nombre: string | null;
  Actor_Rol: string | null;
  Tipo_Accion: string;
  Descripcion: string;
  Tabla_Afectada: string;
  Modulo: string;
  Id_Registro: string | number | null;
  Fecha_Accion: string;
  Detalles: HistorialDetalle[];
}

export interface HistorialResponse {
  data: Historial[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HistorialUserOption { id: number; label: string; }
export interface HistorialOption { value: string; label: string; actividad?: string; }
export interface HistorialFilterOptions {
  usuarios: HistorialUserOption[];
  acciones: HistorialOption[];
  actividades: HistorialOption[];
  modulos: HistorialOption[];
}

export interface HistorialFilters {
  usuarios?: number[];
  actividad?: string[];
  modulos?: string[];
  referencia?: string;
  fechaInicio?: string;
  fechaFin?: string;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class HistorialService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/historial`;

  getFilterOptions(): Observable<HistorialFilterOptions> {
    return this.http.get<HistorialFilterOptions>(`${this.apiUrl}/options`);
  }

  getHistorial(filters: HistorialFilters): Observable<HistorialResponse> {
    return this.http.get<HistorialResponse>(this.apiUrl, { params: this.toParams(filters, true) });
  }

  exportarHistorial(filters: HistorialFilters): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/export`, { params: this.toParams(filters, false), responseType: 'blob' });
  }

  descargarExcel(blob: Blob, nombreArchivo = `historial-${this.todayBogota()}.xlsx`): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  private toParams(filters: HistorialFilters, includePage: boolean): HttpParams {
    let params = new HttpParams();
    if (filters.referencia) params = params.set('referencia', filters.referencia);
    if (filters.fechaInicio && filters.fechaFin) {
      params = params.set('desde', filters.fechaInicio).set('hasta', filters.fechaFin);
    }
    for (const id of filters.usuarios || []) params = params.append('usuarios', String(id));
    for (const activity of filters.actividad || []) params = params.append('actividad', activity);
    for (const module of filters.modulos || []) params = params.append('modulos', module);
    if (includePage) {
      params = params.set('page', String(filters.page || 1)).set('limit', String(filters.limit || 10));
    }
    return params;
  }

  private todayBogota(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
}
