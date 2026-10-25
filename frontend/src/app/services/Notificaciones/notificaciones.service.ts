import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Subscription } from 'rxjs';
import { SILENT_APP_ACTIVITY } from '../../interceptors/app-activity.interceptor';

export interface SirNotification {
  idNotificacion: string; tipo: string; titulo: string; mensaje: string; entidadTipo: string | null;
  entidadId: string | null; datos: Record<string, unknown> | null; leida: boolean;
  fechaLectura: string | null; fechaCreacion: string;
}

export function notificationDisplayTitle(item: SirNotification): string {
  if (item.tipo.toUpperCase() !== 'APP_UPDATE') return item.titulo;
  const version = String(item.datos?.['version'] || item.entidadId || '').trim();
  return version && !item.titulo.includes(version) ? `${item.titulo} · ${version}` : item.titulo;
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

  load(onLoaded?: (items: SirNotification[]) => void): void {
    this.loadSub?.unsubscribe();
    const generation = ++this.loadGeneration;
    const context = new HttpContext().set(SILENT_APP_ACTIVITY, true);
    this.loadSub = this.http.get<{ noLeidas: number; notificaciones: SirNotification[] }>(this.baseUrl, { context }).subscribe({
      next: response => {
        if (generation !== this.loadGeneration) return;
        this.noLeidas.set(response.noLeidas || 0);
        this.items.set(response.notificaciones || []);
        onLoaded?.(response.notificaciones || []);
      },
    });
  }
  markRead(id: string): void {
    if (this.items().some(item => item.idNotificacion === id && item.tipo === 'ENTIDAD_REPORTANTE_RECHAZADA')) return;
    this.http.patch(`${this.baseUrl}/${id}/leer`, {}).subscribe({ next: () => {
      this.items.update(items => items.map(item => item.idNotificacion === id ? { ...item, leida: true } : item));
      this.noLeidas.update(value => Math.max(0, value - 1));
    }});
  }
  markAllRead(): void {
    this.http.patch(`${this.baseUrl}/leer-todas`, {}).subscribe({ next: () => {
      this.items.update(items => items.map(item => item.tipo === 'ENTIDAD_REPORTANTE_RECHAZADA'
        ? item : { ...item, leida: true }));
      this.noLeidas.set(this.items().filter(item => !item.leida).length);
    }});
  }

  markActivityHandled(type: 'PENDIENTE' | 'RECORDATORIO', sourceId: string): void {
    let changed = 0;
    this.items.update(items => items.map(item => {
      const matches = type === 'RECORDATORIO'
        ? item.tipo.toUpperCase() === type
          && String(item.datos?.['recordatorioId'] || item.entidadId || '') === sourceId
        : item.tipo.toUpperCase() === type
          && String(item.datos?.['pendienteId'] || '') === sourceId;
      if (!matches || item.leida) return item;
      changed += 1;
      return { ...item, leida: true, fechaLectura: new Date().toISOString() };
    }));
    if (changed) this.noLeidas.update(value => Math.max(0, value - changed));
  }
}
