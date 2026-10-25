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

export interface GrupoComisionDia {
  Id: string;
  Id_Entidad_Reportante: number;
  Nombre_Entidad: string;
  Tipo_Entidad: TipoEntidadComision;
  Fecha_Tour: string;
  Estado: EstadoLiquidacion;
  Cantidad_Reservas: number;
  Cantidad_Reservas_Actuales: number;
  Cantidad_Reservas_Pendientes: number;
  Cantidad_Reservas_Pagadas: number;
  Total_A_Comisionar: number;
  Monto_Pendiente: number;
  Monto_Pagado: number;
  Tiene_Ajuste_Pendiente: boolean | number;
  Entidad_Inactiva: boolean;
  Entidad_Pendiente_Validacion: boolean;
  Estado_Validacion_Entidad: string;
  Puede_Pagar: boolean;
  Motivo_No_Pagable: string | null;
  Ultimo_Id_Grupo_Pagado: string | number | null;
  Cantidad_Lotes: number;
  Cantidad_Lotes_Pagados: number;
}

export interface ReservaSinEntidadComision {
  Id_Reserva: string;
  Fecha_Tour: string;
  Tipo_Entidad: TipoEntidadComision;
  Nombre_Reportante: string | null;
  Nombre_Tour: string | null;
  Cantidad_Pasajeros: number;
  Monto_Comision: number;
}

export interface PaginaComision {
  pagina: number;
  limite: number;
  total: number;
  paginas: number;
}

export interface ResultadoGruposComision {
  grupos: GrupoComisionDia[];
  paginacion: PaginaComision;
  pendientesPorAsociarEntidad: { reservas: ReservaSinEntidadComision[]; paginacion: PaginaComision };
}

export interface DetalleGrupoComision {
  grupo: {
    Id: string;
    Id_Entidad_Reportante: number;
    Nombre_Entidad: string;
    Tipo_Entidad: TipoEntidadComision;
    Fecha_Tour: string;
    Entidad_Activa: boolean;
    Estado_Validacion: string;
  };
  reservasPendientes: Array<{
    Id_Reserva: string;
    Fecha_Tour: string;
    Nombre_Tour: string | null;
    Monto_Comision: number;
  }>;
  paginacionReservasPendientes: PaginaComision | null;
  lotes: Array<{
    Id_Grupo_Comision: string;
    Numero_Lote: number;
    Estado: 'PAGADO' | 'ANULADO';
    Fecha_Pago: string | null;
    Monto_Pagado: number | null;
    Cantidad_Reservas_Pagadas: number | null;
    Comprobante_Nombre_Original: string | null;
    Comprobante_Mime_Type: string | null;
    Comprobante_Tamano_Bytes: number | null;
    Tiene_Comprobante: boolean;
    Motivo_Anulacion: string | null;
  }>;
  loteDetalle?: {
    Id_Grupo_Comision: string;
    Numero_Lote: number;
    Estado: 'PAGADO' | 'ANULADO';
    reservas: Array<{
      Id_Reserva: string;
      Fecha_Tour: string;
      Nombre_Tour: string | null;
      Monto_Comision_Pagada: number;
    }>;
    paginacion: PaginaComision;
  };
}

export interface FiltrosGruposComision {
  desde?: string;
  hasta?: string;
  Id_Entidad_Reportante?: string;
  Tipo?: TipoEntidadComision | '';
  Estado?: EstadoLiquidacion | '';
  q?: string;
  page?: number;
  limit?: number;
  unlinkedPage?: number;
}

export interface PagoGrupoComisionPayload {
  Monto_Pendiente_Esperado: number;
  Cantidad_Reservas_Pendientes_Esperada: number;
  Forma_Pago?: FormaPagoComision | null;
  Cuenta_Bancaria?: string | null;
  Nombre_Receptor?: string | null;
  DNI_Receptor?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ComisionesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/comisiones`;
  private readonly gruposApiUrl = `${this.apiUrl}/grupos`;
  private readonly pendingProfileSaves = new Map<number, { payload: PerfilComisionEntidadPayload; message: string }>();

  recordarPerfilPendiente(payload: PerfilComisionEntidadPayload, message: string): void {
    this.pendingProfileSaves.set(payload.Id_Entidad_Reportante, { payload: { ...payload }, message });
  }

  obtenerPerfilPendiente(idEntidad: number): { payload: PerfilComisionEntidadPayload; message: string } | null {
    return this.pendingProfileSaves.get(idEntidad) || null;
  }

  olvidarPerfilPendiente(idEntidad: number): void {
    this.pendingProfileSaves.delete(idEntidad);
  }

  listarGrupos(filtros: FiltrosGruposComision = {}): Observable<ResultadoGruposComision> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filtros)) {
      if (value !== undefined && value !== null && String(value).trim()) params = params.set(key, String(value));
    }
    return this.http.get<unknown>(this.gruposApiUrl, { params }).pipe(
      map((response: any) => (response?.data ?? response) as ResultadoGruposComision),
    );
  }

  obtenerDetalleGrupo(id: string, page = 1, limit = 25, loteId?: string): Observable<DetalleGrupoComision> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (loteId) params = params.set('loteId', loteId);
    return this.http.get<unknown>(`${this.gruposApiUrl}/${encodeURIComponent(id)}/reservas`, { params }).pipe(
      map((response: any) => (response?.data ?? response) as DetalleGrupoComision),
    );
  }

  marcarGrupoPagado(id: string, payload: PagoGrupoComisionPayload, comprobante?: File | null) {
    if (comprobante) {
      const body = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null) body.append(key, String(value));
      }
      body.append('comprobante', comprobante, comprobante.name);
      return this.http.put<unknown>(`${this.gruposApiUrl}/${encodeURIComponent(id)}/pago`, body).pipe(
        map((response: any) => response?.data ?? response),
      );
    }
    return this.http.put<unknown>(`${this.gruposApiUrl}/${encodeURIComponent(id)}/pago`, payload).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  anularLote(id: string, motivo: string) {
    return this.http.put<unknown>(`${this.gruposApiUrl}/lotes/${encodeURIComponent(id)}/anulacion`, { Motivo: motivo }).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  subirComprobanteLote(id: string, comprobante: File) {
    const body = new FormData();
    body.append('comprobante', comprobante, comprobante.name);
    return this.http.post<unknown>(`${this.gruposApiUrl}/lotes/${encodeURIComponent(id)}/comprobante`, body).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  descargarComprobanteLote(id: string) {
    return this.http.get(`${this.gruposApiUrl}/lotes/${encodeURIComponent(id)}/comprobante`, { responseType: 'blob' });
  }

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
