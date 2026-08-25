import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export type FormaPagoComision = 'TRANSFERENCIA_BANCOLOMBIA' | 'NEQUI' | 'EFECTIVO';
export type EstadoLiquidacion = 'PENDIENTE' | 'PAGADO';
export type TipoBeneficiario = 'HOTEL' | 'AGENCIA' | 'FREELANCE';

export interface DocumentoBeneficiarioComision {
  Id_Documento: number;
  Id_Beneficiario: number;
  Nombre_Original: string;
  Mime_Type: string;
  Tamano_Bytes: number;
  Fecha_Creacion: string;
}

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
  Id_Tour: number;
  Nombre_Tour: string;
  Tipo_Reserva: string | null;
  Num_Pasajeros: number;
  Total_Comision: number;
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

export interface ComisionBeneficiario {
  Key_Beneficiario: string;
  Id_Beneficiario: number | null;
  Id_Canal: number;
  Tipo_Beneficiario: TipoBeneficiario | null;
  Nombre_Reportante: string;
  Telefono: string | null;
  Centralizado: boolean;
  Forma_Pago: FormaPagoComision | null;
  Cuenta_Bancaria: string | null;
  Nombre_Receptor: string | null;
  DNI_Receptor: string | null;
  documentos: DocumentoBeneficiarioComision[];
  Origen_Datos_Pago: 'CENTRALIZADO' | 'HISTORICO' | 'SIN_DATOS';
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
  reportantes: ComisionBeneficiario[];
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

export interface BeneficiarioComisionPayload {
  Id_Beneficiario?: number | null;
  Id_Canal: number;
  Tipo_Beneficiario: TipoBeneficiario;
  Nombre: string;
  Telefono?: string | null;
  Forma_Pago: FormaPagoComision;
  Numero_Cuenta: string | null;
  Nombre_Receptor: string;
  DNI_Receptor: string;
  reservas: string[];
  documentos?: File[];
}

@Injectable({ providedIn: 'root' })
export class ComisionesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/comisiones`;

  listarComisiones(filtros: FiltrosComisiones): Observable<ComisionCanal[]> {
    return this.http.get<unknown>(this.apiUrl, { params: this.params(filtros) }).pipe(
      map((response: any) => response?.data ?? response ?? []),
    );
  }

  actualizarLiquidacion(payload: GrupoPagoComision & { Estado: EstadoLiquidacion }): Observable<{ updated: number }> {
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

  guardarBeneficiario(payload: BeneficiarioComisionPayload): Observable<any> {
    const form = new FormData();
    form.append('Id_Beneficiario', String(payload.Id_Beneficiario || ''));
    form.append('Id_Canal', String(payload.Id_Canal));
    form.append('Tipo_Beneficiario', payload.Tipo_Beneficiario);
    form.append('Nombre', payload.Nombre);
    form.append('Telefono', payload.Telefono || '');
    form.append('Forma_Pago', payload.Forma_Pago);
    form.append('Numero_Cuenta', payload.Numero_Cuenta || '');
    form.append('Nombre_Receptor', payload.Nombre_Receptor);
    form.append('DNI_Receptor', payload.DNI_Receptor);
    form.append('reservas', JSON.stringify(payload.reservas));
    for (const document of payload.documentos || []) form.append('documentos', document, document.name);
    return this.http.post<unknown>(`${this.apiUrl}/beneficiarios`, form).pipe(
      map((response: any) => response?.data ?? response),
    );
  }

  descargarDocumento(idDocumento: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/beneficiarios/documentos/${idDocumento}`, { responseType: 'blob' });
  }

  eliminarDocumento(idBeneficiario: number, idDocumento: number): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/beneficiarios/${idBeneficiario}/documentos/${idDocumento}`);
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
