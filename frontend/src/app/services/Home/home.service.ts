import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { SILENT_APP_ACTIVITY } from '../../interceptors/app-activity.interceptor';

export interface HomeProfile {
  id: number;
  name: string;
  avatar: string | null;
  role: string;
  mode: 'management' | 'advisor' | 'client';
}

export interface HomeCapabilities {
  management: boolean;
  operations: boolean;
  clientMode: boolean;
  canCreateReservations: boolean;
  canReadReservations: boolean;
  canUpdateReservations: boolean;
  canCreateTransfers: boolean;
  canReadTransfers: boolean;
  canUpdateTransfers: boolean;
  canReadAforos: boolean;
  canReadReports: boolean;
  canReadProgramming: boolean;
}

export interface HomeDayOverview {
  date: string;
  reservations: number;
  passengers: number;
  privateReservations: number;
  transfers: number;
  transferPassengers: number;
}

export interface HomeReservation {
  Id_Reserva: number;
  Fecha: string;
  Estado: string;
  Tipo_Reserva: string;
  Nombre_Tour: string | null;
  Pasajeros: number;
}

export interface HomeTransfer {
  Id_Transfer: number;
  Fecha: string;
  Hora_Recogida: string | null;
  Estado: string;
  Punto_Salida: string | null;
  Punto_Destino: string | null;
  Cantidad_Personas: number;
  Nombre_Servicio: string | null;
}

export interface HomeActivity {
  Accion: string;
  Tabla: string;
  Id_Registro: number | null;
  Fecha_Hora_Registro: string;
  Usuario?: string | null;
}

export interface HomeProcess {
  id: 'confirmation' | 'programming' | 'insurance' | 'commissions' | string;
  label: string;
  description: string;
  count: number;
  route: string;
  permission: string;
}

export interface HomeCapacityAlert {
  tourId: number;
  tourName: string;
  date: string;
  capacity: number;
  occupied: number;
  percentage: number | null;
  status: 'missing' | 'full' | 'critical' | 'warning';
}

export interface HomeSummary {
  generatedAt: string;
  dates: { today: string; tomorrow: string };
  profile: HomeProfile;
  capabilities: HomeCapabilities;
  overview: { today: HomeDayOverview; tomorrow: HomeDayOverview };
  personalWork: {
    upcomingReservations: HomeReservation[];
    upcomingTransfers: HomeTransfer[];
    pendingReservations: number;
    recentActivity: HomeActivity[];
  };
  operations: {
    processes: HomeProcess[];
    capacityAlerts: HomeCapacityAlert[];
    recentActivity: HomeActivity[];
  };
}

@Injectable({ providedIn: 'root' })
export class HomeService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  getSummary(silent = false): Observable<HomeSummary> {
    const context = new HttpContext().set(SILENT_APP_ACTIVITY, silent);
    return this.http.get<HomeSummary>(`${this.baseUrl}/home/summary`, { context });
  }
}
