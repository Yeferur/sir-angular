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
    this.ws.presenceEvents$.subscribe(msg => {
      if (msg.type === 'usuarios_conectados_actualizados') {
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

        if (enWebSocket && enDB) {
          nuevosEstados.set(id, 'activa');
        } else if (!enWebSocket && enDB) {
          nuevosEstados.set(id, 'inactiva');
        } else {
          nuevosEstados.set(id, 'cerrada');
        }
      }
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

  // Obtener usuario por ID
  obtenerUsuario(id: string): Observable<any> {
    return this.http.get(`${environment.apiUrl}/usuarios/${id}`);
  }

  // Obtener perfil del usuario autenticado
  getMiPerfil(): Observable<any> {
    return this.http.get(`${environment.apiUrl}/perfil`);
  }

  // Actualizar perfil del usuario autenticado (campos seguros)
  actualizarMiPerfil(payload: {
    Nombres_Apellidos: string;
    Telefono_Usuario?: string | null;
    Correo: string;
    Contrasena?: string;
  }): Observable<any> {
    return this.http.put(`${environment.apiUrl}/perfil`, payload);
  }

  // Actualizar usuario
  actualizarUsuario(id: string, payload: any): Observable<any> {
    return this.http.put(`${environment.apiUrl}/usuarios/${id}`, payload);
  }

  // Eliminar usuario
  eliminarUsuario(id: string): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/usuarios/${id}`);
  }

  removeUsuarioFromSignal(id: string): { user: Usuario | null; estado: EstadoSesion | undefined; index: number } {
    const currentUsers = this.usuarios();
    const index = currentUsers.findIndex((u) => String(u.id_user) === String(id));
    if (index < 0) {
      return { user: null, estado: undefined, index: -1 };
    }

    const user = currentUsers[index];
    const estado = this.estados().get(String(id));

    this.usuarios.update((list) => list.filter((u) => String(u.id_user) !== String(id)));
    this.estados.update((map) => {
      const next = new Map(map);
      next.delete(String(id));
      return next;
    });

    return { user, estado, index };
  }

  restoreUsuarioInSignal(user: Usuario, estado: EstadoSesion | undefined, index = -1): void {
    this.usuarios.update((list) => {
      const next = [...list];
      if (index >= 0 && index <= next.length) {
        next.splice(index, 0, user);
      } else {
        next.push(user);
      }
      return next;
    });

    this.estados.update((map) => {
      const next = new Map(map);
      next.set(String(user.id_user), estado || 'inactiva');
      return next;
    });
  }

  // 🎥 Avatar methods

  /**
   * Upload profile photo (FormData with 'avatar' field)
   */
  uploadAvatar(formData: FormData): Observable<any> {
    return this.http.post(`${environment.apiUrl}/perfil/foto`, formData);
  }

  /**
   * Delete profile photo
   */
  deleteAvatar(): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/perfil/foto`);
  }

}
