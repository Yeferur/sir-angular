import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EstadoTurno = 'en_turno' | 'fuera_turno' | 'sin_configurar';

export interface TurnoDia {
  diaSemana: number;
  nombreDia: string;
  esLaborable: boolean;
  horaInicio: string | null;
  horaFin: string | null;
}

export interface AsesorTurnos {
  idUsuario: string;
  nombre: string;
  usuario: string;
  correo: string;
  activo: boolean;
  configurado: boolean;
  estadoActual: EstadoTurno;
  turnos: TurnoDia[];
}

export interface TurnosResponse {
  asesores: AsesorTurnos[];
  zonaHoraria: string;
  horaSalidaMaxima: string;
}

export interface MiJornadaResponse {
  jornada: AsesorTurnos;
  zonaHoraria: string;
  horaSalidaMaxima: string;
}

@Injectable({ providedIn: 'root' })
export class TurnosService {
  private readonly baseUrl = `${environment.apiUrl}/turnos`;

  constructor(private readonly http: HttpClient) {}

  listarAsesores(): Observable<TurnosResponse> {
    return this.http.get<TurnosResponse>(`${this.baseUrl}/asesores`);
  }

  obtenerMiJornada(): Observable<MiJornadaResponse> {
    return this.http.get<MiJornadaResponse>(`${this.baseUrl}/mi-jornada`);
  }

  actualizarJornada(idUsuario: string, turnos: TurnoDia[]): Observable<{
    idUsuario: string;
    configurado: boolean;
    estadoActual: EstadoTurno;
    turnos: TurnoDia[];
  }> {
    return this.http.put<any>(`${this.baseUrl}/asesores/${idUsuario}`, { turnos });
  }
}
