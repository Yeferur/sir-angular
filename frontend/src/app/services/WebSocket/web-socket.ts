import { Injectable, NgZone } from '@angular/core';
import { ReplaySubject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;

  // ReplaySubject(1) evita perder mensajes si llegan antes de suscribirse
  public messages$ = new ReplaySubject<any>(1);

  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;

  private currentToken: string | null = null;
  private manualClose = false;

  constructor(private ngZone: NgZone) {}

  connect(token: string) {
    this.currentToken = token;
    this.manualClose = false;

    // Evitar abrir 2 sockets
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';

const wsUrl = !environment.production
  ? `${proto}://localhost:4000/ws`
  : `${proto}://${window.location.host}/ws`;

this.ws = new WebSocket(wsUrl);


    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('✅ WebSocket conectado:', wsUrl);
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

      // Si backend dice auth inválida, cerrar y NO reconectar
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

      // ✅ emitir dentro de Angular
      this.ngZone.run(() => this.messages$.next(data));
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
      // onerror no trae detalle; onclose con code/reason es más útil
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
