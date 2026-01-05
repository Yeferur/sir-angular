import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private ws: WebSocket | null = null;
  public messages$ = new Subject<any>(); // ✅ este observable emite los mensajes
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000; // 3 segundos
  private currentToken: string | null = null;

  constructor(private ngZone: NgZone) {}

  connect(token: string) {
    this.currentToken = token;
    this.reconnectAttempts = 0;
    this.ws = new WebSocket('ws://localhost:5000');

    this.ws.onopen = () => {
      console.log('✅ WebSocket conectado');
      this.reconnectAttempts = 0; // Reset counter on success
      this.send({
        type: 'auth',
        token
      });
    };

    this.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.error('Error parseando mensaje', event.data);
        return;
      }

      // Detener intentos de reconexión si hay error de autenticación
      if (data.type === 'error') {
        console.error('❌ Error de WebSocket:', data.message);
        if (data.message?.includes('Sesión') || data.message?.includes('autenticación')) {
          console.warn('🛑 Sesión inválida - no se intentará reconectar');
          this.currentToken = null; // Invalidar token
          this.ws?.close();
        }
        return;
      }

      // Emitir a cualquier suscriptor
      this.ngZone.run(() => {
        this.messages$.next(data); // ✅ Aquí emite el mensaje recibido
      });
    };

    this.ws.onclose = () => {
      console.warn('❌ WebSocket cerrado');
      this.ws = null;
      this.attemptReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error', err);
    };
  }

  private attemptReconnect() {
    // No reconectar si el token fue invalidado
    if (!this.currentToken) {
      console.log('🛑 Token invalidado - reconexión detenida');
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(`🔄 Reintentando conexión en ${delay}ms (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      this.reconnectTimer = setTimeout(() => {
        if (this.currentToken && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
          this.connect(this.currentToken);
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ No se pudo reconectar después de varios intentos');
    }
  }

  send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.currentToken = null;
    this.reconnectAttempts = 0;
  }
}
