import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Subscription } from 'rxjs';

export interface SirNotification {
  idNotificacion: string; tipo: string; titulo: string; mensaje: string; entidadTipo: string | null;
  entidadId: string | null; datos: Record<string, unknown> | null; leida: boolean;
  fechaLectura: string | null; fechaCreacion: string;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/notificaciones`;
  readonly noLeidas = signal(0);
  readonly items = signal<SirNotification[]>([]);
  private loadSub?: Subscription;
  private loadGeneration = 0;

  clear(): void {
    this.loadGeneration += 1;
    this.loadSub?.unsubscribe();
    this.loadSub = undefined;
    this.noLeidas.set(0);
    this.items.set([]);
  }

  load(): void {
    this.loadSub?.unsubscribe();
    const generation = ++this.loadGeneration;
    this.loadSub = this.http.get<{ noLeidas: number; notificaciones: SirNotification[] }>(this.baseUrl).subscribe({
      next: response => {
        if (generation !== this.loadGeneration) return;
        this.noLeidas.set(response.noLeidas || 0);
        this.items.set(response.notificaciones || []);
      },
    });
  }
  markRead(id: string): void {
    this.http.patch(`${this.baseUrl}/${id}/leer`, {}).subscribe({ next: () => {
      this.items.update(items => items.map(item => item.idNotificacion === id ? { ...item, leida: true } : item));
      this.noLeidas.update(value => Math.max(0, value - 1));
    }});
  }
  markAllRead(): void {
    this.http.patch(`${this.baseUrl}/leer-todas`, {}).subscribe({ next: () => {
      this.items.update(items => items.map(item => ({ ...item, leida: true }))); this.noLeidas.set(0);
    }});
  }
}
