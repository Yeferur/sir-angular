import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ListadoGeneralFilters {
  fechaTour: string;
  fechaTourDesde: string;
  fechaTourHasta: string;
  tours: number[];
  rutas: string[];
  estados: string[];
  canales: number[];
}

export interface ListadoGeneralOptions {
  tours: Array<{ Id_Tour: number; Nombre_Tour: string; Activo: number | boolean }>;
  rutas: Array<{ Ruta: string }>;
  canales: Array<{ Id_Canal: number; Nombre_Canal: string }>;
  estados: Array<{ value: string; label: string }>;
}

export interface ListadoGeneralItem {
  Id_Reserva: string;
  Fecha_Tour: string | null;
  Nombre_Tour: string | null;
  Estado: string | null;
  Nombre_Canal: string | null;
  Nombre_Reportante: string | null;
  NumeroPasajeros: number;
  Rutas: string | null;
}

export interface ListadoGeneralResult {
  items: ListadoGeneralItem[];
  totalReservas: number;
  totalPasajeros: number;
  limite: number;
}

export type ListadoGeneralReportType = 'reservas_grupales_privadas' | 'reservas_grupales' | 'reservas_privadas' | 'transfers';

@Injectable({ providedIn: 'root' })
export class ListadoGeneralService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly baseUrl = `${this.apiUrl}/programacion/listado-general`;

  obtenerOpciones(): Observable<ListadoGeneralOptions> {
    return this.http.get<any>(`${this.baseUrl}/opciones`).pipe(
      map(response => (response?.data ?? response) as ListadoGeneralOptions),
    );
  }

  consultar(
    filters: ListadoGeneralFilters,
    format: 'tradicional' | 'nuevo' | 'masivo',
    reportType: Exclude<ListadoGeneralReportType, 'transfers'>,
  ): Observable<ListadoGeneralResult> {
    return this.http.post<any>(`${this.baseUrl}/consultar`, { filters, format, reportType }).pipe(
      map(response => (response?.data ?? response) as ListadoGeneralResult),
    );
  }

  exportar(
    filters: ListadoGeneralFilters,
    format: 'tradicional' | 'nuevo' | 'masivo',
    reportType: Exclude<ListadoGeneralReportType, 'transfers'>,
  ): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.baseUrl}/exportar`, { filters, format, reportType }, {
      observe: 'response',
      responseType: 'blob',
    });
  }
}
