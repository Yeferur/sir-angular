import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { PlanLogistico, PlanAsistidoPayload, DestinoTourProgramacion } from '../../interfaces/Programacion/reservas';

interface ListadoPayload {
  fecha: string;
  idTour?: number;
  idsTours?: number[];
  buses?: any[];
}

export interface ListadoProgramacionResponse {
  exists: boolean;
  fromSnapshot?: boolean;
  idProgramacion?: number;
  confirmadoEn?: string;
  buses: any[];
  reservasSinAsignar: any[];
  privados?: any[];
  destinoTour?: DestinoTourProgramacion | null;
}

@Injectable({
  providedIn: 'root'
})
export class ProgramacionDashboardService {
  private apiUrl = environment.apiUrl; // URL de tu API desde el environment

  private http = inject(HttpClient);

  /**
   * Obtiene todos los tours activos desde el backend.
   * @returns Observable con la lista de tours.
   */
  getTours(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/tours`).pipe(
      map(tours => tours.map(tour => ({
        ...tour,
        NombreTour: tour.Nombre_Tour
      })))
    );
  }

  /**
   * Llama al "cerebro" para generar el plan logístico óptimo para un tour.
   * @param fecha - La fecha de la operación.
   * @param idTour - El ID del tour.
   * @returns Observable con las sugerencias del plan logístico.
   */
  generarPlanLogistico(fecha: string, idTour: number | number[]): Observable<PlanLogistico> {
    const payload: any = { fecha };
    if (Array.isArray(idTour)) {
      payload.idsTours = idTour;
    } else {
      payload.idTour = idTour;
    }
    return this.http.post<PlanLogistico>(`${this.apiUrl}/plan-logistico`, payload);
  }

  /**
   * Llama al "cerebro" en Modo Asistido con una flota definida por el usuario.
   * @param payload - Contiene fecha, idTour, flotaManual y reservasAncladas.
   * @returns Observable con el plan logístico generado para la flota específica.
   */
  generarPlanAsistido(payload: PlanAsistidoPayload): Observable<PlanLogistico> {
    return this.http.post<PlanLogistico>(`${this.apiUrl}/plan-asistido`, payload);
  }

  /**
   * Guarda el listado final confirmado.
   * @param listadoConfirmado - El objeto del listado final a guardar.
   * @returns Observable de la respuesta del servidor.
   */
  guardarListadoFinal(listadoConfirmado: ListadoPayload): Observable<any> {
    // Deberías tener un endpoint específico para guardar el resultado final.
    return this.http.post(`${this.apiUrl}/guardar-listado`, listadoConfirmado);
  }

  /**
   * Consulta si existe un listado guardado para fecha/tour.
   */
  obtenerListadoFinal(payload: ListadoPayload): Observable<ListadoProgramacionResponse> {
    return this.http.post<ListadoProgramacionResponse>(`${this.apiUrl}/listado-existente`, payload);
  }

  /**
   * Exporta un listado (bus) a Excel y devuelve un Blob para descarga.
   */
  /**
   * Consulta el resumen de reservas privadas para una fecha dada.
   * Se llama desde el dashboard al cargar, sin necesidad de abrir un tour.
   */
  resumenPrivadosDia(fecha: string, idsTours?: number[]): Observable<{
    totalReservas: number;
    totalBuses: number;
    totalPax: number;
    privados: any[];
  }> {
    const payload: any = { fecha };
    if (idsTours && idsTours.length > 0) payload.idsTours = idsTours;
    return this.http.post<any>(`${this.apiUrl}/privados-del-dia`, payload);
  }

  exportarReservaPrivada(payload: {
    fecha: string;
    idReserva: string | number;
    idTour?: number;
    nombreTour?: string;
    nombreReportante?: string;
    buses: any[];
  }): Observable<Blob> {
    return this.http.post(`${this.apiUrl}/exportar-reserva-privada`, payload, { responseType: 'blob' });
  }

  exportarListadoBus(payload: { fecha: string; idTour: number; bus: any; nombreTour?: string }): Observable<Blob> {
    return this.http.post(`${this.apiUrl}/exportar-listado-bus`, payload, { responseType: 'blob' });
  }
}
