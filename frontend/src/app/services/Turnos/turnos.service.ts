import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EstadoTurno = 'en_turno' | 'fuera_turno' | 'sin_configurar';
export type EstadoSemana = 'borrador' | 'publicado' | 'pendiente_republicacion';

export interface CanalTurno {
  idCanal: string;
  nombreCanal: string;
}

export interface VacacionTurno {
  idVacacion: string | null;
  fechaInicio: string;
  fechaFin: string;
  fechaRegreso: string;
  diasHabiles: number;
  estado: 'programada' | 'cancelada';
  observaciones?: string | null;
}

export interface TurnoDia {
  idTurnoDia: string | null;
  diaSemana: number;
  nombreDia: string;
  fecha: string;
  esLaborable: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  esSupernumerario: boolean;
}

export interface SemanaTurno {
  idSemana: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoSemana;
  fechaUltimaPublicacion?: string | null;
}

export interface AsesorSemana {
  idUsuario: string;
  nombre: string;
  usuario: string;
  correo: string;
  activo: boolean;
  canal: CanalTurno | null;
  canalBase: CanalTurno | null;
  canalSemanal: CanalTurno | null;
  vacacion: VacacionTurno | null;
  esSupernumerario: boolean;
  configurado: boolean;
  estadoActual: EstadoTurno;
  turnos: TurnoDia[];
}

export interface SemanaTurnoResponse {
  semana: SemanaTurno;
  asesores: AsesorSemana[];
  horaSalidaMaxima: string;
  pasoMinutos: number;
}

export interface HistorialSemana {
  idSemana: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoSemana;
  fechaUltimaPublicacion: string | null;
}

export interface MiJornadaSemana {
  idUsuario: string;
  nombre: string;
  usuario: string;
  correo: string;
  activo: boolean;
  canal: CanalTurno | null;
  vacacion: VacacionTurno | null;
  semana: { idSemana: string; fechaInicio: string; fechaFin: string; estado: EstadoSemana };
  esSupernumerario: boolean;
  configurado: boolean;
  estadoActual: EstadoTurno;
  turnos: TurnoDia[];
}

export interface MiJornadaResponse {
  jornada: MiJornadaSemana;
  zonaHoraria: string;
  horaSalidaMaxima: string;
}

export interface ActualizarAsesorSemanaPayload {
  turnos: Array<{ diaSemana: number; esLaborable: boolean; horaInicio: string | null; horaFin: string | null }>;
  esSupernumerario: boolean;
  idCanalSemanal: string | null;
  vacacion: Omit<VacacionTurno, 'estado'> | null;
}

export interface PublicarSemanaPayload {
  jornadas: Array<ActualizarAsesorSemanaPayload & { idUsuario: string }>;
  aceptarAdvertencias: boolean;
}

export interface AsesorIntercambio {
  idUsuario: string; nombre: string; horaInicio: string; horaFin: string;
}

export interface IntercambioTurno {
  idIntercambio: string; fecha: string; estado: 'pendiente'|'aceptado'|'rechazado'|'cancelado'|'expirado';
  esSolicitante: boolean; solicitante: string; receptor: string; motivo: string | null;
  horarioSolicitante: { inicio: string; fin: string };
  horarioReceptor: { inicio: string; fin: string };
  fechaCreacion: string; fechaRespuesta: string | null;
}

@Injectable({ providedIn: 'root' })
export class TurnosService {
  private readonly baseUrl = `${environment.apiUrl}/turnos`;

  constructor(private readonly http: HttpClient) {}

  obtenerCanales(): Observable<{ canales: CanalTurno[] }> {
    return this.http.get<{ canales: CanalTurno[] }>(`${this.baseUrl}/canales`);
  }

  obtenerSemana(fecha?: string): Observable<SemanaTurnoResponse> {
    const params = fecha ? { fecha } : undefined;
    return this.http.get<SemanaTurnoResponse>(`${this.baseUrl}/semanas`, { params });
  }

  obtenerHistorial(): Observable<{ semanas: HistorialSemana[] }> {
    return this.http.get<{ semanas: HistorialSemana[] }>(`${this.baseUrl}/semanas/historial`);
  }

  obtenerMiJornada(fecha?: string): Observable<MiJornadaResponse> {
    const params = fecha ? { fecha } : undefined;
    return this.http.get<MiJornadaResponse>(`${this.baseUrl}/mi-jornada`, { params });
  }

  publicarSemana(idSemana: string, payload: PublicarSemanaPayload): Observable<{ idSemana: string; estado: EstadoSemana }> {
    return this.http.post<{ idSemana: string; estado: EstadoSemana }>(`${this.baseUrl}/semanas/${idSemana}/publicar`, payload);
  }

  obtenerOpcionesIntercambio(fecha: string): Observable<{ asesores: AsesorIntercambio[] }> {
    return this.http.get<{ asesores: AsesorIntercambio[] }>(`${this.baseUrl}/intercambios/opciones`, { params: { fecha } });
  }

  obtenerMisIntercambios(): Observable<{ intercambios: IntercambioTurno[] }> {
    return this.http.get<{ intercambios: IntercambioTurno[] }>(`${this.baseUrl}/intercambios`);
  }

  solicitarIntercambio(fecha: string, idReceptor: string, motivo: string): Observable<{ idIntercambio: string; estado: string }> {
    return this.http.post<{ idIntercambio: string; estado: string }>(`${this.baseUrl}/intercambios`, { fecha, idReceptor, motivo });
  }

  responderIntercambio(id: string, aceptar: boolean): Observable<{ idIntercambio: string; estado: string }> {
    return this.http.patch<{ idIntercambio: string; estado: string }>(`${this.baseUrl}/intercambios/${id}/responder`, { aceptar });
  }

  cancelarIntercambio(id: string): Observable<{ idIntercambio: string; estado: string }> {
    return this.http.patch<{ idIntercambio: string; estado: string }>(`${this.baseUrl}/intercambios/${id}/cancelar`, {});
  }

}
