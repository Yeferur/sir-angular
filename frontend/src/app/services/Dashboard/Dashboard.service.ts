import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface DashboardFilters {
  startDate?: string;   // 'YYYY-MM-DD'
  endDate?:   string;   // 'YYYY-MM-DD'
  tourId?:    number;   // null | undefined = todos los tours
  reservationType?: 'Grupal' | 'Privada';
}

export interface DashboardStats {
  totalReservas:      number;
  totalPasajeros:     number;
  totalIngresos:      number;   // bruto
  totalIngresosNetos: number;   // neto
  totalTransfers:     number;
}

export interface IncomeHistory {
  bruto: number[];   // 12 valores, uno por mes
  neto:  number[];   // 12 valores, uno por mes
}

export interface DailyIncome {
  fecha: string;   // 'YYYY-MM-DD'
  bruto: number;
  neto:  number;
}

export interface DailyPassengers {
  fecha:     string;
  pasajeros: number;
}

export interface ChannelPassengers {
  canal:    string;
  cantidad: number;
}

export interface PassengerDistribution {
  estado:   string;
  cantidad: number;
}

export interface ReservationBreakdown {
  tipo: 'Grupales' | 'Privadas';
  reservas: number;
  pasajeros: number;
  bruto: number;
  neto: number;
}

export interface TourOccupancy {
  nombre: string;
  pasajeros: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function toParams(filters: DashboardFilters): HttpParams {
  let p = new HttpParams();
  if (filters.startDate) p = p.set('startDate', filters.startDate);
  if (filters.endDate)   p = p.set('endDate',   filters.endDate);
  if (filters.tourId)    p = p.set('tourId',    String(filters.tourId));
  if (filters.reservationType) p = p.set('reservationType', filters.reservationType);
  return p;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/dashboard`;

  /** KPIs: reservas, pasajeros, ingresos bruto/neto, transfers */
  getStats(filters: DashboardFilters = {}): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.base}/stats`, { params: toParams(filters) });
  }

  /**
   * Ingresos mensuales del año dado.
   * Acepta tourId para filtrar por tour específico.
   */
  getIncomeHistory(year: number, filters: DashboardFilters = {}): Observable<IncomeHistory> {
    const params = toParams(filters).set('year', String(year));
    return this.http.get<IncomeHistory>(`${this.base}/income-history`, { params });
  }

  /**
   * Ingresos bruto + neto agrupados por día dentro del rango.
   * Ideal para la gráfica de rango de fechas.
   */
  getDailyIncome(filters: DashboardFilters = {}): Observable<DailyIncome[]> {
    return this.http.get<DailyIncome[]>(`${this.base}/daily-income`, { params: toParams(filters) });
  }

  /**
   * Pasajeros por día dentro del rango.
   */
  getDailyPassengers(filters: DashboardFilters = {}): Observable<DailyPassengers[]> {
    return this.http.get<DailyPassengers[]>(`${this.base}/daily-passengers`, { params: toParams(filters) });
  }

  /**
   * Pasajeros agrupados por canal de venta.
   */
  getPassengersByChannel(filters: DashboardFilters = {}): Observable<ChannelPassengers[]> {
    return this.http.get<ChannelPassengers[]>(`${this.base}/passengers-by-channel`, { params: toParams(filters) });
  }

  /** Viajeros, no viajeros y pendientes según el cierre de cada jornada. */
  getPassengerDistribution(filters: DashboardFilters = {}): Observable<PassengerDistribution[]> {
    return this.http.get<PassengerDistribution[]>(`${this.base}/passenger-distribution`, { params: toParams(filters) });
  }

  /** Comparativo operativo y financiero de reservas grupales y privadas. */
  getReservationBreakdown(filters: DashboardFilters = {}): Observable<ReservationBreakdown[]> {
    return this.http.get<ReservationBreakdown[]>(`${this.base}/reservation-breakdown`, { params: toParams(filters) });
  }

  /** Top 10 destinos por pasajeros */
  getTourOccupancy(filters: DashboardFilters = {}): Observable<TourOccupancy[]> {
    return this.http.get<TourOccupancy[]>(`${this.base}/tour-occupancy`, { params: toParams(filters) });
  }
}
