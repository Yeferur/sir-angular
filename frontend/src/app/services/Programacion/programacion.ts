import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PlanLogistico, PlanAsistidoPayload } from '../../interfaces/Programacion/reservas';

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
    // Asumo que tienes un endpoint para obtener los tours. Ajústalo si es necesario.
    return this.http.get<any[]>(`${this.apiUrl}/tours`);
  }

  /**
   * Llama al "cerebro" para generar el plan logístico óptimo para un tour.
   * @param fecha - La fecha de la operación.
   * @param idTour - El ID del tour.
   * @returns Observable con las sugerencias del plan logístico.
   */
  generarPlanLogistico(fecha: string, idTour: number): Observable<PlanLogistico> {
    const payload = { fecha, idTour };
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
  guardarListadoFinal(listadoConfirmado: any): Observable<any> {
    // Deberías tener un endpoint específico para guardar el resultado final.
    return this.http.post(`${this.apiUrl}/guardar-listado`, listadoConfirmado);
  }

  /**
   * Exporta un listado (bus) a Excel y devuelve un Blob para descarga.
   */
  exportarListadoBus(payload: { fecha: string; idTour: number; bus: any; nombreTour?: string }): Observable<Blob> {
    return this.http.post(`${this.apiUrl}/exportar-listado-bus`, payload, { responseType: 'blob' });
  }
}
