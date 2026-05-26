// src/app/services/IA/ia.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../Login/login-service';
import { firstValueFrom } from 'rxjs';

export interface IaMessage {
  role: 'user' | 'assistant';
  content: string;
  isIa?: boolean;
  loading?: boolean;
}

export interface IaAccion {
  accion: string;
  label?: string;
  datos: Record<string, any>;
  // Cuando hay múltiples acciones posibles (ej: ver cupos + ver reservas)
  acciones?: Array<{ accion: string; label: string; datos: Record<string, any> }>;
}

export interface IaSessionContext {
  lastIntent?: string;
  lastEntityType?: 'reserva' | 'transfer' | 'tour' | 'punto' | 'dashboard' | 'operacion' | 'unknown';
  lastDate?: string;
  lastTourId?: number | null;
  lastTourName?: string | null;
  lastResults?: Array<{
    id: string | number;
    type: string;
    title?: string;
  }>;
  lastFilters?: Record<string, any>;
}

export interface IaResponse {
  texto: string;
  accion: IaAccion | null;
  contextPatch?: Partial<IaSessionContext>;
  meta?: {
    interactionId?: number;
    mode?: string;
    confidence?: number;
    toolUsed?: string;
    elapsedMs?: number;
  };
  chart?: {
    type: 'bar' | 'line' | 'pie';
    titulo: string;
    data: Array<Record<string, any>>;
    xKey: string;
    yKeys: string[];
  } | null;
}

@Injectable({ providedIn: 'root' })
export class IaService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = environment.apiUrl;

  readonly loading = signal(false);
  readonly historial = signal<IaMessage[]>([]);
  readonly sessionContext = signal<IaSessionContext>({});

  async chat(mensaje: string): Promise<IaResponse> {
    this.loading.set(true);

    // Historial para contexto (solo los últimos 6 mensajes)
    const historialPayload = this.historial()
      .slice(-6)
      .filter(m => !m.loading)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const token = this.auth.getToken();
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const response = await firstValueFrom(
        this.http.post<IaResponse>(
          `${this.apiUrl}/ia/chat`,
          { mensaje, historial: historialPayload, contexto: this.sessionContext() },
          { headers }
        )
      );

      if (response.contextPatch && typeof response.contextPatch === 'object') {
        this.sessionContext.update((current) => ({
          ...current,
          ...response.contextPatch,
        }));
      }

      // Guardar en historial
      this.historial.update(h => [
        ...h,
        { role: 'user', content: mensaje },
        { role: 'assistant', content: response.texto, isIa: true },
      ]);

      return response;
    } finally {
      this.loading.set(false);
    }
  }

  clearHistorial(): void {
    this.historial.set([]);
  }

  clearContext(): void {
    this.sessionContext.set({});
  }
}
