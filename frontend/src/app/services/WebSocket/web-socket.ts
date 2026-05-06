import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type WebSocketEventType =
  | 'forceLogout'
  | 'force-logout'
  | 'logout'
  | 'selfLogoutCurrentSession'
  | 'selfLogoutAllSessions'
  | 'adminForceLogout'
  | 'usuarios_conectados_actualizados'
  | 'aforoActualizado'
  | 'reservaCreada'
  | 'reservaActualizada'
  | 'reservaEliminada'
  | 'transferCreado'
  | 'transferActualizado'
  | 'transferEliminado'
  | 'tourActualizado'
  | 'puntoActualizado'
  | 'puntoActualizada'
  | 'listadoActualizado'
  | 'catalogoActualizado'
  | 'monedaActualizada'
  | 'canalActualizado'
  | 'rangoTransferActualizado'
  | 'precioTransferActualizado'
  | string;

export interface WebSocketEvent<T = any> {
  type: WebSocketEventType;
  payload: T;
  raw: any;
  receivedAt: number;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;

  private messagesSubject = new Subject<any>();
  public messages$: Observable<any> = this.messagesSubject.asObservable();

  private eventsSubject = new Subject<WebSocketEvent>();
  public events$: Observable<WebSocketEvent> = this.eventsSubject.asObservable();

  public readonly systemEvents$ = this.streamForTypes([
    'forceLogout',
    'force-logout',
    'logout',
    'selfLogoutCurrentSession',
    'selfLogoutAllSessions',
    'adminForceLogout'
  ]);
  public readonly presenceEvents$ = this.streamForTypes(['usuarios_conectados_actualizados']);
  public readonly aforoEvents$ = this.streamForTypes(['aforoActualizado']);
  public readonly reservationEvents$ = this.streamForTypes(['reservaCreada', 'reservaActualizada', 'reservaEliminada']);
  public readonly transferEvents$ = this.streamForTypes(['transferCreado', 'transferActualizado', 'transferEliminado', 'rangoTransferActualizado', 'precioTransferActualizado']);
  public readonly tourEvents$ = this.streamForTypes(['tourActualizado']);
  public readonly pointEvents$ = this.streamForTypes(['puntoActualizado', 'puntoActualizada']);
  public readonly listingEvents$ = this.streamForTypes(['listadoActualizado']);
  public readonly catalogEvents$ = this.streamForTypes(['catalogoActualizado', 'monedaActualizada', 'canalActualizado']);

  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;

  private currentToken: string | null = null;
  private manualClose = false;

  constructor(private ngZone: NgZone) {}

  private normalizeEvent(data: any): WebSocketEvent {
    const type = String(data?.type || '') as WebSocketEventType;
    return {
      type,
      payload: data,
      raw: data,
      receivedAt: Date.now(),
    };
  }

  private streamForTypes(types: string[]): Observable<any> {
    return new Observable<any>((subscriber) => {
      const subscription = this.events$.subscribe((event) => {
        if (types.includes(String(event.type))) {
          subscriber.next(event.payload);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  connect(token: string) {
    this.currentToken = token;
    this.manualClose = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;

    const isLocal = host === 'localhost' || host === '127.0.0.1';

    const wsUrl = isLocal
      ? `${proto}://localhost:4000/ws`
      : `${proto}://${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.send({ type: 'auth', token });
    };

    this.ws.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.error('❌ Error parseando WS:', event.data);
        return;
      }

      if (data.type === 'error') {
        console.error('❌ WS error:', data.message);

        const msg = String(data.message || '').toLowerCase();
        if (msg.includes('sesión') || msg.includes('sesion') || msg.includes('autentic')) {
          console.warn('🛑 Sesión inválida - no se reconecta');
          this.currentToken = null;
          this.manualClose = true;
          try { this.ws?.close(1000, 'auth_failed'); } catch {}
        }
        return;
      }

      this.ngZone.run(() => {
        this.messagesSubject.next(data);
        this.eventsSubject.next(this.normalizeEvent(data));
      });
    };

    this.ws.onclose = (e) => {
      console.warn('❌ WS cerrado', { code: e.code, reason: e.reason, wasClean: e.wasClean });
      this.ws = null;

      if (!this.manualClose) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('❌ WebSocket error', err);
    };
  }

  private attemptReconnect() {
    if (!this.currentToken) {
      console.log('🛑 Token invalidado - reconexión detenida');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ No se pudo reconectar después de varios intentos');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`🔄 Reintentando en ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.currentToken && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.connect(this.currentToken);
      }
    }, delay);
  }

  send(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    this.manualClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.currentToken = null;
    this.reconnectAttempts = 0;

    if (this.ws) {
      try { this.ws.close(1000, 'manual_disconnect'); } catch {}
      this.ws = null;
    }
  }
}
