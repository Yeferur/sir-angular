import { Injectable, NgZone, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { WebSocketService } from './WebSocket/web-socket';

export interface Privado {
  Id_Reserva: number;
  NumeroPasajeros: number;
}

export interface Tour {
  Id_Tour: number;
  Nombre_Tour: string;
  cupos: number;
  NumeroPasajeros: number;
  totalPrivados: number;
  privados: Privado[];
}

export interface Transfer {
  id: number;
  Servicio: string;
  totalTransfers: number;
}

@Injectable({
  providedIn: 'root'
})
export class InicioService {
  private http = inject(HttpClient);
  private ws = inject(WebSocketService);
  private zone = inject(NgZone);
  private baseUrl = environment.apiUrl;
  
  // Signal para cambios en tiempo real
  aforoActualizado = signal<any>(null);
  reservaActualizada = signal<any>(null);

  constructor() {
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    this.ws.messages$.subscribe(msg => {
      // Asegura que la escritura del signal ocurra dentro de Angular
      this.zone.run(() => {
        if (msg.type === 'aforoActualizado') {
          this.aforoActualizado.set(msg);
        }

        if (msg.type === 'reservaCreada' || msg.type === 'reservaActualizada' || msg.type === 'reservaEliminada') {
          this.reservaActualizada.set(msg);
        }
      });
    });
  }

  getDatosInicio(fecha: string): Observable<{ tours: Tour[]; transfers: Transfer[] }> {
    const url = `${this.baseUrl}/tours-data`;
    // Evitar devoluciones en caché del navegador cuando la URL es idéntica
    const params = { fecha, t: Date.now().toString() };
    return this.http.get<{ tours: Tour[]; transfers: Transfer[] }>(url, { params });
  }

  guardarCupo(body: { SelectTour: number; NuevoCupo: number; Fecha: string; id_user?: number }): Observable<{ message: string }> {
    const url = `${this.baseUrl}/guardar-aforo`;
    return this.http.post<{ message: string }>(url, {
      Id_Tour: body.SelectTour,
      Fecha: body.Fecha,
      NuevoCupo: body.NuevoCupo
    });
  }
}
