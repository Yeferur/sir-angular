import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export type FormaPagoComision = 'TRANSFERENCIA_BANCOLOMBIA' | 'NEQUI' | 'EFECTIVO';
export type EstadoLiquidacion = 'PENDIENTE' | 'PAGADO';
export type TipoEntidadComision = 'HOTEL' | 'AGENCIA_NACIONAL' | 'AGENCIA_INTERNACIONAL';

export interface ComisionPasajero {
  Id_Pasajero: number;
  Nombre_Pasajero: string;
  DNI: string | null;
  Tipo_Pasajero: string | null;
  Comision: number;
}

export interface ComisionReserva {
  Id_Reserva: string;
  Fecha_Tour: string;
  Nombre_Reportante?: string | null;
  Telefono_Reportante?: string | null;
  Id_Tour: number;
  Nombre_Tour: string;
  Tipo_Reserva: string | null;
  Num_Pasajeros: number;
  Total_Comision: number;
  Monto_Comision_Pagada?: number | null;
  Comision_Minima: number | null;
  Comision_Maxima: number | null;
  Estado_Liquidacion: EstadoLiquidacion;
  Forma_Pago: FormaPagoComision | null;
  Cuenta_Bancaria: string | null;
  Nombre_Receptor: string | null;
  DNI_Receptor: string | null;
  Fecha_Pago: string | null;
  pasajeros: ComisionPasajero[];
}

/** A payment group returned by the Comisiones API. Hotel/agency identity is the entity; Freelance identity is its reservation. */
export interface ComisionGrupo {
  Id_Entidad_Reportante: number | null;
  Id_Perfil_Comision: number | null;
  Tipo_Entidad: TipoEntidadComision | null;
  Nombre_Entidad: string | null;
  Nombre_Reportante: string | null;
  Telefono: string | null;
  Forma_Pago: FormaPagoComision | null;
  Cuenta_Bancaria: string | null;
  Nombre_Receptor: string | null;
  DNI_Receptor: string | null;
  Total_Reportante: number;
  Pendiente_Reportante: number;
  Pagado_Reportante: number;
  reservas: ComisionReserva[];
}

export interface ComisionCanal {
  Id_Canal: number;
  Nombre_Canal: string;
  Total_Canal: number;
  Pendiente_Canal: number;
  Pagado_Canal: number;
  grupos: ComisionGrupo[];
}

export interface PerfilComisionEntidad {
  Id_Perfil_Comision: number;
  Id_Entidad_Reportante: number;
  Tipo_Entidad: TipoEntidadComision;
  Nombre_Entidad: string;
  Forma_Pago: FormaPagoComision | null;
  Numero_Cuenta: string | null;
  Nombre_Receptor: string | null;
  DNI_Receptor: string | null;
  Activo: number;
}

export interface PerfilComisionEntidadPayload {
  Id_Perfil_Comision?: number;
  Id_Entidad_Reportante: number;
  Forma_Pago: FormaPagoComision;
  Numero_Cuenta: string | null;
  Nombre_Receptor: string;
  DNI_Receptor: string;
}

export interface FiltrosComisiones {
  Fecha: string;
  Id_Tour?: string;
  Id_Canal?: string;
  Estado?: EstadoLiquidacion | '';
  Nombre_Reportante?: string;
}

export interface GrupoPagoComision {
  reservas: string[];
  Forma_Pago: FormaPagoComision | null;
  Cuenta_Bancaria: string | null;
  Nombre_Receptor: string | null;
  DNI_Receptor: string | null;
}

@Injectable({ providedIn: 'root' })
export class ComisionesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/comisiones`;

  listarComisiones(filtros: FiltrosComisiones): Observable<ComisionCanal[]> {
    return this.http.get<unknown>(this.apiUrl, { params: this.params(filtros) }).pipe(
      map((response: any) => {
        const channels = response?.data ?? response ?? [];
        if (!Array.isArray(channels)) return [];
        return channels.map((channel: any) => ({
          Id_Canal: Number(channel.Id_Canal),
          Nombre_Canal: String(channel.Nombre_Canal || ''),
          Total_Canal: Number(channel.Total_Canal || 0),
          Pendiente_Canal: Number(channel.Pendiente_Canal || 0),
          Pagado_Canal: Number(channel.Pagado_Canal || 0),
          grupos: Array.isArray(channel.reportantes) ? channel.reportantes.map((group: any) => ({
            Id_Entidad_Reportante: group.Id_Entidad_Reportante == null ? null : Number(group.Id_Entidad_Reportante),
            Id_Perfil_Comision: group.Id_Perfil_Comision == null ? null : Number(group.Id_Perfil_Comision),
            Tipo_Entidad: group.Tipo_Entidad ?? null,
            Nombre_Entidad: group.Nombre_Entidad ?? null,
            Nombre_Reportante: group.Nombre_Reportante ?? null,
            Telefono: group.Telefono ?? null,
            Forma_Pago: group.Forma_Pago ?? null,
            Cuenta_Bancaria: group.Cuenta_Bancaria ?? null,
            Nombre_Receptor: group.Nombre_Receptor ?? null,
            DNI_Receptor: group.DNI_Receptor ?? null,
            Total_Reportante: Number(group.Total_Reportante || 0),
            Pendiente_Reportante: Number(group.Pendiente_Reportante || 0),
            Pagado_Reportante: Number(group.Pagado_Reportante || 0),
            reservas: Array.isArray(group.reservas) ? group.reservas.map((reservation: any) => ({
              ...reservation,
              Monto_Comision_Pagada: reservation.Monto_Comision_Pagada == null
                ? null
                : Number(reservation.Monto_Comision_Pagada),
            })) : [],
          })) : [],
        }));
      }),
    );
  }

  obtenerPerfilEntidad(idEntidad: number): Observable<PerfilComisionEntidad | null> {
    return this.http.get<unknown>(`${this.apiUrl}/perfiles-entidad/${encodeURIComponent(idEntidad)}`).pipe(
      map((response: any) => response?.data ?? response ?? null),
    );
  }

  crearPerfilEntidad(payload: PerfilComisionEntidadPayload): Observable<PerfilComisionEntidad> {
    return this.http.post<unknown>(`${this.apiUrl}/perfiles-entidad`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  actualizarPerfilEntidad(payload: PerfilComisionEntidadPayload): Observable<PerfilComisionEntidad> {
    return this.http.put<unknown>(`${this.apiUrl}/perfiles-entidad`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  actualizarLiquidacion(payload: GrupoPagoComision & { Estado: EstadoLiquidacion }): Observable<{ updated: number; montos?: Record<string, number> }> {
    return this.http.put<unknown>(`${this.apiUrl}/liquidacion/estado`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  actualizarLiquidacionesLote(payload: { Estado: EstadoLiquidacion; pagos: GrupoPagoComision[] }): Observable<{ updated: number }> {
    return this.http.put<unknown>(`${this.apiUrl}/liquidacion/lote`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  actualizarDatosPago(payload: GrupoPagoComision): Observable<{ updated: number }> {
    return this.http.put<unknown>(`${this.apiUrl}/liquidacion/pago`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  exportarExcel(filtros: FiltrosComisiones): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/exportar`, {
      params: this.params(filtros),
      responseType: 'blob',
    });
  }

  private params(filtros: FiltrosComisiones): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filtros)) {
      const normalized = String(value ?? '').trim();
      if (normalized) params = params.set(key, normalized);
    }
    return params;
  }
}
