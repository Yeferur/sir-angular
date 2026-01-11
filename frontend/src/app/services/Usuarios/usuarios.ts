import { Injectable, signal } from "@angular/core";
import { WebSocketService } from "../WebSocket/web-socket";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";
import { Observable } from "rxjs";

export type EstadoSesion = 'activa' | 'inactiva' | 'cerrada';

export interface Usuario {
  id_user: string;
  username: string;
  name: string;
  apellidos: string;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private usuarios = signal<Usuario[]>([]);
  private estados = signal<Map<string, EstadoSesion>>(new Map());

  // Guarda la última lista de sesiones activas en la DB
  private sesionesDB = new Set<string>();

constructor(
  private ws: WebSocketService,
  private http: HttpClient
) {
  // Cargar al iniciar
  this.loadUsuariosYEstados();

  // Escuchar WebSocket
  this.ws.messages$.subscribe(msg => {
    if (msg.type === 'usuarios_conectados_actualizados') {
      console.log('📨 Mensaje WebSocket recibido:', msg);
      this.actualizarEstados(msg);
    }
  });

}

private actualizarEstados(msg: any) {
  // Vuelve a cargar las sesiones de DB
  this.http.get<{ usuarios: Usuario[], sesiones: { id_user: string }[] }>(
    `${environment.apiUrl}/usuarios-sesiones`
  ).subscribe(data => {
    this.usuarios.set(data.usuarios);
    
    // Convertir arrays a String de forma consistente
    const usuariosWS = msg.usuarios.map((x: any) => String(x));
    const sesionesDBActuales = new Set(data.sesiones.map(s => String(s.id_user)));

    const nuevosEstados = new Map<string, EstadoSesion>();

    for (const user of data.usuarios) {
      const id = String(user.id_user);
      const enWebSocket = usuariosWS.includes(id);
      const enDB = sesionesDBActuales.has(id);

      console.log('id', id, '| enWebSocket:', enWebSocket, '| enDB:', enDB);

      if (enWebSocket && enDB) {
        nuevosEstados.set(id, 'activa');
      } else if (!enWebSocket && enDB) {
        nuevosEstados.set(id, 'inactiva');
      } else {
        nuevosEstados.set(id, 'cerrada');
      }
    }

    console.log('✅ Nuevo Map de estados:', nuevosEstados);
    this.estados.set(nuevosEstados);
  });
}




  loadUsuariosYEstados() {
    this.http.get<{ usuarios: Usuario[], sesiones: { id_user: string }[] }>(
      `${environment.apiUrl}/usuarios-sesiones`
    ).subscribe(data => {
      this.usuarios.set(data.usuarios);

      const activos = new Set(data.sesiones.map(s => s.id_user));
      const estadosMap = new Map<string, 'activa' | 'inactiva' | 'cerrada'>();

      for (const user of data.usuarios) {
        estadosMap.set(user.id_user, activos.has(user.id_user) ? 'activa' : 'inactiva');
      }

      this.estados.set(estadosMap);
    });
  }



  getUsuariosSignal() {
    return this.usuarios;
  }

  getEstadosSignal() {
    return this.estados;
  }

  // Forzar cierre de sesión (solo admin)
  forzarCierreSesion(userId: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/forceLogout`, { userId });
  }

  // Crear usuario (admin). If payload is FormData, post as multipart/form-data
  crearUsuario(payload: any): Observable<any> {
    if (payload instanceof FormData) {
      return this.http.post(`${environment.apiUrl}/usuarios`, payload);
    }
    return this.http.post(`${environment.apiUrl}/usuarios`, payload);
  }

}
