import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SeguroFaltante {
  code: 'GUIA' | 'DNI_GUIA' | 'CONDUCTOR' | 'DNI_CONDUCTOR' | 'DOCUMENTO_PASAJERO';
  label: string;
  source: 'programacion' | 'seguros' | 'reserva';
  count?: number;
}

export interface SeguroPasajero {
  Id_Reserva: string;
  Nombre_Reportante?: string | null;
  Id_Pasajero: string | number;
  Nombre_Pasajero: string;
  DNI?: string | null;
  Tipo_Pasajero?: string | null;
}

export interface SeguroBus {
  Id_Bus_Prog: number;
  Placa_Display: string;
  Orden_Bus: number;
  Tipo_Bus: 'grupal' | 'privado';
  Id_Reserva_Privada?: string | null;
  Guia?: string | null;
  DNI_Guia?: string | null;
  Conductor?: string | null;
  DNI_Conductor?: string | null;
  pasajeros: SeguroPasajero[];
  Pasajeros_Sin_Documento: number;
  Total_Asegurados: number;
  Faltantes: SeguroFaltante[];
  Datos_Completos: boolean;
}

export interface SeguroPersonalPayload {
  Placa_Display?: string | null;
  Guia?: string | null;
  Conductor?: string | null;
  DNI_Conductor?: string | null;
  DNI_Guia?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SegurosService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/seguros`;

  listarSeguros(filtros: { Fecha: string; Id_Tour: string }): Observable<SeguroBus[]> {
    const params = new HttpParams()
      .set('Fecha', filtros.Fecha)
      .set('Id_Tour', filtros.Id_Tour);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map(response => (response?.data ?? response ?? []) as SeguroBus[]),
    );
  }

  actualizarPersonalBus(idBusProg: number, campos: SeguroPersonalPayload): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/buses/${idBusProg}`, campos);
  }

  exportarExcel(filtros: { Fecha: string; Id_Tour: string }): Observable<Blob> {
    const params = new HttpParams()
      .set('Fecha', filtros.Fecha)
      .set('Id_Tour', filtros.Id_Tour);
    return this.http.get(`${this.apiUrl}/exportar`, { params, responseType: 'blob' });
  }
}
