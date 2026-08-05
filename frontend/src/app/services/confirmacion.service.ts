import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PasajeroControlViaje {
  Id_Pasajero: number;
  Id_Reserva: string;
  Nombre_Pasajero: string;
  DNI: string | null;
  Telefono_Pasajero: string | null;
  Tipo_Pasajero: 'ADULTO' | 'NINO' | 'INFANTE';
  Confirmacion: 0 | 1;
  Telefono_Reportante: string | null;
  Nombre_Reportante: string | null;
  Nombre_Canal: string | null;
  PuntoEncuentro: string | null;
}

export interface ActualizarControlViajePayload {
  Id_Tour: number;
  Fecha: string;
  pasajeros: Array<{ Id_Pasajero: number; Confirmacion: 0 | 1 }>;
}

export interface JornadaConfirmacion {
  Id_Tour: number;
  Nombre_Tour: string;
  Total_Pasajeros: number;
  Total_Comisionables: number;
  Total_Viajaron: number;
  Total_No_Viajaron: number;
  Confirmada: boolean;
  Requiere_Confirmacion: boolean;
  Cambio_Cantidad: boolean;
  Confirmada_En: string | null;
  Confirmada_Por: number | null;
}

export interface EstadoConfirmacion {
  Fecha: string;
  Total_Jornadas: number;
  Jornadas_Pendientes: number;
  Total_Pasajeros: number;
  jornadas: JornadaConfirmacion[];
}

export interface ResultadoConfirmacion {
  updated: number;
  confirmed: boolean;
  totalPasajeros: number;
  totalViajaron: number;
  totalNoViajaron: number;
}

@Injectable({ providedIn: 'root' })
export class ConfirmacionService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/confirmacion`;

  getPasajeros(idTour: number, fecha: string): Observable<PasajeroControlViaje[]> {
    return this.http.get<PasajeroControlViaje[]>(`${this.apiUrl}/pasajeros`, {
      params: { Id_Tour: String(idTour), Fecha: fecha },
    });
  }

  getEstado(fecha: string, idTour?: number | string | null): Observable<EstadoConfirmacion> {
    const params: Record<string, string> = { Fecha: fecha };
    if (idTour !== null && idTour !== undefined && String(idTour).trim()) {
      params['Id_Tour'] = String(idTour);
    }
    return this.http.get<unknown>(`${this.apiUrl}/estado`, { params }).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  saveConfirmacion(payload: ActualizarControlViajePayload): Observable<ResultadoConfirmacion> {
    return this.http.put<unknown>(`${this.apiUrl}/update`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }
}
