import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export type TipoEntidad = 'HOTEL' | 'AGENCIA_NACIONAL' | 'AGENCIA_INTERNACIONAL';
export type ValidacionEntidad = 'PENDIENTE_VALIDACION' | 'VALIDADA' | 'RECHAZADA';
export interface FiltrosEntidades {
  desde: string; hasta: string; tipo: string; validacion: string;
  estado: string; actividad: string; buscar: string; diasSinReportarMin?: string;
  ordenarPor?: string; orden?: 'ASC' | 'DESC';
}
export interface ActividadEntidad {
  Id_Entidad_Reportante: number; Tipo: TipoEntidad; Nombre: string; Activo: number;
  Estado_Validacion: ValidacionEntidad; Fecha_Creacion: string; Creador?: string;
  Reservas: number; Transfers: number; Operaciones: number; Pasajeros: number;
  Primera_Reserva: string | null; Ultima_Reserva: string | null; Dias_Sin_Reportar: number | null;
  Primera_Actividad: string | null; Ultima_Actividad: string | null; Ultimo_Reporte: string | null;
  Contacto_Reciente: string | null;
}
export interface PaginaEntidades {
  items: ActividadEntidad[];
  summary: { Total_Entidades: number; Con_Reservas: number; Sin_Reservas: number;
    Con_Actividad: number; Sin_Actividad: number; Pendientes: number; Total_Reservas: number;
    Total_Transfers: number; Total_Operaciones: number; Total_Pasajeros: number };
  page: number; pageSize: number; totalPages: number; total: number;
  umbralDiasSinReportar: number; ordenarPor: string; orden: 'ASC' | 'DESC';
}
export interface DetalleEntidad {
  entity: Pick<ActividadEntidad, 'Id_Entidad_Reportante' | 'Tipo' | 'Nombre' | 'Activo'
    | 'Estado_Validacion' | 'Fecha_Creacion'> & {
      Creado_Por: number | null; Creador: string | null; Motivo_Rechazo?: string | null;
    };
  historic: { Reservas: number; Transfers: number; Operaciones: number; Pasajeros: number;
    Primera_Reserva: string | null; Ultima_Reserva: string | null; Dias_Sin_Reportar: number | null;
    Primera_Actividad: string | null; Ultima_Actividad: string | null };
  period: { Reservas: number; Transfers: number; Operaciones: number; Pasajeros: number };
  contacts: { Nombre: string; Telefono: string | null; Reservas: number; Ultimo_Reporte: string }[];
  observed: { Id_Punto: number; Nombre_Punto: string; Reservas: number }[];
  associated: { Id_Punto: number; Nombre_Punto: string; Estado_Validacion: string }[];
}

export interface ResultadoValidacionEntidad {
  Id_Entidad_Reportante: number;
  Estado_Validacion: ValidacionEntidad;
  Activo: number;
  Motivo_Rechazo: string | null;
  warning: string | null;
  reservasAfectadas: number;
  transfersAfectados: number;
}

@Injectable({ providedIn: 'root' })
export class EntidadesReportantesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/entidades-reportantes`;
  private params(filters: FiltrosEntidades): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) if (value) params = params.set(key, value);
    return params;
  }
  activity(filters: FiltrosEntidades, page = 1) {
    return this.http.get<PaginaEntidades>(`${this.url}/actividad`, {
      params: this.params(filters).set('page', page).set('pageSize', 25),
    });
  }
  search(tipo: TipoEntidad, nombre: string) {
    return this.http.get<ActividadEntidad[]>(this.url, { params: new HttpParams()
      .set('tipo', tipo).set('buscar', nombre).set('limite', 20).set('incluirInactivas', '1') });
  }
  detail(id: number, filters: FiltrosEntidades) {
    return this.http.get<DetalleEntidad>(`${this.url}/${id}`, { params: this.params(filters) });
  }
  create(Tipo: TipoEntidad, Nombre: string) {
    return this.http.post<DetalleEntidad>(this.url, { Tipo, Nombre });
  }
  update(id: number, changes: { Nombre?: string; Tipo?: TipoEntidad; Activo?: number }) {
    return this.http.patch<ActividadEntidad>(`${this.url}/${id}`, changes);
  }
  validate(id: number, state: ValidacionEntidad, reason = '') {
    return this.http.patch<ResultadoValidacionEntidad>(`${this.url}/${id}/validacion`, {
      Estado_Validacion: state, Motivo_Rechazo: state === 'RECHAZADA' ? reason : undefined,
    });
  }
  point(id: number, pointId: number, associated: boolean) {
    const url = `${this.url}/${id}/puntos/${pointId}`;
    return associated ? this.http.put(url, {}) : this.http.delete(url);
  }
  export(filters: FiltrosEntidades) {
    return this.http.get(`${this.url}/exportar`, { params: this.params(filters), responseType: 'blob' });
  }
}
