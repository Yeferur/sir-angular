import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export type PendingPriority = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export interface OperationalPending {
  idPendiente: string;
  regla: string;
  entidadTipo: string;
  entidadId: string;
  titulo: string;
  descripcion: string | null;
  prioridad: PendingPriority;
  estado: 'ACTIVO' | 'RESUELTO_AUTOMATICAMENTE' | 'DESCARTADO';
  fechaOperacion: string | null;
  fechaLimite: string | null;
  suprimidoHasta: string | null;
  estaSuprimido: boolean;
  siguienteRecordatorio: string | null;
  permiteDescarte: boolean;
  requiereJustificacion: boolean;
  posposicionMaxMinutos: number | null;
  primeraDeteccion: string;
  ultimaDeteccion: string;
  datos: Record<string, unknown> | null;
}

export interface PersonalReminder {
  idRecordatorio: string;
  titulo: string;
  descripcion: string | null;
  fecha: string;
  recurrencia: string | null;
  intervalo: string | null;
  recordarTodoElDia: boolean;
  intervaloTodoElDia: string | null;
  siguienteTrigger: string | null;
  estado: 'ACTIVO' | 'COMPLETADO';
  suprimidoHasta: string | null;
  estaSuprimido: boolean;
  entidadTipo: string | null;
  entidadId: string | null;
  fechaCreacion: string;
  fechaActualizacion: string;
}

export interface ReminderInput {
  titulo: string;
  descripcion?: string;
  fecha: string;
  recurrencia?: string | null;
  entidadTipo?: string | null;
  entidadId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PendientesService {
  private readonly http = inject(HttpClient);
  private readonly pendingUrl = `${environment.apiUrl}/pendientes`;
  private readonly reminderUrl = `${environment.apiUrl}/recordatorios`;
  readonly activeCount = signal(0);

  listPending(includeSuppressed = true): Observable<{ pendientes: OperationalPending[]; total: number }> {
    return this.http.get<{ pendientes: OperationalPending[]; total: number }>(
      this.pendingUrl,
      { params: { incluirSuprimidos: String(includeSuppressed) } },
    ).pipe(tap(response => this.activeCount.set(response.total || 0)));
  }

  loadCount(): void {
    this.listPending(false).subscribe({ error: () => this.activeCount.set(0) });
  }

  clear(): void { this.activeCount.set(0); }

  postponePending(id: string, suprimidoHasta: string): Observable<unknown> {
    return this.http.patch(`${this.pendingUrl}/${id}/posponer`, { suprimidoHasta });
  }

  dismissPending(id: string, motivo: string): Observable<unknown> {
    return this.http.patch(`${this.pendingUrl}/${id}/descartar`, { motivo });
  }

  listReminders(includeCompleted = false): Observable<{ recordatorios: PersonalReminder[]; total: number }> {
    return this.http.get<{ recordatorios: PersonalReminder[]; total: number }>(
      this.reminderUrl,
      { params: { incluirCompletados: String(includeCompleted) } },
    );
  }

  createReminder(input: ReminderInput): Observable<PersonalReminder> {
    return this.http.post<PersonalReminder>(this.reminderUrl, input);
  }

  updateReminder(id: string, input: Partial<ReminderInput>): Observable<PersonalReminder> {
    return this.http.patch<PersonalReminder>(`${this.reminderUrl}/${id}`, input);
  }

  postponeReminder(id: string, suprimidoHasta: string): Observable<PersonalReminder> {
    return this.http.patch<PersonalReminder>(`${this.reminderUrl}/${id}/posponer`, { suprimidoHasta });
  }

  completeReminder(id: string): Observable<PersonalReminder> {
    return this.http.patch<PersonalReminder>(`${this.reminderUrl}/${id}/completar`, {});
  }

  deleteReminder(id: string): Observable<unknown> {
    return this.http.delete(`${this.reminderUrl}/${id}`);
  }
}
