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
  totalReservasCanceladas: number;
  reservationStatuses: ReservationStatusSummary[];
  passengerAge: PassengerAgeSummary[];
  totalPasajeros:     number;
  totalIngresos:      number;   // bruto
  totalIngresosNetos: number;   // neto
  totalTransfers:     number;
  totalTransferPassengers: number;
  totalViajaron: number;
  totalNoViajaron: number;
  totalPendientes: number;
  closedJourneys: number;
  pendingJourneys: number;
  primaryCurrency: string;
  mixedCurrencies: boolean;
  companyRevenue: number;
  transferRevenue: number;
  scheduledTourRevenue: number;
  tourCommission: number;
  collectedRevenue: number;
  pendingCollection: number;
  noShowAdjustment: number;
  financialByCurrency: FinancialCurrencySummary[];
  comparison: DashboardComparison | null;
}

export interface ReservationStatusSummary {
  estado: string;
  cantidad: number;
}

export interface PassengerAgeSummary {
  tipo: string;
  cantidad: number;
}

export interface FinancialCurrencySummary {
  currency: string;
  scheduledTours: number;
  tourRevenue: number;
  tourCommission: number;
  tourNetRevenue: number;
  transferRevenue: number;
  companyRevenue: number;
  collectedFull: number;
  collectedAbonos: number;
  collectedTotal: number;
  pendingCollection: number;
  noShowAdjustment: number;
}

export interface DashboardComparison {
  period: { startDate: string; endDate: string };
  reservationsPct: number | null;
  passengersPct: number | null;
  companyRevenuePct: number | null;
  transferRevenuePct: number | null;
  travelRateDelta: number | null;
}

export interface IncomeHistory {
  bruto: number[];   // 12 valores, uno por mes
  neto:  number[];   // 12 valores, uno por mes
  transfers: number[];
  empresa: number[];
}

export interface DailyIncome {
  fecha: string;   // 'YYYY-MM-DD'
  bruto: number;
  neto:  number;
  transfer: number;
  empresa: number;
}

export interface DailyPassengers {
  fecha:     string;
  tour:      string;
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
  idPlan?: number | null;
  reservas?: number;
  adultos?: number;
  ninos?: number;
  infantes?: number;
  sinPlan?: boolean;
}

export interface DashboardOperational {
  idiomas: DashboardLanguageRow[];
  puntos: DashboardPointRow[];
  inasistenciaCanal: DashboardAbsenceRow[];
  inasistenciaTour: DashboardAbsenceRow[];
  tarifas: DashboardTariffRow[];
  pasaportes: DashboardPassportRow[];
  canalFinanciero: DashboardChannelFinancialRow[];
}

export interface DashboardLanguageRow { idioma: string; registrados: number; viajaron: number; }
export interface DashboardPointRow { punto: string; registrados: number; viajaron: number; }
export interface DashboardAbsenceRow { canal?: string; tour?: string; programados: number; viajaron: number; noViajaron: number; pendientes: number; }
export interface DashboardTariffRow { tarifa: string; pasajeros: number; ingresos: number; }
export interface DashboardPassportRow { plan: string; pasajeros: number; }
export interface DashboardChannelFinancialRow { canal: string; viajaron: number; ingresos: number; comisiones: number; }

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

  /** Top 10 tours o, al seleccionar un tour con varios planes, desglose por plan. */
  getTourOccupancy(filters: DashboardFilters = {}): Observable<TourOccupancy[]> {
    return this.http.get<TourOccupancy[]>(`${this.base}/tour-occupancy`, { params: toParams(filters) });
  }

  getOperational(filters: DashboardFilters = {}): Observable<DashboardOperational> {
    return this.http.get<DashboardOperational>(`${this.base}/operational`, { params: toParams(filters) });
  }
}
