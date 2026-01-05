// src/app/services/Reservas/reservas.ts
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';
import { WebSocketService } from '../WebSocket/web-socket';

/** ==== Tipos base ==== */
export type Tour = {
  Id_Tour: number;
  Nombre_Tour: string;
  Abreviacion: string;
  Comision_Hotel: number;
  Comision_Agencia: number;
  Comision_Freelance: number;
  Cupo_Base?: number | null;
  Latitud?: number | null;
  Longitud?: number | null;
};
export type Canal = { Id_Canal: number; Nombre_Canal: string; };
export type Moneda = { Id_Moneda: number; Codigo: string; Nombre_Moneda: string; };
export type Plan = { Id_Plan: number; Id_Tour: number; Nombre_Plan: string; };
export type Horario = { Id_Horario: number; HoraSalida: string };
export type PrecioMap = Partial<Record<'ADULTO' | 'NINO' | 'INFANTE', number>>;

export interface Punto {
  Id_Punto: number;
  NombrePunto: string;
}

/** ==== Tipos para Detalle de Reserva (edición) ==== */
export interface CabeceraReserva {
  Id_Reserva: number | string;
  Id_Tour: number;
  Id_Plan?: number | null;
  Fecha_Tour: string;           // YYYY-MM-DD
  Id_Horario?: number | null;
  Idioma_Reserva: string;
  Id_Moneda: number;
  Id_Canal: number;
  Tipo_Reserva: 'Grupal' | 'Privada';
  Id_Punto: number | null;
  Nombre_Reportante: string;
  Telefono_Reportante: string;
  Indicativo?: string;
  Observaciones?: string | null;
  Estado: 'Pendiente' | 'Confirmada';
}

export interface Pasajero {
  Tipo_Pasajero: 'ADULTO' | 'NINO' | 'INFANTE';
  Nombre_Pasajero: string;
  DNI: string | null;
  Telefono_Pasajero?: string | null;
  Id_Punto: number | null;
  Precio_Tour: number;      // precio de referencia guardado
  Precio_Pasajero: number;  // precio real cobrado
  Comision: number;         // comisión por pax (0 si infante)
}

export interface Pago {
  Id_Pago?: number;
  Tipo: 'Pago Directo' | 'Pago Completo' | 'Abono';
  Monto: number;
  Fecha?: string;
  SoporteUrl?: string | null;
}

export interface ReservaDetalle {
  Cabecera: CabeceraReserva;
  Pasajeros: Pasajero[];
  Pagos: Pago[];
}

@Injectable({ providedIn: 'root' })
export class Reservas {
  apiUrl = environment.apiUrl; // ej: '/api'
  private ws = inject(WebSocketService);
  
  // Signals para cambios en tiempo real
  reservaActualizada = signal<any>(null);

  constructor(private http: HttpClient) {
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    this.ws.messages$.subscribe(msg => {
      if (msg.type === 'reservaCreada' || msg.type === 'reservaActualizada' || msg.type === 'reservaEliminada') {
        console.log('📡 Evento de reserva recibido:', msg);
        this.reservaActualizada.set(msg);
      }
    });
  }

  /** ===== Listas ===== */
  getReservas(params: any) {
    let httpParams = new HttpParams();
    Object.keys(params).forEach(k => {
      const v = params[k];
      if (Array.isArray(v)) v.forEach(item => httpParams = httpParams.append(k, String(item)));
      else httpParams = httpParams.set(k, String(v));
    });
    return this.http.get<any[]>(`${this.apiUrl}/reservas`, { params: httpParams });
  }

  getReserva(Id_Reserva: string) {
    const httpParams = new HttpParams().set('Id_Reserva', Id_Reserva);
    return this.http.get<any>(`${this.apiUrl}/reserva`, { params: httpParams });
  }

  getCanales()  { return this.http.get<Canal[]>( `${this.apiUrl}/canales` ); }
  getTours()    { return this.http.get<Tour[]>(  `${this.apiUrl}/tours`   ); }
  getMonedas()  { return this.http.get<Moneda[]>(`${this.apiUrl}/monedas` ); }

  getPlanesByTour(idTour: number) {
    return this.http.get<Plan[]>(`${this.apiUrl}/tours/${idTour}/planes`);
  }

  getDisponibilidadTour(idTour: number) {
    return this.http.get<any>(`${this.apiUrl}/tours/${idTour}/disponibilidad`);
  }

  /** ===== Precios ===== */
  getPrecios(params: { Id_Tour: number; Id_Plan?: number | null; Id_Moneda: number }) {
    let p = new HttpParams()
      .set('Id_Tour', String(params.Id_Tour))
      .set('Id_Moneda', String(params.Id_Moneda));
    if (params.Id_Plan) p = p.set('Id_Plan', String(params.Id_Plan));
    return this.http.get<PrecioMap>(`${this.apiUrl}/precios`, { params: p });
  }

  /** ===== Crear reserva ===== */
  crearReserva(
    data: { cabeceraReserva: any; pasajeros: any[]; pagos: any[] },
    archivos: { completo?: File | null; abonos?: (File | null)[] }
  ) {
    const form = new FormData();
    form.append('payload', JSON.stringify(data));

    if (archivos.completo) form.append('comprobante_pago', archivos.completo);
    if (Array.isArray(archivos.abonos)) {
      archivos.abonos.forEach((f, i) => { if (f) form.append(`abono_${i}`, f); });
    }

    return this.http.post<{ success: boolean; Id_Reserva: string }>(
      `${this.apiUrl}/reservas`,
      form
    );
  }

  // ♻️ Opción JSON si aún la usas en otros flujos
  crearReservaJson(reserva: any): Observable<{ success: boolean; Id_Reserva: string }> {
    return this.http.post<{ success: boolean; Id_Reserva: string }>(`${this.apiUrl}/reservas`, reserva);
  }

  /** ===== Cupos ===== */
  verificarCupos(
    Fecha: string,
    idTour: number,
    cantidad: number,
    Id_Reserva?: string | null
  ): Observable<{
    disponible: boolean;
    cupoTotal: number;
    ocupados: number;
    cuposDisponibles: number;
    nombreTour: string;
  }> {
    let params = new HttpParams()
      .set('Fecha', Fecha)
      .set('Id_Tour', String(idTour))
      .set('cantidad', String(cantidad));
    if (Id_Reserva) {
      params = params.set('Id_Reserva', Id_Reserva);
    }
    return this.http.get<{
      disponible: boolean; cupoTotal: number; ocupados: number; cuposDisponibles: number; nombreTour: string;
    }>(`${this.apiUrl}/reservas/verificar-cupos`, { params });
  }

  /** ===== Puntos ===== */
  buscarPuntos(term: string): Observable<Punto[]> {
    const params = new HttpParams().set('query', term);
    return this.http.get<Punto[]>(`${this.apiUrl}/puntos/query`, { params });
  }

  getPuntoById(Id_Punto: number): Observable<Punto> {
    return this.http.get<Punto>(`${this.apiUrl}/reservas/puntos/${Id_Punto}`);
  }

  /** ===== Horario por (punto principal + tour) =====
   *  Nota: tu BD SIR2 ya no maneja 'Ruta' aquí, solo horario.
   */
  getHorarioPorPunto(Id_Punto: number, Id_Tour: number): Observable<Horario> {
    const params = new HttpParams()
      .set('Id_Punto', String(Id_Punto))
      .set('Id_Tour', String(Id_Tour));
    // ajusta el path al que tengas en tu backend (ej: /puntos/horario)
    return this.http.get<Horario>(`${this.apiUrl}/horarios`, { params });
  }

  /** ===== Comisiones =====
   *  INFANTE = 0 siempre (se maneja en el front). El backend puede devolver solo ADULTO y NINO.
   */
  getComisiones(idTour: number, idCanal: number): Observable<{ ADULTO: number; NINO: number }> {
    const params = new HttpParams()
      .set('Id_Tour', String(idTour))
      .set('Id_Canal', String(idCanal));
    return this.http.get<{ ADULTO: number; NINO: number }>(`${this.apiUrl}/tours/comisiones`, { params });
  }

  /* =============================================================================
   * ==========================  MÉTODOS DE EDICIÓN  =============================
   * ===========================================================================*/

  /** Detalle completo para hidratar el formulario de edición */
  getReservaDetalle(Id_Reserva: number | string): Observable<ReservaDetalle> {
    return this.http.get<ReservaDetalle>(`${this.apiUrl}/reservas/${Id_Reserva}/detalle`);
  }

  /** Actualizar reserva (cabecera + pasajeros + pagos nuevos + archivos) */
  actualizarReserva(
    Id_Reserva: number | string,
    data: { cabeceraReserva: Partial<CabeceraReserva>; pasajeros: Pasajero[]; pagos: any[] },
    archivos: { completo?: File | null; abonos?: (File | null)[] }
  ): Observable<{ success: boolean }> {
    const form = new FormData();
    form.append('payload', JSON.stringify(data));

    // Archivos nuevos (no tocar históricos):
    if (archivos?.completo) form.append('comprobante_pago', archivos.completo);
    if (Array.isArray(archivos?.abonos)) {
      archivos.abonos.forEach((f, i) => { if (f) form.append(`abono_${i}`, f); });
    }

    // Usamos PUT para actualización completa (cámbialo a PATCH si tu backend lo prefiere)
    return this.http.put<{ success: boolean }>(
      `${this.apiUrl}/reservas/${Id_Reserva}`,
      form
    );
  }

  /** Verificar DNI duplicado para una fecha específica */
  verificarDniDuplicado(dni: string, fecha: string): Observable<{ exists: boolean; reserva?: any }> {
    const params = new HttpParams()
      .set('dni', dni)
      .set('fecha', fecha);
    return this.http.get<{ exists: boolean; reserva?: any }>(
      `${this.apiUrl}/reservas/verificar-dni`,
      { params }
    );
  }
}
